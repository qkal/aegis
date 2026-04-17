import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerContext } from "../runtime/context.js";
import { buildTestContext } from "../runtime/test-utils.js";
import { handler as indexHandler } from "./index-content.js";
import { handler, TOOL_NAME } from "./search.js";

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

describe("aegis_search handler", () => {
	it("uses the canonical tool name", () => {
		expect(TOOL_NAME).toBe("aegis_search");
	});

	it("returns results from indexed content and updates counters", () => {
		indexHandler(
			{
				content: "Authentication verifies a user's identity using credentials.",
				label: "auth.md",
				sourceType: "manual",
			},
			ctx,
		);

		const result = handler({ query: "authentication" }, ctx);
		const body = parseBody(result);
		expect(Array.isArray(body["results"])).toBe(true);
		expect(Number(body["resultCount"])).toBeGreaterThanOrEqual(1);
		expect(ctx.counters.searchCalls).toBe(1);
		expect(ctx.counters.searchResultsReturned).toBeGreaterThanOrEqual(1);
	});

	it("returns zero results for unrelated queries", () => {
		const result = handler({ query: "nothing-matches-this-query" }, ctx);
		const body = parseBody(result);
		expect(body["resultCount"]).toBe(0);
	});

	it("rejects empty queries at the schema boundary", () => {
		expect(() => handler({ query: "" }, ctx)).toThrow(/query must not be empty/);
	});
});
