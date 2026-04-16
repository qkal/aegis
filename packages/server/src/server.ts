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

export const SERVER_NAME = "aegis" as const;
export const SERVER_VERSION = "0.1.0" as const;
