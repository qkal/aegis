import { describe, expect, it } from "vitest";
import { PACK_TARGETS, requiredDistFiles } from "../../scripts/ci/hygiene.mjs";

describe("hygiene package manifest", () => {
	it("packs every publishable workspace package", () => {
		expect(PACK_TARGETS).toEqual([
			"packages/adapters",
			"packages/cli",
			"packages/core",
			"packages/engine",
			"packages/server",
			"packages/storage",
		]);
	});

	it("requires extra entrypoints for cli and server", () => {
		expect(requiredDistFiles("packages/cli")).toEqual([
			"dist/index.js",
			"dist/cli.js",
		]);
		expect(requiredDistFiles("packages/server")).toEqual([
			"dist/index.js",
		]);
		expect(requiredDistFiles("packages/core")).toEqual(["dist/index.js"]);
	});
});
