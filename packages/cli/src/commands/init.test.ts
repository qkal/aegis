import { describe, expect, it } from "vitest";
import {
	applyInit,
	INIT_PLATFORMS,
	parseInitArgs,
	plan,
	renderSummary,
	resolve,
	run,
} from "./init.js";

// ---------------------------------------------------------------------------
// In-memory filesystem shim
// ---------------------------------------------------------------------------

interface FakeFs {
	readonly files: Map<string, string>;
	readonly modes: Map<string, number>;
	readonly dirs: Set<string>;
}

function fakeFs(initial: Record<string, string> = {}): FakeFs {
	const files = new Map(Object.entries(initial));
	return { files, modes: new Map(), dirs: new Set() };
}

function fakeEnv(fs: FakeFs, home = "/home/tester") {
	return {
		home,
		readFile: (p: string) => fs.files.get(p),
		writeFile: (p: string, c: string, mode: number) => {
			fs.files.set(p, c);
			fs.modes.set(p, mode);
		},
		mkdirp: (p: string) => fs.dirs.add(p),
	};
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

describe("parseInitArgs", () => {
	it("returns the platform and defaults for --dry-run / --force", () => {
		const out = parseInitArgs(["claude-code"]);
		expect(out).toEqual({ platform: "claude-code", dryRun: false, force: false });
	});

	it("recognizes --dry-run and --force in any order", () => {
		expect(parseInitArgs(["--dry-run", "codex"])).toMatchObject({
			platform: "codex",
			dryRun: true,
		});
		expect(parseInitArgs(["amp", "--force"])).toMatchObject({
			platform: "amp",
			force: true,
		});
	});

	it("rejects unknown platforms with a helpful message", () => {
		const out = parseInitArgs(["nope"]);
		expect(out).toEqual({
			error: "unknown platform: nope. Valid platforms: claude-code, codex, opencode, amp, generic.",
		});
	});

	it("rejects missing platform", () => {
		expect(parseInitArgs([])).toEqual({
			error:
				"missing platform argument. Valid platforms: claude-code, codex, opencode, amp, generic.",
		});
	});

	it("rejects a second positional argument", () => {
		const out = parseInitArgs(["claude-code", "extra"]);
		expect(out).toEqual({ error: "unexpected positional argument: extra" });
	});

	it("rejects unknown flags", () => {
		expect(parseInitArgs(["claude-code", "--foo"])).toEqual({ error: "unknown flag: --foo" });
	});
});

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

describe("plan", () => {
	it.each(INIT_PLATFORMS)("produces at least the policy file for %s", (platform) => {
		const files = plan(platform, "/home/tester");
		expect(files.some((f) => f.path === "/home/tester/.aegisctx/config.json")).toBe(true);
		// Every planned file lives under $HOME so tests don't accidentally
		// write outside the sandbox on a misconfigured env.
		for (const f of files) expect(f.path.startsWith("/home/tester/")).toBe(true);
	});

	it("emits Claude Code hook settings under ~/.claude for claude-code", () => {
		const files = plan("claude-code", "/home/tester");
		const hook = files.find((f) => f.path === "/home/tester/.claude/settings.json");
		expect(hook).toBeDefined();
		const parsed = JSON.parse(hook?.contents ?? "{}") as { hooks: Record<string, unknown>; };
		expect(Object.keys(parsed.hooks)).toEqual([
			"PreToolUse",
			"PostToolUse",
			"SessionStart",
			"PreCompact",
		]);
	});

	it("writes only the shared policy file for the generic platform", () => {
		const files = plan("generic", "/home/tester");
		expect(files).toHaveLength(1);
		expect(files[0]?.path).toBe("/home/tester/.aegisctx/config.json");
	});

	it("assigns 0o600 to the policy file and leaves other files at default 0o644", () => {
		const files = plan("claude-code", "/home/tester");
		const policy = files.find((f) => f.path.endsWith("/.aegisctx/config.json"));
		const hook = files.find((f) => f.path.endsWith("/.claude/settings.json"));
		expect(policy?.mode).toBe(0o600);
		expect(hook?.mode).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Resolver — diff between desired contents and the filesystem
// ---------------------------------------------------------------------------

describe("resolve", () => {
	it("marks files that don't exist as create", () => {
		const fs = fakeFs();
		const resolved = resolve(plan("amp", "/home/tester"), fakeEnv(fs));
		for (const r of resolved) expect(r.action).toBe("create");
	});

	it("marks files with identical contents as unchanged", () => {
		const fs = fakeFs();
		const planned = plan("amp", "/home/tester");
		// Seed the fake FS with each planned file's exact contents.
		for (const p of planned) fs.files.set(p.path, p.contents);
		const resolved = resolve(planned, fakeEnv(fs));
		for (const r of resolved) expect(r.action).toBe("unchanged");
	});

	it("marks files with different contents as update and preserves the prior text", () => {
		const fs = fakeFs({ "/home/tester/.aegisctx/config.json": "{}\n" });
		const resolved = resolve(plan("generic", "/home/tester"), fakeEnv(fs));
		expect(resolved[0]?.action).toBe("update");
		expect(resolved[0]?.before).toBe("{}\n");
	});
});

// ---------------------------------------------------------------------------
// applyInit — actual writes
// ---------------------------------------------------------------------------

describe("applyInit", () => {
	it("writes only files with action=create or action=update and records their mode", () => {
		const fs = fakeFs();
		const planned = plan("claude-code", "/home/tester");
		applyInit(resolve(planned, fakeEnv(fs)), fakeEnv(fs));
		expect(fs.files.has("/home/tester/.aegisctx/config.json")).toBe(true);
		expect(fs.files.has("/home/tester/.claude/settings.json")).toBe(true);
		expect(fs.modes.get("/home/tester/.aegisctx/config.json")).toBe(0o600);
		expect(fs.modes.get("/home/tester/.claude/settings.json")).toBe(0o644);
	});

	it("skips writes for unchanged files", () => {
		const fs = fakeFs();
		const planned = plan("generic", "/home/tester");
		for (const p of planned) fs.files.set(p.path, p.contents);
		const writesBefore = fs.files.size;
		const env = fakeEnv(fs);
		applyInit(resolve(planned, env), env);
		expect(fs.files.size).toBe(writesBefore);
		expect(fs.modes.size).toBe(0);
		expect(fs.dirs.size).toBe(0);
	});

	it("creates parent directories via mkdirp before writing", () => {
		const fs = fakeFs();
		const planned = plan("amp", "/home/tester");
		const env = fakeEnv(fs);
		applyInit(resolve(planned, env), env);
		expect(fs.dirs.has("/home/tester/.aegisctx")).toBe(true);
		expect(fs.dirs.has("/home/tester/.config/amp")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Full `run` entry point
// ---------------------------------------------------------------------------

describe("run (init)", () => {
	const TERM = { useColor: false };

	it("applies changes by default on a fresh install", () => {
		const fs = fakeFs();
		const out: string[] = [];
		const code = run(["claude-code"], fakeEnv(fs), (s) => out.push(s), TERM);
		expect(code).toBe(0);
		expect(fs.files.has("/home/tester/.aegisctx/config.json")).toBe(true);
		expect(fs.files.has("/home/tester/.claude/settings.json")).toBe(true);
		expect(out.join("\n")).toContain("create");
		expect(out.join("\n")).toContain("Applied.");
	});

	it("refuses to overwrite without --force and exits with a note", () => {
		const fs = fakeFs({ "/home/tester/.aegisctx/config.json": "{}\n" });
		const out: string[] = [];
		const code = run(["generic"], fakeEnv(fs), (s) => out.push(s), TERM);
		expect(code).toBe(0);
		// File preserved untouched.
		expect(fs.files.get("/home/tester/.aegisctx/config.json")).toBe("{}\n");
		const joined = out.join("\n");
		expect(joined).toContain("one or more files would be overwritten");
		expect(joined).toContain("Blocked");
		expect(joined).not.toContain("Applied.");
	});

	it("overwrites when --force is passed", () => {
		const fs = fakeFs({ "/home/tester/.aegisctx/config.json": "{}\n" });
		const out: string[] = [];
		const code = run(["generic", "--force"], fakeEnv(fs), (s) => out.push(s), TERM);
		expect(code).toBe(0);
		expect(fs.files.get("/home/tester/.aegisctx/config.json")).not.toBe("{}\n");
	});

	it("respects --dry-run and writes nothing", () => {
		const fs = fakeFs();
		const out: string[] = [];
		const code = run(["--dry-run", "amp"], fakeEnv(fs), (s) => out.push(s), TERM);
		expect(code).toBe(0);
		expect(fs.files.size).toBe(0);
		expect(out.join("\n")).toContain("dry run — no files written");
	});

	it("returns exit code 2 on unknown platform", () => {
		const fs = fakeFs();
		const out: string[] = [];
		const code = run(["nope"], fakeEnv(fs), (s) => out.push(s), TERM);
		expect(code).toBe(2);
		expect(out.join("\n")).toContain("unknown platform");
	});
});

describe("renderSummary", () => {
	const TERM = { useColor: false };

	it("reports dry-run mode explicitly", () => {
		const summary = renderSummary(
			[
				{
					plan: { path: "/p", description: "d", contents: "" },
					action: "create",
					before: undefined,
				},
			],
			{ platform: "generic", dryRun: true, force: false },
			TERM,
		);
		expect(summary).toContain("dry run");
	});

	it("reports blocked when overwrite is blocked", () => {
		const summary = renderSummary(
			[
				{
					plan: { path: "/p", description: "d", contents: "new" },
					action: "update",
					before: "old",
				},
			],
			{ platform: "generic", dryRun: false, force: false, blocked: true },
			TERM,
		);
		expect(summary).toContain("Blocked");
		expect(summary).not.toContain("Applied.");
	});
});
