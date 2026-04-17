/**
 * Server-side policy loader.
 *
 * Reads `~/.aegis/config.json` (user-wide) and/or `.aegis/config.json`
 * (project-local), validates each with {@link normalizePolicy}, and
 * stacks them onto {@link DEFAULT_POLICY} so callers receive a single
 * fully-populated {@link AegisPolicy}.
 *
 * Layer order (later layers override earlier ones for each field that
 * they explicitly set):
 *
 *   defaults → user config → project config
 *
 * The filesystem shim is injectable so the tests don't touch disk.
 */

import {
	type AegisPolicy,
	DEFAULT_POLICY,
	InvalidPolicyError,
	mergePolicy,
	normalizePolicy,
} from "@aegis/core";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Default location of the user-wide policy config. */
export const USER_CONFIG_RELATIVE = ".aegis/config.json" as const;
/** Default location of the project-local policy config, relative to CWD. */
export const PROJECT_CONFIG_RELATIVE = ".aegis/config.json" as const;

/**
 * Thrown when a policy config file exists but can't be loaded.
 * Carries the absolute path so the caller can show a clear error.
 */
export class PolicyConfigError extends Error {
	readonly path: string;
	readonly cause?: unknown;

	constructor(path: string, message: string, cause?: unknown) {
		super(`${path}: ${message}`);
		this.name = "PolicyConfigError";
		this.path = path;
		if (cause !== undefined) this.cause = cause;
	}
}

/** Minimal file-reader surface. Default reads the real filesystem. */
export type PolicyFileReader = (absolutePath: string) => string | undefined;

/** Options accepted by {@link loadPolicy}. */
export interface LoadPolicyOptions {
	/**
	 * Absolute path to the user-wide policy config.
	 * Defaults to `~/.aegis/config.json`. Pass `null` to disable.
	 */
	readonly userConfigPath?: string | null;
	/**
	 * Absolute path to the project-local policy config.
	 * Defaults to `<cwd>/.aegis/config.json`. Pass `null` to disable.
	 */
	readonly projectConfigPath?: string | null;
	/** Current working directory used to resolve the project config. Defaults to `process.cwd()`. */
	readonly cwd?: string;
	/** Home directory used to resolve the user config. Defaults to `os.homedir()`. */
	readonly home?: string;
	/**
	 * Injectable file reader. Return `undefined` when the file does
	 * not exist; throw for all other I/O errors. Defaults to
	 * `fs.readFileSync` with `ENOENT` → `undefined`.
	 */
	readonly readFile?: PolicyFileReader;
}

/**
 * Load and normalize the effective policy for the current session.
 *
 * Missing config files are **not** an error — the caller always gets
 * at least {@link DEFAULT_POLICY}. Malformed JSON or structural
 * validation failures throw {@link PolicyConfigError} so the caller
 * can surface a precise message instead of silently falling back to
 * weaker defaults.
 */
export function loadPolicy(options: LoadPolicyOptions = {}): LoadedPolicy {
	const readFile = options.readFile ?? defaultReadFile;
	const cwd = options.cwd ?? process.cwd();
	const home = options.home ?? homedir();

	const userPath = options.userConfigPath === null
		? null
		: options.userConfigPath ?? join(home, USER_CONFIG_RELATIVE);

	const projectPath = options.projectConfigPath === null
		? null
		: options.projectConfigPath ?? resolve(cwd, PROJECT_CONFIG_RELATIVE);

	const sources: PolicySource[] = [{ scope: "defaults", path: null }];
	let policy: AegisPolicy = DEFAULT_POLICY;

	if (userPath !== null) {
		const parsed = readAndParse(userPath, readFile);
		if (parsed !== undefined) {
			policy = mergePolicy(policy, parsed);
			sources.push({ scope: "user", path: userPath });
		}
	}

	if (projectPath !== null && projectPath !== userPath) {
		const parsed = readAndParse(projectPath, readFile);
		if (parsed !== undefined) {
			policy = mergePolicy(policy, parsed);
			sources.push({ scope: "project", path: projectPath });
		}
	}

	return { policy, sources };
}

export interface LoadedPolicy {
	readonly policy: AegisPolicy;
	readonly sources: readonly PolicySource[];
}

export interface PolicySource {
	readonly scope: "defaults" | "user" | "project";
	readonly path: string | null;
}

function readAndParse(
	path: string,
	readFile: PolicyFileReader,
): unknown {
	let raw: string | undefined;
	try {
		raw = readFile(path);
	} catch (err) {
		throw new PolicyConfigError(path, `could not read policy config`, err);
	}
	if (raw === undefined) return undefined;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new PolicyConfigError(path, `invalid JSON`, err);
	}

	try {
		// Validate (but do not merge onto defaults here — the caller
		// stacks layers in the correct order).
		normalizePolicy(parsed);
	} catch (err) {
		if (err instanceof InvalidPolicyError) {
			throw new PolicyConfigError(path, err.message, err);
		}
		throw err;
	}

	return parsed;
}

function defaultReadFile(absolutePath: string): string | undefined {
	try {
		return readFileSync(absolutePath, "utf8");
	} catch (err) {
		if (isEnoent(err)) return undefined;
		throw err;
	}
}

function isEnoent(err: unknown): boolean {
	return typeof err === "object"
		&& err !== null
		&& (err as { code?: string; }).code === "ENOENT";
}
