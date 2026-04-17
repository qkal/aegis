import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerContext } from "../runtime/context.js";
import { buildTestContext } from "../runtime/test-utils.js";
import { handler, TOOL_NAME } from "./index-content.js";

function parseBody(result: CallToolResult): Record<string, unknown> {
	const block = result.content[0];
	if (!block || block.type !== "text") throw new Error("expected text content");
	return JSON.parse(block.text) as Record<string, unknown>;
}

let ctx: ServerContext;
let close: () => void;

beforeEach(async () => {
	const built = await buildTestContext();
	ctx = built.ctx;
	close = built.close;
});
afterEach(() => close?.());

describe("aegis_index handler", () => {
	it("uses the canonical tool name", () => {
		expect(TOOL_NAME).toBe("aegis_index");
	});

	it("indexes prose content and reports the chunk metadata", () => {
		const result = handler(
			{
				content: "The quick brown fox jumps over the lazy dog.".repeat(10),
				label: "fox.md",
				sourceType: "manual",
			},
			ctx,
		);
		const body = parseBody(result);
		expect(body["reused"]).toBe(false);
		expect(Number(body["chunkCount"])).toBeGreaterThanOrEqual(1);
		expect(ctx.counters.indexCalls).toBe(1);
		expect(ctx.counters.indexChunksAdded).toBe(body["chunkCount"]);
	});

	it("recognizes re-indexing the same body as a dedup hit", () => {
		const args = {
			content: "Same body.",
			label: "dupe.md",
			sourceType: "manual" as const,
		};
		handler(args, ctx);
		const second = parseBody(handler(args, ctx));
		expect(second["reused"]).toBe(true);
		expect(ctx.counters.indexSourcesReused).toBe(1);
	});

	it("rejects oversized content", () => {
		const hugeButInvalid = "x".repeat(1);
		expect(() =>
			handler(
				{
					content: hugeButInvalid,
					label: "", // empty label violates min(1)
					sourceType: "manual",
				},
				ctx,
			)
		).toThrow(/label must not be empty/);
	});
});
