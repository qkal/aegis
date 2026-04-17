/**
 * Server identity (name + version) read from the package manifest.
 *
 * Separated from `server.ts` so every consumer — including tool
 * handlers — can import the identity without pulling the MCP SDK
 * transport wiring into their module graph.
 *
 * Reading via `node:fs` at module-load time avoids requiring JSON
 * import attributes, which would force a wider `module` setting for
 * every package that extends the base tsconfig.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const manifest: { version: string; } = JSON.parse(readFileSync(manifestPath, "utf8"));

export const SERVER_NAME = "aegis" as const;
export const SERVER_VERSION: string = manifest.version;
