/**
 * @aegis/server — MCP server package.
 *
 * Tool registration, transport, hook orchestration, and lifecycle.
 * Depends on all other packages: core, engine, storage, adapters.
 */

export {
	ADVERTISED_TOOLS,
	buildSessionStartCapabilities,
	FALLBACK_GENERIC_CAPABILITIES,
	type SessionStartCapabilities,
	type ToolAdvertisement,
} from "./capabilities.js";
export { HOOK_TYPES, type HookType } from "./hooks/orchestrator.js";
export {
	createServerCounters,
	type FetchLike,
	type FetchResponse,
	type ServerContext,
	type ServerCounters,
} from "./runtime/index.js";
export { createServer, run, SERVER_NAME, SERVER_VERSION, startServer } from "./server.js";
