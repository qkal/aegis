import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADVERTISED_TOOLS } from "./capabilities.js";
import type { ServerContext } from "./runtime/context.js";
import { buildTestContext, StubExecutor } from "./runtime/test-utils.js";
import { createServer, SERVER_NAME, SERVER_VERSION, startServer } from "./server.js";

let ctx: ServerContext;
let close: () => void;
let client: Client;

beforeEach(async () => {
	const built = await buildTestContext({
		executor: new StubExecutor([{
			status: "success",
			stdout: "hi",
			stderr: "",
			exitCode: 0,
			durationMs: 3,
		}]).asPolyglot(),
	});
	ctx = built.ctx;
	close = built.close;

	const server = createServer(ctx);
	const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
	await startServer(server, serverTransport);

	client = new Client({ name: "aegis-test-client", version: "0.0.0" });
	await client.connect(clientTransport);
});

afterEach(async () => {
	await client.close();
	close();
});

describe("MCP server wiring", () => {
	it("advertises the expected server identity", () => {
		const info = client.getServerVersion();
		expect(info?.name).toBe(SERVER_NAME);
		expect(info?.version).toBe(SERVER_VERSION);
	});

	it("lists all six Aegis tools", async () => {
		const listed = await client.listTools();
		const names = listed.tools.map((t) => t.name).sort();
		expect(names).toEqual(ADVERTISED_TOOLS.map((t) => t.name).sort());
	});

	it("round-trips aegis_execute through the stdio-equivalent JSON-RPC transport", async () => {
		const result = await client.callTool({
			name: "aegis_execute",
			arguments: { code: "echo hi", language: "shell" },
		});
		expect(result.isError).toBeFalsy();
		const content = result.content as readonly { type: string; text: string; }[];
		const body = JSON.parse(content[0]!.text) as Record<string, unknown>;
		expect(body["status"]).toBe("success");
		expect(body["stdout"]).toBe("hi");
		expect(ctx.counters.executeCalls).toBe(1);
	});

	it("surfaces schema violations as MCP errors rather than silently invoking handlers", async () => {
		await expect(
			client.callTool({
				name: "aegis_execute",
				arguments: { code: "", language: "javascript" },
			}),
		).resolves.toMatchObject({ isError: true });
	});

	it("renders a session-start instructions block with tier information", () => {
		const instructions = client.getInstructions();
		expect(typeof instructions).toBe("string");
		expect(instructions).toMatch(/Aegis/);
		expect(instructions).toMatch(/tier 3|tier 1/);
	});
});
