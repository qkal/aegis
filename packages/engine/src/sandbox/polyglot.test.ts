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
import { __testing_walkBackToUtf8Boundary, PolyglotExecutor } from "./polyglot.js";
import type { SandboxConfig } from "./types.js";

describe("walkBackToUtf8Boundary", () => {
	it("returns the index unchanged when it already lies on a boundary", () => {
		// "hello" is pure ASCII; every index is a boundary.
		const buf = Buffer.from("hello", "utf8");
		expect(__testing_walkBackToUtf8Boundary(buf, 3)).toBe(3);
	});

	it("walks back off a continuation byte in the middle of a multibyte sequence", () => {
		// "é" is 0xC3 0xA9 (2 bytes). Asking for end=1 lands on the
		// continuation byte 0xA9; the helper must return 0 so the slice
		// stops cleanly before "é".
		const buf = Buffer.from("é", "utf8");
		expect(__testing_walkBackToUtf8Boundary(buf, 1)).toBe(0);
	});

	it("handles a 4-byte code point at the tail", () => {
		// "😀" is 4 bytes: 0xF0 0x9F 0x98 0x80. Cutting inside the
		// sequence (end=2 or 3) must walk back to 0.
		const buf = Buffer.from("😀", "utf8");
		expect(__testing_walkBackToUtf8Boundary(buf, 3)).toBe(0);
		expect(__testing_walkBackToUtf8Boundary(buf, 2)).toBe(0);
		expect(__testing_walkBackToUtf8Boundary(buf, 1)).toBe(0);
	});

	it("keeps preceding complete characters when the last one is split", () => {
		// "aé" → 0x61 0xC3 0xA9. Cutting at end=2 (the 0xA9
		// continuation byte) must walk back to 1, preserving "a".
		const buf = Buffer.from("aé", "utf8");
		expect(__testing_walkBackToUtf8Boundary(buf, 2)).toBe(1);
	});
});

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

// Most of the suite relies on `/bin/sh`, `sleep`, `yes`, `head`, or
// `printf`'s `\033` interpretation. Skip on Windows rather than
// surface failures that have nothing to do with the code under test;
// Windows support is tracked in the cross-platform kill path
// (`killProcessGroup`) and will get its own suite when it lands.
const describeOnPosix = process.platform === "win32" ? describe.skip : describe;

describeOnPosix("PolyglotExecutor.execute", () => {
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

	it("never emits U+FFFD when truncation lands inside a multibyte sequence", async () => {
		// Each "é" is 2 UTF-8 bytes. With maxOutputBytes=3, a naive byte
		// cut would land in the middle of the second "é" and the raw
		// conversion to utf8 would emit U+FFFD. BoundedSink must walk
		// back to the previous code-point boundary.
		const out = await exec.execute(
			baseConfig({
				code: "printf 'éééééééééé'",
				language: "shell",
				maxOutputBytes: 3,
			}),
		);
		expect(out.status).toBe("success");
		if (out.status === "success") {
			expect(out.stdout).not.toContain("\uFFFD");
			// Only complete "é" characters should survive.
			expect(/^é*$/.test(out.stdout)).toBe(true);
		}
	});

	it("does not inherit parent environment variables", async () => {
		// Assert positively: the child's env came exclusively from
		// `config.env` (which does not define AEGIS_TEST_LEAK), so the
		// fallback branch of `${...:-missing}` must fire. This avoids
		// mutating `process.env`, which would be fragile under
		// `describe.concurrent` or other tests reading the same variable.
		const out = await exec.execute(
			baseConfig({
				code: 'echo "${AEGIS_TEST_LEAK:-missing}"',
				language: "shell",
			}),
		);
		expect(out.status).toBe("success");
		if (out.status === "success") {
			expect(out.stdout).toBe("missing");
		}
	});

	it("returns error for rust until compile-then-run lands", async () => {
		const forced = new PolyglotExecutor({
			resolveRuntime: makeResolver({
				rust: {
					language: "rust",
					available: true,
					version: "fake",
					path: "/usr/bin/fake-rustc",
					binary: "rustc",
				},
			}),
		});
		const out = await forced.execute(
			baseConfig({
				code: 'fn main() { println!("hi"); }',
				language: "rust",
			}),
		);
		expect(out).toEqual({
			status: "error",
			error: expect.stringContaining("rust execution is not yet supported"),
		});
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
