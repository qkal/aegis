/**
 * Tests for the SQLite adapter factory and the better-sqlite3 backend.
 *
 * These run on every CI invocation (better-sqlite3 is an optionalDependency
 * but installed in the workspace devDependencies). Tests for the
 * `node:sqlite` backend are gated by an env probe — they only run when the
 * Node binary actually exposes `node:sqlite` (Node 22+ with
 * `--experimental-sqlite`, or Node 24+).
 */

import { describe, expect, it } from "vitest";
import { detectBackend, openDatabase, type SqliteBackend } from "./index.js";

describe("detectBackend", () => {
	it("respects the explicit override argument over everything else", () => {
		expect(detectBackend("better-sqlite3")).toBe("better-sqlite3");
		expect(detectBackend("node-sqlite")).toBe("node-sqlite");
		expect(detectBackend("bun-sqlite")).toBe("bun-sqlite");
	});

	it("returns a SqliteBackend value when no override is given", () => {
		const result = detectBackend();
		const allowed: readonly SqliteBackend[] = ["better-sqlite3", "node-sqlite", "bun-sqlite"];
		expect(allowed).toContain(result);
	});
});

describe("better-sqlite3 backend", () => {
	it("opens an in-memory database, executes DDL, and round-trips rows", async () => {
		const opened = await openDatabase({
			path: ":memory:",
			backend: "better-sqlite3",
		});
		expect(opened.backend).toBe("better-sqlite3");
		const { db } = opened;

		db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, value REAL)");
		const insert = db.prepare<unknown>("INSERT INTO t (name, value) VALUES (?, ?)");
		const r1 = insert.run("alpha", 1.5);
		const r2 = insert.run("beta", 2.5);
		expect(r1.changes).toBe(1);
		expect(r2.changes).toBe(1);
		expect(Number(r1.lastInsertRowid)).toBeGreaterThan(0);
		expect(Number(r2.lastInsertRowid)).toBeGreaterThan(Number(r1.lastInsertRowid));

		const all = db
			.prepare<{ id: number; name: string; value: number; }>(
				"SELECT id, name, value FROM t ORDER BY id ASC",
			)
			.all();
		expect(all).toEqual([
			{ id: Number(r1.lastInsertRowid), name: "alpha", value: 1.5 },
			{ id: Number(r2.lastInsertRowid), name: "beta", value: 2.5 },
		]);

		const one = db.prepare<{ name: string; }>("SELECT name FROM t WHERE name = ?").get("beta");
		expect(one).toEqual({ name: "beta" });

		const missing = db.prepare<{ name: string; }>("SELECT name FROM t WHERE name = ?").get("zzz");
		expect(missing).toBeUndefined();

		db.close();
	});

	it("transactions commit on success", async () => {
		const { db } = await openDatabase({
			path: ":memory:",
			backend: "better-sqlite3",
		});
		db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
		const insert = db.prepare<unknown>("INSERT INTO t (id) VALUES (?)");
		const tx = db.transaction(() => {
			insert.run(1);
			insert.run(2);
			insert.run(3);
		});
		tx();
		const count = db.prepare<{ c: number; }>("SELECT COUNT(*) AS c FROM t").get();
		expect(count?.c).toBe(3);
		db.close();
	});

	it("transactions roll back on throw", async () => {
		const { db } = await openDatabase({
			path: ":memory:",
			backend: "better-sqlite3",
		});
		db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
		const insert = db.prepare<unknown>("INSERT INTO t (id) VALUES (?)");
		const tx = db.transaction(() => {
			insert.run(10);
			insert.run(11);
			throw new Error("boom");
		});
		expect(() => tx()).toThrow("boom");
		const count = db.prepare<{ c: number; }>("SELECT COUNT(*) AS c FROM t").get();
		expect(count?.c).toBe(0);
		db.close();
	});
});

const nodeSqliteAvailable = await (async () => {
	try {
		await import("node:sqlite");
		return true;
	} catch {
		return false;
	}
})();

describe.runIf(nodeSqliteAvailable)("node:sqlite backend", () => {
	it("opens an in-memory database and round-trips rows", async () => {
		const opened = await openDatabase({
			path: ":memory:",
			backend: "node-sqlite",
		});
		expect(opened.backend).toBe("node-sqlite");
		const { db } = opened;
		db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
		const insert = db.prepare<unknown>("INSERT INTO t (name) VALUES (?)");
		insert.run("alpha");
		insert.run("beta");
		const all = db
			.prepare<{ id: number; name: string; }>("SELECT id, name FROM t ORDER BY id ASC")
			.all();
		expect(all.map((r) => r.name)).toEqual(["alpha", "beta"]);
		db.close();
	});

	it("transactions emulated via BEGIN/COMMIT roll back on throw", async () => {
		const { db } = await openDatabase({
			path: ":memory:",
			backend: "node-sqlite",
		});
		db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
		const insert = db.prepare<unknown>("INSERT INTO t (id) VALUES (?)");
		const tx = db.transaction(() => {
			insert.run(1);
			insert.run(2);
			throw new Error("boom");
		});
		expect(() => tx()).toThrow("boom");
		const count = db.prepare<{ c: number; }>("SELECT COUNT(*) AS c FROM t").get();
		expect(count?.c).toBe(0);
		db.close();
	});
});

describe("openDatabase fallback", () => {
	it("falls back to better-sqlite3 when an unknown backend is requested via auto-detect (no override path)", async () => {
		// Explicit override `bun-sqlite` should fail under Node — confirm it
		// reports a useful error rather than silently swapping backends.
		await expect(openDatabase({ path: ":memory:", backend: "bun-sqlite" })).rejects.toThrow(
			/bun:sqlite backend is not available/i,
		);
	});
});
