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
	/** Current working directory reported by the platform, when available. */
	readonly cwd?: string;
	/** Platform-assigned session identifier, when available. */
	readonly sessionId?: string;
}

/** Normalized tool result from any platform. */
export interface NormalizedToolResult {
	readonly toolName: string;
	readonly result: unknown;
	readonly rawOutput: unknown;
	/** The tool input that produced this result, when available. */
	readonly toolInput?: Readonly<Record<string, unknown>>;
	/** Current working directory reported by the platform, when available. */
	readonly cwd?: string;
	/** Platform-assigned session identifier, when available. */
	readonly sessionId?: string;
}

/**
 * Platform-agnostic hook response.
 *
 * Orchestrators build one of these and pass it to {@link HookAdapter.formatResponse},
 * which translates the shape into whatever wire format the platform expects.
 * Each variant is valid for only a specific subset of hook types — see the
 * per-adapter `formatResponse` implementation for the exact mapping.
 */
export type NormalizedHookResponse =
	/** Pre-tool-use permission decision (allow/deny/ask). */
	| {
		readonly kind: "permission";
		readonly decision: "allow" | "deny" | "ask";
		readonly reason?: string;
	}
	/** Extra context to prepend at session start or after compaction. */
	| {
		readonly kind: "context";
		readonly additionalContext: string;
	}
	/** Block a post-tool-use or pre-compact event with a human-readable reason. */
	| {
		readonly kind: "block";
		readonly reason: string;
	}
	/** No-op response: the hook completes cleanly without steering the agent. */
	| { readonly kind: "noop"; };

/** Platform capabilities report. */
export interface PlatformCapabilities {
	readonly platform: string;
	readonly tier: PlatformTier;
	/**
	 * Human-readable tier label for serialization (session-start messages,
	 * `aegis doctor` output, JSON payloads). Maps `1` → `"1"`, `1.5` → `"1L"`,
	 * `2` → `"2"`, `3` → `"3"`. Use `tier` for ordinal comparisons; use
	 * `tierLabel` when the value is shown to agents or users.
	 */
	readonly tierLabel: "1" | "1L" | "2" | "3";
	readonly supportedHooks: readonly HookType[];
	readonly hasSessionStart: boolean;
	readonly hasPreCompact: boolean;
	readonly configDir: string;
	readonly sessionDir: string;
	/**
	 * The subset of tool names whose calls the platform actually fires
	 * PreToolUse/PostToolUse for. Semantics vary by tier (see ADR-0007):
	 *
	 *  - **Tier 1**: `undefined` — all tools are intercepted.
	 *  - **Tier 1L** (`1.5`): **MUST** be a non-empty array listing the
	 *    tools the platform's hook runtime matches (e.g. `['Bash']` for
	 *    Codex today). The MCP server uses this to fall back to MCP-only
	 *    enforcement for unmatched tools.
	 *  - **Tier 2**: optional array of tools with PreToolUse/PostToolUse
	 *    support. `undefined` means all tools that have hooks.
	 *  - **Tier 3**: `undefined` — hooks not supported at all.
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
	formatResponse(hookType: HookType, response: NormalizedHookResponse): unknown;

	/** Extract session events from a tool result (PostToolUse). */
	extractEvents(result: NormalizedToolResult): readonly SessionEvent[];
}
