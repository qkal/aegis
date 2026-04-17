import { describe, expect, it } from "vitest";
import { CLI_VERSION, dispatch, renderUsage } from "./cli.js";

const TERM = { useColor: false };

function captureDispatch(argv: readonly string[]) {
	const out: string[] = [];
	const err: string[] = [];
	const codePromise = dispatch({
		argv,
		write: (s) => out.push(s),
		writeError: (s) => err.push(s),
		term: TERM,
	});
	return { out, err, codePromise };
}

describe("renderUsage", () => {
	it("lists the known commands and platforms", () => {
		const usage = renderUsage(TERM);
		expect(usage).toContain("doctor");
		expect(usage).toContain("init <platform>");
		expect(usage).toContain("claude-code");
	});
});

describe("dispatch", () => {
	it("prints usage and exits 2 when no command is given", async () => {
		const { out, codePromise } = captureDispatch([]);
		const code = await codePromise;
		expect(code).toBe(2);
		expect(out.join("\n")).toContain("USAGE");
	});

	it("prints usage and exits 0 on --help", async () => {
		const { out, codePromise } = captureDispatch(["--help"]);
		const code = await codePromise;
		expect(code).toBe(0);
		expect(out.join("\n")).toContain("USAGE");
	});

	it("prints the version on --version", async () => {
		const { out, codePromise } = captureDispatch(["--version"]);
		const code = await codePromise;
		expect(code).toBe(0);
		expect(out).toEqual([CLI_VERSION]);
	});

	it("emits a clear error and exits 2 on unknown commands", async () => {
		const { err, codePromise } = captureDispatch(["frobnicate"]);
		const code = await codePromise;
		expect(code).toBe(2);
		expect(err.join("\n")).toContain("unknown command: frobnicate");
		expect(err.join("\n")).toContain("USAGE");
	});

	it("returns 2 when `init` is invoked with no platform", async () => {
		const { out, codePromise } = captureDispatch(["init"]);
		const code = await codePromise;
		expect(code).toBe(2);
		expect(out.join("\n")).toContain("missing platform argument");
	});
});
