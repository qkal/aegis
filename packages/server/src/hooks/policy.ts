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
import {
	type AegisPolicy,
	evaluateToolCall,
	type PolicyDecision,
	SHELL_TOOL_NAMES,
} from "@aegis/core";

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
 * Render a conservative policy-matcher string representing the given normalized tool call.
 *
 * Extracts the first applicable string argument for known tool categories (shell command, file path, search pattern, or URL) and formats the result as `ToolName(argument)`. If no applicable argument is present, returns `ToolName()`.
 *
 * @returns The matcher string (e.g., `Read(/path/to/file)` or `Glob(pattern)`), or `ToolName()` when no argument is available.
 */
export function renderPolicyToolCall(call: NormalizedToolCall): string {
	const name = call.toolName;

	if (SHELL_TOOL_NAMES.has(name)) {
		const cmd = firstString(call.arguments, ["command"]);
		return `${name}(${cmd ?? ""})`;
	}
	if (FILE_PATH_TOOLS.has(name)) {
		const path = firstString(call.arguments, ["file_path", "notebook_path", "path"]);
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
 * Enforces the policy for a pre-tool-use event by evaluating the rendered tool call and producing a normalized hook response.
 *
 * @param call - The normalized tool invocation to evaluate
 * @param policy - The Aegis policy used to evaluate the tool call
 * @returns A `NormalizedHookResponse` representing the permission decision derived from the policy — e.g., allow (`{ kind: "permission", decision: "allow" }`), deny with a `reason`, or ask with a `prompt`
 */
export function evaluatePreToolUse(
	call: NormalizedToolCall,
	policy: AegisPolicy,
): NormalizedHookResponse {
	const toolCallStr = renderPolicyToolCall(call);
	const decision = evaluateToolCall(toolCallStr, policy);
	return toHookResponse(decision);
}

/**
 * Convert a policy decision into a normalized hook permission response.
 *
 * @param decision - The policy evaluation result whose `verdict` determines the response; may include `reason` or `prompt` for denial or interactive decisions.
 * @returns A `NormalizedHookResponse` of kind `"permission"`:
 * - `"allow"` when `decision.verdict` is `"allow"`.
 * - `"deny"` when `decision.verdict` is `"deny"` or `"default_deny"`, including `reason` when provided.
 * - `"ask"` when `decision.verdict` is `"ask"`, including the `prompt` as `reason`.
 */
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

/**
 * Selects the first non-empty string value from `args` using `keys` in order.
 *
 * @param args - Mapping of argument names to values to inspect
 * @param keys - Ordered list of keys to check on `args`
 * @returns The first string with length > 0 found at any provided key, or `undefined` if none exist
 */
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
