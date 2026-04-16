/**
 * @aegis/adapters — Platform adapter package.
 *
 * Provides platform-specific adapters for AI coding agent platforms.
 * Each adapter translates between platform hook I/O and Aegis's
 * normalized event model. Depends only on @aegis/core.
 */

export { CLAUDE_CODE_PLATFORM } from "./claude-code/index.js";
export { CURSOR_PLATFORM } from "./cursor/index.js";
export type { DetectedPlatform, PlatformId } from "./detect.js";
export { PLATFORM_ENV_SIGNALS } from "./detect.js";
export { GEMINI_CLI_PLATFORM } from "./gemini-cli/index.js";
export { GENERIC_PLATFORM } from "./generic/index.js";
export type {
	HookAdapter,
	HookType,
	NormalizedToolCall,
	NormalizedToolResult,
	PlatformCapabilities,
	PlatformTier,
} from "./types.js";
export { HOOK_TYPES } from "./types.js";
export { VSCODE_COPILOT_PLATFORM } from "./vscode-copilot/index.js";
