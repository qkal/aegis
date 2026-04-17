import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSmokeFiles, REQUIRED_SMOKE_FILES } from "../../scripts/ci/smoke.mjs";

describe("smoke artifact manifest", () => {
	it("covers the built CLI and server entrypoints", () => {
		expect(REQUIRED_SMOKE_FILES).toEqual([
			"packages/cli/dist/bin.js",
			"packages/cli/dist/index.js",
			"packages/server/dist/index.js",
			"packages/server/package.json",
		]);
	});

	it("throws when any required build artifact is missing", () => {
		const root = mkdtempSync(join(tmpdir(), "aegis-smoke-"));
		mkdirSync(join(root, "packages", "cli", "dist"), { recursive: true });
		writeFileSync(
			join(root, "packages", "cli", "dist", "bin.js"),
			"export const CLI_DESCRIPTION = 'ok';\n",
		);

		expect(() => assertSmokeFiles(root)).toThrow(/packages\/cli\/dist\/index\.js/);
	});
});
