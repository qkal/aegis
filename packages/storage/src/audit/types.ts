/**
 * Audit log types.
 *
 * Append-only, HMAC-chained audit log for security-relevant events.
 * Each entry includes an HMAC of the previous entry to detect tampering.
 * Stored in a separate SQLite database per project.
 */

import type { AuditEntryId, SessionId } from "@aegis/core";

/** Categories of auditable actions. */
export type AuditCategory =
	| "policy_eval"
	| "sandbox_exec"
	| "content_index"
	| "session_lifecycle"
	| "config_change";

/** A single audit log entry. */
export interface AuditEntry {
	readonly id: AuditEntryId;
	readonly timestamp: string;
	readonly sessionId: SessionId;
	readonly category: AuditCategory;
	readonly action: string;
	readonly subject: string;
	readonly decision: "allow" | "deny" | "ask" | "error";
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
	readonly decision?: AuditEntry["decision"];
	readonly since?: string;
	readonly limit?: number;
}
