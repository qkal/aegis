import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PACK_TARGETS = Object.freeze([
	"packages/adapters",
	"packages/cli",
	"packages/core",
	"packages/engine",
	"packages/server",
	"packages/storage",
]);

export function requiredDistFiles(packageDir) {
	switch (packageDir) {
		case "packages/cli":
			return ["dist/index.js", "dist/cli.js"];
		case "packages/server":
			return ["dist/index.js"];
		default:
			return ["dist/index.js"];
	}
}

export function assertPackInputs(root = process.cwd(), packageDirs = PACK_TARGETS) {
	const missing = packageDirs.flatMap((packageDir) =>
		requiredDistFiles(packageDir)
			.filter((relativeFile) => !existsSync(resolve(root, packageDir, relativeFile)))
			.map((relativeFile) => `${packageDir}/${relativeFile}`)
	);

	if (missing.length > 0) {
		throw new Error(
			`Missing package artifacts:\n${missing.map((file) => `- ${file}`).join("\n")}`,
		);
	}
}

export function packWorkspacePackages(
	root = process.cwd(),
	packageDirs = PACK_TARGETS,
	outputDir = resolve(root, ".artifacts", "packs"),
) {
	rmSync(outputDir, { recursive: true, force: true });
	mkdirSync(outputDir, { recursive: true });

	const pnpmCommand = "pnpm";

	for (const packageDir of packageDirs) {
		const result = spawnSync(pnpmCommand, ["pack", "--pack-destination", outputDir], {
			cwd: resolve(root, packageDir),
			stdio: "inherit",
			shell: false,
		});

		if (result.error) {
			throw result.error;
		}

		if (result.status !== 0) {
			throw new Error(`pnpm pack failed for ${packageDir}`);
		}
	}
}

export function runHygiene(root = process.cwd()) {
	assertPackInputs(root);
	packWorkspacePackages(root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		runHygiene();
	} catch (error) {
		console.error(error);
		process.exit(1);
	}
}
