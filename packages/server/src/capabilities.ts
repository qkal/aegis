/**
 * Session-start capability advertisement.
 *
 * When an agent connects to the Aegis MCP server we want to tell it —
 * up-front — which tier the active platform falls into, which hooks
 * the platform supports, and which tools Aegis exposes. Clients use
 * this to decide whether hook-based enforcement is available or
 * whether to fall back to MCP-only enforcement (see ADR-0007 / PLAN).
 *
 * Keeping the payload shape in one module means adapters, the server,
 * and tests all read the same contract.
 */

import type { PlatformCapabilities } from "@aegis/adapters";
import { SERVER_NAME, SERVER_VERSION } from "./server-info.js";
import { TOOL_DESCRIPTION as DOCTOR_DESC, TOOL_NAME as DOCTOR_NAME } from "./tools/doctor.js";
import { TOOL_DESCRIPTION as EXECUTE_DESC, TOOL_NAME as EXECUTE_NAME } from "./tools/execute.js";
import { TOOL_DESCRIPTION as FETCH_DESC, TOOL_NAME as FETCH_NAME } from "./tools/fetch.js";
import { TOOL_DESCRIPTION as INDEX_DESC, TOOL_NAME as INDEX_NAME } from "./tools/index-content.js";
import { TOOL_DESCRIPTION as SEARCH_DESC, TOOL_NAME as SEARCH_NAME } from "./tools/search.js";
import { TOOL_DESCRIPTION as STATS_DESC, TOOL_NAME as STATS_NAME } from "./tools/stats.js";

/** Tool directory exposed at session start. Name + description only — the full schema travels over MCP. */
export interface ToolAdvertisement {
	readonly name: string;
	readonly description: string;
}

/** Full payload returned to the agent when the session starts. */
export interface SessionStartCapabilities {
	readonly server: { readonly name: string; readonly version: string; };
	readonly platform: {
		readonly name: string;
		readonly tier: 1 | 1.5 | 2 | 3;
		readonly tierLabel: "1" | "1L" | "2" | "3";
		readonly supportedHooks: readonly string[];
		readonly hasSessionStart: boolean;
		readonly hasPreCompact: boolean;
		readonly interceptedTools: readonly string[] | null;
		readonly hookEnforcement: "full" | "partial" | "mcp-only";
	};
	readonly tools: readonly ToolAdvertisement[];
}

/** Static list of tools the server registers. Kept next to `capabilities` so session-start cannot drift from `registerTool` calls. */
export const ADVERTISED_TOOLS: readonly ToolAdvertisement[] = [
	{ name: EXECUTE_NAME, description: EXECUTE_DESC },
	{ name: INDEX_NAME, description: INDEX_DESC },
	{ name: SEARCH_NAME, description: SEARCH_DESC },
	{ name: FETCH_NAME, description: FETCH_DESC },
	{ name: STATS_NAME, description: STATS_DESC },
	{ name: DOCTOR_NAME, description: DOCTOR_DESC },
] as const;

/**
 * Fallback capabilities when no adapter has been detected. Treat
 * every client as a Tier-3 MCP-only consumer: safe default, never
 * promises hooks we cannot fulfil.
 */
export const FALLBACK_GENERIC_CAPABILITIES: PlatformCapabilities = {
	platform: "generic",
	tier: 3,
	tierLabel: "3",
	supportedHooks: [],
	hasSessionStart: false,
	hasPreCompact: false,
	configDir: "",
	sessionDir: "",
};

/**
 * Build the session-start payload. Derives a coarse `hookEnforcement`
 * label from the tier so consumers don't need to re-implement the
 * tier→enforcement mapping:
 *  - tier 1            → "full"
 *  - tier 1.5 / 2      → "partial"
 *  - tier 3 (or missing) → "mcp-only"
 */
export function buildSessionStartCapabilities(
	platform: PlatformCapabilities | undefined,
): SessionStartCapabilities {
	const effective = platform ?? FALLBACK_GENERIC_CAPABILITIES;
	return {
		server: { name: SERVER_NAME, version: SERVER_VERSION },
		platform: {
			name: effective.platform,
			tier: effective.tier,
			tierLabel: effective.tierLabel,
			supportedHooks: effective.supportedHooks,
			hasSessionStart: effective.hasSessionStart,
			hasPreCompact: effective.hasPreCompact,
			interceptedTools: effective.interceptedTools ?? null,
			hookEnforcement: deriveEnforcement(effective.tier),
		},
		tools: ADVERTISED_TOOLS,
	};
}

function deriveEnforcement(tier: PlatformCapabilities["tier"]): "full" | "partial" | "mcp-only" {
	if (tier === 1) return "full";
	if (tier === 1.5 || tier === 2) return "partial";
	return "mcp-only";
}
