import { LANGUAGES } from "@aegisctx/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerContext } from "../runtime/context.js";
import { buildTestContext } from "../runtime/test-utils.js";
import { handler, TOOL_NAME } from "./doctor.js";

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

describe("aegisctx_doctor handler", () => {
	it("uses the canonical tool name", () => {
		expect(TOOL_NAME).toBe("aegisctx_doctor");
	});

	it("reports one entry per known language and a total count that matches LANGUAGES", () => {
		const body = parseBody(handler({}, ctx));
		const runtimes = body["runtimes"] as Record<string, unknown>;
		expect(runtimes["total"]).toBe(LANGUAGES.length);
		const detail = runtimes["detail"] as { readonly language: string; }[];
		expect(detail.map((d) => d.language).sort()).toEqual([...LANGUAGES].sort());
		expect(ctx.counters.doctorCalls).toBe(1);
	});

	it("reports platform: null when no adapter was detected", () => {
		const body = parseBody(handler({}, ctx));
		expect(body["platform"]).toBeNull();
	});
});
