/**
 * Test harness helpers for the server package.
 *
 * Everything here is `/test-utils.ts` (not `.test.ts`) so it does not
 * run under vitest as a suite — it only lives in `src/` so the
 * workspace `tsconfig` type-checks it alongside the production code.
 *
 * Nothing in this file may be imported from a non-test module; the
 * separator is enforced by convention rather than by tooling.
 */

import { type AegisPolicy, DEFAULT_POLICY } from "@aegis/core";
import type { ExecOutcome, PolyglotExecutor, SandboxConfig } from "@aegis/engine";
import {
	CONTENT_INDEX_MIGRATIONS,
	ContentIndex,
	type Database,
	openDatabase,
	runMigrations,
} from "@aegis/storage";
import {
	createServerCounters,
	type FetchLike,
	type FetchResponse,
	type ServerContext,
} from "./context.js";

/** Fake executor whose outcomes are supplied per invocation. */
export class StubExecutor {
	calls: SandboxConfig[] = [];
	#outcomes: ExecOutcome[];

	constructor(outcomes: readonly ExecOutcome[]) {
		this.#outcomes = [...outcomes];
	}

	execute = async (config: SandboxConfig): Promise<ExecOutcome> => {
		this.calls.push(config);
		const next = this.#outcomes.shift();
		if (next === undefined) {
			return { status: "error", error: "stub executor exhausted" };
		}
		return next;
	};

	asPolyglot(): PolyglotExecutor {
		// The server only calls `.execute()` on the executor, so a
		// structurally-typed cast is safe. We never need a real
		// `PolyglotExecutor` in tests.
		return this as unknown as PolyglotExecutor;
	}
}

/** Fixed-response fetch stub for `aegis_fetch` tests. */
export function stubFetch(
	fn: (url: string, init?: Parameters<FetchLike>[1]) => Promise<FetchResponse> | FetchResponse,
): FetchLike {
	return async (url, init) => fn(url, init);
}

/** Build a plain `FetchResponse` for stub fetchers. */
export function fetchResponse(
	init: {
		readonly ok: boolean;
		readonly status: number;
		readonly statusText?: string;
		readonly body: string;
		readonly headers?: Record<string, string>;
	},
): FetchResponse {
	const headers = init.headers ?? {};
	const lowered: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
	return {
		ok: init.ok,
		status: init.status,
		statusText: init.statusText ?? "",
		headers: {
			get(name) {
				return lowered[name.toLowerCase()] ?? null;
			},
		},
		text: async () => init.body,
	};
}

/**
 * Open an in-memory SQLite-backed `ContentIndex` with all content
 * migrations applied. Callers are responsible for `db.close()`.
 */
export async function openInMemoryContentIndex(): Promise<{
	readonly db: Database;
	readonly contentIndex: ContentIndex;
}> {
	const { db } = await openDatabase({ path: ":memory:", backend: "better-sqlite3" });
	runMigrations(db, CONTENT_INDEX_MIGRATIONS);
	const contentIndex = new ContentIndex(db);
	return { db, contentIndex };
}

/** Options accepted by {@link buildTestContext}. */
export interface BuildTestContextOptions {
	readonly executor?: PolyglotExecutor;
	readonly fetch?: FetchLike;
	readonly now?: () => Date;
	readonly startedAt?: number;
	readonly policy?: AegisPolicy;
}

/**
 * Create a complete ServerContext backed by an in-memory content index and return a cleanup handle.
 *
 * The returned context is initialized with migrations applied and sensible defaults for executor,
 * fetch, time, policy, and counters when those options are not provided.
 *
 * @param opts - Optional overrides for parts of the test context:
 *   - `executor`: custom PolyglotExecutor to use instead of the default stub executor.
 *   - `fetch`: custom FetchLike implementation to use instead of the default stub that throws.
 *   - `now`: function returning the current Date; used to derive `startedAt` if not provided.
 *   - `startedAt`: numeric timestamp to use as the server start time.
 *   - `policy`: AegisPolicy to apply to the context; defaults to `DEFAULT_POLICY`.
 * @returns An object with `ctx`, the created ServerContext, and `close()`, a function that closes the underlying in-memory database.
 */
export async function buildTestContext(
	opts: BuildTestContextOptions = {},
): Promise<{ readonly ctx: ServerContext; readonly close: () => void; }> {
	const { db, contentIndex } = await openInMemoryContentIndex();
	const executor = opts.executor ?? new StubExecutor([]).asPolyglot();
	const fetchImpl = opts.fetch ?? stubFetch(() => {
		throw new Error("fetch not stubbed");
	});
	const now = opts.now ?? (() => new Date("2025-01-01T00:00:00.000Z"));
	const ctx: ServerContext = {
		executor,
		contentIndex,
		db,
		platform: undefined,
		policy: opts.policy ?? DEFAULT_POLICY,
		startedAt: opts.startedAt ?? now().getTime(),
		counters: createServerCounters(),
		now,
		fetch: fetchImpl,
	};
	return { ctx, close: () => db.close() };
}
