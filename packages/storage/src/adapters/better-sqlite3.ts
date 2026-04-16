/**
 * better-sqlite3 backend.
 *
 * Synchronous, native-addon SQLite binding (https://github.com/WiseLibs/better-sqlite3).
 * Used as the default fallback when neither `node:sqlite` nor `bun:sqlite`
 * is available, and as the primary backend on Node < 22 or when the user
 * forces it via `AEGIS_SQLITE_BACKEND=better-sqlite3`.
 *
 * The library is declared as an optional npm dependency on `@aegis/storage`,
 * so it may not be installed at runtime; we import it dynamically and surface
 * a typed error if it is missing.
 */

import { createRequire } from "node:module";
import type { Database, PreparedStatement, StatementResult } from "./types.js";

const require = createRequire(import.meta.url);

interface BetterSqliteStatement {
	all(...params: readonly unknown[]): unknown[];
	get(...params: readonly unknown[]): unknown;
	run(...params: readonly unknown[]): {
		changes: number;
		lastInsertRowid: number | bigint;
	};
}

interface BetterSqliteDatabase {
	prepare(sql: string): BetterSqliteStatement;
	exec(sql: string): void;
	transaction<TArgs extends readonly unknown[], TReturn>(
		fn: (...args: TArgs) => TReturn,
	): (...args: TArgs) => TReturn;
	close(): void;
	pragma(s: string): unknown;
}

type BetterSqliteCtor = new(
	path: string,
	options?: { readonly?: boolean; fileMustExist?: boolean; },
) => BetterSqliteDatabase;

/** Thrown when better-sqlite3 is not installed or fails to load. */
export class BetterSqliteUnavailableError extends Error {
	constructor(cause: unknown) {
		super(
			"better-sqlite3 backend is not available: "
				+ (cause instanceof Error ? cause.message : String(cause))
				+ ". Install it with `pnpm add better-sqlite3` or use the node:sqlite backend on Node 22+.",
		);
		this.name = "BetterSqliteUnavailableError";
		this.cause = cause;
	}
}

/**
 * Open a database backed by better-sqlite3. The constructor is loaded via a
 * synchronous `createRequire` so we can wrap a thrown `MODULE_NOT_FOUND` in a
 * typed error rather than a plain `Cannot find module` message.
 */
export function openBetterSqlite(path: string): Database {
	let Ctor: BetterSqliteCtor;
	try {
		Ctor = require("better-sqlite3") as BetterSqliteCtor;
	} catch (cause) {
		throw new BetterSqliteUnavailableError(cause);
	}
	const db = new Ctor(path);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");
	return wrap(db);
}

function wrap(db: BetterSqliteDatabase): Database {
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
