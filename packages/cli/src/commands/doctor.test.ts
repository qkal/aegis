import type { DetectedRuntime } from "@aegis/engine";
import { describe, expect, it } from "vitest";
import { type DoctorEnv, renderReport, runChecks } from "./doctor.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEnv(overrides: Partial<DoctorEnv> = {}): DoctorEnv {
	return {
		env: {},
		home: "/home/tester",
		cwd: "/tmp/proj",
		detectRuntimes: (langs) =>
			langs.map(
				(l): DetectedRuntime => ({
					language: l,
					available: true,
					version: "1.0.0",
					binary: `/usr/bin/${l}`,
					path: `/usr/bin/${l}`,
				}),
			),
		openTempDatabase: async () => ({ close: () => {} }),
		loadPolicy: () => ({ sources: [{ scope: "defaults", path: null }] }),
		readFile: () => undefined,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

describe("runChecks: Platform", () => {
	it("reports ok with the detected platform when an env signal is set", async () => {
		const results = await runChecks(makeEnv({ env: { CLAUDE_PROJECT_DIR: "/tmp/proj" } }));
		const platform = results.find((r) => r.title === "Platform");
		expect(platform?.status).toBe("ok");
		expect(platform?.summary).toContain("claude-code");
	});

	it("warns and hints to run aegis init when no signal is present", async () => {
		const results = await runChecks(makeEnv({ env: {} }));
		const platform = results.find((r) => r.title === "Platform");
		expect(platform?.status).toBe("warn");
		expect(platform?.hint).toContain("aegis init");
	});
});

// ---------------------------------------------------------------------------
// Runtimes
// ---------------------------------------------------------------------------

describe("runChecks: Runtimes", () => {
	it("reports ok when at least one runtime is available and shell is present", async () => {
		const results = await runChecks(makeEnv());
		const runtimes = results.find((r) => r.title === "Runtimes");
		expect(runtimes?.status).toBe("ok");
		expect(runtimes?.detail?.length).toBeGreaterThan(0);
	});

	it("fails when shell is missing (required for Bash-hook capture)", async () => {
		const results = await runChecks(
			makeEnv({
				detectRuntimes: (langs) =>
					langs.map((l): DetectedRuntime =>
						l === "shell"
							? { language: l, available: false }
							: {
								language: l,
								available: true,
								version: "1.0",
								binary: `/usr/bin/${l}`,
								path: `/usr/bin/${l}`,
							}
					),
			}),
		);
		const runtimes = results.find((r) => r.title === "Runtimes");
		expect(runtimes?.status).toBe("fail");
		expect(runtimes?.summary).toContain("shell");
	});

	it("fails when no runtime is available at all", async () => {
		const results = await runChecks(
			makeEnv({
				detectRuntimes: (langs) => langs.map((l) => ({ language: l, available: false })),
			}),
		);
		const runtimes = results.find((r) => r.title === "Runtimes");
		expect(runtimes?.status).toBe("fail");
		expect(runtimes?.summary).toContain("no supported runtime");
	});
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

describe("runChecks: Storage", () => {
	it("reports ok when a :memory: database opens", async () => {
		const results = await runChecks(makeEnv());
		const storage = results.find((r) => r.title === "Storage");
		expect(storage?.status).toBe("ok");
	});

	it("fails with a hint when no backend is available", async () => {
		const results = await runChecks(
			makeEnv({
				openTempDatabase: async () => {
					throw new Error("No SQLite backend available");
				},
			}),
		);
		const storage = results.find((r) => r.title === "Storage");
		expect(storage?.status).toBe("fail");
		expect(storage?.hint).toContain("better-sqlite3");
	});
});

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

describe("runChecks: Policy", () => {
	it("reports defaults when no user or project config exists", async () => {
		const results = await runChecks(makeEnv());
		const policy = results.find((r) => r.title === "Policy");
		expect(policy?.status).toBe("ok");
		expect(policy?.summary).toContain("built-in defaults");
	});

	it("lists config layer paths when user or project config is merged", async () => {
		const results = await runChecks(
			makeEnv({
				loadPolicy: () => ({
					sources: [
						{ scope: "defaults", path: null },
						{ scope: "user", path: "/home/tester/.aegis/config.json" },
						{ scope: "project", path: "/tmp/proj/.aegis/config.json" },
					],
				}),
			}),
		);
		const policy = results.find((r) => r.title === "Policy");
		expect(policy?.status).toBe("ok");
		expect(policy?.summary).toContain("2 config layer(s)");
		expect(policy?.detail?.join("\n")).toContain("/home/tester/.aegis/config.json");
		expect(policy?.detail?.join("\n")).toContain("/tmp/proj/.aegis/config.json");
	});
});

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

describe("runChecks: Hooks", () => {
	it("skips hooks when no platform is detected", async () => {
		const results = await runChecks(makeEnv({ env: {} }));
		const hooks = results.find((r) => r.title === "Hooks");
		expect(hooks?.status).toBe("warn");
		expect(hooks?.summary).toContain("skipped");
	});

	it("warns when the platform's config file is missing", async () => {
		const results = await runChecks(makeEnv({ env: { CLAUDE_PROJECT_DIR: "/tmp/proj" } }));
		const hooks = results.find((r) => r.title === "Hooks");
		expect(hooks?.status).toBe("warn");
		expect(hooks?.hint).toContain("aegis init claude-code");
	});

	it("warns when the platform's config exists but doesn't reference aegis", async () => {
		const results = await runChecks(
			makeEnv({
				env: { CLAUDE_PROJECT_DIR: "/tmp/proj" },
				readFile: () => `{ "hooks": {} }`,
			}),
		);
		const hooks = results.find((r) => r.title === "Hooks");
		expect(hooks?.status).toBe("warn");
		expect(hooks?.summary).toContain("does not reference aegis");
	});

	it("reports ok when the platform's config references aegis", async () => {
		const results = await runChecks(
			makeEnv({
				env: { CLAUDE_PROJECT_DIR: "/tmp/proj" },
				readFile: () => `{"hooks":{"PreToolUse":[{"command":"aegis mcp hook pre-tool-use"}]}}`,
			}),
		);
		const hooks = results.find((r) => r.title === "Hooks");
		expect(hooks?.status).toBe("ok");
	});

	it("reports ok for Amp which is MCP-only (no hooks config file)", async () => {
		const results = await runChecks(makeEnv({ env: { AMP_SESSION_ID: "s1" } }));
		const hooks = results.find((r) => r.title === "Hooks");
		expect(hooks?.status).toBe("ok");
		expect(hooks?.summary).toContain("MCP-only");
	});
});

// ---------------------------------------------------------------------------
// renderReport — exit codes
// ---------------------------------------------------------------------------

describe("renderReport", () => {
	const TERM = { useColor: false };

	it("returns 0 when every check passes", () => {
		const code = renderReport(
			[{ title: "A", status: "ok", summary: "ok" }],
			() => {},
			TERM,
		);
		expect(code).toBe(0);
	});

	it("returns 0 when warnings are present but no failures", () => {
		const code = renderReport(
			[{ title: "A", status: "warn", summary: "warn" }],
			() => {},
			TERM,
		);
		expect(code).toBe(0);
	});

	it("returns 1 on any fail status", () => {
		const code = renderReport(
			[
				{ title: "A", status: "ok", summary: "ok" },
				{ title: "B", status: "fail", summary: "bad" },
			],
			() => {},
			TERM,
		);
		expect(code).toBe(1);
	});

	it("emits hint and detail lines for failed checks", () => {
		const out: string[] = [];
		renderReport(
			[
				{
					title: "Storage",
					status: "fail",
					summary: "broken",
					detail: ["  inner: nope"],
					hint: "install something",
				},
			],
			(s) => out.push(s),
			TERM,
		);
		const joined = out.join("\n");
		expect(joined).toContain("inner: nope");
		expect(joined).toContain("hint: install something");
	});
});
