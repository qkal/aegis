/**
 * aegis_index — Content indexing tool.
 *
 * Indexes markdown/text content into the local knowledge base.
 * Content is chunked, deduplicated, and indexed in dual FTS5 tables.
 *
 * Implementation deferred to Phase 1.
 */

export const TOOL_NAME = "aegis_index" as const;

export const TOOL_DESCRIPTION =
	"Index markdown or text content into the local knowledge base. " +
	"Content is chunked, deduplicated, and searchable via aegis_search.";
