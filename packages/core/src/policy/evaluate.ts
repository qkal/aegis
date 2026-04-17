/**
 * Policy evaluation engine.
 *
 * Pure functions that evaluate tool calls against policy rules.
 * Evaluation order: deny → ask → allow → default-deny.
 *
 * This module has ZERO dependencies and ZERO I/O.
 *
 * Security notes:
 *
 *  1. Glob matching is implemented with a linear two-pointer algorithm
 *     (not a regex engine) so a malicious policy author cannot craft a
 *     pattern that triggers catastrophic regex backtracking (ReDoS).
 *  2. Tool calls for shell-like tools (`Bash`, `Shell`, `Exec`, `Sh`,
 *     `run_command`) are decomposed into their constituent commands
 *     before matching. Chain operators (`;`, `&&`, `||`, `|`, `&`,
 *     newline) and command substitutions (`$(...)`, backticks) are
 *     recursively extracted so that a call like
 *     `Bash(git status; sudo rm -rf /)` cannot bypass a deny rule for
 *     `Bash(sudo *)` by riding on an allowed prefix.
 */
import type { AegisPolicy, ToolPattern } from "./schema.js";

/**
 * Result of evaluating a tool call against a policy.
 * Discriminated union on `verdict`.
 */
export type PolicyDecision =
	| { readonly verdict: "allow"; readonly matchedRule: string; }
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
	| { readonly verdict: "default_deny"; readonly reason: string; };

/**
 * Tools whose argument is a shell command line. For these tools the
 * argument is decomposed on chain operators and command substitutions
 * before matching against policy rules; every sub-command must satisfy
 * the policy independently.
 *
 * Exported so the server hook layer can reuse the same set instead of
 * maintaining a duplicate that could drift. Any tool the hook maps
 * onto a shell-command-line argument must appear here, otherwise a
 * chained command like `run_command(echo ok; sudo rm -rf /)` would be
 * matched as a single opaque argument and bypass a
 * `run_command(sudo *)` deny rule.
 */
export const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set([
	"Bash",
	"Shell",
	"Exec",
	"Sh",
	"run_command",
]);

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

	// For shell-like tools, expand the call into its constituent commands
	// and evaluate each one independently. This prevents chain-operator
	// bypasses such as `Bash(git status; sudo rm -rf /)`.
	const subCalls = expandToolCall(toolCall);

	// Step 1: Check deny rules first (highest priority).
	// A deny match on ANY sub-command denies the whole call.
	for (const pattern of policy.tools.deny) {
		for (const call of subCalls) {
			if (matchToolPattern(call, pattern)) {
				return {
					verdict: "deny",
					matchedRule: pattern,
					reason: `${toolName} call matches deny rule "${pattern}"`,
				};
			}
		}
	}

	// Step 2: Check ask rules. An ask match on ANY sub-command escalates.
	for (const pattern of policy.tools.ask) {
		for (const call of subCalls) {
			if (matchToolPattern(call, pattern)) {
				return {
					verdict: "ask",
					matchedRule: pattern,
					prompt: `${toolName} call requires confirmation (matches rule "${pattern}")`,
				};
			}
		}
	}

	// Step 3: Check allow rules. EVERY sub-command must match some allow
	// rule for the whole call to be allowed. If any sub-command has no
	// matching allow rule, we fall through to default-deny.
	let matchedAllow: string | null = null;
	for (const call of subCalls) {
		let matched: string | null = null;
		for (const pattern of policy.tools.allow) {
			if (matchToolPattern(call, pattern)) {
				matched = pattern;
				break;
			}
		}
		if (matched === null) {
			return {
				verdict: "default_deny",
				reason: `No matching allow rule for ${toolName} call`,
			};
		}
		// Remember the first allow rule that matched, for reporting.
		matchedAllow ??= matched;
	}

	if (matchedAllow !== null) {
		return { verdict: "allow", matchedRule: matchedAllow };
	}

	// Step 4: Default deny — no sub-commands at all (empty arg).
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
 * Expand a tool call into the set of sub-calls that must satisfy policy.
 *
 * For non-shell tools this is simply `[toolCall]`.
 *
 * For shell tools (those in {@link SHELL_TOOL_NAMES}: `Bash`, `Shell`,
 * `Exec`, `Sh`, `run_command`) the argument is split on unquoted chain
 * operators (`;`, `&&`, `||`, `|`, `&`, newline) and any command
 * substitutions (`$(...)` and backticks) are recursively extracted so
 * their contents are also evaluated. Each resulting segment is wrapped
 * back into the same tool name so matching works uniformly.
 *
 * Exported for testing only.
 */
export function expandToolCall(toolCall: string): readonly string[] {
	const parsed = parseToolCall(toolCall);
	if (parsed === null) {
		return [toolCall];
	}
	const { name, arg } = parsed;
	if (!SHELL_TOOL_NAMES.has(name)) {
		return [toolCall];
	}
	const segments = splitShellCommand(arg);
	if (segments.length === 0) {
		return [toolCall];
	}
	return segments.map((seg) => `${name}(${seg})`);
}

/**
 * Parse a tool-call string of the form `Name(arg)`. Returns null if the
 * string does not conform so callers can fall back to literal matching.
 */
function parseToolCall(toolCall: string): { name: string; arg: string; } | null {
	const open = toolCall.indexOf("(");
	if (open <= 0 || !toolCall.endsWith(")")) return null;
	const name = toolCall.slice(0, open);
	if (!/^\w+$/.test(name)) return null;
	const arg = toolCall.slice(open + 1, toolCall.length - 1);
	return { name, arg };
}

/**
 * Split a shell command line into its constituent simple commands.
 *
 * Honoured delimiters (at the top level only, i.e. outside quotes and
 * grouping parens): `;`, `&&`, `||`, `|`, `|&`, `&`, newlines.
 * Command substitutions (`$(...)` and backticks) are expanded to additional
 * segments so that substituted commands are independently evaluated.
 *
 * Quote handling:
 *  - Single quotes: everything inside is literal (no escapes, no expansion).
 *  - Double quotes: backslash escapes `"`, `` ` ``, `$`, `\` and newline.
 *  - Backticks: treated as a command substitution; the contents are
 *    recursively expanded and emitted as separate segments.
 *
 * Leading environment-variable assignments (e.g. `FOO=bar sudo ls`) are
 * stripped from each segment before it is returned so that pattern
 * authors do not have to enumerate every prefix combination — a deny
 * rule for `sudo *` must still catch `FOO=bar sudo ls`.
 *
 * Empty segments are dropped.
 */
function splitShellCommand(command: string): string[] {
	const out: string[] = [];

	const pushSegment = (segment: string) => {
		const trimmed = stripLeadingAssignments(segment.trim());
		if (trimmed === "") return;
		out.push(trimmed);
	};

	let current = "";
	let i = 0;
	let quote: "" | "'" | '"' = "";
	let parenDepth = 0;

	const len = command.length;
	while (i < len) {
		const c = command[i] as string;

		// Inside a single-quoted span: only `'` terminates it.
		if (quote === "'") {
			current += c;
			if (c === "'") quote = "";
			i++;
			continue;
		}

		// Inside a double-quoted span: honour backslash escapes; `"` ends it.
		if (quote === '"') {
			if (c === "\\" && i + 1 < len) {
				current += c + (command[i + 1] as string);
				i += 2;
				continue;
			}
			if (c === "`") {
				// Command substitution inside double quotes.
				const end = findMatchingBacktick(command, i);
				const inner = command.slice(i + 1, end);
				for (const sub of splitShellCommand(inner)) out.push(sub);
				current += command.slice(i, end + 1);
				i = end + 1;
				continue;
			}
			if (c === "$" && command[i + 1] === "(") {
				const end = findMatchingParen(command, i + 1);
				const inner = command.slice(i + 2, end);
				for (const sub of splitShellCommand(inner)) out.push(sub);
				current += command.slice(i, end + 1);
				i = end + 1;
				continue;
			}
			current += c;
			if (c === '"') quote = "";
			i++;
			continue;
		}

		// Unquoted context.
		if (c === "\\" && i + 1 < len) {
			current += c + (command[i + 1] as string);
			i += 2;
			continue;
		}
		if (c === "'" || c === '"') {
			quote = c as "'" | '"';
			current += c;
			i++;
			continue;
		}
		if (c === "`") {
			const end = findMatchingBacktick(command, i);
			const inner = command.slice(i + 1, end);
			for (const sub of splitShellCommand(inner)) out.push(sub);
			current += command.slice(i, end + 1);
			i = end + 1;
			continue;
		}
		if (c === "$" && command[i + 1] === "(") {
			const end = findMatchingParen(command, i + 1);
			const inner = command.slice(i + 2, end);
			for (const sub of splitShellCommand(inner)) out.push(sub);
			current += command.slice(i, end + 1);
			i = end + 1;
			continue;
		}
		if (c === "(") {
			parenDepth++;
			current += c;
			i++;
			continue;
		}
		if (c === ")") {
			if (parenDepth > 0) parenDepth--;
			current += c;
			i++;
			continue;
		}

		if (parenDepth === 0) {
			// Detect two-character operators first.
			if (c === "&" && command[i + 1] === "&") {
				pushSegment(current);
				current = "";
				i += 2;
				continue;
			}
			if (c === "|" && command[i + 1] === "|") {
				pushSegment(current);
				current = "";
				i += 2;
				continue;
			}
			if (c === "|" && command[i + 1] === "&") {
				pushSegment(current);
				current = "";
				i += 2;
				continue;
			}
			if (c === ";" || c === "\n" || c === "|" || c === "&") {
				pushSegment(current);
				current = "";
				i++;
				continue;
			}
		}

		current += c;
		i++;
	}

	pushSegment(current);
	return out;
}

/** Find the index of the backtick that closes the one at `start`. */
function findMatchingBacktick(input: string, start: number): number {
	let i = start + 1;
	while (i < input.length) {
		const c = input[i];
		if (c === "\\" && i + 1 < input.length) {
			i += 2;
			continue;
		}
		if (c === "`") return i;
		i++;
	}
	return input.length - 1;
}

/** Find the index of the `)` that closes the `(` at `start`. */
function findMatchingParen(input: string, start: number): number {
	let depth = 0;
	let i = start;
	let quote: "" | "'" | '"' = "";
	while (i < input.length) {
		const c = input[i];
		if (quote === "'") {
			if (c === "'") quote = "";
			i++;
			continue;
		}
		if (quote === '"') {
			if (c === "\\" && i + 1 < input.length) {
				i += 2;
				continue;
			}
			if (c === '"') quote = "";
			i++;
			continue;
		}
		if (c === "'" || c === '"') {
			quote = c as "'" | '"';
			i++;
			continue;
		}
		if (c === "\\" && i + 1 < input.length) {
			i += 2;
			continue;
		}
		if (c === "(") depth++;
		else if (c === ")") {
			depth--;
			if (depth === 0) return i;
		}
		i++;
	}
	return input.length - 1;
}

/**
 * Strip leading `VAR=value` assignments from a command so that a rule for
 * `sudo *` still matches `FOO=bar sudo ls`. Only contiguous assignments at
 * the start of the command are removed; assignments further inside are
 * left alone.
 */
function stripLeadingAssignments(segment: string): string {
	let rest = segment;
	while (true) {
		// Match: [A-Za-z_][A-Za-z0-9_]*=<value-until-whitespace>
		const m = rest.match(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/);
		if (!m) break;
		rest = rest.slice(m[0].length);
	}
	return rest;
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
	const call = parseToolCall(toolCall);
	const pat = parseToolCall(pattern);

	if (call === null || pat === null) {
		return toolCall === pattern;
	}

	if (call.name !== pat.name) {
		return false;
	}

	return matchGlob(call.arg, pat.arg);
}

/**
 * Simple glob matching supporting `*` (any characters) and `?` (single character).
 *
 * Implemented with a linear two-pointer algorithm so a malicious policy
 * pattern (e.g. `*a*a*a*a*`) cannot cause catastrophic backtracking. The
 * worst-case complexity is O(input_length + pattern_length * input_length)
 * bounded work per call — empirically under a millisecond even for the
 * pathological regex inputs that used to take multiple seconds.
 *
 * This is intentionally minimal — no brace expansion, no character classes.
 */
export function matchGlob(input: string, pattern: string): boolean {
	const inputLen = input.length;
	const patLen = pattern.length;

	let i = 0;
	let p = 0;
	// Saved positions for the most recent `*` so we can backtrack by
	// advancing `starI` one character at a time — this keeps total work
	// bounded by O(inputLen * patLen) rather than exponential.
	let starI = -1;
	let starP = -1;

	while (i < inputLen) {
		const pc = p < patLen ? pattern[p] : undefined;
		const ic = input[i];

		if (pc === "?" || (pc !== "*" && pc === ic)) {
			i++;
			p++;
			continue;
		}
		if (pc === "*") {
			starP = p;
			starI = i;
			p++;
			continue;
		}
		if (starP !== -1) {
			p = starP + 1;
			starI++;
			i = starI;
			continue;
		}
		return false;
	}

	while (p < patLen && pattern[p] === "*") {
		p++;
	}
	return p === patLen;
}
