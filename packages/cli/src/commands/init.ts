/**
 * aegis init — Interactive setup command.
 *
 * Detects the current platform, creates config files with secure
 * defaults, copies platform-specific hook configuration, and runs
 * `aegis doctor` to verify.
 *
 * Implementation deferred to Phase 1.
 */

export const COMMAND_NAME = "init" as const;
export const COMMAND_DESCRIPTION = "Set up Aegis for your AI coding agent platform";
