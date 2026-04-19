/**
 * Integration tests for the capture / snapshot / restore pipeline.
 *
 * These wire the real Claude Code adapter + a real in-memory SQLite
 * SessionEventStore so the full "PostToolUse → append → PreCompact →
 * saveSnapshot → SessionStart → restore" loop is exercised end-to-end.
 */
import { claudeCodeAdapter } from "@aegisctx/adapters";
import { postToolUseBashFailureFixture, postToolUseWriteFixture } from "@aegisctx/adapters/testing";
import { type SessionId } from "@aegisctx/core";
import {
	openDatabase,
	runMigrations,
	SESSION_STORE_MIGRATIONS,
	SessionEventStore,
} from "@aegisctx/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	type CaptureContext,
	captureToolResult,
	defaultEventIdFactory,
	generateSnapshot,
	restoreSnapshot,
} from "./capture.js";

const sid = (raw: string): SessionId => raw as SessionId;

let ctx: CaptureContext;
let close: () => void;

beforeEach(async () => {
	const { db } = await openDatabase({ path: ":memory:", backend: "better-sqlite3" });
	runMigrations(db, SESSION_STORE_MIGRATIONS);
	const store = new SessionEventStore(db);
	ctx = {
		adapter: claudeCodeAdapter,
		store,
		newEventId: defaultEventIdFactory(),
		now: () => new Date("2025-03-01T00:00:00.000Z"),
	};
	close = () => db.close();
});

afterEach(() => close());

describe("captureToolResult", () => {
	it("extracts and persists events from a PostToolUse Write payload", () => {
		const records = captureToolResult(
			"PostToolUse",
			postToolUseWriteFixture,
			sid("session-1"),
			ctx,
		);
		expect(records.length).toBeGreaterThan(0);
		expect(records.map((r) => r.event.kind)).toContain("file");
	});

	it("returns an empty list for tools the adapter does not recognise", () => {
		const unknown = {
			session_id: "session-1",
			transcript_path: "/tmp/t.jsonl",
			cwd: "/tmp",
			hook_event_name: "PostToolUse",
			tool_name: "SomeToolNoOneImplemented",
			tool_input: {},
			tool_response: {},
		};
		const records = captureToolResult("PostToolUse", unknown, sid("session-1"), ctx);
		expect(records).toEqual([]);
	});

	it("records an error event when the tool exits non-zero", () => {
		const records = captureToolResult(
			"PostToolUse",
			postToolUseBashFailureFixture,
			sid("session-1"),
			ctx,
		);
		const kinds = records.map((r) => r.event.kind);
		expect(kinds).toContain("error");
	});
});

describe("generateSnapshot + restoreSnapshot round-trip", () => {
	it("returns noop when no events have been captured", () => {
		const response = restoreSnapshot(sid("empty"), ctx);
		expect(response).toEqual({ kind: "noop" });
	});

	it("after capturing events, a compact generates a snapshot that restore replays", () => {
		captureToolResult(
			"PostToolUse",
			postToolUseWriteFixture,
			sid("session-1"),
			ctx,
		);
		captureToolResult(
			"PostToolUse",
			postToolUseBashFailureFixture,
			sid("session-1"),
			ctx,
		);
		const snapshot = generateSnapshot(sid("session-1"), ctx);
		expect(snapshot.includedEventCount).toBeGreaterThan(0);
		expect(snapshot.byteLength).toBeLessThanOrEqual(snapshot.budgetBytes);

		const restored = restoreSnapshot(sid("session-1"), ctx);
		assert.equal(restored.kind, "context");
		expect(restored.additionalContext).toBe(snapshot.text);
		expect(restored.additionalContext).toContain("file/write");
	});

	it("honours a caller-supplied budget override", () => {
		for (let i = 0; i < 20; i += 1) {
			captureToolResult(
				"PostToolUse",
				postToolUseWriteFixture,
				sid("session-2"),
				ctx,
			);
		}
		const tight = generateSnapshot(sid("session-2"), ctx, { budgetBytes: 256 });
		expect(tight.byteLength).toBeLessThanOrEqual(256);
		expect(tight.droppedEventCount).toBeGreaterThan(0);
	});

	it("restore returns the most recent snapshot when several are taken", () => {
		captureToolResult(
			"PostToolUse",
			postToolUseWriteFixture,
			sid("session-3"),
			ctx,
		);
		const first = generateSnapshot(sid("session-3"), ctx);

		// Simulate passage of time + more events, then another compact.
		const laterCtx: CaptureContext = {
			...ctx,
			now: () => new Date("2025-03-01T01:00:00.000Z"),
		};
		captureToolResult(
			"PostToolUse",
			postToolUseBashFailureFixture,
			sid("session-3"),
			laterCtx,
		);
		const second = generateSnapshot(sid("session-3"), laterCtx);
		expect(second.text).not.toBe(first.text);

		const restored = restoreSnapshot(sid("session-3"), laterCtx);
		assert.equal(restored.kind, "context");
		expect(restored.additionalContext).toBe(second.text);
	});
});

describe("defaultEventIdFactory", () => {
	it("produces monotonically distinct ids", () => {
		const factory = defaultEventIdFactory();
		const ids = new Set<string>();
		for (let i = 0; i < 100; i += 1) {
			ids.add(factory());
		}
		expect(ids.size).toBe(100);
	});
});
