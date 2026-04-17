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
	CODEX_HOME: "codex",
	CODEX_SESSION_ID: "codex",
	GEMINI_CLI_PROJECT_DIR: "gemini-cli",
	CURSOR_PROJECT_DIR: "cursor",
	VSCODE_COPILOT_PROJECT_DIR: "vscode-copilot",
	OPENCODE_PROJECT_DIR: "opencode",
	OPENCODE_SESSION_ID: "opencode",
	AMP_SESSION_ID: "amp",
	AMP_THREAD_ID: "amp",
	WINDSURF_PROJECT_DIR: "windsurf",
	ANTIGRAVITY_PROJECT_DIR: "antigravity",
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

/**
 * Detect the host agent platform from an environment map (defaults to
 * `process.env`). Returns `undefined` if no known signal matches — the
 * caller is expected to fall back to `generic` in that case.
 *
 * Resolution order is the insertion order of {@link PLATFORM_ENV_SIGNALS}:
 * Claude Code wins over Codex if, somehow, both sets of env vars are
 * present simultaneously. In practice a host shell never sets more than
 * one platform's signals at once, but deterministic ordering keeps the
 * fallback predictable for tests and `aegis doctor`.
 */
export function detectPlatform(
	env: Readonly<Record<string, string | undefined>>,
): DetectedPlatform | undefined {
	for (const [signal, platform] of Object.entries(PLATFORM_ENV_SIGNALS)) {
		const value = env[signal];
		if (value !== undefined && value !== "") {
			return {
				platform,
				confidence: "high",
				reason: `env var ${signal} is set`,
			};
		}
	}
	return undefined;
}
