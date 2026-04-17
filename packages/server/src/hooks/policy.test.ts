import type { NormalizedToolCall } from "@aegis/adapters";
import { DEFAULT_POLICY, normalizePolicy } from "@aegis/core";
import { describe, expect, it } from "vitest";

import { evaluatePreToolUse, renderPolicyToolCall, toHookResponse } from "./policy.js";

function call(toolName: string, args: Record<string, unknown>): NormalizedToolCall {
	return {
		toolName,
		arguments: args,
		rawInput: { tool_name: toolName, tool_input: args },
	};
}

describe("renderPolicyToolCall", () => {
	it("renders Bash calls using the command argument", () => {
		expect(renderPolicyToolCall(call("Bash", { command: "git status" })))
			.toBe("Bash(git status)");
	});

	it("renders Read/Write calls using file_path", () => {
		expect(renderPolicyToolCall(call("Read", { file_path: "/etc/passwd" })))
			.toBe("Read(/etc/passwd)");
		expect(renderPolicyToolCall(call("Write", { file_path: ".env.local", content: "secret" })))
			.toBe("Write(.env.local)");
	});

	it("renders Grep/Glob calls using pattern", () => {
		expect(renderPolicyToolCall(call("Grep", { pattern: "TODO", path: "src/" })))
			.toBe("Grep(TODO)");
	});

	it("renders WebFetch calls using url", () => {
		expect(renderPolicyToolCall(call("WebFetch", { url: "https://example.com" })))
			.toBe("WebFetch(https://example.com)");
	});

	it("falls back to an empty argument for unknown tools", () => {
		expect(renderPolicyToolCall(call("SomeOtherTool", { anything: "at all" })))
			.toBe("SomeOtherTool()");
	});

	it("treats missing or non-string arguments as empty", () => {
		expect(renderPolicyToolCall(call("Bash", { command: 42 as unknown as string })))
			.toBe("Bash()");
		expect(renderPolicyToolCall(call("Read", {}))).toBe("Read()");
	});
});

describe("evaluatePreToolUse", () => {
	it("denies Bash(sudo ...) under the default policy", () => {
		const res = evaluatePreToolUse(
			call("Bash", { command: "sudo rm -rf /" }),
			DEFAULT_POLICY,
		);
		expect(res.kind).toBe("permission");
		if (res.kind !== "permission") throw new Error("unreachable");
		expect(res.decision).toBe("deny");
		expect(res.reason).toMatch(/deny rule/);
	});

	it("denies Read(.env*) under the default policy", () => {
		const res = evaluatePreToolUse(
			call("Read", { file_path: ".env.production" }),
			DEFAULT_POLICY,
		);
		if (res.kind !== "permission") throw new Error("unreachable");
		expect(res.decision).toBe("deny");
	});

	it("denies chained shell calls when any segment matches a deny rule", () => {
		const res = evaluatePreToolUse(
			call("Bash", { command: "echo hi; sudo ls" }),
			DEFAULT_POLICY,
		);
		if (res.kind !== "permission") throw new Error("unreachable");
		expect(res.decision).toBe("deny");
	});

	it("allows Bash(git ...) under the default policy", () => {
		const res = evaluatePreToolUse(
			call("Bash", { command: "git status" }),
			DEFAULT_POLICY,
		);
		if (res.kind !== "permission") throw new Error("unreachable");
		expect(res.decision).toBe("allow");
	});

	it("falls through to default-deny for tools with no matching allow", () => {
		const res = evaluatePreToolUse(
			call("MysteryTool", { anything: "goes" }),
			DEFAULT_POLICY,
		);
		if (res.kind !== "permission") throw new Error("unreachable");
		expect(res.decision).toBe("deny");
		expect(res.reason).toMatch(/No matching allow rule/);
	});

	it("honors `ask` rules from a user policy", () => {
		const policy = normalizePolicy({
			tools: {
				deny: [...DEFAULT_POLICY.tools.deny],
				allow: [...DEFAULT_POLICY.tools.allow],
				ask: ["Bash(curl *)"],
			},
		});
		const res = evaluatePreToolUse(
			call("Bash", { command: "curl https://example.com" }),
			policy,
		);
		if (res.kind !== "permission") throw new Error("unreachable");
		expect(res.decision).toBe("ask");
		expect(res.reason).toMatch(/requires confirmation/);
	});
});

describe("toHookResponse", () => {
	it("preserves deny reasons verbatim", () => {
		const res = toHookResponse({
			verdict: "deny",
			matchedRule: "Bash(sudo *)",
			reason: 'Bash call matches deny rule "Bash(sudo *)"',
		});
		if (res.kind !== "permission") throw new Error("unreachable");
		expect(res.decision).toBe("deny");
		expect(res.reason).toBe('Bash call matches deny rule "Bash(sudo *)"');
	});

	it("maps default_deny onto a deny response", () => {
		const res = toHookResponse({
			verdict: "default_deny",
			reason: "No matching allow rule for Bash call",
		});
		if (res.kind !== "permission") throw new Error("unreachable");
		expect(res.decision).toBe("deny");
	});

	it("maps ask.prompt onto the response reason", () => {
		const res = toHookResponse({
			verdict: "ask",
			matchedRule: "Bash(curl *)",
			prompt: "Bash call requires confirmation",
		});
		if (res.kind !== "permission") throw new Error("unreachable");
		expect(res.decision).toBe("ask");
		expect(res.reason).toBe("Bash call requires confirmation");
	});
});
