/**
 * Platform detection tests.
 *
 * These tests exercise `detectPlatform` with explicit env-var maps so
 * the behaviour is deterministic regardless of which platform the test
 * runner itself is on. Each assertion pairs one signal with its
 * expected platform to catch any renumbering of the PLATFORM_ENV_SIGNALS
 * constant.
 */
import { describe, expect, it } from "vitest";

import { detectPlatform, PLATFORM_ENV_SIGNALS } from "./detect.js";

describe("detectPlatform", () => {
	it("returns undefined when no known signal is set", () => {
		expect(detectPlatform({})).toBeUndefined();
		expect(detectPlatform({ UNRELATED_VAR: "1" })).toBeUndefined();
	});

	it("ignores empty-string signals (treat as unset)", () => {
		expect(detectPlatform({ CLAUDE_PROJECT_DIR: "" })).toBeUndefined();
	});

	it("maps every signal in PLATFORM_ENV_SIGNALS to its platform", () => {
		for (const [signal, platform] of Object.entries(PLATFORM_ENV_SIGNALS)) {
			const detected = detectPlatform({ [signal]: "/tmp/project" });
			expect(detected).toEqual({
				platform,
				confidence: "high",
				reason: `env var ${signal} is set`,
			});
		}
	});

	it("is deterministic when multiple signals are present (first in PLATFORM_ENV_SIGNALS wins)", () => {
		const env = { CLAUDE_PROJECT_DIR: "/tmp/a", CODEX_HOME: "/tmp/b" };
		expect(detectPlatform(env)).toEqual({
			platform: "claude-code",
			confidence: "high",
			reason: "env var CLAUDE_PROJECT_DIR is set",
		});
	});
});
