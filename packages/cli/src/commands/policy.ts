/**
 * aegis policy — Policy management commands.
 *
 * Subcommands:
 * - aegis policy show    — Display resolved policy
 * - aegis policy check   — Test a command against policy
 * - aegis policy validate — Validate all policy files
 *
 * Implementation deferred to Phase 2.
 */

export const COMMAND_NAME = "policy" as const;
export const COMMAND_DESCRIPTION = "Manage and test security policies";
