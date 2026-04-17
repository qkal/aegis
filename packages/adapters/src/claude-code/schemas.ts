/**
 * Zod schemas for Claude Code hook payloads.
 *
 * These schemas describe the JSON that the Claude Code CLI writes to
 * our hook handler's stdin. They are the untrusted-input boundary for
 * this adapter — every field coming out of Claude Code passes through
 * one of these schemas before any Aegis code sees it.
 *
 * Source: https://code.claude.com/docs/en/hooks (reference) plus the
 * "Claude Code Hooks — Input & Output Schemas" authoritative gist.
 * Unknown fields are preserved (`.passthrough()`-style via `.loose()`)
 * because Anthropic ships schema extensions without a major-version
 * bump, and stripping unknown keys would silently drop new signal we
 * might want to forward through `rawInput` / `rawOutput`.
 */
import { z } from "zod";

/**
 * Common envelope that every Claude Code hook payload carries.
 *
 * `transcript_path`, `permission_mode`, and `cwd` are documented as
 * always-present, but we mark them optional-with-fallback to survive
 * older Claude Code builds and fixture-minimization during testing.
 */
const commonEnvelopeShape = {
	session_id: z.string().min(1),
	transcript_path: z.string().optional(),
	cwd: z.string().optional(),
	permission_mode: z.string().optional(),
} as const;

/** PreToolUse: fires before Claude Code executes a tool call. Blocking. */
export const PreToolUsePayloadSchema = z.looseObject({
	...commonEnvelopeShape,
	hook_event_name: z.literal("PreToolUse"),
	tool_name: z.string().min(1),
	tool_input: z.record(z.string(), z.unknown()),
	tool_use_id: z.string().optional(),
});

/** PostToolUse: fires after a successful tool call. Non-blocking for tool,
 * but may inject `additionalContext` on the next turn. */
export const PostToolUsePayloadSchema = z.looseObject({
	...commonEnvelopeShape,
	hook_event_name: z.literal("PostToolUse"),
	tool_name: z.string().min(1),
	tool_input: z.record(z.string(), z.unknown()),
	tool_response: z.unknown(),
	tool_use_id: z.string().optional(),
});

/** SessionStart: fires at the top of every session (startup / resume / clear / compact). */
export const SessionStartPayloadSchema = z.looseObject({
	...commonEnvelopeShape,
	hook_event_name: z.literal("SessionStart"),
	source: z.enum(["startup", "resume", "clear", "compact"]).optional(),
	model: z.string().optional(),
});

/** PreCompact: fires immediately before Claude Code compacts the transcript. Blocking. */
export const PreCompactPayloadSchema = z.looseObject({
	...commonEnvelopeShape,
	hook_event_name: z.literal("PreCompact"),
	trigger: z.enum(["manual", "auto"]).optional(),
	custom_instructions: z.string().optional(),
});

export type PreToolUsePayload = z.infer<typeof PreToolUsePayloadSchema>;
export type PostToolUsePayload = z.infer<typeof PostToolUsePayloadSchema>;
export type SessionStartPayload = z.infer<typeof SessionStartPayloadSchema>;
export type PreCompactPayload = z.infer<typeof PreCompactPayloadSchema>;
