/**
 * PolyglotExecutor integration tests.
 *
 * These tests spawn real child processes. They rely on `node` and
 * `/bin/sh` being available on the host, both of which are guaranteed
 * by the CI image and local developer environments. Tests that need
 * languages outside the baseline are skipped when the runtime is not
 * detected.
 */

import { describe, expect, it } from "vitest";

import type { Language } from "@aegis/core";

import { type DetectedRuntime, detectRuntime } from "../runtime/detect.js";
import { PolyglotExecutor } from "./polyglot.js";
import type { SandboxConfig } from "./types.js";

function baseConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
	return {
		code: "",
		language: "shell",
		timeoutMs: 5_000,
		maxOutputBytes: 64 * 1024,
		env: { PATH: process.env["PATH"] ?? "" },
		allowNetwork: false,
		...overrides,
	};
}

function makeResolver(
	override?: Partial<Record<Language, DetectedRuntime>>,
): (language: Language) => DetectedRuntime {
	return (language) => {
		const forced = override?.[language];
		if (forced !== undefined) {
			return forced;
		}
		return detectRuntime(language);
	};
}

describe("PolyglotExecutor.execute", () => {
	const exec = new PolyglotExecutor({ resolveRuntime: makeResolver() });

	it("rejects non-positive timeouts", async () => {
		const out = await exec.execute(baseConfig({ timeoutMs: 0 }));
		expect(out).toEqual({ status: "error", error: expect.stringContaining("timeoutMs") });
	});

	it("rejects non-positive output budgets", async () => {
		const out = await exec.execute(baseConfig({ maxOutputBytes: 0 }));
		expect(out).toEqual({
			status: "error",
			error: expect.stringContaining("maxOutputBytes"),
		});
	});

	it("returns error when no runtime is available", async () => {
		const forced = new PolyglotExecutor({
			resolveRuntime: makeResolver({
				shell: { language: "shell", available: false },
			}),
		});
		const out = await forced.execute(baseConfig({ code: "echo hi", language: "shell" }));
		expect(out).toEqual({
			status: "error",
			error: expect.stringContaining("no runtime available"),
		});
	});

	it("captures stdout for a successful shell script", async () => {
		const out = await exec.execute(
			baseConfig({ code: "echo hello-sandbox", language: "shell" }),
		);
		expect(out.status).toBe("success");
		if (out.status === "success") {
			expect(out.stdout).toBe("hello-sandbox");
			expect(out.stderr).toBe("");
			expect(out.exitCode).toBe(0);
			expect(out.durationMs).toBeGreaterThanOrEqual(0);
		}
	});

	it("reports failure with non-zero exit code and stderr", async () => {
		const out = await exec.execute(
			baseConfig({ code: "echo boom >&2; exit 7", language: "shell" }),
		);
		expect(out.status).toBe("failure");
		if (out.status === "failure") {
			expect(out.exitCode).toBe(7);
			expect(out.stderr).toBe("boom");
		}
	});

	it("enforces the timeout and kills the entire process group", async () => {
		// `sleep 5 & wait` would survive SIGKILL of just the parent on
		// some shells if we did not kill the whole process group.
		const out = await exec.execute(
			baseConfig({
				code: "sleep 5 & sleep 5 & sleep 5 & wait",
				language: "shell",
				timeoutMs: 200,
			}),
		);
		expect(out.status).toBe("timeout");
	});

	it("strips ANSI escape codes from captured output", async () => {
		const out = await exec.execute(
			baseConfig({
				code: "printf '\\033[31mred\\033[0m\\n'",
				language: "shell",
			}),
		);
		expect(out.status).toBe("success");
		if (out.status === "success") {
			expect(out.stdout).toBe("red");
		}
	});

	it("truncates stdout to maxOutputBytes", async () => {
		const out = await exec.execute(
			baseConfig({
				code: "yes aaaaaaaaaa | head -c 50000",
				language: "shell",
				maxOutputBytes: 1_000,
			}),
		);
		expect(out.status).toBe("success");
		if (out.status === "success") {
			// Byte length is bounded by maxOutputBytes; the processed
			// string may be slightly shorter due to UTF-8 boundary
			// rounding.
			expect(Buffer.byteLength(out.stdout, "utf8")).toBeLessThanOrEqual(1_000);
		}
	});

	it("does not inherit parent environment variables", async () => {
		const marker = `AEGIS_TEST_${Math.random().toString(36).slice(2)}`;
		process.env["AEGIS_TEST_LEAK"] = marker;
		try {
			const out = await exec.execute(
				baseConfig({
					code: 'echo "${AEGIS_TEST_LEAK:-missing}"',
					language: "shell",
				}),
			);
			expect(out.status).toBe("success");
			if (out.status === "success") {
				expect(out.stdout).toBe("missing");
				expect(out.stdout).not.toContain(marker);
			}
		} finally {
			delete process.env["AEGIS_TEST_LEAK"];
		}
	});

	it("runs javascript via node when detected", async () => {
		const runtime = detectRuntime("javascript");
		if (!runtime.available) {
			return; // Skip: node not on PATH; unusual for CI but allowed.
		}
		const out = await exec.execute(
			baseConfig({
				code: "console.log('js:' + (1 + 2))",
				language: "javascript",
			}),
		);
		expect(out.status).toBe("success");
		if (out.status === "success") {
			expect(out.stdout).toBe("js:3");
		}
	});

	it("sets a writable working directory when workingDir is omitted", async () => {
		const out = await exec.execute(
			baseConfig({
				code: "pwd",
				language: "shell",
			}),
		);
		expect(out.status).toBe("success");
		if (out.status === "success") {
			// The default workDir is a freshly-created temp dir.
			expect(out.stdout.length).toBeGreaterThan(0);
		}
	});

	it("honours an explicit workingDir", async () => {
		const out = await exec.execute(
			baseConfig({
				code: "pwd",
				language: "shell",
				workingDir: "/tmp",
			}),
		);
		expect(out.status).toBe("success");
		if (out.status === "success") {
			expect(out.stdout).toBe("/tmp");
		}
	});

	it("surfaces spawn errors when the runtime binary cannot be executed", async () => {
		const forced = new PolyglotExecutor({
			resolveRuntime: makeResolver({
				shell: {
					language: "shell",
					available: true,
					version: "fake",
					path: "/nonexistent/aegis-test-bin-does-not-exist",
					binary: "sh",
				},
			}),
		});
		const out = await forced.execute(
			baseConfig({ code: "echo nope", language: "shell" }),
		);
		expect(out.status).toBe("error");
	});
});
