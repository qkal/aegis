/**
 * Policy document schema and types.
 *
 * Policies are declarative security rules authored by the user.
 * They are validated at load time and evaluated at every tool invocation.
 * Policy evaluation is pure — no I/O, no side effects.
 */

/** Pattern for matching tool invocations (e.g., "Bash(sudo *)", "Read(.env*)"). */
export type ToolPattern = string;

/**
 * Supported sandbox execution languages.
 *
 * Declared as a `readonly` tuple so consumers (e.g. the MCP server's
 * tool-description generator) can iterate the list without redeclaring
 * it. `Language` is derived from the tuple so adding a language is a
 * single-line change.
 */
export const LANGUAGES = [
	"javascript",
	"typescript",
	"python",
	"shell",
	"ruby",
	"go",
	"rust",
	"php",
	"r",
	"perl",
	"swift",
] as const;

export type Language = (typeof LANGUAGES)[number];

/** Top-level policy document shape. */
export interface AegisPolicy {
	readonly version: 1;
	readonly sandbox: SandboxPolicy;
	readonly tools: ToolPolicy;
	readonly execution: ExecutionPolicy;
}

/** Controls what the sandbox can access. */
export interface SandboxPolicy {
	readonly env: {
		readonly allow: readonly string[];
		readonly deny: readonly string[];
	};
	readonly fs: {
		readonly read: readonly string[];
		readonly write: readonly string[];
		readonly deny: readonly string[];
	};
	readonly net: {
		readonly allow: readonly string[];
		readonly deny: readonly string[];
	};
}

/** Controls which tool invocations are permitted, denied, or require confirmation. */
export interface ToolPolicy {
	readonly deny: readonly ToolPattern[];
	readonly allow: readonly ToolPattern[];
	readonly ask: readonly ToolPattern[];
}

/** Controls sandbox execution limits. */
export interface ExecutionPolicy {
	readonly maxTimeoutMs: number;
	readonly maxOutputBytes: number;
	readonly allowBackground: boolean;
	readonly allowedRuntimes: readonly Language[];
}

/** Built-in secure defaults applied when no user policy is provided. */
export const DEFAULT_POLICY: AegisPolicy = {
	version: 1,
	sandbox: {
		env: {
			allow: ["PATH", "HOME", "LANG", "TERM"],
			deny: [
				"AWS_*",
				"GH_TOKEN",
				"GITHUB_TOKEN",
				"OPENAI_API_KEY",
				"ANTHROPIC_API_KEY",
				"GOOGLE_API_KEY",
				"SSH_AUTH_SOCK",
			],
		},
		fs: {
			read: [],
			write: [],
			deny: ["~/.ssh/*", "~/.aws/*", "~/.gnupg/*", "~/.config/*", ".env*"],
		},
		net: {
			allow: [],
			deny: ["*"],
		},
	},
	tools: {
		// Broad-by-default deny patterns. The custom glob matcher supports only
		// `*` and `?` (no character classes), so variants like `-R`, `777`,
		// `a+rwx`, and `o+w` are each covered explicitly.
		deny: [
			"Bash(sudo *)",
			"Bash(rm -rf *)",
			"Bash(chmod *777*)",
			"Bash(chmod *-R*)",
			"Bash(chmod *a+*)",
			"Bash(chmod *o+w*)",
			"Bash(chown *)",
			"Read(.env*)",
			"Read(~/.ssh/*)",
			"Read(~/.aws/*)",
		],
		allow: [
			"Bash(git *)",
			"Bash(npm *)",
			"Bash(pnpm *)",
			"Bash(yarn *)",
			"Bash(node *)",
			"Bash(python *)",
			"Bash(pip *)",
		],
		ask: [],
	},
	execution: {
		maxTimeoutMs: 30_000,
		maxOutputBytes: 5_242_880,
		allowBackground: false,
		allowedRuntimes: [
			"javascript",
			"typescript",
			"python",
			"shell",
			"ruby",
			"go",
			"rust",
			"php",
			"r",
			"perl",
			"swift",
		],
	},
};
