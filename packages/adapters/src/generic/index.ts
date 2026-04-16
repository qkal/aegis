/**
 * Generic MCP-only adapter.
 *
 * Tier 3: MCP tools only, no hooks, instruction-file routing.
 * Fallback for platforms with no hook support.
 * Implementation deferred to Phase 3.
 */

export const GENERIC_PLATFORM = "generic" as const;
