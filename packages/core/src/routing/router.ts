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
	| "aegisctx_execute"
	| "aegisctx_execute_file"
	| "aegisctx_batch"
	| "aegisctx_index"
	| "aegisctx_search"
	| "aegisctx_fetch"
	| "aegisctx_stats"
	| "aegisctx_doctor"
	| "aegisctx_audit";

/** Map tool names to their routing decisions. */
export function routeTool(tool: AegisTool): RoutingDecision {
	switch (tool) {
		case "aegisctx_execute":
		case "aegisctx_execute_file":
		case "aegisctx_batch":
			return { route: "sandbox", language: "auto" };
		case "aegisctx_search":
			return { route: "search" };
		case "aegisctx_index":
			return { route: "index" };
		case "aegisctx_fetch":
			return { route: "fetch" };
		case "aegisctx_stats":
			return { route: "stats" };
		case "aegisctx_doctor":
			return { route: "doctor" };
		case "aegisctx_audit":
			return { route: "audit" };
	}
}
