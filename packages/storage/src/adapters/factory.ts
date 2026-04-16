/**
 * SQLite backend auto-detection and factory.
 *
 * Selection priority (per ADR-0006):
 *   1. `bun:sqlite`        — when running on Bun
 *   2. `node:sqlite`       — when available (Node 22+ with `--experimental-sqlite`, or Node 24+)
 *   3. `better-sqlite3`    — fallback (npm dep, native addon)
 *
 * The user can force a specific backend with the `AEGIS_SQLITE_BACKEND`
 * environment variable or by passing `backend` explicitly. This is useful
 * for test matrices that exercise every backend regardless of host runtime.
 */

import { openBetterSqlite } from "./better-sqlite3.js";
import { openBunSqlite } from "./bun-sqlite.js";
import { openNodeSqlite } from "./node-sqlite.js";
import type { Database, SqliteBackend } from "./types.js";

/** Options accepted by `openDatabase`. */
export interface OpenDatabaseOptions {
	/** Filesystem path to the SQLite file, or `:memory:` for an in-memory database. */
	readonly path: string;
	/** Force a specific backend. Defaults to auto-detection. */
	readonly backend?: SqliteBackend;
}

/** The chosen backend identifier plus the opened database. */
export interface OpenedDatabase {
	readonly backend: SqliteBackend;
	readonly db: Database;
}

interface BunGlobal {
	version?: string;
}

declare const Bun: BunGlobal | undefined;

function isBunRuntime(): boolean {
	return typeof Bun !== "undefined" && typeof Bun.version === "string";
}

/**
 * Resolve the backend identifier to use, considering the explicit override,
 * the `AEGIS_SQLITE_BACKEND` env var, and the runtime.
 */
export function detectBackend(override?: SqliteBackend): SqliteBackend {
	if (override) return override;
	const envOverride = process.env["AEGIS_SQLITE_BACKEND"];
	if (
		envOverride === "better-sqlite3"
		|| envOverride === "node-sqlite"
		|| envOverride === "bun-sqlite"
	) {
		return envOverride;
	}
	if (isBunRuntime()) return "bun-sqlite";
	// Probe node:sqlite synchronously via process.versions to avoid awaiting
	// here; the actual import happens inside openNodeSqlite. We only fall back
	// to better-sqlite3 if Node is older than 22 (where node:sqlite cannot be
	// available at all).
	const nodeMajor = Number(process.versions.node.split(".")[0]);
	if (Number.isFinite(nodeMajor) && nodeMajor >= 22) return "node-sqlite";
	return "better-sqlite3";
}

/**
 * Open a database, falling back through the backend priority list if the
 * preferred backend is unavailable. Always returns the actual backend used
 * so callers can log it (and tests can assert on it).
 */
export async function openDatabase(opts: OpenDatabaseOptions): Promise<OpenedDatabase> {
	const preferred = detectBackend(opts.backend);
	const tryOrder: readonly SqliteBackend[] = opts.backend
		? [opts.backend]
		: dedupe([preferred, "node-sqlite", "better-sqlite3"]);

	let lastError: unknown;
	for (const backend of tryOrder) {
		try {
			const db = await openByBackend(backend, opts.path);
			return { backend, db };
		} catch (err) {
			lastError = err;
		}
	}
	throw new Error(
		`No SQLite backend available. Tried: ${tryOrder.join(", ")}. Last error: ${
			lastError instanceof Error ? lastError.message : String(lastError)
		}`,
		{ cause: lastError },
	);
}

async function openByBackend(backend: SqliteBackend, path: string): Promise<Database> {
	switch (backend) {
		case "better-sqlite3":
			return openBetterSqlite(path);
		case "node-sqlite":
			return openNodeSqlite(path);
		case "bun-sqlite":
			return openBunSqlite(path);
		default: {
			const _exhaustive: never = backend;
			throw new Error(`unknown backend: ${String(_exhaustive)}`);
		}
	}
}

function dedupe<T>(xs: readonly T[]): T[] {
	const seen = new Set<T>();
	const out: T[] = [];
	for (const x of xs) {
		if (!seen.has(x)) {
			seen.add(x);
			out.push(x);
		}
	}
	return out;
}
