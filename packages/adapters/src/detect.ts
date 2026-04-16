/**
 * Platform auto-detection.
 *
 * Detects which AI coding agent platform is running based on
 * environment variables and process context.
 */

/**
 * Well-known environment variables for platform detection.
 *
 * Declared `as const` so the value literals narrow to a union and can be
 * exposed via the `PlatformId` type below — callers that receive a
 * `DetectedPlatform.platform` therefore get the exact union of known
 * platforms from the compiler.
 */
export const PLATFORM_ENV_SIGNALS = {
	CLAUDE_PROJECT_DIR: "claude-code",
	GEMINI_CLI_PROJECT_DIR: "gemini-cli",
	CURSOR_PROJECT_DIR: "cursor",
	VSCODE_COPILOT_PROJECT_DIR: "vscode-copilot",
	OPENCODE_PROJECT_DIR: "opencode",
	KILO_CODE_PROJECT_DIR: "kilo-code",
} as const;

/** Literal union of known platform identifiers. */
export type PlatformId = (typeof PLATFORM_ENV_SIGNALS)[keyof typeof PLATFORM_ENV_SIGNALS];

/** Detected platform information. */
export interface DetectedPlatform {
	readonly platform: PlatformId;
	readonly confidence: "high" | "medium" | "low";
	readonly reason: string;
}
