import type { PlatformCapabilities } from "@aegisctx/adapters";
import { describe, expect, it } from "vitest";
import {
	ADVERTISED_TOOLS,
	buildSessionStartCapabilities,
	FALLBACK_GENERIC_CAPABILITIES,
} from "./capabilities.js";

describe("buildSessionStartCapabilities", () => {
	it("advertises all six M1.2 tools in a stable order", () => {
		const names = ADVERTISED_TOOLS.map((t) => t.name);
		expect(names).toEqual([
			"aegisctx_execute",
			"aegisctx_index",
			"aegisctx_search",
			"aegisctx_fetch",
			"aegisctx_stats",
			"aegisctx_doctor",
		]);
	});

	it("derives hookEnforcement='mcp-only' when no platform is detected", () => {
		const caps = buildSessionStartCapabilities(undefined);
		expect(caps.platform.name).toBe(FALLBACK_GENERIC_CAPABILITIES.platform);
		expect(caps.platform.tierLabel).toBe("3");
		expect(caps.platform.hookEnforcement).toBe("mcp-only");
		expect(caps.tools).toEqual(ADVERTISED_TOOLS);
	});

	it("derives 'full' for tier 1, 'partial' for 1.5/2, 'mcp-only' for 3", () => {
		const base: PlatformCapabilities = {
			platform: "x",
			tier: 1,
			tierLabel: "1",
			supportedHooks: [],
			hasSessionStart: false,
			hasPreCompact: false,
			configDir: "",
			sessionDir: "",
		};
		expect(buildSessionStartCapabilities(base).platform.hookEnforcement).toBe("full");
		expect(
			buildSessionStartCapabilities({ ...base, tier: 1.5, tierLabel: "1L" }).platform
				.hookEnforcement,
		).toBe("partial");
		expect(
			buildSessionStartCapabilities({ ...base, tier: 2, tierLabel: "2" }).platform
				.hookEnforcement,
		).toBe("partial");
		expect(
			buildSessionStartCapabilities({ ...base, tier: 3, tierLabel: "3" }).platform
				.hookEnforcement,
		).toBe("mcp-only");
	});

	it("passes through interceptedTools when an adapter reports them", () => {
		const caps: PlatformCapabilities = {
			platform: "codex",
			tier: 1.5,
			tierLabel: "1L",
			supportedHooks: ["PreToolUse", "PostToolUse"],
			hasSessionStart: true,
			hasPreCompact: false,
			configDir: "",
			sessionDir: "",
			interceptedTools: ["Bash"],
		};
		const built = buildSessionStartCapabilities(caps);
		expect(built.platform.interceptedTools).toEqual(["Bash"]);
	});
});
