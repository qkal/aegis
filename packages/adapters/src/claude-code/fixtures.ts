/**
 * Canonical Claude Code hook payload fixtures.
 *
 * These are minimal, realistic examples of what the Claude Code CLI
 * writes to a hook's stdin. Each shape is derived from the public
 * Claude Code docs (code.claude.com/docs/en/hooks) and the hook
 * schema gist authored by Anthropic; they're inlined here so the unit
 * tests stay hermetic and don't need network access or a separate
 * fixtures directory.
 *
 * Only use these for tests and examples — production code must always
 * round-trip its input through the Zod schemas in `./schemas.ts`.
 */

const SESSION_ID = "abc123-session" as const;
const TRANSCRIPT_PATH = "/home/alice/.claude/projects/demo/transcript.jsonl" as const;
const CWD = "/home/alice/projects/demo" as const;

/** PreToolUse fixture: Claude wants to run `npm test`. */
export const preToolUseBashFixture: Readonly<Record<string, unknown>> = Object.freeze({
	session_id: SESSION_ID,
	transcript_path: TRANSCRIPT_PATH,
	cwd: CWD,
	permission_mode: "default",
	hook_event_name: "PreToolUse",
	tool_name: "Bash",
	tool_input: { command: "npm test", description: "Run the project test suite" },
});

/** PreToolUse fixture: Claude wants to read a .env file (should be denied). */
export const preToolUseDotenvFixture: Readonly<Record<string, unknown>> = Object.freeze({
	session_id: SESSION_ID,
	transcript_path: TRANSCRIPT_PATH,
	cwd: CWD,
	permission_mode: "default",
	hook_event_name: "PreToolUse",
	tool_name: "Read",
	tool_input: { file_path: ".env" },
});

/** PostToolUse fixture: a successful Write returned a JSON response. */
export const postToolUseWriteFixture: Readonly<Record<string, unknown>> = Object.freeze({
	session_id: SESSION_ID,
	transcript_path: TRANSCRIPT_PATH,
	cwd: CWD,
	permission_mode: "default",
	hook_event_name: "PostToolUse",
	tool_name: "Write",
	tool_use_id: "toolu_01abc",
	tool_input: { file_path: "/home/alice/projects/demo/README.md", content: "# Demo\n" },
	tool_response: { filePath: "/home/alice/projects/demo/README.md", success: true },
});

/** PostToolUse fixture: a failed Bash command with a non-zero exit code. */
export const postToolUseBashFailureFixture: Readonly<Record<string, unknown>> = Object.freeze({
	session_id: SESSION_ID,
	transcript_path: TRANSCRIPT_PATH,
	cwd: CWD,
	permission_mode: "default",
	hook_event_name: "PostToolUse",
	tool_name: "Bash",
	tool_use_id: "toolu_01bash",
	tool_input: { command: "pnpm build" },
	tool_response: { exit_code: 1, stderr: "error TS2345: missing property", stdout: "" },
});

/** PostToolUse fixture: a `git commit` via Bash (extracts a git event). */
export const postToolUseGitCommitFixture: Readonly<Record<string, unknown>> = Object.freeze({
	session_id: SESSION_ID,
	transcript_path: TRANSCRIPT_PATH,
	cwd: CWD,
	permission_mode: "default",
	hook_event_name: "PostToolUse",
	tool_name: "Bash",
	tool_use_id: "toolu_01git",
	tool_input: { command: "git commit -m 'wip'" },
	tool_response: { exit_code: 0, stdout: "[main abc] wip\n", stderr: "" },
});

/** PostToolUse fixture: a TodoWrite with a mixed status list. */
export const postToolUseTodoWriteFixture: Readonly<Record<string, unknown>> = Object.freeze({
	session_id: SESSION_ID,
	transcript_path: TRANSCRIPT_PATH,
	cwd: CWD,
	permission_mode: "default",
	hook_event_name: "PostToolUse",
	tool_name: "TodoWrite",
	tool_use_id: "toolu_01todos",
	tool_input: {
		todos: [
			{ content: "Implement adapter", status: "completed" },
			{ content: "Write tests", status: "in_progress" },
			{ content: "Open PR", status: "pending" },
		],
	},
	tool_response: { ok: true },
});

/** SessionStart fixture (startup). */
export const sessionStartFixture: Readonly<Record<string, unknown>> = Object.freeze({
	session_id: SESSION_ID,
	transcript_path: TRANSCRIPT_PATH,
	cwd: CWD,
	hook_event_name: "SessionStart",
	source: "startup",
	model: "claude-sonnet-4-6",
});

/** PreCompact fixture (manual trigger). */
export const preCompactFixture: Readonly<Record<string, unknown>> = Object.freeze({
	session_id: SESSION_ID,
	transcript_path: TRANSCRIPT_PATH,
	cwd: CWD,
	hook_event_name: "PreCompact",
	trigger: "manual",
	custom_instructions: "",
});
