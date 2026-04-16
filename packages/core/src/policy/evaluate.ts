/**
 * Policy evaluation engine.
 *
 * Pure functions that evaluate tool calls against policy rules.
 * Evaluation order: deny → ask → allow → default-deny.
 *
 * This module has ZERO dependencies and ZERO I/O.
 */
import type { AegisPolicy, ToolPattern } from "./schema.js";

/**
 * Result of evaluating a tool call against a policy.
 * Discriminated union on `verdict`.
 */
export type PolicyDecision =
	| { readonly verdict: "allow"; readonly matchedRule: string }
	| {
			readonly verdict: "deny";
			readonly matchedRule: string;
			readonly reason: string;
	  }
	| {
			readonly verdict: "ask";
			readonly matchedRule: string;
			readonly prompt: string;
	  }
	| { readonly verdict: "default_deny"; readonly reason: string };

/**
 * Evaluate a tool call string against the policy's tool rules.
 *
 * @param toolCall - The tool call string (e.g., "Bash(sudo rm -rf /)")
 * @param policy - The resolved policy document
 * @returns A PolicyDecision describing the verdict
 */
export function evaluateToolCall(toolCall: string, policy: AegisPolicy): PolicyDecision {
	// The tool name (portion before the first "(") is safe to include in
	// human-readable messages; the argument payload may contain credentials,
	// secrets, or tokens and is therefore NEVER echoed — only `matchedRule`
	// (which comes from the policy author) is included.
	const toolName = extractToolName(toolCall);

	// Step 1: Check deny rules first (highest priority)
	for (const pattern of policy.tools.deny) {
		if (matchToolPattern(toolCall, pattern)) {
			return {
				verdict: "deny",
				matchedRule: pattern,
				reason: `${toolName} call matches deny rule "${pattern}"`,
			};
		}
	}

	// Step 2: Check ask rules
	for (const pattern of policy.tools.ask) {
		if (matchToolPattern(toolCall, pattern)) {
			return {
				verdict: "ask",
				matchedRule: pattern,
				prompt: `${toolName} call requires confirmation (matches rule "${pattern}")`,
			};
		}
	}

	// Step 3: Check allow rules
	for (const pattern of policy.tools.allow) {
		if (matchToolPattern(toolCall, pattern)) {
			return {
				verdict: "allow",
				matchedRule: pattern,
			};
		}
	}

	// Step 4: Default deny — no matching allow rule
	return {
		verdict: "default_deny",
		reason: `No matching allow rule for ${toolName} call`,
	};
}

/**
 * Extract the tool-name portion of a tool-call string (the text before the
 * first `(`). Returns "Tool" if no parens are present — tool names are
 * considered non-sensitive, but the argument payload is not.
 */
function extractToolName(toolCall: string): string {
	const parenIdx = toolCall.indexOf("(");
	if (parenIdx <= 0) {
		return "Tool";
	}
	return toolCall.slice(0, parenIdx);
}

/**
 * Evaluate an environment variable name against the sandbox env policy.
 *
 * @returns true if the variable is allowed in the sandbox
 */
export function evaluateEnvVar(varName: string, policy: AegisPolicy): boolean {
	// Deny takes precedence
	for (const pattern of policy.sandbox.env.deny) {
		if (matchGlob(varName, pattern)) {
			return false;
		}
	}

	// Check allow
	for (const pattern of policy.sandbox.env.allow) {
		if (matchGlob(varName, pattern)) {
			return true;
		}
	}

	// Default: deny (least privilege)
	return false;
}

/**
 * Evaluate a filesystem path against the sandbox fs policy.
 *
 * @returns "read" | "write" | "deny"
 */
export function evaluateFilePath(
	path: string,
	operation: "read" | "write",
	policy: AegisPolicy,
): "allow" | "deny" {
	// Normalize the path before matching so that traversal forms like
	// `/workspace/../etc/passwd` cannot evade deny rules by dressing up as
	// allowed prefixes. Malformed paths (null bytes, escapes above root) are
	// rejected outright.
	const normalized = normalizePathForPolicy(path);
	if (normalized === null) {
		return "deny";
	}

	// Deny always takes precedence
	for (const pattern of policy.sandbox.fs.deny) {
		if (matchGlob(normalized, pattern)) {
			return "deny";
		}
	}

	const allowPatterns = operation === "write" ? policy.sandbox.fs.write : policy.sandbox.fs.read;

	for (const pattern of allowPatterns) {
		if (matchGlob(normalized, pattern)) {
			return "allow";
		}
	}

	// Default: deny
	return "deny";
}

/**
 * POSIX-style path normalization suitable for policy matching.
 *
 * - Rejects strings containing NUL bytes (return `null`).
 * - Resolves `.` and `..` segments without touching the filesystem.
 * - Preserves a single leading `/` for absolute paths and a leading `~/`
 *   for home-relative paths (so `~/.ssh/*`-style patterns still apply).
 * - Rejects absolute paths whose `..` resolution would escape above root.
 * - Collapses runs of `/` and strips trailing `/`.
 *
 * The function is pure — no I/O, no `path.resolve` (which would consult
 * `process.cwd()`). It is safe to call on untrusted input.
 */
export function normalizePathForPolicy(input: string): string | null {
	if (input.includes("\0")) return null;
	if (input === "") return "";

	let prefix = "";
	let rest = input;
	if (rest.startsWith("~/")) {
		prefix = "~/";
		rest = rest.slice(2);
	} else if (rest === "~") {
		return "~";
	} else if (rest.startsWith("/")) {
		prefix = "/";
		rest = rest.slice(1);
	}

	const isAnchored = prefix !== "";
	const segments: string[] = [];
	for (const segment of rest.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			if (segments.length > 0 && segments[segments.length - 1] !== "..") {
				segments.pop();
				continue;
			}
			if (isAnchored) {
				// Attempt to escape above the anchor (/ or ~/) — refuse.
				return null;
			}
			segments.push("..");
			continue;
		}
		segments.push(segment);
	}

	const joined = segments.join("/");
	if (prefix === "") {
		return joined === "" ? "." : joined;
	}
	return prefix + joined;
}

/**
 * Evaluate a network host:port against the sandbox net policy.
 *
 * @returns true if the connection is allowed
 */
export function evaluateNetAccess(hostPort: string, policy: AegisPolicy): boolean {
	// Deny takes precedence
	for (const pattern of policy.sandbox.net.deny) {
		if (matchGlob(hostPort, pattern)) {
			return false;
		}
	}

	for (const pattern of policy.sandbox.net.allow) {
		if (matchGlob(hostPort, pattern)) {
			return true;
		}
	}

	// Default: deny
	return false;
}

/**
 * Match a tool call string against a tool pattern.
 *
 * Tool patterns have the form "ToolName(argument pattern)" where
 * the argument pattern supports glob-style wildcards.
 *
 * @example
 * matchToolPattern("Bash(sudo rm -rf /)", "Bash(sudo *)") // true
 * matchToolPattern("Read(.env.local)", "Read(.env*)") // true
 * matchToolPattern("Bash(git status)", "Bash(git *)") // true
 */
export function matchToolPattern(toolCall: string, pattern: ToolPattern): boolean {
	// Extract tool name and argument from both
	const callMatch = toolCall.match(/^(\w+)\((.+)\)$/);
	const patternMatch = pattern.match(/^(\w+)\((.+)\)$/);

	if (!callMatch || !patternMatch) {
		return toolCall === pattern;
	}

	const [, callTool, callArg] = callMatch;
	const [, patternTool, patternArg] = patternMatch;

	if (callTool !== patternTool) {
		return false;
	}

	return matchGlob(callArg ?? "", patternArg ?? "");
}

/**
 * Simple glob matching supporting `*` (any characters) and `?` (single character).
 * This is intentionally simple — no brace expansion, no character classes.
 */
export function matchGlob(input: string, pattern: string): boolean {
	const regex = globToRegex(pattern);
	return regex.test(input);
}

/** Convert a glob pattern to a RegExp. */
function globToRegex(pattern: string): RegExp {
	let regex = "^";
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i];
		switch (c) {
			case "*":
				regex += ".*";
				break;
			case "?":
				regex += ".";
				break;
			case ".":
			case "(":
			case ")":
			case "[":
			case "]":
			case "{":
			case "}":
			case "+":
			case "^":
			case "$":
			case "|":
			case "\\":
				regex += `\\${c}`;
				break;
			default:
				regex += c;
		}
	}
	regex += "$";
	return new RegExp(regex);
}
