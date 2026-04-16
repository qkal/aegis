/**
 * Policy document schema and types.
 *
 * Policies are declarative security rules authored by the user.
 * They are validated at load time and evaluated at every tool invocation.
 * Policy evaluation is pure — no I/O, no side effects.
 */

/** Pattern for matching tool invocations (e.g., "Bash(sudo *)", "Read(.env*)"). */
export type ToolPattern = string;

/** Supported sandbox execution languages. */
export type Language =
	| "javascript"
	| "typescript"
	| "python"
	| "shell"
	| "ruby"
	| "go"
	| "rust"
	| "php"
	| "r"
	| "perl"
	| "swift";

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
		deny: [
			"Bash(sudo *)",
			"Bash(rm -rf /*)",
			"Bash(chmod 777 *)",
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
