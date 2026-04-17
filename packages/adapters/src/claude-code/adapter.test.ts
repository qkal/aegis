/**
 * Claude Code adapter unit tests.
 *
 * Organized by interface method. Each test asserts both the happy path
 * (fixture round-trips cleanly) and the defensive path (invalid input
 * is rejected at the adapter boundary rather than smuggled into Aegis
 * with an `unknown` shape). The fixtures live next to this file so
 * contributors can see exactly what Claude Code writes on stdin
 * without chasing indirection.
 */
import { describe, expect, it } from "vitest";

import type { NormalizedHookResponse, NormalizedToolResult } from "../types.js";
import { CLAUDE_CODE_PLATFORM, claudeCodeAdapter } from "./adapter.js";
import {
	postToolUseBashFailureFixture,
	postToolUseGitCommitFixture,
	postToolUseTodoWriteFixture,
	postToolUseWriteFixture,
	preCompactFixture,
	preToolUseBashFixture,
	preToolUseDotenvFixture,
	sessionStartFixture,
} from "./fixtures.js";

describe("claudeCodeAdapter.capabilities", () => {
	it("reports Tier 1 with all four hooks and no interceptedTools", () => {
		const caps = claudeCodeAdapter.capabilities();
		expect(caps.platform).toBe(CLAUDE_CODE_PLATFORM);
		expect(caps.tier).toBe(1);
		expect(caps.tierLabel).toBe("1");
		expect(caps.hasSessionStart).toBe(true);
		expect(caps.hasPreCompact).toBe(true);
		expect([...caps.supportedHooks].sort()).toEqual([
			"PostToolUse",
			"PreCompact",
			"PreToolUse",
			"SessionStart",
		]);
		// Tier 1 means "all tools intercepted"; this is signalled by leaving
		// interceptedTools unset (see ADR-0007).
		expect(caps.interceptedTools).toBeUndefined();
	});

	it("returns a stable (frozen) capability object", () => {
		const caps = claudeCodeAdapter.capabilities();
		expect(Object.isFrozen(caps)).toBe(true);
	});
});

describe("claudeCodeAdapter.parseToolCall", () => {
	it("validates and normalizes a PreToolUse Bash payload", () => {
		const call = claudeCodeAdapter.parseToolCall("PreToolUse", preToolUseBashFixture);
		expect(call.toolName).toBe("Bash");
		expect(call.arguments).toEqual({
			command: "npm test",
			description: "Run the project test suite",
		});
		expect(call.cwd).toBe("/home/alice/projects/demo");
		expect(call.sessionId).toBe("abc123-session");
		// rawInput is preserved by reference for downstream forwarding.
		expect(call.rawInput).toBe(preToolUseBashFixture);
	});

	it("rejects a payload with the wrong hook_event_name", () => {
		expect(() =>
			claudeCodeAdapter.parseToolCall("PreToolUse", {
				...preToolUseBashFixture,
				hook_event_name: "PostToolUse",
			})
		).toThrow(/hook_event_name|PreToolUse|Invalid/i);
	});

	it("rejects missing required fields (session_id)", () => {
		const { session_id: _unused, ...rest } = preToolUseBashFixture as Record<string, unknown>;
		expect(() => claudeCodeAdapter.parseToolCall("PreToolUse", rest))
			.toThrow(/session_id|required|Invalid/i);
	});

	it("refuses non-PreToolUse hook types", () => {
		expect(() => claudeCodeAdapter.parseToolCall("PostToolUse", preToolUseBashFixture))
			.toThrow(/only PreToolUse/);
	});

	it("tolerates a forward-compatible unknown field", () => {
		const call = claudeCodeAdapter.parseToolCall("PreToolUse", {
			...preToolUseBashFixture,
			future_field: { nested: true },
		});
		expect(call.toolName).toBe("Bash");
	});
});

describe("claudeCodeAdapter.parseToolResult", () => {
	it("validates and normalizes a PostToolUse Write payload", () => {
		const result = claudeCodeAdapter.parseToolResult("PostToolUse", postToolUseWriteFixture);
		expect(result.toolName).toBe("Write");
		expect(result.toolInput).toEqual({
			file_path: "/home/alice/projects/demo/README.md",
			content: "# Demo\n",
		});
		expect(result.result).toEqual({
			filePath: "/home/alice/projects/demo/README.md",
			success: true,
		});
		expect(result.cwd).toBe("/home/alice/projects/demo");
		expect(result.sessionId).toBe("abc123-session");
	});

	it("refuses non-PostToolUse hook types", () => {
		expect(() => claudeCodeAdapter.parseToolResult("PreToolUse", postToolUseWriteFixture))
			.toThrow(/only PostToolUse/);
	});
});

describe("claudeCodeAdapter.parseSessionStart / parsePreCompact", () => {
	it("parses a SessionStart startup payload", () => {
		const parsed = claudeCodeAdapter.parseSessionStart(sessionStartFixture);
		expect(parsed.sessionId).toBe("abc123-session");
		expect(parsed.source).toBe("startup");
		expect(parsed.model).toBe("claude-sonnet-4-6");
		expect(parsed.cwd).toBe("/home/alice/projects/demo");
	});

	it("parses a PreCompact manual payload", () => {
		const parsed = claudeCodeAdapter.parsePreCompact(preCompactFixture);
		expect(parsed.sessionId).toBe("abc123-session");
		expect(parsed.trigger).toBe("manual");
		expect(parsed.customInstructions).toBe("");
	});
});

describe("claudeCodeAdapter.formatResponse", () => {
	it("formats a PreToolUse deny with a reason", () => {
		const response: NormalizedHookResponse = {
			kind: "permission",
			decision: "deny",
			reason: "Policy forbids reading .env files",
		};
		expect(claudeCodeAdapter.formatResponse("PreToolUse", response)).toEqual({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: "Policy forbids reading .env files",
			},
		});
	});

	it("formats a PreToolUse allow without a reason", () => {
		const response: NormalizedHookResponse = { kind: "permission", decision: "allow" };
		expect(claudeCodeAdapter.formatResponse("PreToolUse", response)).toEqual({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "allow",
			},
		});
	});

	it("formats a PreToolUse noop as an empty object", () => {
		expect(claudeCodeAdapter.formatResponse("PreToolUse", { kind: "noop" })).toEqual({});
	});

	it("formats a SessionStart additionalContext injection", () => {
		const response: NormalizedHookResponse = {
			kind: "context",
			additionalContext: "Aegis Tier 1 (Claude Code). Prefer aegis_* tools.",
		};
		expect(claudeCodeAdapter.formatResponse("SessionStart", response)).toEqual({
			hookSpecificOutput: {
				hookEventName: "SessionStart",
				additionalContext: "Aegis Tier 1 (Claude Code). Prefer aegis_* tools.",
			},
		});
	});

	it("formats a PostToolUse block as top-level decision/reason", () => {
		const response: NormalizedHookResponse = {
			kind: "block",
			reason: "Post-tool audit found a secret leak",
		};
		expect(claudeCodeAdapter.formatResponse("PostToolUse", response)).toEqual({
			decision: "block",
			reason: "Post-tool audit found a secret leak",
		});
	});

	it("formats a PostToolUse additionalContext via hookSpecificOutput", () => {
		const response: NormalizedHookResponse = {
			kind: "context",
			additionalContext: "Reminder: lint the file you just wrote.",
		};
		expect(claudeCodeAdapter.formatResponse("PostToolUse", response)).toEqual({
			hookSpecificOutput: {
				hookEventName: "PostToolUse",
				additionalContext: "Reminder: lint the file you just wrote.",
			},
		});
	});

	it("formats a PreCompact block", () => {
		const response: NormalizedHookResponse = {
			kind: "block",
			reason: "Snapshot in progress",
		};
		expect(claudeCodeAdapter.formatResponse("PreCompact", response)).toEqual({
			decision: "block",
			reason: "Snapshot in progress",
		});
	});

	it("returns `{}` for SessionStart / PreCompact without steering", () => {
		expect(claudeCodeAdapter.formatResponse("SessionStart", { kind: "noop" })).toEqual({});
		expect(claudeCodeAdapter.formatResponse("PreCompact", { kind: "noop" })).toEqual({});
	});
});

describe("claudeCodeAdapter.extractEvents", () => {
	const resultFor = (
		fixture: Readonly<Record<string, unknown>>,
	): NormalizedToolResult => claudeCodeAdapter.parseToolResult("PostToolUse", fixture);

	it("emits a file/write event for a Write tool", () => {
		const events = claudeCodeAdapter.extractEvents(resultFor(postToolUseWriteFixture));
		expect(events).toHaveLength(1);
		const event = events[0];
		expect(event).toMatchObject({
			kind: "file",
			action: "write",
			path: "/home/alice/projects/demo/README.md",
		});
	});

	it("emits a git/commit event from a Bash `git commit`", () => {
		const events = claudeCodeAdapter.extractEvents(resultFor(postToolUseGitCommitFixture));
		expect(events.some((e) => e.kind === "git" && e.action === "commit")).toBe(true);
	});

	it("emits an error event for a failed Bash command", () => {
		const events = claudeCodeAdapter.extractEvents(resultFor(postToolUseBashFailureFixture));
		const errorEvent = events.find((e) => e.kind === "error");
		expect(errorEvent).toBeDefined();
		expect(errorEvent).toMatchObject({
			kind: "error",
			tool: "Bash",
			exitCode: 1,
		});
	});

	it("emits task events with correct action mapping from TodoWrite", () => {
		const events = claudeCodeAdapter.extractEvents(resultFor(postToolUseTodoWriteFixture));
		const tasks = events.filter((e) => e.kind === "task");
		expect(tasks).toHaveLength(3);
		const byDescription = new Map(
			tasks.map((t) => t.kind === "task" ? [t.description, t.action] : [undefined, undefined]),
		);
		expect(byDescription.get("Implement adapter")).toBe("complete");
		expect(byDescription.get("Write tests")).toBe("update");
		expect(byDescription.get("Open PR")).toBe("create");
	});

	it("returns [] for a tool without an extractor", () => {
		const mystery = claudeCodeAdapter.extractEvents({
			toolName: "UnknownFutureTool",
			result: { ok: true },
			rawOutput: {},
			toolInput: { foo: "bar" },
		});
		expect(mystery).toEqual([]);
	});

	it("does not emit a Read event when .env was blocked (no PostToolUse fires)", () => {
		// Sanity check: the .env fixture is PreToolUse-only; asking the
		// extractor for a PostToolUse Read on this input must yield nothing
		// because the call should have been denied upstream.
		expect(() => claudeCodeAdapter.parseToolResult("PostToolUse", preToolUseDotenvFixture))
			.toThrow(/tool_response|hook_event_name|Invalid/i);
	});
});
