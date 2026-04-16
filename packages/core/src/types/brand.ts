/**
 * Branded types for domain identifiers.
 *
 * Branded types prevent accidental mixing of string/number IDs
 * that represent different domain concepts (e.g., passing a SessionId
 * where a PolicyId is expected).
 */

declare const __brand: unique symbol;

/** Apply a nominal brand to a base type. */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

/** Unique identifier for a user session. UUIDv7 (time-sorted). */
export type SessionId = Brand<string, "SessionId">;

/** Unique identifier for a session event. UUIDv7 (time-sorted). */
export type EventId = Brand<string, "EventId">;

/** Unique identifier for a policy document. */
export type PolicyId = Brand<string, "PolicyId">;

/** Unique identifier for an audit log entry. UUIDv7 (time-sorted). */
export type AuditEntryId = Brand<string, "AuditEntryId">;

/** Unique identifier for a content source in the index. */
export type ContentSourceId = Brand<number, "ContentSourceId">;

/** Construct a SessionId from a raw string (validated externally). */
export function sessionId(raw: string): SessionId {
	return raw as SessionId;
}

/** Construct an EventId from a raw string (validated externally). */
export function eventId(raw: string): EventId {
	return raw as EventId;
}

/** Construct a PolicyId from a raw string (validated externally). */
export function policyId(raw: string): PolicyId {
	return raw as PolicyId;
}

/** Construct an AuditEntryId from a raw string (validated externally). */
export function auditEntryId(raw: string): AuditEntryId {
	return raw as AuditEntryId;
}

/** Construct a ContentSourceId from a raw number (validated externally). */
export function contentSourceId(raw: number): ContentSourceId {
	return raw as ContentSourceId;
}
