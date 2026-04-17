/**
 * Shared runtime context passed to every tool handler.
 *
 * The server owns one `ServerContext` for the lifetime of the process;
 * tool handlers are pure functions of `(args, ctx)` so they can be
 * tested with stub executors, in-memory content indexes, fake clocks,
 * and mocked HTTP fetchers without reaching the network or touching
 * the real filesystem.
 */

import type { PlatformCapabilities } from "@aegis/adapters";
import type { PolyglotExecutor } from "@aegis/engine";
import type { ContentIndex, Database } from "@aegis/storage";

/**
 * Minimal fetch signature. Subset of the DOM `fetch` used by
 * `aegis_fetch`; declared here so the server never depends on the
 * global `fetch` directly and tests can inject a deterministic
 * implementation.
 */
export type FetchLike = (
	url: string,
	init?: { readonly headers?: Record<string, string>; },
) => Promise<FetchResponse>;

/** Minimum surface needed from a fetch response. */
export interface FetchResponse {
	readonly ok: boolean;
	readonly status: number;
	readonly statusText: string;
	readonly headers: {
		get(name: string): string | null;
	};
	text(): Promise<string>;
}

/**
 * Mutable counters tracked across tool invocations. Pure increment
 * operations — tool handlers must not reorder fields or introduce new
 * counters here without a corresponding update to `aegis_stats`.
 */
export interface ServerCounters {
	executeCalls: number;
	executeSuccesses: number;
	executeFailures: number;
	executeTimeouts: number;
	executeErrors: number;
	executeBytesSaved: number;
	searchCalls: number;
	searchResultsReturned: number;
	indexCalls: number;
	indexChunksAdded: number;
	indexSourcesReused: number;
	fetchCalls: number;
	fetchBytesFetched: number;
	fetchCacheHits: number;
	doctorCalls: number;
}

export function createServerCounters(): ServerCounters {
	return {
		executeCalls: 0,
		executeSuccesses: 0,
		executeFailures: 0,
		executeTimeouts: 0,
		executeErrors: 0,
		executeBytesSaved: 0,
		searchCalls: 0,
		searchResultsReturned: 0,
		indexCalls: 0,
		indexChunksAdded: 0,
		indexSourcesReused: 0,
		fetchCalls: 0,
		fetchBytesFetched: 0,
		fetchCacheHits: 0,
		doctorCalls: 0,
	};
}

/**
 * All state needed by a tool handler. Passed explicitly rather than
 * stashed in module-level singletons so each handler's inputs are
 * visible at the call site and the full wiring can be replaced in
 * tests with a single object.
 */
export interface ServerContext {
	readonly executor: PolyglotExecutor;
	readonly contentIndex: ContentIndex;
	readonly db: Database;
	/** Platform capabilities reported by the detected adapter; undefined in tests or when no platform is detected. */
	readonly platform: PlatformCapabilities | undefined;
	/** Process start time in ms since the epoch — used by `aegis_stats`. */
	readonly startedAt: number;
	readonly counters: ServerCounters;
	/** Injectable clock so tests can assert on timestamps without freezing global time. */
	readonly now: () => Date;
	/** Injectable fetch so `aegis_fetch` is unit-testable without a real network. */
	readonly fetch: FetchLike;
}
