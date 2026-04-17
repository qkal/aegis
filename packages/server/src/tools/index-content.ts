/**
 * aegis_index — Content indexing tool.
 *
 * Wraps `ContentIndex.index()`. Chunking, deduplication, and FTS5
 * population all happen inside the storage package; this handler just
 * validates input and maps the result to an MCP response.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ServerContext } from "../runtime/context.js";
import { errorResult, jsonResult } from "./helpers.js";

export const TOOL_NAME = "aegis_index" as const;

export const TOOL_DESCRIPTION = "Index markdown or text content into the local knowledge base. "
	+ "Content is chunked, deduplicated, and searchable via aegis_search.";

const SOURCE_TYPES = ["file", "url", "session-events", "manual"] as const;

const MAX_CONTENT_BYTES = 16 * 1024 * 1024; // 16 MiB hard ceiling.

export const inputSchema = {
	content: z.string().min(1, "content must not be empty"),
	label: z.string().min(1, "label must not be empty").max(512),
	sourceType: z.enum(SOURCE_TYPES).optional(),
	expiresAt: z.string().datetime().optional(),
	maxChunkBytes: z.number().int().positive().optional(),
} as const;

const argsSchema = z.object(inputSchema);
export type IndexArgs = z.infer<typeof argsSchema>;

export function handler(
	rawArgs: IndexArgs,
	ctx: ServerContext,
): CallToolResult {
	const args = argsSchema.parse(rawArgs);
	if (Buffer.byteLength(args.content, "utf8") > MAX_CONTENT_BYTES) {
		return errorResult(`content exceeds max indexable size of ${MAX_CONTENT_BYTES} bytes`, {
			code: "too_large",
			maxBytes: MAX_CONTENT_BYTES,
		});
	}

	ctx.counters.indexCalls += 1;
	const result = ctx.contentIndex.index(args.content, {
		label: args.label,
		sourceType: args.sourceType ?? "manual",
		...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
		...(args.maxChunkBytes !== undefined ? { maxChunkBytes: args.maxChunkBytes } : {}),
	});

	if (result.reused) {
		ctx.counters.indexSourcesReused += 1;
	} else {
		ctx.counters.indexChunksAdded += result.chunkCount;
	}

	return jsonResult({
		sourceId: result.sourceId,
		chunkCount: result.chunkCount,
		codeChunkCount: result.codeChunkCount,
		contentHash: result.contentHash,
		reused: result.reused,
	});
}
