import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerContext } from "../runtime/context.js";
import { buildTestContext, StubExecutor } from "../runtime/test-utils.js";
import { handler, inputSchema, TOOL_NAME } from "./execute.js";

function parseBody(result: CallToolResult): Record<string, unknown> {
	const block = result.content[0];
	if (!block || block.type !== "text") throw new Error("expected text content");
	return JSON.parse(block.text) as Record<string, unknown>;
}

let ctx: ServerContext;
let close: () => void;

afterEach(() => close?.());

describe("aegis_execute tool metadata", () => {
	it("exposes the canonical tool name and a flat input schema", () => {
		expect(TOOL_NAME).toBe("aegis_execute");
		expect(Object.keys(inputSchema).sort()).toEqual([
			"allowNetwork",
			"code",
			"language",
			"maxOutputBytes",
			"timeoutMs",
			"workingDir",
		]);
	});
});

describe("aegis_execute handler", () => {
	beforeEach(async () => {
		// Default wiring: stub executor is swapped per-test below.
		const built = await buildTestContext();
		ctx = built.ctx;
		close = built.close;
	});

	it("maps a successful execution to a non-error JSON result and bumps savings", async () => {
		const stub = new StubExecutor([{
			status: "success",
			stdout: "hello\n",
			stderr: "",
			exitCode: 0,
			durationMs: 7,
		}]);
		ctx = { ...ctx, executor: stub.asPolyglot() };

		const result = await handler(
			{ code: "console.log('hello')", language: "javascript" },
			ctx,
		);

		expect(result.isError).toBeFalsy();
		expect(parseBody(result)).toEqual({
			status: "success",
			stdout: "hello\n",
			stderr: "",
			exitCode: 0,
			durationMs: 7,
		});
		expect(ctx.counters.executeCalls).toBe(1);
		expect(ctx.counters.executeSuccesses).toBe(1);
		expect(ctx.counters.executeBytesSaved).toBe(Buffer.byteLength("hello\n", "utf8"));
	});

	it("returns an error result and increments executeErrors on engine error", async () => {
		const stub = new StubExecutor([{
			status: "error",
			error: 'no runtime available for language "rust"',
		}]);
		ctx = { ...ctx, executor: stub.asPolyglot() };

		const result = await handler(
			{ code: "fn main() {}", language: "rust" },
			ctx,
		);

		expect(result.isError).toBe(true);
		expect(parseBody(result)).toEqual({
			error: 'no runtime available for language "rust"',
			code: "error",
		});
		expect(ctx.counters.executeErrors).toBe(1);
	});

	it("forwards explicit timeout and maxOutputBytes into the sandbox config", async () => {
		const stub = new StubExecutor([{
			status: "success",
			stdout: "",
			stderr: "",
			exitCode: 0,
			durationMs: 1,
		}]);
		ctx = { ...ctx, executor: stub.asPolyglot() };

		await handler(
			{
				code: "echo hi",
				language: "shell",
				timeoutMs: 1_000,
				maxOutputBytes: 4_096,
			},
			ctx,
		);

		expect(stub.calls).toHaveLength(1);
		const call = stub.calls[0]!;
		expect(call.timeoutMs).toBe(1_000);
		expect(call.maxOutputBytes).toBe(4_096);
		expect(call.allowNetwork).toBe(false);
		expect(call.env).toEqual({ PATH: process.env["PATH"] ?? "" });
	});

	it("records timeouts separately and does not credit byte savings twice", async () => {
		const stub = new StubExecutor([{
			status: "timeout",
			stdout: "partial",
			stderr: "",
			durationMs: 100,
		}]);
		ctx = { ...ctx, executor: stub.asPolyglot() };

		const result = await handler(
			{ code: "while true; do :; done", language: "shell" },
			ctx,
		);
		const body = parseBody(result);
		expect(body["status"]).toBe("timeout");
		expect(ctx.counters.executeTimeouts).toBe(1);
		expect(ctx.counters.executeBytesSaved).toBe(0);
	});

	it("rejects unknown languages at the schema boundary", async () => {
		await expect(
			handler(
				{ code: "print(1)", language: "cobol" as unknown as "python" },
				ctx,
			),
		).rejects.toThrow(/Invalid|expected/);
	});

	it("rejects empty code", async () => {
		await expect(
			handler({ code: "", language: "javascript" }, ctx),
		).rejects.toThrow(/code must not be empty/);
	});
});
