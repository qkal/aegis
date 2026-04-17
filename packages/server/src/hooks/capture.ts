/**
 * Session event capture pipeline (M1.4).
 *
 * Three entry points — one per hook that participates in the
 * compaction-survival loop:
 *
 *   • `captureToolResult(hookType, rawOutput, ctx)`
 *       Parses a PostToolUse payload with the adapter, lifts events
 *       via `adapter.extractEvents`, and persists every event to
 *       SQLite. Returns the newly persisted records.
 *
 *   • `generateSnapshot(sessionId, ctx)`
 *       Called on PreCompact (Claude Code, OpenCode compact) or from
 *       `IdleWindowSnapshotter` after an idle threshold (Codex /
 *       AmpCode — platforms without a first-class compact hook).
 *       Reads every event we've captured for `sessionId`, builds a
 *       budget-capped snapshot, and writes it to `session_snapshots`.
 *
 *   • `restoreSnapshot(sessionId, ctx)`
 *       Called on SessionStart. Loads the latest snapshot (if any)
 *       and returns a `NormalizedHookResponse` of kind `"context"`
 *       that the adapter serializes into `additionalContext`. When
 *       the session is fresh (no snapshot yet) returns `"noop"`.
 *
 * All three functions are thin wrappers — the heavy lifting (schema
 * validation, event extraction, priority-tiered rendering, SQLite I/O)
 * lives in `@aegis/adapters`, `@aegis/core`, and `@aegis/storage`.
 * Keeping them in the server layer means the CLI / MCP harness has
 * a single narrow surface to test against and replace.
 */

import type { HookAdapter, HookType, NormalizedHookResponse } from "@aegis/adapters";
import {
	buildSnapshot,
	DEFAULT_SNAPSHOT_BUDGET_BYTES,
	type EventId,
	type SessionEvent,
	type SessionId,
} from "@aegis/core";
import type { SessionEventRecord, SessionEventStore } from "@aegis/storage";

/** Dependencies required by the capture pipeline. */
export interface CaptureContext {
	readonly adapter: HookAdapter;
	readonly store: SessionEventStore;
	/** Monotonic-ish UUID factory. Injectable so tests can assert on IDs. */
	readonly newEventId: () => string;
	/** Clock override for deterministic snapshot headers. */
	readonly now?: () => Date;
}

/** Default event-ID factory. Caller can override (e.g. to use a UUIDv7 lib). */
export function defaultEventIdFactory(): () => string {
	let counter = 0;
	return () => {
		counter += 1;
		const time = Date.now().toString(36);
		const rand = Math.random().toString(36).slice(2, 10);
		const seq = counter.toString(36).padStart(4, "0");
		return `evt_${time}_${seq}_${rand}`;
	};
}

/**
 * Parse a PostToolUse payload, extract its structured session events,
 * and persist them. Returns the persisted records so callers can wire
 * them through `aegis_audit` (Phase 2) or emit telemetry.
 *
 * Returns an empty array — without raising — when the adapter does not
 * recognize this tool. This is intentional: unknown tools are legitimate
 * (agents add new tools faster than Aegis can ship adapters), so the
 * capture pipeline must be tolerant, not brittle.
 */
export function captureToolResult(
	hookType: HookType,
	rawOutput: unknown,
	sessionId: SessionId,
	ctx: CaptureContext,
): readonly SessionEventRecord[] {
	const normalized = ctx.adapter.parseToolResult(hookType, rawOutput);
	const events = ctx.adapter.extractEvents(normalized);
	if (events.length === 0) return [];

	const items = events.map((event) => ({
		id: ctx.newEventId() as EventId,
		sessionId,
		event,
	}));
	return ctx.store.appendAll(items);
}

/**
 * Build and persist a snapshot for `sessionId`. Returns metadata for
 * logging/assertion; callers that just want the side-effect can ignore
 * the return value.
 */
export function generateSnapshot(
	sessionId: SessionId,
	ctx: CaptureContext,
	options: { readonly budgetBytes?: number; } = {},
): {
	readonly byteLength: number;
	readonly budgetBytes: number;
	readonly includedEventCount: number;
	readonly droppedEventCount: number;
	readonly text: string;
} {
	const events = ctx.store
		.list({ sessionId })
		.map((r) => r.event);

	const built = buildSnapshot(events, {
		budgetBytes: options.budgetBytes ?? DEFAULT_SNAPSHOT_BUDGET_BYTES,
		now: ctx.now,
	});

	ctx.store.saveSnapshot({
		sessionId,
		budgetBytes: built.budgetBytes,
		includedEventCount: built.includedEvents.length,
		snapshotText: built.text,
		createdAt: (ctx.now ?? (() => new Date()))().toISOString(),
	});

	return {
		byteLength: built.byteLength,
		budgetBytes: built.budgetBytes,
		includedEventCount: built.includedEvents.length,
		droppedEventCount: built.droppedEvents.length,
		text: built.text,
	};
}

/**
 * Load the latest persisted snapshot and shape it as a
 * `NormalizedHookResponse` the adapter can turn into platform-specific
 * `additionalContext`. Returns a `"noop"` response when no snapshot
 * exists yet.
 */
export function restoreSnapshot(
	sessionId: SessionId,
	ctx: CaptureContext,
): NormalizedHookResponse {
	const snapshot = ctx.store.latestSnapshotText(sessionId);
	if (snapshot === undefined || snapshot.text.length === 0) {
		return { kind: "noop" };
	}
	return { kind: "context", additionalContext: snapshot.text };
}

/** Utility: count events by kind (telemetry helper, used by the CLI). */
export function countEventsByKind(
	events: readonly SessionEvent[],
): Readonly<Record<string, number>> {
	const counts: Record<string, number> = {};
	for (const event of events) {
		counts[event.kind] = (counts[event.kind] ?? 0) + 1;
	}
	return counts;
}
