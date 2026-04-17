/**
 * @aegis/adapters — Platform adapter package.
 *
 * Provides platform-specific adapters for AI coding agent platforms.
 * Each adapter translates between platform hook I/O and Aegis's
 * normalized event model. Depends only on @aegis/core.
 */

export { AMP_PLATFORM } from "./amp/index.js";
export { ANTIGRAVITY_PLATFORM } from "./antigravity/index.js";
export {
	CLAUDE_CODE_PLATFORM,
	claudeCodeAdapter,
	postToolUseBashFailureFixture,
	postToolUseGitCommitFixture,
	postToolUseTodoWriteFixture,
	postToolUseWriteFixture,
	preCompactFixture,
	preToolUseBashFixture,
	preToolUseDotenvFixture,
	sessionStartFixture,
} from "./claude-code/index.js";
export type {
	PostToolUsePayload as ClaudeCodePostToolUsePayload,
	PreCompactPayload as ClaudeCodePreCompactPayload,
	PreToolUsePayload as ClaudeCodePreToolUsePayload,
	SessionStartPayload as ClaudeCodeSessionStartPayload,
} from "./claude-code/index.js";
export { CODEX_INTERCEPTED_TOOLS, CODEX_PLATFORM } from "./codex/index.js";
export { CURSOR_PLATFORM } from "./cursor/index.js";
export type { DetectedPlatform, PlatformId } from "./detect.js";
export { detectPlatform, PLATFORM_ENV_SIGNALS } from "./detect.js";
export { GEMINI_CLI_PLATFORM } from "./gemini-cli/index.js";
export { GENERIC_PLATFORM } from "./generic/index.js";
export { OPENCODE_PLATFORM, OPENCODE_PLUGIN_EVENTS } from "./opencode/index.js";
export type {
	HookAdapter,
	HookType,
	NormalizedHookResponse,
	NormalizedToolCall,
	NormalizedToolResult,
	PlatformCapabilities,
	PlatformTier,
} from "./types.js";
export { HOOK_TYPES } from "./types.js";
export { VSCODE_COPILOT_PLATFORM } from "./vscode-copilot/index.js";
export { WINDSURF_PLATFORM } from "./windsurf/index.js";
