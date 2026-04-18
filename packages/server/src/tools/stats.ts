/**
 * aegisctx_stats — Session statistics tool.
 *
 * Reads per-process counters plus index-level totals and returns a
 * single snapshot. Counters come from `ServerContext.counters`, which
 * is mutated by every tool handler as its side effect.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ServerContext } from "../runtime/context.js";
import { SERVER_NAME, SERVER_VERSION } from "../server-info.js";
import { jsonResult } from "./helpers.js";

export const TOOL_NAME = "aegisctx_stats" as const;

export const TOOL_DESCRIPTION = "Show session statistics: context bytes saved, tool call counts, "
	+ "cache hit rates, and sandbox execution metrics.";

export const inputSchema = {} as const;

const argsSchema = z.object(inputSchema);
export type StatsArgs = z.infer<typeof argsSchema>;

export function handler(
	rawArgs: StatsArgs,
	ctx: ServerContext,
): CallToolResult {
	argsSchema.parse(rawArgs);

	const now = ctx.now();
	const uptimeMs = Math.max(0, now.getTime() - ctx.startedAt);
	const sources = ctx.contentIndex.listSources();
	const totalChunks = sources.reduce((acc, s) => acc + s.totalChunks, 0);
	const codeChunks = sources.reduce((acc, s) => acc + s.codeChunks, 0);

	return jsonResult({
		server: { name: SERVER_NAME, version: SERVER_VERSION },
		uptimeMs,
		startedAt: new Date(ctx.startedAt).toISOString(),
		counters: { ...ctx.counters },
		index: {
			sourceCount: sources.length,
			totalChunks,
			codeChunks,
			proseChunks: totalChunks - codeChunks,
			fts5: ctx.contentIndex.capabilities.fts5,
			trigramTokenizer: ctx.contentIndex.capabilities.trigramTokenizer,
		},
		platform: ctx.platform === undefined ? null : {
			name: ctx.platform.platform,
			tier: ctx.platform.tier,
			tierLabel: ctx.platform.tierLabel,
		},
	});
}
