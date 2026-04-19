/**
 * aegisctx_doctor — Diagnostics tool.
 *
 * Reports which runtimes were detected on the host, whether FTS5 and
 * the trigram tokenizer are available on the active SQLite backend,
 * and what platform tier the adapter advertised. Cheap to call —
 * runtime detection is cached after the first invocation.
 */

import { LANGUAGES } from "@aegisctx/core";
import { cachedDetectRuntime } from "@aegisctx/engine";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ServerContext } from "../runtime/context.js";
import { SERVER_NAME, SERVER_VERSION } from "../server-info.js";
import { jsonResult } from "./helpers.js";

export const TOOL_NAME = "aegisctx_doctor" as const;

export const TOOL_DESCRIPTION = "Run diagnostics: check platform detection, available runtimes, "
	+ "storage health, policy validity, and hook registration.";

export const inputSchema = {} as const;

const argsSchema = z.object(inputSchema);
export type DoctorArgs = z.infer<typeof argsSchema>;

export function handler(
	rawArgs: DoctorArgs,
	ctx: ServerContext,
): CallToolResult {
	argsSchema.parse(rawArgs);
	ctx.counters.doctorCalls += 1;

	const runtimes = LANGUAGES.map((lang) => {
		const runtime = cachedDetectRuntime(lang);
		return runtime.available
			? {
				language: lang,
				available: true,
				binary: runtime.binary,
				path: runtime.path,
				version: runtime.version,
			}
			: { language: lang, available: false };
	});

	const availableCount = runtimes.filter((r) => r.available).length;

	return jsonResult({
		server: { name: SERVER_NAME, version: SERVER_VERSION },
		nodeVersion: process.versions.node,
		platformOs: process.platform,
		platform: ctx.platform === undefined ? null : {
			name: ctx.platform.platform,
			tier: ctx.platform.tier,
			tierLabel: ctx.platform.tierLabel,
			supportedHooks: ctx.platform.supportedHooks,
			hasSessionStart: ctx.platform.hasSessionStart,
			hasPreCompact: ctx.platform.hasPreCompact,
			interceptedTools: ctx.platform.interceptedTools ?? null,
		},
		storage: {
			fts5: ctx.contentIndex.capabilities.fts5,
			trigramTokenizer: ctx.contentIndex.capabilities.trigramTokenizer,
		},
		runtimes: {
			total: LANGUAGES.length,
			available: availableCount,
			missing: LANGUAGES.length - availableCount,
			detail: runtimes,
		},
	});
}
