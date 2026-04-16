/**
 * aegis_audit — Audit log query tool.
 *
 * Query recent audit events from the HMAC-chained audit log.
 *
 * Implementation deferred to Phase 2.
 */

export const TOOL_NAME = "aegis_audit" as const;

export const TOOL_DESCRIPTION = "Query recent security audit events. Filter by category, action, "
	+ "decision, or time range.";
