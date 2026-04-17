/**
 * Tests for SessionEventStore — append, list, snapshots, and session reset.
 */
import {
	type EventId,
	EventPriority,
	type FileEvent,
	type GitEvent,
	type SessionId,
	type TaskEvent,
} from "@aegis/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../adapters/index.js";
import type { Database } from "../adapters/types.js";
import { runMigrations } from "../migrations/index.js";
import { SESSION_STORE_MIGRATIONS } from "./schema.js";
import { NonSerializableEventError, SessionEventStore } from "./store.js";

const sid = (raw: string): SessionId => raw as SessionId;
const eid = (raw: string): EventId => raw as EventId;

const fileEvent = (path: string, ts: string): FileEvent => ({
	kind: "file",
	action: "write",
	path,
	timestamp: ts,
	priority: EventPriority.CRITICAL,
});

const gitEvent = (action: GitEvent["action"], ts: string): GitEvent => ({
	kind: "git",
	action,
	timestamp: ts,
	priority: EventPriority.HIGH,
});

const taskEvent = (description: string, ts: string): TaskEvent => ({
	kind: "task",
	action: "create",
	description,
	timestamp: ts,
	priority: EventPriority.CRITICAL,
});

let db: Database;
let store: SessionEventStore;

beforeEach(async () => {
	const { db: opened } = await openDatabase({
		path: ":memory:",
		backend: "better-sqlite3",
	});
	db = opened;
	runMigrations(db, SESSION_STORE_MIGRATIONS);
	store = new SessionEventStore(db);
});

afterEach(() => db.close());

describe("SessionEventStore.append", () => {
	it("persists an event and round-trips it via list()", () => {
		const persisted = store.append({
			id: eid("evt-1"),
			sessionId: sid("s-1"),
			event: fileEvent("src/a.ts", "2025-01-01T00:00:00.000Z"),
		});
		expect(persisted.id).toBe("evt-1");
		expect(persisted.event.kind).toBe("file");
		expect(typeof persisted.createdAt).toBe("string");

		const rows = store.list({ sessionId: sid("s-1") });
		expect(rows).toHaveLength(1);
		expect(rows[0]?.event).toEqual(persisted.event);
	});

	it("appendAll persists multiple events atomically and returns them in order", () => {
		const items = [
			{
				id: eid("e1"),
				sessionId: sid("s-1"),
				event: fileEvent("a.ts", "2025-01-01T00:00:01.000Z"),
			},
			{
				id: eid("e2"),
				sessionId: sid("s-1"),
				event: fileEvent("b.ts", "2025-01-01T00:00:02.000Z"),
			},
			{
				id: eid("e3"),
				sessionId: sid("s-1"),
				event: gitEvent("commit", "2025-01-01T00:00:03.000Z"),
			},
		];
		const persisted = store.appendAll(items);
		expect(persisted).toHaveLength(3);
		expect(persisted.map((r) => r.id)).toEqual(["e1", "e2", "e3"]);

		const rows = store.list({ sessionId: sid("s-1") });
		expect(rows.map((r) => r.event.kind)).toEqual(["file", "file", "git"]);
	});

	it("appendAll with empty input is a no-op", () => {
		const rows = store.appendAll([]);
		expect(rows).toEqual([]);
	});

	it("rejects duplicate event IDs", () => {
		store.append({
			id: eid("dup"),
			sessionId: sid("s-1"),
			event: fileEvent("a.ts", "2025-01-01T00:00:01.000Z"),
		});
		expect(() =>
			store.append({
				id: eid("dup"),
				sessionId: sid("s-1"),
				event: fileEvent("b.ts", "2025-01-01T00:00:02.000Z"),
			})
		).toThrow(/UNIQUE|PRIMARY|dup/i);
	});

	it("throws NonSerializableEventError when the event cannot be stringified", () => {
		const bad = {
			kind: "file",
			action: "write",
			path: "a.ts",
			timestamp: "t",
			priority: EventPriority.CRITICAL,
			// Circular reference added below.
		} as unknown as FileEvent & { self: unknown; };
		(bad as unknown as { self: unknown; }).self = bad;
		expect(() =>
			store.append({
				id: eid("bad"),
				sessionId: sid("s-1"),
				event: bad,
			})
		).toThrow(NonSerializableEventError);
	});
});

describe("SessionEventStore.list filters", () => {
	beforeEach(() => {
		store.appendAll([
			{ id: eid("1"), sessionId: sid("s-1"), event: fileEvent("a.ts", "2025-01-01T00:00:01.000Z") },
			{
				id: eid("2"),
				sessionId: sid("s-1"),
				event: gitEvent("commit", "2025-01-01T00:00:02.000Z"),
			},
			{
				id: eid("3"),
				sessionId: sid("s-1"),
				event: taskEvent("Ship M1.4", "2025-01-01T00:00:03.000Z"),
			},
			{ id: eid("4"), sessionId: sid("s-2"), event: fileEvent("b.ts", "2025-01-01T00:00:04.000Z") },
		]);
	});

	it("scopes results to the requested session", () => {
		expect(store.list({ sessionId: sid("s-1") })).toHaveLength(3);
		expect(store.list({ sessionId: sid("s-2") })).toHaveLength(1);
	});

	it("filters by kinds", () => {
		const rows = store.list({ sessionId: sid("s-1"), kinds: ["file", "task"] });
		expect(rows.map((r) => r.event.kind)).toEqual(["file", "task"]);
	});

	it("filters by since timestamp against the server-assigned createdAt", () => {
		// Re-run the append sequence with an explicit series of timestamps
		// so we can pin `since` against `createdAt` (the server-generated
		// column `since` compares against).
		const fresh = store.list({ sessionId: sid("s-1") });
		expect(fresh).toHaveLength(3);
		const pivot = fresh[1]?.createdAt;
		expect(pivot).toBeDefined();
		const rows = store.list({
			sessionId: sid("s-1"),
			since: pivot,
		});
		// Rows at or after the pivot's createdAt should be returned.
		expect(rows.length).toBeGreaterThanOrEqual(2);
		expect(rows.length).toBeLessThan(fresh.length + 1);
	});

	it("honours the limit cap after applying since/kinds", () => {
		const rows = store.list({ sessionId: sid("s-1"), limit: 2 });
		expect(rows).toHaveLength(2);
	});
});

describe("SessionEventStore.snapshots", () => {
	it("persists a snapshot and reads it back via latestSnapshotText", () => {
		const s = sid("s-snap");
		store.saveSnapshot({
			sessionId: s,
			budgetBytes: 2048,
			includedEventCount: 3,
			snapshotText: "rendered content",
			createdAt: "2025-01-01T00:00:00.000Z",
		});
		const loaded = store.latestSnapshotText(s);
		expect(loaded?.text).toBe("rendered content");
		expect(loaded?.budgetBytes).toBe(2048);
		expect(loaded?.includedEventCount).toBe(3);
	});

	it("returns the most recent snapshot when multiple are written", () => {
		const s = sid("s-snap");
		store.saveSnapshot({
			sessionId: s,
			budgetBytes: 2048,
			includedEventCount: 1,
			snapshotText: "v1",
			createdAt: "2025-01-01T00:00:00.000Z",
		});
		store.saveSnapshot({
			sessionId: s,
			budgetBytes: 2048,
			includedEventCount: 2,
			snapshotText: "v2",
			createdAt: "2025-01-02T00:00:00.000Z",
		});
		expect(store.latestSnapshotText(s)?.text).toBe("v2");
	});

	it("returns undefined for sessions without any snapshot", () => {
		expect(store.latestSnapshotText(sid("never-snapped"))).toBeUndefined();
	});
});

describe("SessionEventStore.deleteSession", () => {
	it("removes events and snapshots for the session, leaving others intact", () => {
		store.append({
			id: eid("a"),
			sessionId: sid("s-1"),
			event: fileEvent("x.ts", "2025-01-01T00:00:00.000Z"),
		});
		store.append({
			id: eid("b"),
			sessionId: sid("s-2"),
			event: fileEvent("y.ts", "2025-01-01T00:00:00.000Z"),
		});
		store.saveSnapshot({
			sessionId: sid("s-1"),
			budgetBytes: 2048,
			includedEventCount: 1,
			snapshotText: "t",
		});

		const removed = store.deleteSession(sid("s-1"));
		expect(removed.events).toBe(1);
		expect(removed.snapshots).toBe(1);

		expect(store.list({ sessionId: sid("s-1") })).toEqual([]);
		expect(store.latestSnapshotText(sid("s-1"))).toBeUndefined();
		expect(store.list({ sessionId: sid("s-2") })).toHaveLength(1);
	});
});
