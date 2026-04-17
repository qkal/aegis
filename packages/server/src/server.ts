/**
 * MCP server setup and lifecycle.
 *
 * This file must stay under 200 lines (see MILESTONES.md §M1.2). All
 * business logic lives in tool modules + the runtime context; this
 * file only wires them together:
 *
 *  - creates the MCP server
 *  - registers the six Aegis tools
 *  - connects the stdio transport
 *  - installs graceful shutdown handlers
 *
 * Identity (name, version) lives in `./server-info.ts` so tool modules
 * can import it without pulling in the MCP SDK.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { buildSessionStartCapabilities } from "./capabilities.js";
import type { ServerContext } from "./runtime/context.js";
import { SERVER_NAME, SERVER_VERSION } from "./server-info.js";
import * as doctor from "./tools/doctor.js";
import * as execute from "./tools/execute.js";
import * as fetchTool from "./tools/fetch.js";
import * as indexTool from "./tools/index-content.js";
import * as search from "./tools/search.js";
import * as stats from "./tools/stats.js";

export { SERVER_NAME, SERVER_VERSION } from "./server-info.js";

/**
 * Create an `McpServer` with every Aegis tool wired to the supplied
 * context. The server is returned unconnected so callers can attach
 * whatever transport they want (stdio in production, in-memory pairs
 * in tests).
 */
export function createServer(ctx: ServerContext): McpServer {
	const caps = buildSessionStartCapabilities(ctx.platform);
	const server = new McpServer(
		{ name: SERVER_NAME, version: SERVER_VERSION },
		{
			capabilities: { tools: {} },
			// Advertised in `serverInfo.instructions`; MCP clients render
			// this verbatim to the agent, giving it a one-shot summary of
			// tier, hook enforcement, and tool surface.
			instructions: renderInstructions(caps),
		},
	);

	server.registerTool(
		execute.TOOL_NAME,
		{ description: execute.TOOL_DESCRIPTION, inputSchema: execute.inputSchema },
		(args) => execute.handler(args, ctx),
	);
	server.registerTool(
		indexTool.TOOL_NAME,
		{ description: indexTool.TOOL_DESCRIPTION, inputSchema: indexTool.inputSchema },
		(args) => indexTool.handler(args, ctx),
	);
	server.registerTool(
		search.TOOL_NAME,
		{ description: search.TOOL_DESCRIPTION, inputSchema: search.inputSchema },
		(args) => search.handler(args, ctx),
	);
	server.registerTool(
		fetchTool.TOOL_NAME,
		{ description: fetchTool.TOOL_DESCRIPTION, inputSchema: fetchTool.inputSchema },
		(args) => fetchTool.handler(args, ctx),
	);
	server.registerTool(
		stats.TOOL_NAME,
		{ description: stats.TOOL_DESCRIPTION, inputSchema: stats.inputSchema },
		(args) => stats.handler(args, ctx),
	);
	server.registerTool(
		doctor.TOOL_NAME,
		{ description: doctor.TOOL_DESCRIPTION, inputSchema: doctor.inputSchema },
		(args) => doctor.handler(args, ctx),
	);

	return server;
}

/**
 * Handle wiring a single server instance to a single transport. Lives
 * as a separate function (rather than inlined in `run`) so tests can
 * drive it with an in-memory transport pair.
 */
export async function startServer(
	server: McpServer,
	transport: Transport,
): Promise<void> {
	await server.connect(transport);
}

/** Options accepted by {@link run}. Primarily for test injection. */
export interface RunOptions {
	readonly transport?: Transport;
	readonly signals?: readonly NodeJS.Signals[];
	readonly onShutdown?: () => Promise<void> | void;
}

/**
 * Entry point for `npx aegis serve` / the package `bin` script.
 *
 * Wires up stdio, registers SIGINT/SIGTERM handlers, and resolves
 * when shutdown is complete. Any failure inside a handler is logged
 * to stderr — stdout belongs to the JSON-RPC transport and must not
 * be contaminated.
 */
export async function run(ctx: ServerContext, options: RunOptions = {}): Promise<void> {
	const server = createServer(ctx);
	const transport = options.transport ?? new StdioServerTransport();
	const signals = options.signals ?? (["SIGINT", "SIGTERM"] as const);

	const shutdown = createShutdown(server, options.onShutdown);
	const detach = attachSignalHandlers(signals, shutdown);
	try {
		await startServer(server, transport);
		await waitForClose(server);
	} finally {
		detach();
	}
}

/**
 * Human-readable summary rendered into the MCP `instructions` field.
 * Kept terse — agents see this on every session start.
 */
function renderInstructions(caps: ReturnType<typeof buildSessionStartCapabilities>): string {
	const lines = [
		`Aegis ${caps.server.version} — local-first context engine.`,
		`Platform: ${caps.platform.name} (tier ${caps.platform.tierLabel}, ${caps.platform.hookEnforcement} enforcement).`,
		`Tools: ${caps.tools.map((t) => t.name).join(", ")}.`,
	];
	if (caps.platform.interceptedTools !== null) {
		lines.push(`Intercepted tools: ${caps.platform.interceptedTools.join(", ") || "(none)"}.`);
	}
	return lines.join("\n");
}

function createShutdown(
	server: McpServer,
	onShutdown: RunOptions["onShutdown"],
): () => Promise<void> {
	let running: Promise<void> | undefined;
	return () => {
		if (running !== undefined) return running;
		running = (async () => {
			try {
				await server.close();
			} catch (err) {
				process.stderr.write(`aegis: server.close failed: ${(err as Error).message}\n`);
			}
			if (onShutdown !== undefined) {
				try {
					await onShutdown();
				} catch (err) {
					process.stderr.write(`aegis: shutdown hook failed: ${(err as Error).message}\n`);
				}
			}
		})();
		return running;
	};
}

function attachSignalHandlers(
	signals: readonly NodeJS.Signals[],
	shutdown: () => Promise<void>,
): () => void {
	const handler = (): void => {
		void shutdown();
	};
	for (const sig of signals) process.on(sig, handler);
	return () => {
		for (const sig of signals) process.off(sig, handler);
	};
}

function waitForClose(server: McpServer): Promise<void> {
	return new Promise<void>((resolve) => {
		const previous = server.server.onclose;
		server.server.onclose = (): void => {
			previous?.();
			resolve();
		};
	});
}
