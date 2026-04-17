/**
 * Schema migrations for the session event store.
 *
 * Two tables back compaction-surviving session state:
 *
 *   session_events     — append-only typed SessionEvent records, keyed by
 *                        a UUID-ish `id` (opaque) and `session_id`. The
 *                        `event_kind` + `priority` columns are projected
 *                        from the JSON body so snapshot builders can filter
 *                        without reading+parsing every row.
 *   session_snapshots  — one row per snapshot, written on PreCompact /
 *                        idle-window. `snapshot_text` is the rendered
 *                        text the adapter will reinject as
 *                        `additionalContext` on SessionStart.
 *
 * Events are never modified in place: compaction always creates a new
 * snapshot row, and the raw event log is retained so a later `aegis audit`
 * (Phase 2) can reconstruct what the agent actually did. If the project
 * database is deleted or corrupted, all session history is lost — this is
 * a deliberate local-first trade-off (ADR-0008).
 */

import type { Migration } from "../migrations/types.js";

export const SESSION_STORE_MIGRATIONS: readonly Migration[] = [
	{
		version: 1,
		description: "session event store: events + snapshots",
		up: (db) => {
			db.exec(`
				CREATE TABLE session_events (
					id          TEXT    PRIMARY KEY,
					session_id  TEXT    NOT NULL,
					event_kind  TEXT    NOT NULL,
					priority    INTEGER NOT NULL,
					event_json  TEXT    NOT NULL,
					created_at  TEXT    NOT NULL
				);

				CREATE INDEX session_events_session_time_idx
					ON session_events (session_id, created_at DESC);

				CREATE INDEX session_events_session_priority_idx
					ON session_events (session_id, priority ASC, created_at ASC);

				CREATE TABLE session_snapshots (
					id             INTEGER PRIMARY KEY AUTOINCREMENT,
					session_id     TEXT    NOT NULL,
					created_at     TEXT    NOT NULL,
					budget_bytes   INTEGER NOT NULL,
					included_event_count INTEGER NOT NULL,
					snapshot_text  TEXT    NOT NULL
				);

				CREATE INDEX session_snapshots_session_time_idx
					ON session_snapshots (session_id, created_at DESC);
			`);
		},
	},
];
