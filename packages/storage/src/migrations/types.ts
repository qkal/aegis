/**
 * Schema migration system.
 *
 * Each migration is a numbered, idempotent function.
 * Migrations are applied sequentially at database open time.
 * No ad-hoc ALTER TABLE — all schema changes go through this system.
 */

import type { Database } from "../adapters/types.js";

/** A single schema migration step. */
export interface Migration {
	/** Sequential version number (1, 2, 3, ...). Must be unique. */
	readonly version: number;
	/** Description of what this migration does. */
	readonly description: string;
	/** Apply the migration (forward-only, no rollbacks). */
	readonly up: (db: Database) => void;
}
