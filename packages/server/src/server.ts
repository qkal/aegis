/**
 * MCP server setup and lifecycle.
 *
 * This file should remain under 200 lines. It handles:
 * - MCP server initialization
 * - Tool registration (delegated to individual tool modules)
 * - Transport setup (stdio)
 * - Graceful shutdown
 *
 * All business logic lives in the respective packages.
 *
 * Implementation deferred to Phase 1.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `SERVER_VERSION` is read from the package manifest at module load time so
 * the exported value is a single source of truth (the `version` baked into
 * the published package). Reading via `node:fs` avoids requiring JSON
 * import attributes, which would force a wider `module` setting for every
 * package that extends the base tsconfig.
 */
const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const manifest: { version: string; } = JSON.parse(readFileSync(manifestPath, "utf8"));

export const SERVER_NAME = "aegis" as const;
export const SERVER_VERSION: string = manifest.version;
