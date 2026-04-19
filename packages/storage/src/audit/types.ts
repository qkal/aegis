/**
 * Audit log types.
 *
 * Append-only, HMAC-chained audit log for security-relevant events.
 * Each entry includes an HMAC of the previous entry to detect tampering.
 * Stored in a separate SQLite database per project.
 */

import type { AuditEntryId, PolicyDecision, SessionId } from "@aegisctx/core";

/** Categories of auditable actions. */
export type AuditCategory =
	| "policy_eval"
	| "sandbox_exec"
	| "content_index"
	| "session_lifecycle"
	| "config_change";

/**
 * Outcome recorded for an audit entry.
 *
 * Derived from the canonical policy verdict union in `@aegisctx/core` plus an
 * "error" sentinel for failures that never reached a verdict (e.g. the
 * evaluator threw or a precondition was not met). Deriving from the core
 * type means the storage layer cannot drift from the policy engine's
 * decision vocabulary.
 */
export type AuditDecision = PolicyDecision["verdict"] | "error";

/** A single audit log entry. */
export interface AuditEntry {
	readonly id: AuditEntryId;
	readonly timestamp: string;
	readonly sessionId: SessionId;
	readonly category: AuditCategory;
	readonly action: string;
	readonly subject: string;
	readonly decision: AuditDecision;
	readonly reason: string;
	readonly context: Readonly<Record<string, unknown>>;
	readonly prevHmac: string;
	readonly hmac: string;
}

/** Filter options for querying audit entries. */
export interface AuditFilter {
	readonly sessionId?: SessionId;
	readonly category?: AuditCategory;
	readonly action?: string;
	readonly decision?: AuditDecision;
	readonly since?: string;
	readonly limit?: number;
}
