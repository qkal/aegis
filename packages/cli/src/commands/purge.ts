/**
 * aegisctx purge — Content cleanup command.
 *
 * Subcommands:
 * - aegisctx purge          — Delete all indexed content
 * - aegisctx purge --expired — Delete only expired content
 *
 * Implementation deferred to Phase 4.
 */

export const COMMAND_NAME = "purge" as const;
export const COMMAND_DESCRIPTION = "Clean up indexed content";
