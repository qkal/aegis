/**
 * Runtime detection.
 *
 * Detects available language runtimes on the host system by spawning
 * each candidate binary with a version-probe flag. Results are cached
 * for the lifetime of the process so that `aegis doctor` and the MCP
 * server do not pay the spawn cost on every invocation.
 *
 * Detection is intentionally defensive:
 * - probes run with a short timeout so a hung binary cannot block startup
 * - probe environment is explicitly constructed, never inherited
 * - only stdout/stderr from the probe inform the version string; nothing
 *   else about the host is recorded
 */

import type { Language } from "@aegis/core";
import { spawnSync } from "node:child_process";

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
 * runtimes accept `--version`; the Go toolchain notably does not.
 */
const VERSION_ARGS: Record<string, readonly string[]> = {
	go: ["version"],
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
 * Resolve `name` against the real host `PATH` using `command -v` via
 * `/bin/sh`. Returns the absolute path of the first match or `undefined`
 * if the binary cannot be located. Uses a sanitized environment.
 */
export function defaultResolveBinary(name: string): string | undefined {
	const result = spawnSync("/bin/sh", ["-c", `command -v "${name}"`], {
		env: { PATH: process.env["PATH"] ?? "" },
		encoding: "utf8",
		timeout: DEFAULT_PROBE_TIMEOUT_MS,
	});
	if (result.status !== 0) {
		return undefined;
	}
	const path = result.stdout.trim();
	return path.length > 0 ? path : undefined;
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
 * Process-lifetime cache of detection results. Keyed by language.
 * Intentionally module-scoped; call {@link clearRuntimeCache} in tests.
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
