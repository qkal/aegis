/**
 * Platform auto-detection.
 *
 * Detects which AI coding agent platform is running based on
 * environment variables and process context.
 */

/** Detected platform information. */
export interface DetectedPlatform {
	readonly platform: string;
	readonly confidence: "high" | "medium" | "low";
	readonly reason: string;
}

/** Well-known environment variables for platform detection. */
export const PLATFORM_ENV_SIGNALS: Record<string, string> = {
	CLAUDE_PROJECT_DIR: "claude-code",
	GEMINI_CLI_PROJECT_DIR: "gemini-cli",
	CURSOR_PROJECT_DIR: "cursor",
	VSCODE_COPILOT_PROJECT_DIR: "vscode-copilot",
	OPENCODE_PROJECT_DIR: "opencode",
	KILO_CODE_PROJECT_DIR: "kilo-code",
};
