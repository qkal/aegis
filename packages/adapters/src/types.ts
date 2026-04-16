/**
 * Platform adapter interface and shared types.
 *
 * Each platform adapter translates between platform-specific hook I/O
 * and Aegis's normalized event model. Adapters are the untrusted input
 * boundary — all data from the agent platform is validated here.
 */

import type { SessionEvent } from "@aegis/core";

/**
 * Canonical list of Aegis hook kinds. Exported as a readonly tuple so the
 * type `HookType` is derived from a single source of truth and downstream
 * code (e.g. `@aegis/server`'s orchestrator) can re-use the same constant
 * instead of redeclaring the list.
 */
export const HOOK_TYPES = ["PreToolUse", "PostToolUse", "PreCompact", "SessionStart"] as const;

/** Hook types supported by Aegis. */
export type HookType = (typeof HOOK_TYPES)[number];

/**
 * Capability tiers for platform support. See ADR-0007.
 *
 * All values are numeric so that ordinal comparisons (`tier <= 2`) work
 * correctly without special-casing.
 *
 *  - `1`   : full hook coverage (PreToolUse, PostToolUse, SessionStart, and
 *            where supported PreCompact). Examples: Claude Code, OpenCode.
 *  - `1.5` : Tier 1 wiring ("Tier 1L"), but the platform's hook runtime only
 *            emits PreToolUse/PostToolUse for a subset of tools. The adapter
 *            must also report `interceptedTools` in capabilities. Example:
 *            Codex CLI.
 *  - `2`   : partial hooks (PreToolUse + PostToolUse only). Examples: Cursor.
 *  - `3`   : MCP-only, no hooks; routing via instruction files. Examples:
 *            AmpCode, Windsurf, Antigravity, Zed.
 */
export type PlatformTier = 1 | 1.5 | 2 | 3;

/** Normalized tool call from any platform. */
export interface NormalizedToolCall {
	readonly toolName: string;
	readonly arguments: Readonly<Record<string, unknown>>;
	readonly rawInput: unknown;
}

/** Normalized tool result from any platform. */
export interface NormalizedToolResult {
	readonly toolName: string;
	readonly result: unknown;
	readonly rawOutput: unknown;
}

/** Platform capabilities report. */
export interface PlatformCapabilities {
	readonly platform: string;
	readonly tier: PlatformTier;
	readonly supportedHooks: readonly HookType[];
	readonly hasSessionStart: boolean;
	readonly hasPreCompact: boolean;
	readonly configDir: string;
	readonly sessionDir: string;
	/**
	 * For Tier 1L (`1.5`) platforms: the subset of tool names whose calls the
	 * platform actually fires PreToolUse/PostToolUse for. `undefined` means
	 * "all tools" (Tier 1) or "no tools" (Tier 3 — hooks not supported at all).
	 *
	 * For Tier 2 platforms: the subset of tools for which PreToolUse and
	 * PostToolUse hooks are supported. Tier 2 may include only pre/post hooks
	 * and not other hook types (SessionStart, PreCompact).
	 */
	readonly interceptedTools?: readonly string[];
}

/**
 * Interface that all platform adapters must implement.
 *
 * Each adapter is responsible for:
 * 1. Parsing platform-specific stdin JSON into normalized events
 * 2. Formatting Aegis responses into platform-specific stdout JSON
 * 3. Reporting its capabilities (which hooks are available)
 * 4. Providing platform-specific paths (config dir, session dir)
 */
export interface HookAdapter {
	/** Unique platform identifier. */
	readonly platform: string;

	/** Report this platform's capabilities. */
	capabilities(): PlatformCapabilities;

	/** Parse a raw hook input into a normalized tool call. */
	parseToolCall(hookType: HookType, rawInput: unknown): NormalizedToolCall;

	/** Parse a raw hook result into a normalized tool result. */
	parseToolResult(hookType: HookType, rawOutput: unknown): NormalizedToolResult;

	/** Format an Aegis response for the platform's expected output. */
	formatResponse(hookType: HookType, response: unknown): unknown;

	/** Extract session events from a tool result (PostToolUse). */
	extractEvents(result: NormalizedToolResult): readonly SessionEvent[];
}
