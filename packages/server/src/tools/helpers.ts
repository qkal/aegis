/**
 * Shared MCP `CallToolResult` helpers.
 *
 * Tool handlers return structured JSON as a single `text` content block
 * so the MCP transport can relay it verbatim. We also set `isError:
 * true` on failure paths so clients can branch on it without parsing
 * the body, matching the MCP conventions used by reference servers.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Render a value as pretty JSON and wrap it in a single text block. */
export function jsonResult(value: unknown): CallToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
	};
}

/**
 * Build an `isError: true` MCP result. `detail` is an arbitrary
 * JSON-serializable object that clients can render verbatim; callers
 * typically include a machine-readable `code` plus any structured
 * diagnostic fields.
 */
export function errorResult(message: string, detail?: Record<string, unknown>): CallToolResult {
	const body = { error: message, ...(detail ?? {}) };
	return {
		isError: true,
		content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
	};
}
