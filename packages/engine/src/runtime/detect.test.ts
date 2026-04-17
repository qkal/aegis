import { describe, expect, it } from "vitest";
import {
	cachedDetectRuntime,
	clearRuntimeCache,
	detectAllRuntimes,
	detectRuntime,
	parseVersion,
	RUNTIME_BINARIES,
} from "./detect.js";

describe("parseVersion", () => {
	it("returns the first non-empty line of stdout", () => {
		expect(parseVersion("v22.3.0\n", "")).toBe("v22.3.0");
		expect(parseVersion("\n\nPython 3.12.1\n", "")).toBe("Python 3.12.1");
	});

	it("falls back to stderr when stdout is empty", () => {
		expect(parseVersion("", "go version go1.22 linux/amd64\n"))
			.toBe("go version go1.22 linux/amd64");
	});

	it("returns empty string when both streams are empty", () => {
		expect(parseVersion("", "")).toBe("");
	});
});

describe("detectRuntime", () => {
	it("marks a runtime available when its binary resolves and probes OK", () => {
		const detected = detectRuntime("javascript", {
			resolveBinary: (name) => name === "node" ? "/usr/local/bin/node" : undefined,
			probeVersion: () => ({ stdout: "v22.12.0", stderr: "", status: 0 }),
		});
		expect(detected).toEqual({
			language: "javascript",
			available: true,
			version: "v22.12.0",
			path: "/usr/local/bin/node",
			binary: "node",
		});
	});

	it("falls through to the next candidate when the first is missing", () => {
		const detected = detectRuntime("python", {
			resolveBinary: (name) => name === "python" ? "/usr/bin/python" : undefined,
			probeVersion: () => ({ stdout: "Python 2.7.18", stderr: "", status: 0 }),
		});
		expect(detected.available).toBe(true);
		if (detected.available) {
			expect(detected.binary).toBe("python");
			expect(detected.path).toBe("/usr/bin/python");
		}
	});

	it("returns unavailable when no candidate resolves", () => {
		const detected = detectRuntime("rust", {
			resolveBinary: () => undefined,
			probeVersion: () => {
				throw new Error("should not be called");
			},
		});
		expect(detected).toEqual({ language: "rust", available: false });
	});

	it("returns unavailable when the probe fails", () => {
		const detected = detectRuntime("go", {
			resolveBinary: () => "/opt/go/bin/go",
			probeVersion: () => ({ stdout: "", stderr: "boom", status: 2 }),
		});
		expect(detected).toEqual({ language: "go", available: false });
	});

	it("uses `go version` rather than `--version` for go", () => {
		const seenArgs: string[][] = [];
		detectRuntime("go", {
			resolveBinary: () => "/opt/go/bin/go",
			probeVersion: (_, args) => {
				seenArgs.push([...args]);
				return { stdout: "go version go1.22 linux/amd64", stderr: "", status: 0 };
			},
		});
		expect(seenArgs).toEqual([["version"]]);
	});
});

describe("detectAllRuntimes", () => {
	it("preserves input order", () => {
		const out = detectAllRuntimes(["javascript", "python", "rust"], {
			resolveBinary: () => undefined,
			probeVersion: () => ({ stdout: "", stderr: "", status: 0 }),
		});
		expect(out.map((r) => r.language)).toEqual(["javascript", "python", "rust"]);
		expect(out.every((r) => r.available === false)).toBe(true);
	});
});

describe("cache", () => {
	it("caches detection results", () => {
		clearRuntimeCache();
		let calls = 0;
		const probe = () => {
			calls += 1;
			return { stdout: "v22.0.0", stderr: "", status: 0 };
		};
		const first = cachedDetectRuntime("javascript", {
			resolveBinary: () => "/usr/bin/node",
			probeVersion: probe,
		});
		const second = cachedDetectRuntime("javascript", {
			resolveBinary: () => "/usr/bin/node",
			probeVersion: probe,
		});
		expect(first).toBe(second);
		expect(calls).toBe(1);
	});
});

describe("RUNTIME_BINARIES", () => {
	it("has at least one candidate for every language", () => {
		for (const [, bins] of Object.entries(RUNTIME_BINARIES)) {
			expect(bins.length).toBeGreaterThan(0);
		}
	});
});
