/**
 * Policy normalization and merge.
 *
 * Pure utilities for turning a partial, externally-supplied policy
 * document (e.g. `~/.aegis/config.json`) into a fully-populated
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
 * config. `aegis init` writes a config that does exactly that.
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
 * Validate and normalize an externally-supplied policy document.
 *
 * Returns a fully-populated {@link AegisPolicy}; any field absent from
 * `raw` is filled from {@link DEFAULT_POLICY}. Throws
 * {@link InvalidPolicyError} on any structural problem.
 */
export function normalizePolicy(raw: unknown): AegisPolicy {
	return mergePolicy(DEFAULT_POLICY, raw);
}

/**
 * Layer a partial policy onto a base policy. The base is treated as
 * fully-populated (any {@link AegisPolicy} satisfies that contract);
 * the partial is validated field-by-field and, where present,
 * replaces the base's value by the rules described at the top of
 * this file.
 *
 * Call {@link normalizePolicy} to merge onto {@link DEFAULT_POLICY},
 * or call {@link mergePolicy} directly to stack layers
 * (`mergePolicy(defaults, user, project)` via repeated calls).
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
// ---------------------------------------------------------------------------

function requireObject(raw: unknown, path: string): Record<string, unknown> {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new InvalidPolicyError(path, "expected an object");
	}
	return raw as Record<string, unknown>;
}

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

function requirePositiveInt(path: string, raw: unknown): number {
	if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
		throw new InvalidPolicyError(path, "expected a positive integer");
	}
	return raw;
}

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
