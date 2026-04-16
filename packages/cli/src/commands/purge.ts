/**
 * aegis purge — Content cleanup command.
 *
 * Subcommands:
 * - aegis purge          — Delete all indexed content
 * - aegis purge --expired — Delete only expired content
 *
 * Implementation deferred to Phase 4.
 */

export const COMMAND_NAME = "purge" as const;
export const COMMAND_DESCRIPTION = "Clean up indexed content";
