import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "../..");
const packageJson = JSON.parse(
	readFileSync(resolve(rootDir, "package.json"), "utf8"),
);

describe("root toolchain contract", () => {
	it("uses the expected scripts and dev dependencies", () => {
		expect(packageJson.scripts.lint).toBe("oxlint .");
		expect(packageJson.scripts["lint:fix"]).toBe("oxlint --fix .");
		expect(packageJson.scripts.format).toBe("dprint fmt");
		expect(packageJson.scripts["format:check"]).toBe("dprint check");
		expect(packageJson.scripts["test:core"]).toBe(
			"node ./scripts/ci/run-vitest-shard.mjs core",
		);
		expect(packageJson.scripts["test:storage"]).toBe(
			"node ./scripts/ci/run-vitest-shard.mjs storage",
		);
		expect(packageJson.scripts["test:rest"]).toBe(
			"node ./scripts/ci/run-vitest-shard.mjs rest",
		);
		expect(packageJson.scripts["ci:smoke"]).toBe("node ./scripts/ci/smoke.mjs");
		expect(packageJson.scripts["ci:hygiene"]).toBe(
			"node ./scripts/ci/hygiene.mjs",
		);
		expect(packageJson.devDependencies["@biomejs/biome"]).toBeUndefined();
		expect(packageJson.devDependencies.oxlint).toBeDefined();
		expect(packageJson.devDependencies.dprint).toBeDefined();
		expect(packageJson.devDependencies["@dprint/typescript"]).toBeDefined();
		expect(packageJson.devDependencies["@dprint/json"]).toBeDefined();
		expect(packageJson.devDependencies["@dprint/markdown"]).toBeDefined();
	});

	it("uses the expected root config files", () => {
		expect(existsSync(resolve(rootDir, ".oxlintrc.json"))).toBe(true);
		expect(existsSync(resolve(rootDir, "dprint.json"))).toBe(true);
		expect(existsSync(resolve(rootDir, "biome.json"))).toBe(false);
	});
});
