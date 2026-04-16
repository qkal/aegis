/**
 * Platform adapter interface and shared types.
 *
 * Each platform adapter translates between platform-specific hook I/O
 * and Aegis's normalized event model. Adapters are the untrusted input
 * boundary — all data from the agent platform is validated here.
 */

import type { SessionEvent } from "@aegis/core";

/** Hook types supported by Aegis. */
export type HookType = "PreToolUse" | "PostToolUse" | "PreCompact" | "SessionStart";

/** Capability tiers for platform support. */
export type PlatformTier = 1 | 2 | 3;

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
