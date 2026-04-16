import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveShardFiles } from "./test-shards.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function buildVitestShardInvocation(rootDir, files) {
	return {
		command: process.execPath,
		args: [
			resolve(rootDir, "node_modules", "vitest", "vitest.mjs"),
			"run",
			"--passWithNoTests",
			...files,
		],
	};
}

export function runVitestShard(rootDir, shard) {
	const files = resolveShardFiles(rootDir, shard);
	const { command, args } = buildVitestShardInvocation(rootDir, files);
	const result = spawnSync(command, args, {
		cwd: rootDir,
		stdio: "inherit",
		shell: false,
	});

	if (result.error) {
		throw result.error;
	}

	return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const shardName = process.argv[2];
	if (!shardName) {
		console.error("Usage: node scripts/ci/run-vitest-shard.mjs <core|storage|rest>");
		process.exit(1);
	}

	process.exit(runVitestShard(root, shardName));
}
