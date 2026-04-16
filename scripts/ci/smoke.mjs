import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_SMOKE_FILES = Object.freeze([
	"packages/cli/dist/cli.js",
	"packages/cli/dist/index.js",
	"packages/server/dist/index.js",
	"packages/server/package.json",
]);

export function assertSmokeFiles(
	root = process.cwd(),
	requiredFiles = REQUIRED_SMOKE_FILES,
) {
	const missing = requiredFiles.filter((file) => !existsSync(resolve(root, file)));
	if (missing.length > 0) {
		throw new Error(
			`Missing smoke-test artifacts:\n${missing.map((file) => `- ${file}`).join("\n")}`,
		);
	}
}

export async function importBuiltModule(root, relativePath) {
	return import(pathToFileURL(resolve(root, relativePath)).href);
}

export async function runSmoke(root = process.cwd()) {
	assertSmokeFiles(root);

	const cliBin = await importBuiltModule(root, "packages/cli/dist/cli.js");
	const cliModule = await importBuiltModule(root, "packages/cli/dist/index.js");
	const serverModule = await importBuiltModule(root, "packages/server/dist/index.js");

	if (cliModule.CLI_NAME !== "aegis" || typeof cliModule.CLI_VERSION !== "string") {
		throw new Error("CLI dist exports are missing expected identifiers.");
	}

	if (serverModule.SERVER_NAME !== "aegis" || typeof serverModule.SERVER_VERSION !== "string") {
		throw new Error("Server dist exports are missing expected identifiers.");
	}

	if (typeof cliBin.CLI_DESCRIPTION !== "string") {
		throw new Error("CLI entrypoint failed to load.");
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	runSmoke().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
