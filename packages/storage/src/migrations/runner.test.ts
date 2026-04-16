/**
 * Migration runner tests.
 *
 * Run against the better-sqlite3 backend (always available in CI) using an
 * in-memory database so each test starts from a clean slate.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../adapters/index.js";
import type { Database } from "../adapters/types.js";
import {
	currentVersion,
	InvalidMigrationListError,
	type Migration,
	MigrationDriftError,
	runMigrations,
} from "./index.js";

let db: Database;

beforeEach(async () => {
	const opened = await openDatabase({
		path: ":memory:",
		backend: "better-sqlite3",
	});
	db = opened.db;
});

afterEach(() => {
	db.close();
});

const M1: Migration = {
	version: 1,
	description: "create users",
	up: (d) => d.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)"),
};

const M2: Migration = {
	version: 2,
	description: "create posts",
	up: (d) =>
		d.exec("CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT)"),
};

const M3: Migration = {
	version: 3,
	description: "add posts.body",
	up: (d) => d.exec("ALTER TABLE posts ADD COLUMN body TEXT"),
};

describe("runMigrations", () => {
	it("applies all migrations on a fresh database in order", () => {
		const result = runMigrations(db, [M1, M2, M3]);
		expect(result.applied).toEqual([1, 2, 3]);
		expect(result.skipped).toEqual([]);
		expect(result.currentVersion).toBe(3);

		const tables = db
			.prepare<{ name: string; }>(
				"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
			)
			.all()
			.map((r) => r.name);
		expect(tables).toEqual(["_aegis_migrations", "posts", "users"]);
	});

	it("is idempotent: re-running with the same list applies nothing", () => {
		runMigrations(db, [M1, M2]);
		const second = runMigrations(db, [M1, M2]);
		expect(second.applied).toEqual([]);
		expect(second.skipped).toEqual([1, 2]);
		expect(second.currentVersion).toBe(2);
	});

	it("only applies the unrecorded suffix when new migrations are appended", () => {
		runMigrations(db, [M1, M2]);
		const next = runMigrations(db, [M1, M2, M3]);
		expect(next.applied).toEqual([3]);
		expect(next.skipped).toEqual([1, 2]);
		expect(next.currentVersion).toBe(3);
	});

	it("rolls back a migration that throws", () => {
		const broken: Migration = {
			version: 2,
			description: "broken",
			up: (d) => {
				d.exec("CREATE TABLE x (id INTEGER PRIMARY KEY)");
				throw new Error("nope");
			},
		};
		runMigrations(db, [M1]);
		expect(() => runMigrations(db, [M1, broken])).toThrow("nope");
		expect(currentVersion(db)).toBe(1);
		const tables = db
			.prepare<{ name: string; }>(
				"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
			)
			.all()
			.map((r) => r.name);
		expect(tables).not.toContain("x");
	});

	it("rejects a migration whose version is already recorded with a different description", () => {
		runMigrations(db, [M1, M2]);
		const renamed: Migration = {
			...M2,
			description: "create posts (renamed)",
		};
		expect(() => runMigrations(db, [M1, renamed])).toThrow(MigrationDriftError);
	});

	it("rejects a migration list with a duplicate version", () => {
		const dup: Migration = { ...M2, description: "duplicate" };
		expect(() => runMigrations(db, [M1, M2, dup])).toThrow(InvalidMigrationListError);
	});

	it("rejects a migration list that does not start at version 1", () => {
		expect(() => runMigrations(db, [M2, M3])).toThrow(InvalidMigrationListError);
	});

	it("rejects a migration list with a version gap", () => {
		expect(() => runMigrations(db, [M1, M3])).toThrow(InvalidMigrationListError);
	});

	it("rejects when a previously-recorded migration is removed from the supplied list", () => {
		runMigrations(db, [M1, M2]);
		// User accidentally deletes M1 from the list.
		expect(() => runMigrations(db, [M2])).toThrow(InvalidMigrationListError);
	});
});

describe("currentVersion", () => {
	it("returns 0 on a fresh database", () => {
		expect(currentVersion(db)).toBe(0);
	});

	it("returns the highest applied version", () => {
		runMigrations(db, [M1, M2, M3]);
		expect(currentVersion(db)).toBe(3);
	});
});
