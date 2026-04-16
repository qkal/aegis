/**
 * Migration runner.
 *
 * Schema migrations are forward-only and idempotent. The runner tracks
 * applied versions in an `_aegis_migrations` table and runs each pending
 * migration inside a transaction. Re-running `runMigrations()` against a
 * fully-migrated database is a no-op.
 *
 * Migration ordering rules:
 *  - Migrations are sorted by `version` ascending.
 *  - Versions must be unique and contiguous from 1; gaps throw before any
 *    migration runs (this catches typos / accidental deletes early).
 *  - A migration whose version is already recorded is skipped silently.
 *  - A migration whose version is *less than* the highest recorded version
 *    but is missing from the recorded set is treated as "out-of-order
 *    insertion" and rejected — schema changes must always be appended.
 */

import type { Database } from "../adapters/types.js";
import type { Migration } from "./types.js";

/** Tracks which versions have been applied. */
interface MigrationRecord {
	version: number;
	description: string;
	applied_at: string;
}

/** Result of running migrations. */
export interface RunMigrationsResult {
	/** Versions that were freshly applied during this run. */
	readonly applied: readonly number[];
	/** Versions that were already recorded and skipped. */
	readonly skipped: readonly number[];
	/** The highest version recorded after the run. */
	readonly currentVersion: number;
}

/** Thrown when the migration list itself is malformed. */
export class InvalidMigrationListError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidMigrationListError";
	}
}

/** Thrown when a migration whose version is already recorded re-appears with a different description. */
export class MigrationDriftError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MigrationDriftError";
	}
}

/**
 * Apply all pending migrations against `db`. Idempotent.
 */
export function runMigrations(db: Database, migrations: readonly Migration[]): RunMigrationsResult {
	validateMigrationList(migrations);
	ensureMigrationsTable(db);

	const recorded = readRecorded(db);
	const recordedVersions = new Set(recorded.map((r) => r.version));
	const sorted = [...migrations].sort((a, b) => a.version - b.version);

	// Drift check: every recorded version must exist in the supplied list,
	// and the description must match. (Catches "I renamed migration 3" errors.)
	for (const r of recorded) {
		const found = sorted.find((m) => m.version === r.version);
		if (!found) {
			throw new MigrationDriftError(
				`Recorded migration ${r.version} (${r.description}) is not in the supplied migration list.`,
			);
		}
		if (found.description !== r.description) {
			throw new MigrationDriftError(
				`Migration ${r.version} description drift: recorded "${r.description}", supplied "${found.description}".`,
			);
		}
	}

	const applied: number[] = [];
	const skipped: number[] = [];

	for (const m of sorted) {
		if (recordedVersions.has(m.version)) {
			skipped.push(m.version);
			continue;
		}
		// Each migration runs in its own transaction so a partial failure
		// rolls back cleanly. We can't atomically guarantee a multi-DDL
		// migration on every backend (some don't transactionalize CREATE
		// statements), but BEGIN/COMMIT covers the recorded-row insert and
		// the bulk of DML.
		const tx = db.transaction(() => {
			m.up(db);
			db.prepare(
				"INSERT INTO _aegis_migrations (version, description, applied_at) VALUES (?, ?, ?)",
			).run(m.version, m.description, new Date().toISOString());
		});
		tx();
		applied.push(m.version);
	}

	const currentVersion = currentVersionOf(db);
	return { applied, skipped, currentVersion };
}

/** Return the highest applied migration version, or 0 if none. */
export function currentVersion(db: Database): number {
	ensureMigrationsTable(db);
	return currentVersionOf(db);
}

function currentVersionOf(db: Database): number {
	const row = db
		.prepare<{ v: number | null; }>("SELECT MAX(version) AS v FROM _aegis_migrations")
		.get();
	return row?.v ?? 0;
}

function ensureMigrationsTable(db: Database): void {
	db.exec(
		`CREATE TABLE IF NOT EXISTS _aegis_migrations (
			version INTEGER PRIMARY KEY,
			description TEXT NOT NULL,
			applied_at TEXT NOT NULL
		)`,
	);
}

function readRecorded(db: Database): MigrationRecord[] {
	return db
		.prepare<MigrationRecord>(
			"SELECT version, description, applied_at FROM _aegis_migrations ORDER BY version ASC",
		)
		.all();
}

function validateMigrationList(migrations: readonly Migration[]): void {
	if (migrations.length === 0) return;
	const versions = migrations.map((m) => m.version);
	const unique = new Set(versions);
	if (unique.size !== versions.length) {
		const dupes = versions.filter((v, i) => versions.indexOf(v) !== i);
		throw new InvalidMigrationListError(
			`Duplicate migration version(s): ${[...new Set(dupes)].join(", ")}`,
		);
	}
	const sorted = [...versions].sort((a, b) => a - b);
	const first = sorted[0];
	if (first !== 1) {
		throw new InvalidMigrationListError(`Migrations must start at version 1; got ${first}.`);
	}
	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1];
		const cur = sorted[i];
		if (prev === undefined || cur === undefined || cur !== prev + 1) {
			throw new InvalidMigrationListError(`Migration version gap between ${prev} and ${cur}.`);
		}
	}
}
