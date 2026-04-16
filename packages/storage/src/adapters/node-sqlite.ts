/**
 * node:sqlite backend.
 *
 * Built into Node.js 22+ (behind `--experimental-sqlite` until 24).
 * Preferred backend when available because it requires no native addon
 * compilation (no node-gyp, no toolchain on Windows / Alpine / CentOS).
 *
 * The module is loaded dynamically so that running on a Node binary
 * without the SQLite build (or on a Node < 22) doesn't break the import
 * graph for the rest of `@aegis/storage`.
 */

import type { Database, PreparedStatement, StatementResult } from "./types.js";

interface NodeSqliteStatement {
	all(...params: readonly unknown[]): unknown[];
	get(...params: readonly unknown[]): unknown;
	run(...params: readonly unknown[]): {
		changes: number | bigint;
		lastInsertRowid: number | bigint;
	};
}

interface NodeSqliteDatabase {
	prepare(sql: string): NodeSqliteStatement;
	exec(sql: string): void;
	close(): void;
}

type NodeSqliteCtor = new(path: string) => NodeSqliteDatabase;

interface NodeSqliteModule {
	DatabaseSync: NodeSqliteCtor;
}

/** Thrown when node:sqlite cannot be loaded (Node < 22, no `--experimental-sqlite`, etc.). */
export class NodeSqliteUnavailableError extends Error {
	constructor(cause: unknown) {
		super(
			"node:sqlite backend is not available: "
				+ (cause instanceof Error ? cause.message : String(cause))
				+ ". Use Node 22+ with `--experimental-sqlite` (or Node 24+) or fall back to better-sqlite3.",
		);
		this.name = "NodeSqliteUnavailableError";
		this.cause = cause;
	}
}

/**
 * Open a database backed by `node:sqlite`. Uses dynamic `import()` so that
 * the missing-built-in error surfaces as a typed `NodeSqliteUnavailableError`
 * instead of an opaque module-resolution failure.
 */
export async function openNodeSqlite(path: string): Promise<Database> {
	let mod: NodeSqliteModule;
	try {
		mod = (await import("node:sqlite")) as unknown as NodeSqliteModule;
	} catch (cause) {
		throw new NodeSqliteUnavailableError(cause);
	}
	const db = new mod.DatabaseSync(path);
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	return wrap(db);
}

function wrap(db: NodeSqliteDatabase): Database {
	return {
		prepare<TRow>(sql: string): PreparedStatement<TRow> {
			const stmt = db.prepare(sql);
			return {
				all: (...params) => stmt.all(...params) as TRow[],
				get: (...params) => stmt.get(...params) as TRow | undefined,
				run: (...params): StatementResult => {
					const r = stmt.run(...params);
					return {
						changes: typeof r.changes === "bigint" ? Number(r.changes) : r.changes,
						lastInsertRowid: r.lastInsertRowid,
					};
				},
			};
		},
		exec(sql) {
			db.exec(sql);
		},
		transaction<T>(fn: () => T) {
			// node:sqlite has no native `transaction` helper; emulate the
			// better-sqlite3 semantics: call returns a function that wraps `fn`
			// in BEGIN / COMMIT (ROLLBACK on throw).
			return () => {
				db.exec("BEGIN");
				try {
					const result = fn();
					db.exec("COMMIT");
					return result;
				} catch (err) {
					db.exec("ROLLBACK");
					throw err;
				}
			};
		},
		close() {
			db.close();
		},
	};
}
