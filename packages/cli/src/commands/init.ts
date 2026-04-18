/**
 * `aegisctx init <platform>` — platform configuration scaffolder.
 *
 * Computes a list of files to create or update for the chosen
 * platform, prints a diff preview to stdout, and (unless `--dry-run`
 * is passed) applies the changes.
 *
 * Supported platforms in Phase 1a: claude-code, codex, opencode, amp,
 * and a generic fallback. Each platform contributes its own set of
 * `PlannedFile`s (hook config, MCP server entry, AGENTS.md stub).
 * The default Aegis policy is written to `~/.aegisctx/config.json`
 * unconditionally so `aegisctx doctor` has something to load.
 *
 * The planner is pure — the default environment injects the real
 * filesystem, but tests mount an in-memory shim and assert on the
 * generated plan.
 */

import { DEFAULT_POLICY } from "@aegisctx/core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { bold, cyan, dim, green, shouldUseColor, type TermStyle, yellow } from "../term.js";

export const COMMAND_NAME = "init" as const;
export const COMMAND_DESCRIPTION = "Set up Aegis for your AI coding agent platform";

/** Platforms for which `aegisctx init` knows how to scaffold configuration. */
export const INIT_PLATFORMS = [
	"claude-code",
	"codex",
	"opencode",
	"amp",
	"generic",
] as const;

export type InitPlatform = (typeof INIT_PLATFORMS)[number];

/** A single file the planner wants to create or update. */
export interface PlannedFile {
	/** Absolute path. */
	readonly path: string;
	/** Human-readable description printed above the diff. */
	readonly description: string;
	/** The full desired contents (not a patch — we only render or write whole files). */
	readonly contents: string;
	/** Optional file mode (defaults to 0o600 for policy files, 0o644 otherwise). */
	readonly mode?: number;
}

/** The action the planner determined for each planned file. */
export type PlanAction = "create" | "update" | "unchanged";

/** A single planner-resolved file with its action. */
export interface ResolvedFile {
	readonly plan: PlannedFile;
	readonly action: PlanAction;
	readonly before: string | undefined;
}

/** Injectable environment for `planInit` and `applyInit`. */
export interface InitEnv {
	readonly home: string;
	readonly readFile: (absolutePath: string) => string | undefined;
	readonly writeFile: (absolutePath: string, contents: string, mode: number) => void;
	readonly mkdirp: (absolutePath: string) => void;
}

/** Default env that writes to the real filesystem. */
export function defaultInitEnv(): InitEnv {
	return {
		home: homedir(),
		readFile: (path) => {
			try {
				return readFileSync(path, "utf8");
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
				throw err;
			}
		},
		writeFile: (path, contents, mode) => writeFileSync(path, contents, { mode }),
		mkdirp: (path) => mkdirSync(path, { recursive: true }),
	};
}

/** Parsed command options. */
export interface InitOptions {
	readonly platform: InitPlatform;
	readonly dryRun: boolean;
	readonly force: boolean;
}

/** Parse the remaining argv after the `init` subcommand token. */
export function parseInitArgs(argv: readonly string[]): InitOptions | { readonly error: string; } {
	let platform: InitPlatform | undefined;
	let dryRun = false;
	let force = false;

	for (const arg of argv) {
		if (arg === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (arg === "--force") {
			force = true;
			continue;
		}
		if (arg.startsWith("-")) {
			return { error: `unknown flag: ${arg}` };
		}
		if (platform !== undefined) {
			return { error: `unexpected positional argument: ${arg}` };
		}
		if (!isInitPlatform(arg)) {
			return {
				error: `unknown platform: ${arg}. Valid platforms: ${INIT_PLATFORMS.join(", ")}.`,
			};
		}
		platform = arg;
	}

	if (platform === undefined) {
		return {
			error: `missing platform argument. Valid platforms: ${INIT_PLATFORMS.join(", ")}.`,
		};
	}
	return { platform, dryRun, force };
}

function isInitPlatform(value: string): value is InitPlatform {
	return (INIT_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Compute the set of files `aegisctx init <platform>` would write.
 * Pure — does not touch the filesystem.
 */
export function plan(platform: InitPlatform, home: string): readonly PlannedFile[] {
	const files: PlannedFile[] = [policyFile(home)];
	const platformFiles = PLATFORM_FILES[platform](home);
	for (const f of platformFiles) files.push(f);
	return files;
}

/** Resolve each planned file against the current filesystem. */
export function resolve(
	planned: readonly PlannedFile[],
	deps: InitEnv,
): readonly ResolvedFile[] {
	return planned.map((p) => {
		const before = deps.readFile(p.path);
		if (before === undefined) {
			return { plan: p, action: "create", before: undefined };
		}
		if (before === p.contents) {
			return { plan: p, action: "unchanged", before };
		}
		return { plan: p, action: "update", before };
	});
}

/** Write all non-unchanged files. Creates parent directories as needed. */
export function applyInit(resolved: readonly ResolvedFile[], deps: InitEnv): void {
	for (const r of resolved) {
		if (r.action === "unchanged") continue;
		deps.mkdirp(dirname(r.plan.path));
		deps.writeFile(r.plan.path, r.plan.contents, r.plan.mode ?? 0o644);
	}
}

/** Render a preview of what `apply` would do. Returns the lines to print. */
export function renderPreview(
	resolved: readonly ResolvedFile[],
	term: TermStyle,
): readonly string[] {
	const lines: string[] = [];
	lines.push(bold("Aegis init — planned changes", term));
	lines.push("");
	for (const r of resolved) {
		const prefix = r.action === "create"
			? green("create", term)
			: r.action === "update"
			? yellow("update", term)
			: dim("unchanged", term);
		lines.push(`  ${prefix}  ${r.plan.path}`);
		lines.push(dim(`           ${r.plan.description}`, term));
	}
	return lines;
}

/** Summary line printed after the preview. */
export function renderSummary(
	resolved: readonly ResolvedFile[],
	opts: InitOptions & { readonly blocked?: boolean; },
	term: TermStyle,
): string {
	const creates = resolved.filter((r) => r.action === "create").length;
	const updates = resolved.filter((r) => r.action === "update").length;
	const unchanged = resolved.filter((r) => r.action === "unchanged").length;
	const head = `${creates} to create, ${updates} to update, ${unchanged} unchanged.`;
	if (opts.dryRun) {
		return bold(`${head} (dry run — no files written)`, term);
	}
	if (opts.blocked) {
		return bold(`${head} Blocked — re-run with --force to apply.`, term);
	}
	if (creates + updates === 0) {
		return bold(`${head} Nothing to do.`, term);
	}
	return bold(`${head} Applied.`, term);
}

/**
 * Entry point. Returns the exit code the CLI should propagate.
 */
export function run(
	argv: readonly string[],
	deps: InitEnv = defaultInitEnv(),
	write: (line: string) => void = (s) => process.stdout.write(`${s}\n`),
	term: TermStyle = { useColor: shouldUseColor(process.env, process.stdout) },
): number {
	const parsed = parseInitArgs(argv);
	if ("error" in parsed) {
		write(`${cyan("error:", term)} ${parsed.error}`);
		return 2;
	}
	const planned = plan(parsed.platform, deps.home);
	const resolved = resolve(planned, deps);
	for (const line of renderPreview(resolved, term)) write(line);
	write("");
	const wouldOverwrite = resolved.some((r) => r.action === "update");
	if (wouldOverwrite && !parsed.force && !parsed.dryRun) {
		write(renderSummary(resolved, { ...parsed, blocked: true }, term));
		write("");
		write(
			`${
				yellow("note:", term)
			} one or more files would be overwritten. Re-run with --force to apply, or --dry-run to preview without changes.`,
		);
		return 0;
	}
	if (!parsed.dryRun) applyInit(resolved, deps);
	write(renderSummary(resolved, parsed, term));
	return 0;
}

// ---------------------------------------------------------------------------
// Platform file templates
// ---------------------------------------------------------------------------

/** Map each init platform to its file set (excluding the shared policy file). */
const PLATFORM_FILES: Record<InitPlatform, (home: string) => readonly PlannedFile[]> = {
	"claude-code": (home) => [claudeCodeHookFile(home)],
	codex: (home) => [codexHookFile(home)],
	opencode: (home) => [opencodePluginFile(home)],
	amp: (home) => [ampMcpFile(home)],
	generic: (_home) => [],
};

function policyFile(home: string): PlannedFile {
	// Write the effective default policy as a JSON document so the user
	// can see what Aegis enforces out of the box and has a concrete
	// file to edit. Keys are sorted for a stable on-disk form and to
	// make diffs against future updates reviewable.
	const contents = `${JSON.stringify(DEFAULT_POLICY, stableSortReplacer, "\t")}\n`;
	return {
		path: join(home, ".aegisctx", "config.json"),
		description:
			"Aegis policy — default deny list (sudo, rm -rf, .env reads, credential env vars, all network)",
		contents,
		mode: 0o600,
	};
}

function claudeCodeHookFile(home: string): PlannedFile {
	// Claude Code's hook loader looks for `~/.claude/settings.json` with
	// a `hooks` object keyed by hook name. We register every supported
	// hook to route through the Aegis MCP binary; the MCP wrapper
	// fallback handles platforms where the hook isn't actually invoked.
	const contents = `${
		JSON.stringify(
			{
				$schema: "https://schemas.claude.com/claude-code/settings.json",
				hooks: {
					PreToolUse: [{ command: "aegisctx mcp hook pre-tool-use" }],
					PostToolUse: [{ command: "aegisctx mcp hook post-tool-use" }],
					SessionStart: [{ command: "aegisctx mcp hook session-start" }],
					PreCompact: [{ command: "aegisctx mcp hook pre-compact" }],
				},
			},
			null,
			"\t",
		)
	}\n`;
	return {
		path: join(home, ".claude", "settings.json"),
		description:
			"Claude Code hooks — routes PreToolUse / PostToolUse / SessionStart / PreCompact through aegisctx.",
		contents,
	};
}

function codexHookFile(home: string): PlannedFile {
	const contents = `${
		JSON.stringify(
			{
				hooks: {
					pre_tool_use: { command: ["aegisctx", "mcp", "hook", "pre-tool-use"] },
					post_tool_use: { command: ["aegisctx", "mcp", "hook", "post-tool-use"] },
				},
			},
			null,
			"\t",
		)
	}\n`;
	return {
		path: join(home, ".codex", "hooks.json"),
		description:
			"Codex CLI hooks — requires [features] codex_hooks = true in ~/.codex/config.toml.",
		contents,
	};
}

function opencodePluginFile(home: string): PlannedFile {
	const contents = `${
		JSON.stringify(
			{
				plugins: [
					{
						id: "aegisctx",
						command: ["aegisctx", "mcp", "serve"],
					},
				],
			},
			null,
			"\t",
		)
	}\n`;
	return {
		path: join(home, ".opencode", "plugins.json"),
		description:
			"OpenCode plugin registration — routes session.idle and tool events through aegisctx.",
		contents,
	};
}

function ampMcpFile(home: string): PlannedFile {
	const contents = `${
		JSON.stringify(
			{
				mcpServers: {
					aegisctx: {
						command: "aegisctx",
						args: ["mcp", "serve"],
					},
				},
			},
			null,
			"\t",
		)
	}\n`;
	return {
		path: join(home, ".config", "amp", "mcp.json"),
		description: "Amp MCP server registration (Amp is MCP-only; no hook channel).",
		contents,
	};
}

/**
 * Stable JSON replacer: sorts object keys alphabetically so the
 * policy file has a deterministic on-disk form and meaningful diffs.
 */
function stableSortReplacer(_key: string, value: unknown): unknown {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		const entries = Object.entries(value as Record<string, unknown>);
		entries.sort(([a], [b]) => a.localeCompare(b));
		return Object.fromEntries(entries);
	}
	return value;
}
