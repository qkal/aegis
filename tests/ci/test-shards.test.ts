import { globSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildVitestShardInvocation } from "../../scripts/ci/run-vitest-shard.mjs";
import { resolveShardFiles, TEST_SHARDS } from "../../scripts/ci/test-shards.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("vitest shard manifest", () => {
	it("defines the three Linux CI shards", () => {
		expect(Object.keys(TEST_SHARDS)).toEqual(["core", "storage", "rest"]);
	});

	it("partitions all current tests without overlap", () => {
		const allTests = [
			...globSync("packages/*/src/**/*.test.ts", { cwd: root, posix: true }),
			...globSync("tests/**/*.test.ts", { cwd: root, posix: true }),
		].sort();

		const shardFiles = Object.keys(TEST_SHARDS)
			.flatMap((name) => resolveShardFiles(root, name))
			.sort();

		expect(shardFiles).toEqual(allTests);
		expect(new Set(shardFiles).size).toBe(shardFiles.length);
	});

	it("invokes the local Vitest entrypoint through Node", () => {
		const files = resolveShardFiles(root, "core");
		const invocation = buildVitestShardInvocation(root, files);

		expect(invocation.command).toBe(process.execPath);
		expect(invocation.args.slice(0, 3)).toEqual([
			resolve(root, "node_modules", "vitest", "vitest.mjs"),
			"run",
			"--passWithNoTests",
		]);
		expect(invocation.args.slice(3)).toEqual(files);
	});
});
