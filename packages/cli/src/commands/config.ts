/**
 * aegisctx config — Configuration management commands.
 *
 * Subcommands:
 * - aegisctx config show    — Display resolved config
 * - aegisctx config set     — Set a config value
 * - aegisctx config validate — Validate all config files
 *
 * Implementation deferred to Phase 1.
 */

export const COMMAND_NAME = "config" as const;
export const COMMAND_DESCRIPTION = "Manage Aegis configuration";
