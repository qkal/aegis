import { globSync } from "node:fs";

export const TEST_SHARDS = Object.freeze({
	core: ["packages/core/src/**/*.test.ts"],
	storage: ["packages/storage/src/**/*.test.ts"],
	rest: [
		"packages/adapters/src/**/*.test.ts",
		"packages/cli/src/**/*.test.ts",
		"packages/engine/src/**/*.test.ts",
		"packages/server/src/**/*.test.ts",
		"tests/**/*.test.ts",
	],
});

export function getShardPatterns(name) {
	const patterns = TEST_SHARDS[name];
	if (!patterns) {
		throw new Error(`Unknown test shard: ${name}`);
	}
	return patterns;
}

export function resolveShardFiles(root, name) {
	return getShardPatterns(name)
		.flatMap((pattern) => globSync(pattern, { cwd: root, posix: true }))
		.sort();
}
