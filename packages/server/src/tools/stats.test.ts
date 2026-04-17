import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerContext } from "../runtime/context.js";
import { buildTestContext, StubExecutor } from "../runtime/test-utils.js";
import { handler as executeHandler } from "./execute.js";
import { handler as indexHandler } from "./index-content.js";
import { handler, TOOL_NAME } from "./stats.js";

function parseBody(result: CallToolResult): Record<string, unknown> {
	const block = result.content[0];
	if (!block || block.type !== "text") throw new Error("expected text content");
	return JSON.parse(block.text) as Record<string, unknown>;
}

let ctx: ServerContext;
let close: () => void;

beforeEach(async () => {
	const start = new Date("2025-01-01T00:00:00.000Z").getTime();
	let nowMs = start;
	const built = await buildTestContext({
		executor: new StubExecutor([{
			status: "success",
			stdout: "out",
			stderr: "",
			exitCode: 0,
			durationMs: 1,
		}]).asPolyglot(),
		now: () => new Date(nowMs += 1_000),
		startedAt: start,
	});
	ctx = built.ctx;
	close = built.close;
});
afterEach(() => close?.());

describe("aegis_stats handler", () => {
	it("uses the canonical tool name", () => {
		expect(TOOL_NAME).toBe("aegis_stats");
	});

	it("reports counters and index totals after a few tool invocations", async () => {
		await executeHandler({ code: "echo hi", language: "shell" }, ctx);
		indexHandler(
			{ content: "A short document.", label: "doc.md", sourceType: "manual" },
			ctx,
		);

		const body = parseBody(handler({}, ctx));
		expect(body["server"]).toMatchObject({ name: "aegis" });
		expect(Number(body["uptimeMs"])).toBeGreaterThan(0);
		const counters = body["counters"] as Record<string, number>;
		expect(counters["executeCalls"]).toBe(1);
		expect(counters["indexCalls"]).toBe(1);
		const index = body["index"] as Record<string, number | boolean>;
		expect(Number(index["sourceCount"])).toBe(1);
	});
});
