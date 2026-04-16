/**
 * aegis_execute — Sandboxed code execution tool.
 *
 * Executes code in an isolated sandbox process.
 * Supports all languages declared by the core policy contract. Returns
 * only stdout to the agent's context.
 *
 * Implementation deferred to Phase 1.
 */

import { LANGUAGES } from "@aegis/core";

export const TOOL_NAME = "aegis_execute" as const;

/**
 * Description advertised to MCP clients. The language list is sourced
 * from `@aegis/core`'s `LANGUAGES` tuple so the server metadata cannot
 * drift from the engine's actual capabilities.
 */
export const TOOL_DESCRIPTION = `Execute code in a sandboxed environment. Returns stdout only. `
	+ `Supports: ${LANGUAGES.join(", ")}.`;
