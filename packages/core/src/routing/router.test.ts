/**
 * Unit tests for the tool call router.
 */
import { describe, expect, it } from "vitest";
import { type AegisTool, routeTool } from "./router.js";

describe("routeTool", () => {
	it("routes execution tools to the sandbox", () => {
		const execTools: AegisTool[] = ["aegis_execute", "aegis_execute_file", "aegis_batch"];
		for (const tool of execTools) {
			const decision = routeTool(tool);
			expect(decision.route).toBe("sandbox");
			if (decision.route === "sandbox") {
				expect(decision.language).toBe("auto");
			}
		}
	});

	it("routes search, index, fetch, stats, doctor, audit to their own routes", () => {
		expect(routeTool("aegis_search").route).toBe("search");
		expect(routeTool("aegis_index").route).toBe("index");
		expect(routeTool("aegis_fetch").route).toBe("fetch");
		expect(routeTool("aegis_stats").route).toBe("stats");
		expect(routeTool("aegis_doctor").route).toBe("doctor");
		expect(routeTool("aegis_audit").route).toBe("audit");
	});
});
