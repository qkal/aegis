/**
 * Tool call routing decisions.
 *
 * The router decides how to handle each normalized tool call:
 * - sandbox: route to the execution engine for sandboxed execution
 * - search: route to the storage layer for content retrieval
 * - index: route to the storage layer for content indexing
 * - passthrough: return directly to the agent
 * - deny: block the tool call per policy
 */

/** Discriminated union for routing decisions. */
export type RoutingDecision =
	| { readonly route: "sandbox"; readonly language: string; }
	| { readonly route: "search"; }
	| { readonly route: "index"; }
	| { readonly route: "fetch"; }
	| { readonly route: "stats"; }
	| { readonly route: "doctor"; }
	| { readonly route: "audit"; }
	| { readonly route: "passthrough"; }
	| { readonly route: "deny"; readonly reason: string; };

/** MCP tool names recognized by Aegis. */
export type AegisTool =
	| "aegis_execute"
	| "aegis_execute_file"
	| "aegis_batch"
	| "aegis_index"
	| "aegis_search"
	| "aegis_fetch"
	| "aegis_stats"
	| "aegis_doctor"
	| "aegis_audit";

/** Map tool names to their routing decisions. */
export function routeTool(tool: AegisTool): RoutingDecision {
	switch (tool) {
		case "aegis_execute":
		case "aegis_execute_file":
		case "aegis_batch":
			return { route: "sandbox", language: "auto" };
		case "aegis_search":
			return { route: "search" };
		case "aegis_index":
			return { route: "index" };
		case "aegis_fetch":
			return { route: "fetch" };
		case "aegis_stats":
			return { route: "stats" };
		case "aegis_doctor":
			return { route: "doctor" };
		case "aegis_audit":
			return { route: "audit" };
	}
}
