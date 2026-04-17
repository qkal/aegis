/**
 * Server-side policy loader.
 *
 * Reads `~/.aegis/config.json` (user-wide) and/or `.aegis/config.json`
 * (project-local), validates each with {@link mergePolicy}, and
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

import { type AegisPolicy, DEFAULT_POLICY, InvalidPolicyError, mergePolicy } from "@aegis/core";
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

	constructor(path: string, message: string, cause?: unknown) {
		super(`${path}: ${message}`, cause !== undefined ? { cause } : undefined);
		this.name = "PolicyConfigError";
		this.path = path;
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
 * Compute the effective Aegis policy by layering defaults with optional user and project config files.
 *
 * Missing config files are ignored (they are not treated as errors); the result always includes at least the default policy. Malformed JSON or structural validation failures throw {@link PolicyConfigError} with the relevant file path and cause.
 *
 * @param options - Optional overrides for resolution and IO (e.g., `userConfigPath`, `projectConfigPath`, `cwd`, `home`, `readFile`). Set `userConfigPath` or `projectConfigPath` to `null` to disable that layer.
 * @returns The loaded policy and an ordered list of sources that contributed to it
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
			policy = mergeWithPath(policy, parsed, userPath);
			sources.push({ scope: "user", path: userPath });
		}
	}

	if (projectPath !== null && projectPath !== userPath) {
		const parsed = readAndParse(projectPath, readFile);
		if (parsed !== undefined) {
			policy = mergeWithPath(policy, parsed, projectPath);
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

/**
 * Merge a parsed policy layer into a base policy and return the resulting policy.
 *
 * @param path - Absolute file path associated with the parsed layer; used as the `path` on any thrown `PolicyConfigError`
 * @returns The merged `AegisPolicy` formed by applying `parsed` on top of `base`
 * @throws {PolicyConfigError} When `parsed` is structurally invalid for a policy; the thrown error's `path` will be `path` and its `cause` will be the original validation error
 */
function mergeWithPath(base: AegisPolicy, parsed: unknown, path: string): AegisPolicy {
	try {
		return mergePolicy(base, parsed);
	} catch (err) {
		if (err instanceof InvalidPolicyError) {
			throw new PolicyConfigError(path, err.message, err);
		}
		throw err;
	}
}

/**
 * Reads the file at `path` and parses its contents as JSON, returning the parsed value or `undefined` when the file is missing.
 *
 * @param path - Absolute path to the policy config file being read
 * @param readFile - Function used to read the file contents; should return the file text or `undefined` when the file does not exist
 * @returns The parsed JSON value, or `undefined` if the reader indicates the file is missing
 * @throws PolicyConfigError - If reading fails for reasons other than "file not found", or if the file contains invalid JSON; the error includes the `path` and original `cause`
 */
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

	try {
		return JSON.parse(raw) as unknown;
	} catch (err) {
		throw new PolicyConfigError(path, `invalid JSON`, err);
	}
}

/**
 * Read a UTF-8 file and return its contents, or return `undefined` when the file does not exist.
 *
 * @param absolutePath - Absolute path to the file to read
 * @returns The file contents decoded as UTF-8, or `undefined` if the file was not found
 * @throws Any filesystem error other than "file not found" is propagated
 */
function defaultReadFile(absolutePath: string): string | undefined {
	try {
		return readFileSync(absolutePath, "utf8");
	} catch (err) {
		if (isEnoent(err)) return undefined;
		throw err;
	}
}

/**
 * Determines whether an unknown value represents a filesystem "file not found" error (`ENOENT`).
 *
 * @param err - The value to inspect for an `ENOENT` error code
 * @returns `true` if `err` is a non-null object whose `code` property equals `"ENOENT"`, `false` otherwise.
 */
function isEnoent(err: unknown): boolean {
	return typeof err === "object"
		&& err !== null
		&& (err as { code?: string; }).code === "ENOENT";
}
