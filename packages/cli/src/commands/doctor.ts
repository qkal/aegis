/**
 * `aegisctx doctor` — health check command.
 *
 * Runs a fixed battery of checks and prints one line per check with a
 * status symbol. Any check that returns `fail` causes the command to
 * exit non-zero; `warn` is informational and does not fail the run.
 *
 * The command is structured as a pure pipeline (`runChecks` builds a
 * `CheckResult[]` from an injectable environment) so unit tests can
 * exercise every branch without spawning the CLI or touching the
 * filesystem. The `run()` entry point wires the injected environment
 * to the real `process` / `fs` defaults.
 */

import { detectPlatform, type PlatformId } from "@aegisctx/adapters";
import { type Language, LANGUAGES } from "@aegisctx/core";
import { type AvailableRuntime, detectAllRuntimes, type DetectedRuntime } from "@aegisctx/engine";
import { loadPolicy, PolicyConfigError } from "@aegisctx/server";
import { openDatabase } from "@aegisctx/storage";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { bold, cyan, dim, shouldUseColor, statusSymbol, type TermStyle } from "../term.js";

export const COMMAND_NAME = "doctor" as const;
export const COMMAND_DESCRIPTION = "Run a full health check on your Aegis installation";

/** A single line in the doctor report. */
export interface CheckResult {
	/** Short section title (printed bold). */
	readonly title: string;
	/** Overall status — any `fail` makes the command exit non-zero. */
	readonly status: "ok" | "warn" | "fail";
	/** One-line summary printed alongside the status symbol. */
	readonly summary: string;
	/** Optional multi-line detail (e.g. a list of missing runtimes). */
	readonly detail?: readonly string[];
	/** Optional hint shown in dim text below the detail. */
	readonly hint?: string;
}

/** Injectable environment for `runChecks`. Each dependency is pure. */
export interface DoctorEnv {
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly home: string;
	readonly cwd: string;
	readonly detectRuntimes: (langs: readonly Language[]) => readonly DetectedRuntime[];
	readonly openTempDatabase: () => Promise<{ close: () => void; }>;
	readonly loadPolicy: () => { sources: readonly { scope: string; path: string | null; }[]; };
	readonly readFile: (absolutePath: string) => string | undefined;
}

/** Build the default env wiring pure-ish dependencies to the real platform. */
export function defaultDoctorEnv(): DoctorEnv {
	return {
		env: process.env as Readonly<Record<string, string | undefined>>,
		home: homedir(),
		cwd: process.cwd(),
		detectRuntimes: (langs) => detectAllRuntimes(langs),
		openTempDatabase: async () => {
			const { db } = await openDatabase({ path: ":memory:" });
			return { close: () => db.close() };
		},
		loadPolicy: () => {
			const loaded = loadPolicy();
			return { sources: loaded.sources };
		},
		readFile: (path) => {
			try {
				return readFileSync(path, "utf8");
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
				throw err;
			}
		},
	};
}

/** The languages we probe by default. `shell` is always expected to be present. */
const PROBED_LANGUAGES: readonly Language[] = LANGUAGES;

/** Per-platform hook config file (relative to $HOME or project). */
const HOOK_CONFIG_PATHS: Record<PlatformId, string | null> = {
	"claude-code": ".claude/settings.json",
	codex: ".codex/hooks.json",
	opencode: ".opencode/plugins.json",
	amp: null, // Amp is MCP-only; no hooks config file yet
	"gemini-cli": null,
	cursor: null,
	"vscode-copilot": null,
	windsurf: null,
	antigravity: null,
	"kilo-code": null,
};

/**
 * Run every check against an injected environment. Pure — no I/O
 * other than what the injected functions perform.
 */
export async function runChecks(deps: DoctorEnv): Promise<readonly CheckResult[]> {
	const results: CheckResult[] = [];
	results.push(checkPlatform(deps));
	results.push(checkRuntimes(deps));
	results.push(await checkStorage(deps));
	results.push(checkPolicy(deps));
	results.push(checkHooks(deps));
	return results;
}

function checkPlatform(deps: DoctorEnv): CheckResult {
	const detected = detectPlatform(deps.env);
	if (detected === undefined) {
		return {
			title: "Platform",
			status: "warn",
			summary: "no known platform env signal detected",
			hint:
				"run `aegisctx init <platform>` to opt in explicitly (e.g. claude-code, codex, opencode, amp).",
		};
	}
	return {
		title: "Platform",
		status: "ok",
		summary: `${detected.platform} (${detected.reason})`,
	};
}

function checkRuntimes(deps: DoctorEnv): CheckResult {
	const detected = deps.detectRuntimes(PROBED_LANGUAGES);
	const available = detected.filter((r): r is AvailableRuntime => r.available);
	const detail = detected.map((r) => {
		if (r.available) {
			return `  ${r.language.padEnd(10)} ${r.binary} (${r.version ?? "version unknown"})`;
		}
		return `  ${r.language.padEnd(10)} (not found)`;
	});
	if (available.length === 0) {
		return {
			title: "Runtimes",
			status: "fail",
			summary: "no supported runtime found on PATH",
			detail,
			hint: "install at least one of: node, python, go, rust, or similar.",
		};
	}
	const missingCritical = detected.find((r) => r.language === "shell" && !r.available);
	if (missingCritical !== undefined) {
		return {
			title: "Runtimes",
			status: "fail",
			summary: "shell runtime missing (required for Bash-hook capture)",
			detail,
		};
	}
	return {
		title: "Runtimes",
		status: "ok",
		summary: `${available.length}/${detected.length} languages available`,
		detail,
	};
}

async function checkStorage(deps: DoctorEnv): Promise<CheckResult> {
	try {
		const db = await deps.openTempDatabase();
		db.close();
		return {
			title: "Storage",
			status: "ok",
			summary: "SQLite backend opened successfully (:memory:)",
		};
	} catch (err) {
		return {
			title: "Storage",
			status: "fail",
			summary: "failed to open a SQLite backend",
			detail: [`  ${(err as Error).message}`],
			hint:
				"install better-sqlite3 (`pnpm add better-sqlite3`) or upgrade to Node 22+ for the built-in node:sqlite backend.",
		};
	}
}

function checkPolicy(deps: DoctorEnv): CheckResult {
	try {
		const { sources } = deps.loadPolicy();
		const layered = sources.filter((s) => s.scope !== "defaults");
		if (layered.length === 0) {
			return {
				title: "Policy",
				status: "ok",
				summary: "using built-in defaults (no user or project config)",
			};
		}
		return {
			title: "Policy",
			status: "ok",
			summary: `${layered.length} config layer(s) merged onto defaults`,
			detail: layered.map((s) => `  ${s.scope.padEnd(8)} ${s.path ?? "(inline)"}`),
		};
	} catch (err) {
		if (err instanceof PolicyConfigError) {
			return {
				title: "Policy",
				status: "fail",
				summary: "policy config failed to load",
				detail: [`  ${err.path}`, `  ${err.message}`],
				hint: "run `aegisctx init <platform>` to rewrite the config with secure defaults.",
			};
		}
		return {
			title: "Policy",
			status: "fail",
			summary: "unexpected error loading policy",
			detail: [`  ${(err as Error).message}`],
		};
	}
}

function checkHooks(deps: DoctorEnv): CheckResult {
	const platform = detectPlatform(deps.env);
	if (platform === undefined) {
		return {
			title: "Hooks",
			status: "warn",
			summary: "skipped (no platform detected)",
		};
	}
	const relative = HOOK_CONFIG_PATHS[platform.platform];
	if (relative === null) {
		return {
			title: "Hooks",
			status: "ok",
			summary: `${platform.platform} has no hooks config (MCP-only)`,
		};
	}
	const absolute = join(deps.home, relative);
	const raw = deps.readFile(absolute);
	if (raw === undefined) {
		return {
			title: "Hooks",
			status: "warn",
			summary: `no ${relative} found under $HOME`,
			hint: `run \`aegisctx init ${platform.platform}\` to install hook configuration.`,
		};
	}
	if (!raw.includes("aegisctx")) {
		return {
			title: "Hooks",
			status: "warn",
			summary: `${relative} exists but does not reference aegisctx`,
			hint:
				`run \`aegisctx init ${platform.platform}\` to merge aegisctx hooks into the existing config.`,
		};
	}
	return {
		title: "Hooks",
		status: "ok",
		summary: `${relative} references aegisctx`,
	};
}

/**
 * Render the check results to a writable stream.
 * Returns the exit code the CLI should propagate.
 */
export function renderReport(
	results: readonly CheckResult[],
	write: (line: string) => void,
	term: TermStyle,
): number {
	write(bold("Aegis health check", term));
	write("");
	for (const r of results) {
		write(`${statusSymbol(r.status, term)} ${bold(r.title, term)}: ${r.summary}`);
		if (r.detail !== undefined) {
			for (const line of r.detail) write(dim(line, term));
		}
		if (r.hint !== undefined) {
			write(dim(`  ${cyan("hint:", term)} ${r.hint}`, term));
		}
	}
	const failed = results.filter((r) => r.status === "fail");
	const warned = results.filter((r) => r.status === "warn");
	write("");
	if (failed.length > 0) {
		write(bold(`${failed.length} check(s) failed, ${warned.length} warning(s).`, term));
		return 1;
	}
	if (warned.length > 0) {
		write(bold(`All required checks passed, ${warned.length} warning(s).`, term));
		return 0;
	}
	write(bold("All checks passed.", term));
	return 0;
}

/**
 * Entry point wiring `runChecks` + `renderReport` to stdout.
 */
export async function run(
	deps: DoctorEnv = defaultDoctorEnv(),
	write: (line: string) => void = (s) => process.stdout.write(`${s}\n`),
	term: TermStyle = { useColor: shouldUseColor(process.env, process.stdout) },
): Promise<number> {
	const results = await runChecks(deps);
	return renderReport(results, write, term);
}
