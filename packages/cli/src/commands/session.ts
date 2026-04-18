/**
 * aegisctx session — Session management commands.
 *
 * Subcommands:
 * - aegisctx session show   — Display current session events
 * - aegisctx session export — Export session as JSON
 *
 * Implementation deferred to Phase 4.
 */

export const COMMAND_NAME = "session" as const;
export const COMMAND_DESCRIPTION = "Manage session data and events";
