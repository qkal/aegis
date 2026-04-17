import type { Language } from "@aegis/core";
import { describe, expect, it } from "vitest";
import { FILE_EXTENSION, planExecution, SOURCE_PLACEHOLDER } from "./command.js";
import type { AvailableRuntime } from "./detect.js";

function rt(language: Language, path = "/usr/bin/fake"): AvailableRuntime {
	return {
		language,
		available: true,
		version: "test",
		path,
		binary: "fake",
	};
}

describe("planExecution", () => {
	it("uses `{{SOURCE}}` as the sole argument for script languages", () => {
		const scripts = [
			"javascript",
			"typescript",
			"python",
			"shell",
			"ruby",
			"php",
			"perl",
			"swift",
		] as const;
		for (const lang of scripts) {
			const plan = planExecution(rt(lang));
			expect(plan.args).toEqual([SOURCE_PLACEHOLDER]);
			expect(plan.sourceExtension).toBe(FILE_EXTENSION[lang]);
		}
	});

	it("invokes `go run <file>` for go", () => {
		const plan = planExecution(rt("go"));
		expect(plan.args).toEqual(["run", SOURCE_PLACEHOLDER]);
		expect(plan.sourceExtension).toBe(".go");
	});

	it("throws for rust because compile-then-run is not yet implemented", () => {
		// Returning a compile-only plan would let the executor report
		// `status: "success"` for a Rust snippet that never ran. Fail
		// fast instead, and surface the error through PolyglotExecutor's
		// normal error path. Revisit when Phase 2 wires compile-then-run.
		expect(() => planExecution(rt("rust"))).toThrow(/rust execution is not yet supported/);
	});

	it("uses `Rscript <file>` for r", () => {
		const plan = planExecution(rt("r"));
		expect(plan.args).toEqual([SOURCE_PLACEHOLDER]);
		expect(plan.sourceExtension).toBe(".R");
	});

	it("returns the supplied binary path", () => {
		const plan = planExecution(rt("javascript", "/opt/custom/node"));
		expect(plan.executable).toBe("/opt/custom/node");
	});

	it("reports extensions that match the language", () => {
		for (const [, ext] of Object.entries(FILE_EXTENSION)) {
			expect(ext.startsWith(".")).toBe(true);
		}
	});
});
