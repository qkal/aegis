/**
 * SQLite backend abstraction.
 *
 * Provides a unified interface over three SQLite backends:
 * - better-sqlite3 (npm, synchronous, most compatible)
 * - node:sqlite (Node 22+, built-in, no native addon)
 * - bun:sqlite (Bun runtime, built-in)
 *
 * The adapter abstracts away API differences so storage code
 * never touches backend-specific APIs directly.
 */

/** A prepared SQL statement that can be executed with parameters. */
export interface PreparedStatement<TRow> {
	/** Execute the statement and return all matching rows. */
	all(...params: readonly unknown[]): TRow[];
	/** Execute the statement and return the first matching row, or undefined. */
	get(...params: readonly unknown[]): TRow | undefined;
	/** Execute the statement for side effects (INSERT, UPDATE, DELETE). */
	run(...params: readonly unknown[]): StatementResult;
}

/** Result of a write operation. */
export interface StatementResult {
	/** Number of rows changed by the statement. */
	readonly changes: number;
	/** The rowid of the last inserted row (if applicable). */
	readonly lastInsertRowid: number | bigint;
}

/** Unified database interface across all SQLite backends. */
export interface Database {
	/** Prepare a SQL statement for execution. */
	prepare<TRow = Record<string, unknown>>(sql: string): PreparedStatement<TRow>;
	/** Execute raw SQL (for DDL, pragmas, etc.). */
	exec(sql: string): void;
	/** Run a function inside a transaction. */
	transaction<T>(fn: () => T): () => T;
	/** Close the database connection. */
	close(): void;
}

/** Supported SQLite backend identifiers. */
export type SqliteBackend = "better-sqlite3" | "node-sqlite" | "bun-sqlite";
