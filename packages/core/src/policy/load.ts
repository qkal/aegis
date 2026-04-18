/**
 * Policy normalization and merge.
 *
 * Pure utilities for turning a partial, externally-supplied policy
 * document (e.g. `~/.aegisctx/config.json`) into a fully-populated
 * `AegisPolicy` by layering onto {@link DEFAULT_POLICY}.
 *
 * This module is I/O-free: the caller is responsible for reading and
 * parsing JSON from disk. All validation is structural — unknown
 * fields are rejected so typos cannot silently weaken the sandbox.
 *
 * Merge semantics (documented so they don't drift):
 *
 *  1. Scalar fields: later layer wins if provided; otherwise fall back
 *     to the earlier layer (ultimately {@link DEFAULT_POLICY}).
 *  2. Array fields (deny / allow / ask / read / write / allowedRuntimes):
 *     later layer **replaces** the earlier one if provided. This is
 *     deliberate — concatenation would make it impossible to override a
 *     permissive default without shipping a breaking change, and
 *     implicit concatenation hides who added what.
 *  3. Nested objects (`sandbox.env`, `sandbox.fs`, `sandbox.net`,
 *     `tools`, `execution`) merge per-field by rules 1–2.
 *
 * To make the default deny list stick even when a user overrides the
 * `deny` array, callers are expected to copy the defaults into their
 * config. `aegisctx init` writes a config that does exactly that.
 */

import {
	type AegisPolicy,
	DEFAULT_POLICY,
	type ExecutionPolicy,
	type Language,
	LANGUAGES,
	type SandboxPolicy,
	type ToolPolicy,
} from "./schema.js";

/** Deep partial of {@link AegisPolicy} with optional sections. */
export interface PartialAegisPolicy {
	readonly version?: 1;
	readonly sandbox?: PartialSandboxPolicy;
	readonly tools?: PartialToolPolicy;
	readonly execution?: PartialExecutionPolicy;
}

export interface PartialSandboxPolicy {
	readonly env?: {
		readonly allow?: readonly string[];
		readonly deny?: readonly string[];
	};
	readonly fs?: {
		readonly read?: readonly string[];
		readonly write?: readonly string[];
		readonly deny?: readonly string[];
	};
	readonly net?: {
		readonly allow?: readonly string[];
		readonly deny?: readonly string[];
	};
}

export interface PartialToolPolicy {
	readonly deny?: readonly string[];
	readonly allow?: readonly string[];
	readonly ask?: readonly string[];
}

export interface PartialExecutionPolicy {
	readonly maxTimeoutMs?: number;
	readonly maxOutputBytes?: number;
	readonly allowBackground?: boolean;
	readonly allowedRuntimes?: readonly Language[];
}

/**
 * Thrown when a policy document fails structural validation.
 *
 * `path` points at the offending field (e.g. `"execution.maxTimeoutMs"`)
 * so the caller can surface a precise error message. The raw value is
 * NEVER embedded — it may contain absolute paths or credential-bearing
 * globs that should not show up in logs.
 */
export class InvalidPolicyError extends Error {
	readonly path: string;

	constructor(path: string, message: string) {
		super(`invalid policy at "${path}": ${message}`);
		this.name = "InvalidPolicyError";
		this.path = path;
	}
}

/**
 * Normalize an external policy document into a complete AegisPolicy.
 *
 * @returns A fully populated {@link AegisPolicy} with any missing fields taken from {@link DEFAULT_POLICY}
 * @throws {@link InvalidPolicyError} if the supplied policy has structural validation errors
 */
export function normalizePolicy(raw: unknown): AegisPolicy {
	return mergePolicy(DEFAULT_POLICY, raw);
}

/**
 * Merge a partial policy document onto a fully populated AegisPolicy.
 *
 * The function validates the provided partial policy and returns a new
 * policy where any fields present in `raw` replace the corresponding
 * fields from `base`; absent fields are retained from `base`.
 *
 * @param base - A fully populated `AegisPolicy` to serve as the merge base
 * @param raw - A partial policy (or `undefined`/`null` to indicate no changes)
 * @returns A new `AegisPolicy` with `raw` applied on top of `base`
 * @throws InvalidPolicyError if `raw` is structurally invalid (wrong types, unknown keys, or unsupported version)
 */
export function mergePolicy(base: AegisPolicy, raw: unknown): AegisPolicy {
	if (raw === undefined || raw === null) return base;
	if (typeof raw !== "object" || Array.isArray(raw)) {
		throw new InvalidPolicyError("", "expected an object");
	}

	assertNoUnknownKeys("", raw as Record<string, unknown>, [
		"version",
		"sandbox",
		"tools",
		"execution",
	]);

	const partial = raw as Record<string, unknown>;

	if (partial["version"] !== undefined && partial["version"] !== 1) {
		throw new InvalidPolicyError("version", `unsupported version (expected 1)`);
	}

	return {
		version: 1,
		sandbox: mergeSandbox(base.sandbox, partial["sandbox"]),
		tools: mergeTools(base.tools, partial["tools"]),
		execution: mergeExecution(base.execution, partial["execution"]),
	};
}

/**
 * Merge a partial sandbox policy into a complete SandboxPolicy, replacing only the fields provided in the partial and preserving others.
 *
 * @param base - The base SandboxPolicy to merge into
 * @param raw - A partial sandbox policy object (or `undefined`); when `undefined` the `base` is returned unchanged
 * @returns The resulting fully populated SandboxPolicy after merging `raw` into `base`
 */
function mergeSandbox(base: SandboxPolicy, raw: unknown): SandboxPolicy {
	if (raw === undefined) return base;
	const partial = requireObject(raw, "sandbox");
	assertNoUnknownKeys("sandbox", partial, ["env", "fs", "net"]);

	const envRaw = partial["env"];
	const fsRaw = partial["fs"];
	const netRaw = partial["net"];

	return {
		env: envRaw === undefined ? base.env : mergeAllowDeny("sandbox.env", base.env, envRaw),
		fs: fsRaw === undefined ? base.fs : mergeFs("sandbox.fs", base.fs, fsRaw),
		net: netRaw === undefined ? base.net : mergeAllowDeny("sandbox.net", base.net, netRaw),
	};
}

/**
 * Merge a base `{ allow, deny }` pair with a partial update while validating any provided arrays.
 *
 * @param path - JSON path prefix used for error messages when validation fails
 * @param base - The base object supplying fallback `allow` and `deny` arrays
 * @param raw - A partial object that may contain `allow` and/or `deny` arrays to replace the base values
 * @returns A new object of the same shape as `base` where `allow` and `deny` are replaced by validated arrays from `raw` when present, otherwise retained from `base`
 */
function mergeAllowDeny<
	T extends { readonly allow: readonly string[]; readonly deny: readonly string[]; },
>(
	path: string,
	base: T,
	raw: unknown,
): T {
	const partial = requireObject(raw, path);
	assertNoUnknownKeys(path, partial, ["allow", "deny"]);
	return {
		...base,
		allow: partial["allow"] === undefined
			? base.allow
			: requireStringArray(`${path}.allow`, partial["allow"]),
		deny: partial["deny"] === undefined
			? base.deny
			: requireStringArray(`${path}.deny`, partial["deny"]),
	};
}

/**
 * Merge a partial filesystem policy into a complete `SandboxPolicy["fs"]`.
 *
 * Validates `raw` as an object containing only the keys `read`, `write`, and `deny`,
 * and replaces each array field from `base` only when the corresponding field is provided.
 *
 * @param path - JSON path used to prefix validation error locations (e.g., `"sandbox.fs"`).
 * @param base - The existing `fs` policy to use as defaults for missing fields.
 * @param raw - A partial `fs` policy to merge; each present field must be an array of strings.
 * @returns The resulting `SandboxPolicy["fs"]` with validated and frozen arrays where provided.
 * @throws InvalidPolicyError - if `raw` is not an object, contains unknown keys, or any array/element fails validation.
 */
function mergeFs(path: string, base: SandboxPolicy["fs"], raw: unknown): SandboxPolicy["fs"] {
	const partial = requireObject(raw, path);
	assertNoUnknownKeys(path, partial, ["read", "write", "deny"]);
	return {
		read: partial["read"] === undefined
			? base.read
			: requireStringArray(`${path}.read`, partial["read"]),
		write: partial["write"] === undefined
			? base.write
			: requireStringArray(`${path}.write`, partial["write"]),
		deny: partial["deny"] === undefined
			? base.deny
			: requireStringArray(`${path}.deny`, partial["deny"]),
	};
}

/**
 * Merge a partial tools policy into a complete `ToolPolicy`, replacing any array fields that are provided.
 *
 * @param base - The existing `ToolPolicy` to use as defaults for missing fields.
 * @param raw - A partial tools policy object (allowed fields: `deny`, `allow`, `ask`). If a field is present it must be an array of strings; if `raw` is `undefined` the `base` is returned unchanged.
 * @returns A `ToolPolicy` where each of `deny`, `allow`, and `ask` is the validated array from `raw` when provided, or the corresponding value from `base` otherwise.
 */
function mergeTools(base: ToolPolicy, raw: unknown): ToolPolicy {
	if (raw === undefined) return base;
	const partial = requireObject(raw, "tools");
	assertNoUnknownKeys("tools", partial, ["deny", "allow", "ask"]);
	return {
		deny: partial["deny"] === undefined
			? base.deny
			: requireStringArray("tools.deny", partial["deny"]),
		allow: partial["allow"] === undefined
			? base.allow
			: requireStringArray("tools.allow", partial["allow"]),
		ask: partial["ask"] === undefined
			? base.ask
			: requireStringArray("tools.ask", partial["ask"]),
	};
}

/**
 * Merge a partial execution policy into a complete `ExecutionPolicy`, validating provided fields.
 *
 * @param base - The existing `ExecutionPolicy` to use as defaults for missing fields
 * @param raw - A partial execution policy (may be `undefined`), expected to be an object with any of `maxTimeoutMs`, `maxOutputBytes`, `allowBackground`, or `allowedRuntimes`
 * @returns A fully populated `ExecutionPolicy` composed of `base` values overridden by validated fields from `raw`
 * @throws {InvalidPolicyError} When `raw` is not an object, contains unknown keys, or any provided field fails validation (includes path information)
 */
function mergeExecution(base: ExecutionPolicy, raw: unknown): ExecutionPolicy {
	if (raw === undefined) return base;
	const partial = requireObject(raw, "execution");
	assertNoUnknownKeys("execution", partial, [
		"maxTimeoutMs",
		"maxOutputBytes",
		"allowBackground",
		"allowedRuntimes",
	]);

	let maxTimeoutMs = base.maxTimeoutMs;
	if (partial["maxTimeoutMs"] !== undefined) {
		maxTimeoutMs = requirePositiveInt("execution.maxTimeoutMs", partial["maxTimeoutMs"]);
	}
	let maxOutputBytes = base.maxOutputBytes;
	if (partial["maxOutputBytes"] !== undefined) {
		maxOutputBytes = requirePositiveInt("execution.maxOutputBytes", partial["maxOutputBytes"]);
	}
	let allowBackground = base.allowBackground;
	if (partial["allowBackground"] !== undefined) {
		if (typeof partial["allowBackground"] !== "boolean") {
			throw new InvalidPolicyError("execution.allowBackground", "expected a boolean");
		}
		allowBackground = partial["allowBackground"];
	}
	let allowedRuntimes = base.allowedRuntimes;
	if (partial["allowedRuntimes"] !== undefined) {
		allowedRuntimes = requireLanguageArray(
			"execution.allowedRuntimes",
			partial["allowedRuntimes"],
		);
	}

	return { maxTimeoutMs, maxOutputBytes, allowBackground, allowedRuntimes };
}

// ---------------------------------------------------------------------------
// Structural guards
/**
 * Validates that `raw` is a non-null, non-array object and returns it.
 *
 * @param raw - The value to validate as an object
 * @param path - The policy path used to report validation errors
 * @returns The validated value typed as `Record<string, unknown>`
 * @throws InvalidPolicyError if `raw` is `null`, not an object, or is an array
 */

function requireObject(raw: unknown, path: string): Record<string, unknown> {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new InvalidPolicyError(path, "expected an object");
	}
	return raw as Record<string, unknown>;
}

/**
 * Ensures `obj` contains only the specified keys.
 *
 * @param path - Base JSON path used when reporting unknown keys; use an empty string for top-level fields.
 * @param obj - Object whose keys are validated against `allowed`.
 * @param allowed - Array of permitted key names.
 * @throws InvalidPolicyError when a key in `obj` is not listed in `allowed`. The error's `path` is formatted as `"<key>"` if `path` is empty, otherwise as `"<path>.<key>"`.
 */
function assertNoUnknownKeys(
	path: string,
	obj: Record<string, unknown>,
	allowed: readonly string[],
): void {
	for (const key of Object.keys(obj)) {
		if (!allowed.includes(key)) {
			const prefix = path === "" ? "" : `${path}.`;
			throw new InvalidPolicyError(`${prefix}${key}`, `unknown field`);
		}
	}
}

/**
 * Validate that `raw` is an array of strings and return a frozen copy.
 *
 * @param path - JSON-style path used in error messages when validation fails
 * @param raw - Value to validate as an array of strings
 * @returns A frozen array containing the validated strings
 * @throws InvalidPolicyError if `raw` is not an array or any element is not a string
 */
function requireStringArray(path: string, raw: unknown): readonly string[] {
	if (!Array.isArray(raw)) {
		throw new InvalidPolicyError(path, "expected an array of strings");
	}
	for (let i = 0; i < raw.length; i += 1) {
		if (typeof raw[i] !== "string") {
			throw new InvalidPolicyError(`${path}[${i}]`, "expected a string");
		}
	}
	return Object.freeze([...raw as string[]]);
}

/**
 * Validate that `raw` is a positive integer.
 *
 * @param path - JSON path used in any validation error message
 * @param raw - The value to validate
 * @returns The validated positive integer
 * @throws InvalidPolicyError if `raw` is not an integer greater than 0
 */
function requirePositiveInt(path: string, raw: unknown): number {
	if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
		throw new InvalidPolicyError(path, "expected a positive integer");
	}
	return raw;
}

/**
 * Validate `raw` as an array of known language identifiers and return it as a frozen `Language[]`.
 *
 * @param path - JSON path used in error messages to locate the validated value
 * @param raw - Candidate value expected to be an array of language identifier strings
 * @returns A frozen array of validated `Language` identifiers
 * @throws {InvalidPolicyError} If `raw` is not an array, or if any element is not a string or is not one of the allowed languages (error path will point to the offending index)
 */
function requireLanguageArray(path: string, raw: unknown): readonly Language[] {
	if (!Array.isArray(raw)) {
		throw new InvalidPolicyError(path, "expected an array of language identifiers");
	}
	const out: Language[] = [];
	const allowed: readonly string[] = LANGUAGES;
	for (let i = 0; i < raw.length; i += 1) {
		const v = raw[i];
		if (typeof v !== "string" || !allowed.includes(v)) {
			throw new InvalidPolicyError(
				`${path}[${i}]`,
				`expected one of: ${LANGUAGES.join(", ")}`,
			);
		}
		out.push(v as Language);
	}
	return Object.freeze(out);
}
