/**
 * Claude Code adapter (Tier 1).
 *
 * Translates between Claude Code's hook JSON (stdin/stdout) and Aegis's
 * normalized event + response model. Claude Code is Tier 1: all four
 * hook types (PreToolUse, PostToolUse, SessionStart, PreCompact) are
 * supported, so this adapter is the reference implementation.
 *
 * Input boundary: every raw payload is validated with Zod before any
 * other Aegis code sees the shape. Unknown top-level fields are
 * preserved via `z.looseObject(...)` so forward-compatible additions
 * survive round-tripping through `rawInput` / `rawOutput`.
 */
import type { SessionEvent } from "@aegis/core";

import type {
	HookAdapter,
	HookType,
	NormalizedHookResponse,
	NormalizedToolCall,
	NormalizedToolResult,
	PlatformCapabilities,
} from "../types.js";
import { extractClaudeEvents } from "./events.js";
import {
	PostToolUsePayloadSchema,
	PreCompactPayloadSchema,
	PreToolUsePayloadSchema,
	SessionStartPayloadSchema,
} from "./schemas.js";

/** Platform identifier exposed on the adapter and used by detectors. */
export const CLAUDE_CODE_PLATFORM = "claude-code" as const;

/**
 * Default Claude Code config / session locations.
 *
 * The install / init flow writes hook registrations into `configDir`
 * and Claude Code persists per-project transcripts under `sessionDir`.
 * Both paths are home-relative and expanded by the caller (CLI); the
 * adapter reports them verbatim so `aegis doctor` can surface them.
 */
const CLAUDE_CONFIG_DIR = "~/.claude" as const;
const CLAUDE_SESSION_DIR = "~/.claude/projects" as const;

/** Static capability report. Claude Code supports all four hook types. */
const CAPABILITIES: PlatformCapabilities = Object.freeze({
	platform: CLAUDE_CODE_PLATFORM,
	tier: 1,
	tierLabel: "1",
	supportedHooks: Object.freeze([
		"PreToolUse",
		"PostToolUse",
		"PreCompact",
		"SessionStart",
	]) as readonly HookType[],
	hasSessionStart: true,
	hasPreCompact: true,
	configDir: CLAUDE_CONFIG_DIR,
	sessionDir: CLAUDE_SESSION_DIR,
	// Tier 1: every tool is intercepted, so `interceptedTools` stays unset.
});

class ClaudeCodeAdapter implements HookAdapter {
	readonly platform = CLAUDE_CODE_PLATFORM;

	capabilities(): PlatformCapabilities {
		return CAPABILITIES;
	}

	parseToolCall(hookType: HookType, rawInput: unknown): NormalizedToolCall {
		if (hookType !== "PreToolUse") {
			throw new Error(
				`claude-code adapter: parseToolCall() called with hookType=${hookType}; only PreToolUse carries a tool call`,
			);
		}
		const parsed = PreToolUsePayloadSchema.parse(rawInput);
		return {
			toolName: parsed.tool_name,
			arguments: parsed.tool_input,
			rawInput,
			...(parsed.cwd !== undefined ? { cwd: parsed.cwd } : {}),
			sessionId: parsed.session_id,
		};
	}

	parseToolResult(hookType: HookType, rawOutput: unknown): NormalizedToolResult {
		if (hookType !== "PostToolUse") {
			throw new Error(
				`claude-code adapter: parseToolResult() called with hookType=${hookType}; only PostToolUse carries a tool result`,
			);
		}
		const parsed = PostToolUsePayloadSchema.parse(rawOutput);
		return {
			toolName: parsed.tool_name,
			result: parsed.tool_response,
			rawOutput,
			toolInput: parsed.tool_input,
			...(parsed.cwd !== undefined ? { cwd: parsed.cwd } : {}),
			sessionId: parsed.session_id,
		};
	}

	formatResponse(hookType: HookType, response: NormalizedHookResponse): unknown {
		switch (hookType) {
			case "PreToolUse":
				return formatPreToolUse(response);
			case "PostToolUse":
				return formatPostToolUse(response);
			case "PreCompact":
				return formatPreCompact(response);
			case "SessionStart":
				return formatSessionStart(response);
		}
	}

	extractEvents(result: NormalizedToolResult): readonly SessionEvent[] {
		return extractClaudeEvents(result);
	}

	/**
	 * Convenience: validate a raw SessionStart or PreCompact payload and
	 * return its envelope. Exposed separately because those hooks don't
	 * map to `parseToolCall` / `parseToolResult`, but callers still need
	 * a validated view.
	 */
	parseSessionStart(rawInput: unknown): {
		readonly sessionId: string;
		readonly source: "startup" | "resume" | "clear" | "compact" | undefined;
		readonly cwd: string | undefined;
		readonly model: string | undefined;
	} {
		const parsed = SessionStartPayloadSchema.parse(rawInput);
		return {
			sessionId: parsed.session_id,
			source: parsed.source,
			cwd: parsed.cwd,
			model: parsed.model,
		};
	}

	parsePreCompact(rawInput: unknown): {
		readonly sessionId: string;
		readonly trigger: "manual" | "auto" | undefined;
		readonly customInstructions: string | undefined;
	} {
		const parsed = PreCompactPayloadSchema.parse(rawInput);
		return {
			sessionId: parsed.session_id,
			trigger: parsed.trigger,
			customInstructions: parsed.custom_instructions,
		};
	}
}

/**
 * Singleton adapter instance. Adapters are stateless, so a single
 * instance is safe to share across calls / sessions / tests.
 */
export const claudeCodeAdapter: ClaudeCodeAdapter = new ClaudeCodeAdapter();

// ---------------------------------------------------------------------------
// Per-hook output formatters
// ---------------------------------------------------------------------------

/**
 * PreToolUse → `{ hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason? } }`.
 *
 * Claude Code's contract: a `permissionDecision` of `"deny"` blocks the
 * tool call; `"ask"` routes to the permission UI; `"allow"` is the
 * fast-path green-light. Missing `reason` is tolerated by Claude but
 * required by the gist reference for `deny` — we always surface it
 * when the caller provides one.
 */
function formatPreToolUse(response: NormalizedHookResponse): unknown {
	if (response.kind !== "permission") {
		// Non-permission responses for a PreToolUse hook are silent no-ops.
		return {};
	}
	const inner: Record<string, string> = {
		hookEventName: "PreToolUse",
		permissionDecision: response.decision,
	};
	if (response.reason !== undefined) {
		inner["permissionDecisionReason"] = response.reason;
	}
	return { hookSpecificOutput: inner };
}

/**
 * PostToolUse → `{ decision: "block", reason }` for a blocking feedback
 * loop, or `{}` for a silent pass-through. Claude Code also accepts an
 * `additionalContext` on PostToolUse via the same hookSpecificOutput
 * envelope as SessionStart, so we honor `kind: "context"` here too.
 */
function formatPostToolUse(response: NormalizedHookResponse): unknown {
	switch (response.kind) {
		case "block":
			return { decision: "block", reason: response.reason };
		case "context":
			return {
				hookSpecificOutput: {
					hookEventName: "PostToolUse",
					additionalContext: response.additionalContext,
				},
			};
		default:
			return {};
	}
}

/**
 * PreCompact → `{ decision: "block", reason }` or noop. Blocking here
 * prevents Claude Code from compacting the transcript; useful when we
 * want to snapshot important context first.
 */
function formatPreCompact(response: NormalizedHookResponse): unknown {
	if (response.kind === "block") {
		return { decision: "block", reason: response.reason };
	}
	return {};
}

/**
 * SessionStart → `{ hookSpecificOutput: { hookEventName, additionalContext } }`.
 *
 * This is Aegis's primary steering surface for every new Claude Code
 * session: the additionalContext is concatenated into the system prompt,
 * so it's where we advertise tier, hook coverage, and the Aegis tool
 * directory the agent should prefer.
 */
function formatSessionStart(response: NormalizedHookResponse): unknown {
	if (response.kind !== "context") return {};
	return {
		hookSpecificOutput: {
			hookEventName: "SessionStart",
			additionalContext: response.additionalContext,
		},
	};
}
