/**
 * Branded types for domain identifiers.
 *
 * Branded types prevent accidental mixing of string/number IDs
 * that represent different domain concepts (e.g., passing a SessionId
 * where a PolicyId is expected).
 *
 * Constructors come in two flavours:
 *
 *   • `sessionId(raw)` / `eventId(...)` / `policyId(...)` /
 *     `auditEntryId(...)` / `contentSourceId(...)` validate their input and
 *     throw `InvalidIdError` on malformed values. Use these at untrusted
 *     boundaries.
 *
 *   • `*Unsafe` counterparts (e.g. `sessionIdUnsafe`) skip validation and
 *     are identity casts. Only use them when the value has already been
 *     validated upstream (e.g. reloaded from the project-owned SQLite
 *     database).
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

/** Thrown when a branded constructor is given an invalid value. */
export class InvalidIdError extends Error {
	readonly kind: string;
	readonly received: unknown;
	constructor(kind: string, received: unknown, detail: string) {
		super(`invalid ${kind}: ${detail}`);
		this.name = "InvalidIdError";
		this.kind = kind;
		this.received = received;
	}
}

/**
 * Minimal invariant for string IDs: non-empty, no whitespace, no NUL bytes,
 * reasonable length. Full UUIDv7 enforcement is deferred until a library is
 * introduced; the goal here is to make the unchecked `as` cast impossible
 * for obviously-malformed inputs.
 */
function assertIdString(kind: string, raw: unknown): asserts raw is string {
	if (typeof raw !== "string") {
		throw new InvalidIdError(kind, raw, `expected string, received ${typeof raw}`);
	}
	if (raw.length === 0) {
		throw new InvalidIdError(kind, raw, "empty string");
	}
	if (raw.length > 128) {
		throw new InvalidIdError(kind, raw, `exceeds 128 characters (${raw.length})`);
	}
	if (/\s/.test(raw)) {
		throw new InvalidIdError(kind, raw, "contains whitespace");
	}
	if (raw.includes("\0")) {
		throw new InvalidIdError(kind, raw, "contains NUL byte");
	}
}

function assertContentSourceNumber(raw: unknown): asserts raw is number {
	if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
		throw new InvalidIdError("ContentSourceId", raw, "expected non-negative integer");
	}
}

/** Construct a SessionId from a raw string; throws on malformed input. */
export function sessionId(raw: string): SessionId {
	assertIdString("SessionId", raw);
	return raw as SessionId;
}

/** Construct an EventId from a raw string; throws on malformed input. */
export function eventId(raw: string): EventId {
	assertIdString("EventId", raw);
	return raw as EventId;
}

/** Construct a PolicyId from a raw string; throws on malformed input. */
export function policyId(raw: string): PolicyId {
	assertIdString("PolicyId", raw);
	return raw as PolicyId;
}

/** Construct an AuditEntryId from a raw string; throws on malformed input. */
export function auditEntryId(raw: string): AuditEntryId {
	assertIdString("AuditEntryId", raw);
	return raw as AuditEntryId;
}

/** Construct a ContentSourceId from a raw number; throws on malformed input. */
export function contentSourceId(raw: number): ContentSourceId {
	assertContentSourceNumber(raw);
	return raw as ContentSourceId;
}

/**
 * Identity-cast variants for trusted callers. No validation is performed —
 * the caller is responsible for guaranteeing the input already satisfies
 * the ID's invariants (e.g. it was re-read from storage we own).
 */
export const sessionIdUnsafe = (raw: string): SessionId => raw as SessionId;
export const eventIdUnsafe = (raw: string): EventId => raw as EventId;
export const policyIdUnsafe = (raw: string): PolicyId => raw as PolicyId;
export const auditEntryIdUnsafe = (raw: string): AuditEntryId => raw as AuditEntryId;
export const contentSourceIdUnsafe = (raw: number): ContentSourceId => raw as ContentSourceId;
