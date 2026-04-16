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
	// Step 1: Check deny rules first (highest priority)
	for (const pattern of policy.tools.deny) {
		if (matchToolPattern(toolCall, pattern)) {
			return {
				verdict: "deny",
				matchedRule: pattern,
				reason: `Tool call "${toolCall}" matches deny rule "${pattern}"`,
			};
		}
	}

	// Step 2: Check ask rules
	for (const pattern of policy.tools.ask) {
		if (matchToolPattern(toolCall, pattern)) {
			return {
				verdict: "ask",
				matchedRule: pattern,
				prompt: `Tool call "${toolCall}" requires confirmation (matches rule "${pattern}")`,
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
		reason: `No matching allow rule for tool call "${toolCall}"`,
	};
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
	// Deny always takes precedence
	for (const pattern of policy.sandbox.fs.deny) {
		if (matchGlob(path, pattern)) {
			return "deny";
		}
	}

	const allowPatterns = operation === "write" ? policy.sandbox.fs.write : policy.sandbox.fs.read;

	for (const pattern of allowPatterns) {
		if (matchGlob(path, pattern)) {
			return "allow";
		}
	}

	// Default: deny
	return "deny";
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
