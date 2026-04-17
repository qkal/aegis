/**
 * Claude Code → normalized session event extraction.
 *
 * The adapter receives a PostToolUse payload and emits zero or more
 * `SessionEvent`s describing what Claude just did. We only emit events
 * for tools where we can extract structured information with high
 * confidence — if the mapping is ambiguous (e.g. Bash, whose semantics
 * depend on the command) we return an empty list rather than guess,
 * because downstream consumers treat each event as ground truth.
 */
import { EventPriority, type SessionEvent } from "@aegis/core";

import type { NormalizedToolResult } from "../types.js";

type ToolExtractor = (
	input: Readonly<Record<string, unknown>>,
	response: unknown,
	timestamp: string,
) => readonly SessionEvent[];

/**
 * Per-tool extractors for well-known Claude Code tools.
 *
 * Keys match the `tool_name` Claude sends on the wire. Each extractor
 * is defensive: if the expected input / response shape is missing,
 * it returns `[]` so an unexpected schema change surfaces as missing
 * events (benign) rather than a crash or fabricated event.
 */
const EXTRACTORS: Record<string, ToolExtractor> = {
	Read(input, _response, timestamp) {
		const path = asString(input["file_path"]);
		if (path === undefined) return [];
		return [{
			kind: "file",
			action: "read",
			path,
			timestamp,
			priority: EventPriority.CRITICAL,
		}];
	},
	Write(input, _response, timestamp) {
		const path = asString(input["file_path"]);
		if (path === undefined) return [];
		return [{
			kind: "file",
			action: "write",
			path,
			timestamp,
			priority: EventPriority.CRITICAL,
		}];
	},
	Edit(input, _response, timestamp) {
		const path = asString(input["file_path"]);
		if (path === undefined) return [];
		return [{
			kind: "file",
			action: "edit",
			path,
			timestamp,
			priority: EventPriority.CRITICAL,
		}];
	},
	MultiEdit(input, _response, timestamp) {
		const path = asString(input["file_path"]);
		if (path === undefined) return [];
		return [{
			kind: "file",
			action: "edit",
			path,
			timestamp,
			priority: EventPriority.CRITICAL,
		}];
	},
	Glob(input, _response, timestamp) {
		const pattern = asString(input["pattern"]);
		if (pattern === undefined) return [];
		return [{
			kind: "file",
			action: "glob",
			path: pattern,
			timestamp,
			priority: EventPriority.CRITICAL,
		}];
	},
	Grep(input, _response, timestamp) {
		const pattern = asString(input["pattern"]);
		if (pattern === undefined) return [];
		return [{
			kind: "file",
			action: "grep",
			path: pattern,
			timestamp,
			priority: EventPriority.CRITICAL,
		}];
	},
	Bash(input, response, timestamp) {
		const command = asString(input["command"]);
		if (command === undefined) return [];
		const events: SessionEvent[] = [];
		const gitEvent = inferGitEvent(command, timestamp);
		if (gitEvent !== undefined) events.push(gitEvent);
		const errorEvent = inferBashError(command, response, timestamp);
		if (errorEvent !== undefined) events.push(errorEvent);
		return events;
	},
	TodoWrite(input, _response, timestamp) {
		const todosField = input["todos"];
		if (!Array.isArray(todosField)) return [];
		const events: SessionEvent[] = [];
		for (const todo of todosField) {
			if (!isPlainObject(todo)) continue;
			const description = asString(todo["content"]) ?? asString(todo["description"]);
			if (description === undefined) continue;
			const status = asString(todo["status"]);
			const action = status === "completed"
				? "complete"
				: status === "in_progress" || status === "in-progress"
				? "update"
				: "create";
			events.push({
				kind: "task",
				action,
				description,
				timestamp,
				priority: EventPriority.CRITICAL,
			});
		}
		return events;
	},
};

/**
 * Extract structured session events from a PostToolUse result.
 *
 * Returns `[]` when no extractor is registered for `result.toolName` or
 * when the extractor cannot recover enough signal from the raw payload.
 * Callers must treat this as a best-effort signal, not an audit log —
 * authoritative tool tracking lives in `@aegis/storage/audit` (M2.1).
 */
export function extractClaudeEvents(result: NormalizedToolResult): readonly SessionEvent[] {
	const extractor = EXTRACTORS[result.toolName];
	if (extractor === undefined) return [];
	const input = result.toolInput ?? {};
	const timestamp = new Date().toISOString();
	return extractor(input, result.result, timestamp);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Best-effort git verb detection from a Bash command.
 *
 * Only matches the first token after an optional `git` prefix to avoid
 * flagging commands like `echo git commit` or `awk '/git push/{...}'`.
 * The full command is discarded — we capture the verb, and `ref` / `message`
 * stay `undefined` because parsing those robustly from a shell string is
 * not worth the complexity here.
 */
function inferGitEvent(command: string, timestamp: string): SessionEvent | undefined {
	// Accept leading `sudo ` / `env FOO=bar ` prefixes pragmatically by
	// searching for the first `git <verb>` occurrence at a word boundary.
	const match = /\bgit\s+(checkout|commit|merge|rebase|push|pull|stash|diff|status)\b/
		.exec(command);
	if (match === null) return undefined;
	const verb = match[1] as
		| "checkout"
		| "commit"
		| "merge"
		| "rebase"
		| "push"
		| "pull"
		| "stash"
		| "diff"
		| "status";
	return {
		kind: "git",
		action: verb,
		timestamp,
		priority: EventPriority.HIGH,
	};
}

/**
 * Detect a failed Bash invocation from the tool_response envelope.
 *
 * Claude Code's Bash tool returns a response object; the exit_code /
 * isError flags live at known paths. If the response isn't structured
 * or doesn't look like an error, we skip the event.
 */
function inferBashError(
	command: string,
	response: unknown,
	timestamp: string,
): SessionEvent | undefined {
	if (!isPlainObject(response)) return undefined;
	const exitCode = response["exit_code"];
	const isError = response["is_error"] === true || response["isError"] === true;
	const failed = (typeof exitCode === "number" && exitCode !== 0) || isError;
	if (!failed) return undefined;
	const stderr = asString(response["stderr"]);
	const message = stderr !== undefined && stderr.length > 0
		? stderr.slice(0, 512)
		: `Bash command failed: ${command.slice(0, 200)}`;
	return {
		kind: "error",
		tool: "Bash",
		message,
		...(typeof exitCode === "number" ? { exitCode } : {}),
		timestamp,
		priority: EventPriority.HIGH,
	};
}
