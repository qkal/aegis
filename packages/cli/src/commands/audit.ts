/**
 * aegis audit — Audit log commands.
 *
 * Subcommands:
 * - aegis audit show   — Display recent audit events
 * - aegis audit verify — Verify HMAC chain integrity
 * - aegis audit export — Export audit log as JSONL
 *
 * Implementation deferred to Phase 2.
 */

export const COMMAND_NAME = "audit" as const;
export const COMMAND_DESCRIPTION = "Query and verify the security audit log";
