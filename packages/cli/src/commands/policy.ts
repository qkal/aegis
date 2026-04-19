/**
 * aegisctx policy — Policy management commands.
 *
 * Subcommands:
 * - aegisctx policy show    — Display resolved policy
 * - aegisctx policy check   — Test a command against policy
 * - aegisctx policy validate — Validate all policy files
 *
 * Implementation deferred to Phase 2.
 */

export const COMMAND_NAME = "policy" as const;
export const COMMAND_DESCRIPTION = "Manage and test security policies";
