/**
 * Runtime detection.
 *
 * Detects available language runtimes on the host system by spawning
 * each candidate binary with a version-probe flag. Results are cached
 * for the lifetime of the process so that `aegisctx doctor` and the MCP
 * server do not pay the spawn cost on every invocation.
 *
 * Detection is intentionally defensive:
 * - probes run with a short timeout so a hung binary cannot block startup
 * - probe environment is explicitly constructed, never inherited
 * - only stdout/stderr from the probe inform the version string; nothing
 *   else about the host is recorded
 */

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

import type { Language } from "@aegisctx/core";

/**
 * Runtime that was located on the host. Narrowing on `available: true`
 * surfaces the version and path; the unavailable variant carries only the
 * requested language so callers cannot accidentally read placeholder
 * version strings.
 */
export interface AvailableRuntime {
	readonly language: Language;
	readonly available: true;
	readonly version: string;
	readonly path: string;
	readonly binary: string;
}

export interface UnavailableRuntime {
	readonly language: Language;
	readonly available: false;
}

export type DetectedRuntime = AvailableRuntime | UnavailableRuntime;

/**
 * Ordered list of binaries to probe for each supported language. The
 * first binary that responds to its version flag wins. Order matters:
 * preferred runtimes come first.
 */
export const RUNTIME_BINARIES: Record<Language, readonly string[]> = {
	javascript: ["node"],
	typescript: ["bun", "tsx"],
	python: ["python3", "python"],
	shell: ["bash", "sh"],
	ruby: ["ruby"],
	go: ["go"],
	rust: ["rustc"],
	php: ["php"],
	r: ["Rscript"],
	perl: ["perl"],
	swift: ["swift"],
};

/**
 * Argument vector used to probe each known binary for its version. Most
 * runtimes accept `--version`; a few do not:
 *
 * - Go's toolchain uses `go version`.
 * - POSIX `sh` and `dash`/`ash` do not implement `--version` at all and
 *   exit non-zero on it, which would otherwise cause detection to mark
 *   them unavailable on minimal images. Probe them with a no-op script
 *   that echoes the interpreter name so detection returns a stable
 *   version string derived from the binary itself.
 */
const VERSION_ARGS: Record<string, readonly string[]> = {
	go: ["version"],
	sh: ["-c", "echo sh"],
	dash: ["-c", "echo dash"],
	ash: ["-c", "echo ash"],
};

const DEFAULT_VERSION_ARGS: readonly string[] = ["--version"];

/** Options accepted by {@link detectRuntime} and related helpers. */
export interface DetectOptions {
	/** Override the binary list for the requested language. Primarily for testing. */
	readonly binaries?: readonly string[];
	/** Timeout in milliseconds for the version probe. */
	readonly timeoutMs?: number;
	/**
	 * Override `which` resolution, typically used by tests to ensure a
	 * deterministic environment without depending on the host `PATH`.
	 */
	readonly resolveBinary?: (name: string) => string | undefined;
	/**
	 * Override the version probe. Must return the probe's stdout/stderr
	 * string and exit status. Primarily for testing.
	 */
	readonly probeVersion?: (path: string, args: readonly string[]) => {
		readonly stdout: string;
		readonly stderr: string;
		readonly status: number | null;
	};
}

/** Default probe timeout. */
const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

/**
 * Resolve `name` against the host `PATH` without invoking a shell.
 * Returns the absolute path of the first match or `undefined` if the
 * binary cannot be located.
 *
 * Doing the PATH scan ourselves avoids two hazards of the naive
 * `/bin/sh -c "command -v <name>"` approach:
 *
 * 1. Shell interpolation — the caller-controlled `name` never reaches
 *    a shell, so a hostile override like `$(rm -rf ~)` is inert.
 * 2. Platform portability — `/bin/sh` does not exist on Windows;
 *    `PATHEXT` is consulted on `win32` so `.exe` / `.cmd` binaries are
 *    found with their stems.
 */
export function defaultResolveBinary(name: string): string | undefined {
	if (isAbsolute(name)) {
		return isExecutableFile(name) ? name : undefined;
	}
	if (name.includes("/") || name.includes("\\")) {
		// A relative path with separators is ambiguous on a PATH scan;
		// refuse rather than guess.
		return undefined;
	}
	const pathEnv = process.env["PATH"] ?? "";
	if (pathEnv.length === 0) {
		return undefined;
	}
	const dirs = pathEnv.split(delimiter).filter((d) => d.length > 0);
	const suffixes = process.platform === "win32"
		? ["", ...(process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT;.COM").split(";")]
		: [""];
	for (const dir of dirs) {
		for (const suffix of suffixes) {
			const candidate = join(dir, name + suffix);
			if (isExecutableFile(candidate)) {
				return candidate;
			}
		}
	}
	return undefined;
}

function isExecutableFile(path: string): boolean {
	try {
		if (!existsSync(path)) {
			return false;
		}
		const st = statSync(path);
		if (!st.isFile()) {
			return false;
		}
		if (process.platform === "win32") {
			return true;
		}
		// 0o111 = any execute bit set.
		return (st.mode & 0o111) !== 0;
	} catch {
		return false;
	}
}

function defaultProbeVersion(path: string, args: readonly string[]): {
	readonly stdout: string;
	readonly stderr: string;
	readonly status: number | null;
} {
	const result = spawnSync(path, [...args], {
		env: { PATH: process.env["PATH"] ?? "" },
		encoding: "utf8",
		timeout: DEFAULT_PROBE_TIMEOUT_MS,
	});
	return {
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		status: result.status,
	};
}

/** Extract a version string from the first non-empty line of output. */
export function parseVersion(stdout: string, stderr: string): string {
	const text = stdout.length > 0 ? stdout : stderr;
	const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0);
	return (firstLine ?? "").trim();
}

/**
 * Detect the runtime for `language`. Returns an {@link AvailableRuntime}
 * on success, or an {@link UnavailableRuntime} if none of the candidate
 * binaries could be located or probed.
 *
 * Detection is synchronous: it runs during server start-up and must
 * complete before the first tool call is accepted.
 */
export function detectRuntime(language: Language, options: DetectOptions = {}): DetectedRuntime {
	const binaries = options.binaries ?? RUNTIME_BINARIES[language];
	const resolveBinary = options.resolveBinary ?? defaultResolveBinary;
	const probeVersion = options.probeVersion ?? defaultProbeVersion;

	for (const binary of binaries) {
		const path = resolveBinary(binary);
		if (!path) {
			continue;
		}
		const args = VERSION_ARGS[binary] ?? DEFAULT_VERSION_ARGS;
		const probe = probeVersion(path, args);
		if (probe.status !== 0) {
			continue;
		}
		const version = parseVersion(probe.stdout, probe.stderr);
		if (version.length === 0) {
			continue;
		}
		return { language, available: true, version, path, binary };
	}
	return { language, available: false };
}

/** Detect every runtime in `languages`, preserving input order. */
export function detectAllRuntimes(
	languages: readonly Language[],
	options: DetectOptions = {},
): readonly DetectedRuntime[] {
	return languages.map((language) => detectRuntime(language, options));
}

/**
 * Process-lifetime cache of detection results. Keyed solely by
 * {@link Language}; `options` is honoured only on the cold-miss path.
 * Callers that need to re-detect after a `PATH` change or that want to
 * exercise alternative resolvers/probes should either clear the cache
 * first with {@link clearRuntimeCache} or call {@link detectRuntime}
 * directly. Intentionally module-scoped.
 */
const cache = new Map<Language, DetectedRuntime>();

export function cachedDetectRuntime(
	language: Language,
	options: DetectOptions = {},
): DetectedRuntime {
	const hit = cache.get(language);
	if (hit) {
		return hit;
	}
	const detected = detectRuntime(language, options);
	cache.set(language, detected);
	return detected;
}

export function clearRuntimeCache(): void {
	cache.clear();
}
