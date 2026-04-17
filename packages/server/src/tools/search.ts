/**
 * aegis_search — BM25-ranked content search tool.
 *
 * Delegates to `ContentIndex.search()`, which runs the dual-FTS5 /
 * RRF merge and returns ranked snippets.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ServerContext } from "../runtime/context.js";
import { jsonResult } from "./helpers.js";

export const TOOL_NAME = "aegis_search" as const;

export const TOOL_DESCRIPTION = "Search indexed content using BM25-ranked full-text search. "
	+ "Supports multiple queries, content-type filtering, and recency bias.";

const CONTENT_TYPES = ["code", "prose"] as const;

export const inputSchema = {
	query: z.string().min(1, "query must not be empty"),
	maxResults: z.number().int().positive().max(50).optional(),
	contentTypeFilter: z.enum(CONTENT_TYPES).optional(),
	recencyBias: z.boolean().optional(),
	sourceWeighted: z.boolean().optional(),
} as const;

const argsSchema = z.object(inputSchema);
export type SearchArgs = z.infer<typeof argsSchema>;

export function handler(
	rawArgs: SearchArgs,
	ctx: ServerContext,
): CallToolResult {
	const args = argsSchema.parse(rawArgs);
	ctx.counters.searchCalls += 1;

	const results = ctx.contentIndex.search(args.query, {
		...(args.maxResults !== undefined ? { maxResults: args.maxResults } : {}),
		...(args.contentTypeFilter !== undefined ? { contentTypeFilter: args.contentTypeFilter } : {}),
		...(args.recencyBias !== undefined ? { recencyBias: args.recencyBias } : {}),
		...(args.sourceWeighted !== undefined ? { sourceWeighted: args.sourceWeighted } : {}),
	});

	ctx.counters.searchResultsReturned += results.length;

	return jsonResult({
		query: args.query,
		resultCount: results.length,
		results: results.map((r) => ({
			sourceId: r.sourceId,
			sourceLabel: r.sourceLabel,
			title: r.title,
			snippet: r.snippet,
			contentType: r.contentType,
			score: r.score,
		})),
		capabilities: {
			fts5: ctx.contentIndex.capabilities.fts5,
			trigramTokenizer: ctx.contentIndex.capabilities.trigramTokenizer,
		},
	});
}
