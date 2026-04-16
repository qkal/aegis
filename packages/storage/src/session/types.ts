/**
 * Session store types.
 *
 * Manages structured session events, snapshots, and session resume.
 * Events are stored as typed records (not bags of strings).
 */

import type { EventId, SessionEvent, SessionId } from "@aegis/core";

/** A persisted session event record. */
export interface SessionEventRecord {
	readonly id: EventId;
	readonly sessionId: SessionId;
	readonly event: SessionEvent;
	readonly createdAt: string;
}

/** A session snapshot for context compaction/resume. */
export interface SessionSnapshot {
	readonly sessionId: SessionId;
	readonly events: readonly SessionEventRecord[];
	readonly createdAt: string;
	readonly budgetBytes: number;
}

/** Filter options for querying session events. */
export interface EventFilter {
	readonly sessionId?: SessionId;
	readonly kinds?: readonly SessionEvent["kind"][];
	readonly since?: string;
	readonly limit?: number;
}
