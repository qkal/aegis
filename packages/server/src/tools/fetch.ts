/**
 * aegis_fetch — URL fetch and index tool.
 *
 * Fetches a URL, converts to markdown, and indexes with TTL cache.
 *
 * Implementation deferred to Phase 1.
 */

export const TOOL_NAME = "aegis_fetch" as const;

export const TOOL_DESCRIPTION =
	"Fetch a URL, convert to markdown, and index into the knowledge base. " +
	"Cached for 24 hours by default. Use force=true to bypass cache.";
