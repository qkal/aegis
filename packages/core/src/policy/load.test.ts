import { describe, expect, it } from "vitest";

import { InvalidPolicyError, mergePolicy, normalizePolicy } from "./load.js";
import { DEFAULT_POLICY } from "./schema.js";

describe("normalizePolicy", () => {
	it("returns the default policy when given undefined", () => {
		expect(normalizePolicy(undefined)).toEqual(DEFAULT_POLICY);
	});

	it("returns the default policy when given null", () => {
		expect(normalizePolicy(null)).toEqual(DEFAULT_POLICY);
	});

	it("returns the default policy when given an empty object", () => {
		expect(normalizePolicy({})).toEqual(DEFAULT_POLICY);
	});

	it("rejects a non-object top-level value", () => {
		expect(() => normalizePolicy("oops")).toThrow(InvalidPolicyError);
		expect(() => normalizePolicy(42)).toThrow(InvalidPolicyError);
		expect(() => normalizePolicy([])).toThrow(InvalidPolicyError);
	});

	it("rejects unsupported version fields", () => {
		expect(() => normalizePolicy({ version: 2 })).toThrow(/version/);
	});

	it("rejects unknown top-level keys", () => {
		expect(() => normalizePolicy({ somethingElse: true })).toThrow(/somethingElse/);
	});

	it("overrides tools.deny with the provided list (replace, not concatenate)", () => {
		const normalized = normalizePolicy({
			tools: { deny: ["Bash(rm *)"] },
		});
		expect(normalized.tools.deny).toEqual(["Bash(rm *)"]);
		// allow/ask inherit from defaults
		expect(normalized.tools.allow).toEqual(DEFAULT_POLICY.tools.allow);
		expect(normalized.tools.ask).toEqual(DEFAULT_POLICY.tools.ask);
	});

	it("overrides execution limits when provided", () => {
		const normalized = normalizePolicy({
			execution: { maxTimeoutMs: 60_000, allowBackground: true },
		});
		expect(normalized.execution.maxTimeoutMs).toBe(60_000);
		expect(normalized.execution.allowBackground).toBe(true);
		expect(normalized.execution.maxOutputBytes).toBe(DEFAULT_POLICY.execution.maxOutputBytes);
		expect(normalized.execution.allowedRuntimes).toEqual(
			DEFAULT_POLICY.execution.allowedRuntimes,
		);
	});

	it("overrides sandbox.fs read/write arrays independently", () => {
		const normalized = normalizePolicy({
			sandbox: { fs: { write: ["/tmp/**"] } },
		});
		expect(normalized.sandbox.fs.write).toEqual(["/tmp/**"]);
		expect(normalized.sandbox.fs.read).toEqual(DEFAULT_POLICY.sandbox.fs.read);
		expect(normalized.sandbox.fs.deny).toEqual(DEFAULT_POLICY.sandbox.fs.deny);
	});

	it("rejects unknown keys in sandbox.env", () => {
		expect(() => normalizePolicy({ sandbox: { env: { magic: [] } } }))
			.toThrow(/sandbox\.env\.magic/);
	});

	it("rejects non-string entries in array fields", () => {
		expect(() => normalizePolicy({ tools: { deny: ["ok", 42] } }))
			.toThrow(/tools\.deny\[1\]/);
	});

	it("rejects non-positive execution.maxTimeoutMs", () => {
		expect(() => normalizePolicy({ execution: { maxTimeoutMs: 0 } }))
			.toThrow(/execution\.maxTimeoutMs/);
		expect(() => normalizePolicy({ execution: { maxTimeoutMs: -1 } }))
			.toThrow(/execution\.maxTimeoutMs/);
		expect(() => normalizePolicy({ execution: { maxTimeoutMs: 1.5 } }))
			.toThrow(/execution\.maxTimeoutMs/);
	});

	it("rejects non-boolean execution.allowBackground", () => {
		expect(() => normalizePolicy({ execution: { allowBackground: "yes" } }))
			.toThrow(/execution\.allowBackground/);
	});

	it("rejects unknown languages in execution.allowedRuntimes", () => {
		expect(() => normalizePolicy({ execution: { allowedRuntimes: ["cobol"] } }))
			.toThrow(/execution\.allowedRuntimes\[0\]/);
	});

	it("accepts every language defined in LANGUAGES", () => {
		const normalized = normalizePolicy({
			execution: {
				allowedRuntimes: ["python", "javascript"],
			},
		});
		expect(normalized.execution.allowedRuntimes).toEqual(["python", "javascript"]);
	});

	it("freezes produced array fields", () => {
		const normalized = normalizePolicy({ tools: { deny: ["Bash(rm *)"] } });
		expect(Object.isFrozen(normalized.tools.deny)).toBe(true);
	});
});

describe("mergePolicy", () => {
	it("layers a partial onto an explicit base", () => {
		const base = normalizePolicy({
			execution: { maxTimeoutMs: 10_000 },
		});
		const merged = mergePolicy(base, { execution: { maxTimeoutMs: 20_000 } });
		expect(merged.execution.maxTimeoutMs).toBe(20_000);
	});

	it("supports stacking three layers (defaults → user → project)", () => {
		const user = normalizePolicy({
			execution: { maxTimeoutMs: 15_000 },
			tools: { allow: ["Bash(git *)"] },
		});
		const project = mergePolicy(user, {
			tools: { allow: ["Bash(pnpm *)"] },
		});
		expect(project.execution.maxTimeoutMs).toBe(15_000); // from user
		expect(project.tools.allow).toEqual(["Bash(pnpm *)"]); // overridden by project
	});

	it("leaves the base untouched when raw is undefined or null", () => {
		expect(mergePolicy(DEFAULT_POLICY, undefined)).toBe(DEFAULT_POLICY);
		expect(mergePolicy(DEFAULT_POLICY, null)).toBe(DEFAULT_POLICY);
	});
});
