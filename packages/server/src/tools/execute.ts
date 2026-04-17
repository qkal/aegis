/**
 * aegis_execute — Sandboxed code execution tool.
 *
 * Runs a snippet in an isolated child process via
 * `PolyglotExecutor` and returns stdout/stderr plus exit metadata.
 * The executor is responsible for env isolation, timeout enforcement,
 * and output truncation; this module just validates input and maps the
 * engine's `ExecOutcome` to an MCP tool result.
 */

import { type Language, LANGUAGES } from "@aegis/core";
import type { ExecOutcome } from "@aegis/engine";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ServerContext } from "../runtime/context.js";
import { errorResult, jsonResult } from "./helpers.js";

export const TOOL_NAME = "aegis_execute" as const;

export const TOOL_DESCRIPTION = `Execute code in a sandboxed environment. Returns stdout only. `
	+ `Supports: ${LANGUAGES.join(", ")}.`;

/** Upper bounds defended in-handler even when the caller omits a value. */
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

/**
 * Zod raw-shape for the MCP SDK's `registerTool` inputSchema. We keep
 * the shape flat (no nested `z.object`) because the SDK reads it as a
 * `ZodRawShape` and wraps it internally.
 */
export const inputSchema = {
	code: z.string().min(1, "code must not be empty"),
	language: z.enum(LANGUAGES as readonly [Language, ...Language[]]),
	timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
	maxOutputBytes: z.number().int().positive().max(MAX_MAX_OUTPUT_BYTES).optional(),
	/** Ignored in Phase 1 (network is always denied); kept so client UIs can show the toggle. */
	allowNetwork: z.boolean().optional(),
	workingDir: z.string().optional(),
} as const;

const argsSchema = z.object(inputSchema);
export type ExecuteArgs = z.infer<typeof argsSchema>;

export async function handler(
	rawArgs: ExecuteArgs,
	ctx: ServerContext,
): Promise<CallToolResult> {
	const args = argsSchema.parse(rawArgs);
	ctx.counters.executeCalls += 1;

	const outcome = await ctx.executor.execute({
		code: args.code,
		language: args.language,
		timeoutMs: args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		maxOutputBytes: args.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
		// Phase 1 ships with env isolation only — no inherited secrets,
		// no parent PATH; the sandbox policy work in M1.5 refines this.
		env: { PATH: process.env["PATH"] ?? "" },
		allowNetwork: false,
		...(args.workingDir !== undefined ? { workingDir: args.workingDir } : {}),
	});

	// Track how many bytes we *avoided* returning to the caller. The
	// conservative definition: total stdout+stderr produced by the
	// child, capped at maxOutputBytes by BoundedSink. Callers get the
	// same data, but the savings metric is still interesting when
	// callers pipe into `aegis_search` / `aegis_index` instead.
	const byteSavings = stdoutBytes(outcome);

	switch (outcome.status) {
		case "success":
			ctx.counters.executeSuccesses += 1;
			ctx.counters.executeBytesSaved += byteSavings;
			return jsonResult({
				status: outcome.status,
				stdout: outcome.stdout,
				stderr: outcome.stderr,
				exitCode: outcome.exitCode,
				durationMs: outcome.durationMs,
			});
		case "failure":
			ctx.counters.executeFailures += 1;
			ctx.counters.executeBytesSaved += byteSavings;
			return jsonResult({
				status: outcome.status,
				stdout: outcome.stdout,
				stderr: outcome.stderr,
				exitCode: outcome.exitCode,
				durationMs: outcome.durationMs,
			});
		case "timeout":
			ctx.counters.executeTimeouts += 1;
			return jsonResult({
				status: outcome.status,
				stdout: outcome.stdout,
				stderr: outcome.stderr,
				durationMs: outcome.durationMs,
			});
		case "denied":
			ctx.counters.executeErrors += 1;
			return errorResult(`execution denied: ${outcome.reason}`, {
				code: "denied",
				reason: outcome.reason,
				matchedRule: outcome.matchedRule,
			});
		case "error":
			ctx.counters.executeErrors += 1;
			return errorResult(outcome.error, { code: "error" });
		default: {
			// Exhaustiveness guard — compiler-verified, runtime-visible.
			const _exhaustive: never = outcome;
			return errorResult(
				`unknown execution outcome: ${String((_exhaustive as { status?: string; }).status)}`,
				{ code: "internal" },
			);
		}
	}
}

function stdoutBytes(outcome: ExecOutcome): number {
	if (
		outcome.status === "success" || outcome.status === "failure" || outcome.status === "timeout"
	) {
		return Buffer.byteLength(outcome.stdout, "utf8") + Buffer.byteLength(outcome.stderr, "utf8");
	}
	return 0;
}
