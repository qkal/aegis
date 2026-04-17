/**
 * `SessionEventStore` — SQLite-backed session event + snapshot persistence.
 *
 * Backs the "events survive compaction" acceptance criterion from M1.4.
 * Callers (the server's hook orchestrator) append events as they arrive
 * from PostToolUse, then on PreCompact / idle-window they ask the store
 * to persist a rendered snapshot that SessionStart will replay into the
 * next agent context.
 *
 * The store is synchronous — every operation runs against the synchronous
 * `Database` interface from `@aegis/storage/adapters`. Callers in an
 * async orchestrator just `await Promise.resolve()` if they want to
 * yield the event loop.
 *
 * Event IDs are provided by the caller so the orchestrator can correlate
 * a newly appended event with the persisted record without a round trip.
 * The store trusts that callers supply valid branded `EventId` / `SessionId`
 * values — no runtime validation is performed on insert. Use the safe
 * constructors from `@aegis/core` (`eventId()`, `sessionId()`) at untrusted
 * boundaries before passing IDs into the store.
 */

import type {
	EventId,
	EventPriority,
	SessionEvent,
	SessionEventKind,
	SessionId,
} from "@aegis/core";

import type { Database } from "../adapters/types.js";
import type { EventFilter, SessionEventRecord } from "./types.js";

/** Metadata returned by `saveSnapshot` — does not carry event records. */
export interface PersistedSnapshotMetadata {
	readonly sessionId: SessionId;
	readonly budgetBytes: number;
	readonly includedEventCount: number;
	readonly createdAt: string;
}

/**
 * Lightweight identity-casts re-declared locally so this file does not
 * need the compiled `@aegis/core` build at test time. Branded types are
 * zero-runtime-cost so these casts are safe.
 */
const eventIdUnsafe = (raw: string): EventId => raw as EventId;
const sessionIdUnsafe = (raw: string): SessionId => raw as SessionId;

/** A row as returned by SELECT * FROM session_events. */
interface EventRow {
	id: string;
	session_id: string;
	event_kind: string;
	priority: number;
	event_json: string;
	created_at: string;
}

/** A row as returned by SELECT * FROM session_snapshots. */
interface SnapshotRow {
	session_id: string;
	created_at: string;
	budget_bytes: number;
	included_event_count: number;
	snapshot_text: string;
}

/**
 * Thrown when a caller appends an event whose body is not round-trippable
 * through JSON (e.g. contains a BigInt, a circular reference, or a symbol).
 */
export class NonSerializableEventError extends Error {
	constructor(detail: string, cause: unknown) {
		super(`session event is not JSON-serializable: ${detail}`, { cause });
		this.name = "NonSerializableEventError";
	}
}

/**
 * High-level facade for persisting session events and snapshots.
 *
 * Construct once per opened database and reuse across requests.
 * Prepared statements are cached internally.
 */
export class SessionEventStore {
	readonly #db: Database;

	readonly #insertEvent;
	readonly #listEventsBySession;
	readonly #deleteEventsBySession;
	readonly #insertSnapshot;
	readonly #latestSnapshot;
	readonly #deleteSnapshotsBySession;

	constructor(db: Database) {
		this.#db = db;
		this.#insertEvent = db.prepare(
			`INSERT INTO session_events
				(id, session_id, event_kind, priority, event_json, created_at)
				VALUES (?, ?, ?, ?, ?, ?)`,
		);
		this.#listEventsBySession = db.prepare<EventRow>(
			`SELECT id, session_id, event_kind, priority, event_json, created_at
				FROM session_events
				WHERE session_id = ?
				ORDER BY created_at ASC, id ASC`,
		);
		this.#deleteEventsBySession = db.prepare(
			"DELETE FROM session_events WHERE session_id = ?",
		);
		this.#insertSnapshot = db.prepare(
			`INSERT INTO session_snapshots
				(session_id, created_at, budget_bytes, included_event_count, snapshot_text)
				VALUES (?, ?, ?, ?, ?)`,
		);
		this.#latestSnapshot = db.prepare<SnapshotRow>(
			`SELECT session_id, created_at, budget_bytes, included_event_count, snapshot_text
				FROM session_snapshots
				WHERE session_id = ?
				ORDER BY created_at DESC, id DESC
				LIMIT 1`,
		);
		this.#deleteSnapshotsBySession = db.prepare(
			"DELETE FROM session_snapshots WHERE session_id = ?",
		);
	}

	/**
	 * Append an event to the store.
	 *
	 * Returns the persisted record, including the caller-supplied `id`
	 * echoed back in branded form. `createdAt` is server-generated (ISO
	 * 8601, UTC) so replayability doesn't depend on client clocks.
	 */
	append(input: {
		readonly id: EventId;
		readonly sessionId: SessionId;
		readonly event: SessionEvent;
	}): SessionEventRecord {
		return this.#appendWithTimestamp(input, new Date().toISOString());
	}

	/** Append many events inside a single transaction. Returns the persisted records. */
	appendAll(
		items: readonly {
			readonly id: EventId;
			readonly sessionId: SessionId;
			readonly event: SessionEvent;
		}[],
	): readonly SessionEventRecord[] {
		if (items.length === 0) return [];
		const createdAt = new Date().toISOString();
		const results: SessionEventRecord[] = [];
		const tx = this.#db.transaction(() => {
			for (const item of items) {
				results.push(this.#appendWithTimestamp(item, createdAt));
			}
		});
		tx();
		return results;
	}

	#appendWithTimestamp(
		input: {
			readonly id: EventId;
			readonly sessionId: SessionId;
			readonly event: SessionEvent;
		},
		createdAt: string,
	): SessionEventRecord {
		let eventJson: string;
		try {
			eventJson = JSON.stringify(input.event);
		} catch (err) {
			throw new NonSerializableEventError(
				`event kind "${input.event.kind}" could not be stringified`,
				err,
			);
		}
		this.#insertEvent.run(
			input.id,
			input.sessionId,
			input.event.kind,
			input.event.priority,
			eventJson,
			createdAt,
		);
		return {
			id: input.id,
			sessionId: input.sessionId,
			event: input.event,
			createdAt,
		};
	}

	/**
	 * List events for a session, optionally filtered by event kind / since
	 * timestamp / limit. Ordering is chronological (oldest first).
	 */
	list(filter: EventFilter & { readonly sessionId: SessionId; }): readonly SessionEventRecord[] {
		// We always scope to a session — callers that want global reads
		// should loop over sessionIds instead. This keeps the prepared
		// statement cache small and the index story clear.
		const rows = this.#listEventsBySession.all(filter.sessionId);
		const since = filter.since;
		const kindSet = filter.kinds !== undefined && filter.kinds.length > 0
			? new Set<SessionEventKind>(filter.kinds)
			: undefined;
		const limit = filter.limit;

		const out: SessionEventRecord[] = [];
		for (const row of rows) {
			if (since !== undefined && row.created_at < since) continue;
			if (kindSet !== undefined && !kindSet.has(row.event_kind as SessionEventKind)) continue;
			out.push(rowToRecord(row));
			if (limit !== undefined && out.length >= limit) break;
		}
		return out;
	}

	/**
	 * Delete every trace of a session (events + snapshots). Useful after
	 * a project-local "clear session" command or when the agent
	 * explicitly resets context.
	 */
	deleteSession(sessionId: SessionId): { readonly events: number; readonly snapshots: number; } {
		let events = 0;
		let snapshots = 0;
		const tx = this.#db.transaction(() => {
			events = this.#deleteEventsBySession.run(sessionId).changes;
			snapshots = this.#deleteSnapshotsBySession.run(sessionId).changes;
		});
		tx();
		return { events, snapshots };
	}

	/**
	 * Persist a compaction snapshot. Stores both the metadata (budget,
	 * event count) and the rendered text so SessionStart doesn't have
	 * to re-build the snapshot from scratch on restore.
	 */
	saveSnapshot(input: {
		readonly sessionId: SessionId;
		readonly budgetBytes: number;
		readonly includedEventCount: number;
		readonly snapshotText: string;
		readonly createdAt?: string;
	}): PersistedSnapshotMetadata {
		const createdAt = input.createdAt ?? new Date().toISOString();
		this.#insertSnapshot.run(
			input.sessionId,
			createdAt,
			input.budgetBytes,
			input.includedEventCount,
			input.snapshotText,
		);
		return {
			sessionId: input.sessionId,
			budgetBytes: input.budgetBytes,
			includedEventCount: input.includedEventCount,
			createdAt,
		};
	}

	/**
	 * Load the most recent snapshot for a session. Returns `undefined`
	 * if no snapshot has ever been taken — callers should treat that
	 * case as "fresh session, nothing to restore".
	 */
	latestSnapshotText(sessionId: SessionId): {
		readonly text: string;
		readonly createdAt: string;
		readonly budgetBytes: number;
		readonly includedEventCount: number;
	} | undefined {
		const row = this.#latestSnapshot.get(sessionId);
		if (row === undefined) return undefined;
		return {
			text: row.snapshot_text,
			createdAt: row.created_at,
			budgetBytes: row.budget_bytes,
			includedEventCount: row.included_event_count,
		};
	}
}

/**
 * Thrown when a persisted event row cannot be deserialized. This indicates
 * data corruption in the `session_events` table (e.g. truncated JSON).
 */
export class CorruptEventRowError extends Error {
	readonly rowId: string;
	constructor(rowId: string, cause: unknown) {
		super(`corrupt session_events row id=${rowId}: ${(cause as Error).message}`, { cause });
		this.name = "CorruptEventRowError";
		this.rowId = rowId;
	}
}

function rowToRecord(row: EventRow): SessionEventRecord {
	// `event_json` is written by us via JSON.stringify on a validated
	// SessionEvent, so parsing back is always safe. We still guard against
	// a corrupted row by surfacing a typed error rather than letting the
	// raw SyntaxError escape.
	let event: SessionEvent;
	try {
		event = JSON.parse(row.event_json) as SessionEvent;
	} catch (err) {
		throw new CorruptEventRowError(row.id, err);
	}
	return {
		id: eventIdUnsafe(row.id),
		sessionId: sessionIdUnsafe(row.session_id),
		event,
		createdAt: row.created_at,
	};
}

/**
 * Sort key helper for snapshot builders. Lower is earlier / higher priority.
 * Exposed so callers can implement their own budget-aware filtering.
 */
export function priorityRank(priority: EventPriority): number {
	return priority;
}
