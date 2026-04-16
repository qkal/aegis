/**
 * aegis doctor — Full health check command.
 *
 * Validates:
 * - Platform detection
 * - Hook registration
 * - Runtime availability
 * - Storage health (SQLite, FTS5)
 * - Policy validity
 * - Audit log integrity
 *
 * Implementation deferred to Phase 1.
 */

export const COMMAND_NAME = "doctor" as const;
export const COMMAND_DESCRIPTION = "Run a full health check on your Aegis installation";
