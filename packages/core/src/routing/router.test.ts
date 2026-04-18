/**
 * Unit tests for the tool call router.
 */
import { describe, expect, it } from "vitest";
import { type AegisTool, routeTool } from "./router.js";

describe("routeTool", () => {
	it("routes execution tools to the sandbox", () => {
		const execTools: AegisTool[] = ["aegisctx_execute", "aegisctx_execute_file", "aegisctx_batch"];
		for (const tool of execTools) {
			expect(routeTool(tool)).toEqual({ route: "sandbox", language: "auto" });
		}
	});

	it("routes search, index, fetch, stats, doctor, audit to their own routes", () => {
		expect(routeTool("aegisctx_search").route).toBe("search");
		expect(routeTool("aegisctx_index").route).toBe("index");
		expect(routeTool("aegisctx_fetch").route).toBe("fetch");
		expect(routeTool("aegisctx_stats").route).toBe("stats");
		expect(routeTool("aegisctx_doctor").route).toBe("doctor");
		expect(routeTool("aegisctx_audit").route).toBe("audit");
	});
});
