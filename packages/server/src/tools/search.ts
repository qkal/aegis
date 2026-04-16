/**
 * aegis_search — BM25-ranked content search tool.
 *
 * Searches the local content index using dual FTS5 (Porter + trigram)
 * with Reciprocal Rank Fusion merge.
 *
 * Implementation deferred to Phase 1.
 */

export const TOOL_NAME = "aegis_search" as const;

export const TOOL_DESCRIPTION = "Search indexed content using BM25-ranked full-text search. "
	+ "Supports multiple queries, content-type filtering, and recency bias.";
