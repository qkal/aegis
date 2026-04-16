/**
 * bun:sqlite backend.
 *
 * Built into the Bun runtime. Preferred backend on Bun because it
 * matches `node:sqlite`'s "no native addon" property and is significantly
 * faster than better-sqlite3 in Bun's benchmarks.
 *
 * The module is loaded dynamically so importing `@aegis/storage` under
 * Node doesn't trip over `bun:sqlite`.
 */

import type { Database, PreparedStatement, StatementResult } from "./types.js";

interface BunSqliteStatement {
	all(...params: readonly unknown[]): unknown[];
	get(...params: readonly unknown[]): unknown;
	run(...params: readonly unknown[]): {
		changes: number;
		lastInsertRowid: number | bigint;
	};
}

interface BunSqliteDatabase {
	prepare(sql: string): BunSqliteStatement;
	exec(sql: string): void;
	transaction<T>(fn: () => T): () => T;
	close(): void;
}

type BunSqliteCtor = new (path: string) => BunSqliteDatabase;

interface BunSqliteModule {
	Database: BunSqliteCtor;
}

/** Thrown when bun:sqlite cannot be loaded (i.e. running on Node, not Bun). */
export class BunSqliteUnavailableError extends Error {
	constructor(cause: unknown) {
		super(
			"bun:sqlite backend is not available (Bun runtime required): " +
				(cause instanceof Error ? cause.message : String(cause)),
		);
		this.name = "BunSqliteUnavailableError";
		this.cause = cause;
	}
}

/** Open a database backed by `bun:sqlite`. */
export async function openBunSqlite(path: string): Promise<Database> {
	let mod: BunSqliteModule;
	try {
		// `bun:sqlite` only resolves under the Bun runtime; it is intentionally
		// unknown to the TypeScript module resolver under Node.
		// @ts-expect-error -- runtime-only module
		mod = (await import("bun:sqlite")) as unknown as BunSqliteModule;
	} catch (cause) {
		throw new BunSqliteUnavailableError(cause);
	}
	const db = new mod.Database(path);
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	return wrap(db);
}

function wrap(db: BunSqliteDatabase): Database {
	return {
		prepare<TRow>(sql: string): PreparedStatement<TRow> {
			const stmt = db.prepare(sql);
			return {
				all: (...params) => stmt.all(...params) as TRow[],
				get: (...params) => stmt.get(...params) as TRow | undefined,
				run: (...params): StatementResult => {
					const r = stmt.run(...params);
					return {
						changes: r.changes,
						lastInsertRowid: r.lastInsertRowid,
					};
				},
			};
		},
		exec(sql) {
			db.exec(sql);
		},
		transaction<T>(fn: () => T) {
			return db.transaction(fn);
		},
		close() {
			db.close();
		},
	};
}
