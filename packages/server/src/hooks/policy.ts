/**
 * PreToolUse policy enforcement.
 *
 * Translates a {@link NormalizedToolCall} into a policy-tool-call
 * string of the form `ToolName(argument)` that {@link evaluateToolCall}
 * understands, then maps the resulting {@link PolicyDecision} onto a
 * {@link NormalizedHookResponse} the adapter can serialize to the
 * platform's wire format.
 *
 * Argument derivation is deliberately conservative:
 *
 *  - Shell-like tools (`Bash`, `Shell`, `Exec`, `Sh`, `run_command`)
 *    use the `command` argument verbatim. The core evaluator expands
 *    chain operators and command substitutions so a deny rule for
 *    `Bash(sudo *)` can never be bypassed via `Bash(true; sudo ls)`.
 *  - File-oriented tools (`Read`, `Write`, `Edit`, `MultiEdit`) use
 *    the `file_path` argument.
 *  - Search tools (`Glob`, `Grep`) use `pattern` (or `path` as fallback).
 *  - Fetch-like tools use `url`.
 *  - Everything else falls back to the tool name with an empty
 *    argument — covered by tool-name-only patterns like `ToolName(*)`.
 *
 * The fallback deliberately does NOT serialize the full arguments
 * object: the policy matcher is glob-based, not structural, and
 * stringifying arbitrary JSON would produce matches that are both
 * lossy (for the author) and leaky (for the sandbox — tokens and
 * credentials routinely appear in tool arguments).
 */

import type { NormalizedHookResponse, NormalizedToolCall } from "@aegis/adapters";
import { type AegisPolicy, evaluateToolCall, type PolicyDecision } from "@aegis/core";

/**
 * Tools whose first argument is a shell command line. Mirrors the
 * list built into `@aegis/core`'s `evaluateToolCall` + any adapter-
 * specific aliases (OpenCode uses `run_command`).
 */
const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set([
	"Bash",
	"Shell",
	"Exec",
	"Sh",
	"run_command",
]);

/** File-path-bearing tools. */
const FILE_PATH_TOOLS: ReadonlySet<string> = new Set([
	"Read",
	"Write",
	"Edit",
	"MultiEdit",
	"NotebookEdit",
]);

/** Search-pattern-bearing tools. */
const SEARCH_TOOLS: ReadonlySet<string> = new Set(["Glob", "Grep"]);

/** URL-bearing tools. */
const URL_TOOLS: ReadonlySet<string> = new Set([
	"WebFetch",
	"WebSearch",
	"Fetch",
	"aegis_fetch",
]);

/**
 * Build the policy-matcher string for a normalized tool call.
 *
 * Exported for unit tests and cross-package reuse; the return value
 * is what {@link evaluateToolCall} receives.
 */
export function renderPolicyToolCall(call: NormalizedToolCall): string {
	const name = call.toolName;

	if (SHELL_TOOL_NAMES.has(name)) {
		const cmd = firstString(call.arguments, ["command"]);
		return `${name}(${cmd ?? ""})`;
	}
	if (FILE_PATH_TOOLS.has(name)) {
		const path = firstString(call.arguments, ["file_path", "path"]);
		return `${name}(${path ?? ""})`;
	}
	if (SEARCH_TOOLS.has(name)) {
		const pattern = firstString(call.arguments, ["pattern", "path"]);
		return `${name}(${pattern ?? ""})`;
	}
	if (URL_TOOLS.has(name)) {
		const url = firstString(call.arguments, ["url"]);
		return `${name}(${url ?? ""})`;
	}
	return `${name}()`;
}

/**
 * Evaluate a PreToolUse call against the policy and return a
 * platform-agnostic response the adapter can serialize.
 */
export function evaluatePreToolUse(
	call: NormalizedToolCall,
	policy: AegisPolicy,
): NormalizedHookResponse {
	const toolCallStr = renderPolicyToolCall(call);
	const decision = evaluateToolCall(toolCallStr, policy);
	return toHookResponse(decision);
}

/** Map a {@link PolicyDecision} onto a {@link NormalizedHookResponse}. */
export function toHookResponse(decision: PolicyDecision): NormalizedHookResponse {
	switch (decision.verdict) {
		case "allow":
			return { kind: "permission", decision: "allow" };
		case "deny":
			return {
				kind: "permission",
				decision: "deny",
				reason: decision.reason,
			};
		case "ask":
			return {
				kind: "permission",
				decision: "ask",
				reason: decision.prompt,
			};
		case "default_deny":
			return {
				kind: "permission",
				decision: "deny",
				reason: decision.reason,
			};
	}
}

function firstString(
	args: Readonly<Record<string, unknown>>,
	keys: readonly string[],
): string | undefined {
	for (const key of keys) {
		const v = args[key];
		if (typeof v === "string" && v.length > 0) return v;
	}
	return undefined;
}
