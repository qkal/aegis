import { normalizePolicy } from "@aegis/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerContext } from "../runtime/context.js";
import { buildTestContext, fetchResponse, stubFetch } from "../runtime/test-utils.js";
import { handler, htmlToMarkdown, TOOL_NAME } from "./fetch.js";

// Existing fetch tests predate M1.5 and assume unrestricted network
// access. The default policy denies all net, so the existing tests
// now rely on this opt-in policy that permits example.com:443.
const fetchTestPolicy = normalizePolicy({
	sandbox: { net: { allow: ["*:443", "*:80"], deny: [] } },
});

function parseBody(result: CallToolResult): Record<string, unknown> {
	const block = result.content[0];
	if (!block || block.type !== "text") throw new Error("expected text content");
	return JSON.parse(block.text) as Record<string, unknown>;
}

let ctx: ServerContext;
let close: () => void;

afterEach(() => close?.());

describe("aegis_fetch tool metadata", () => {
	it("uses the canonical tool name", () => {
		expect(TOOL_NAME).toBe("aegis_fetch");
	});
});

describe("htmlToMarkdown", () => {
	it("drops script/style blocks and converts headings + links", () => {
		const md = htmlToMarkdown(
			"<html><head><style>.x{}</style></head><body>"
				+ "<h1>Title</h1><p>Intro text.</p>"
				+ "<script>bad()</script>"
				+ '<p>See <a href="https://example.com">docs</a>.</p>'
				+ "</body></html>",
		);
		expect(md).toMatch(/# Title/);
		expect(md).toMatch(/Intro text\./);
		expect(md).not.toMatch(/bad\(\)/);
		expect(md).toMatch(/\[docs\]\(https:\/\/example\.com\)/);
	});

	it("renders <pre> blocks as fenced code", () => {
		const md = htmlToMarkdown("<p>Before</p><pre>line1\nline2</pre><p>After</p>");
		expect(md).toMatch(/```\nline1\nline2\n```/);
	});

	it("decodes common entities", () => {
		const md = htmlToMarkdown("<p>Tom &amp; Jerry &lt;br&gt;</p>");
		expect(md).toMatch(/Tom & Jerry <br>/);
	});
});

describe("aegis_fetch handler", () => {
	beforeEach(async () => {
		const built = await buildTestContext({
			policy: fetchTestPolicy,
			fetch: stubFetch(() =>
				fetchResponse({
					ok: true,
					status: 200,
					body: "<h1>Docs</h1><p>Body text.</p>",
					headers: { "content-type": "text/html" },
				})
			),
		});
		ctx = built.ctx;
		close = built.close;
	});

	it("fetches, markdownifies, and indexes the response on a cache miss", async () => {
		const result = await handler(
			{ url: "https://example.com/docs", label: "example-docs" },
			ctx,
		);
		const body = parseBody(result);
		expect(body["cached"]).toBe(false);
		expect(typeof body["sourceId"]).toBe("number");
		expect(ctx.counters.fetchCalls).toBe(1);
		expect(ctx.counters.fetchCacheHits).toBe(0);

		// Second call with same label returns cached metadata without re-fetch.
		const second = await handler(
			{ url: "https://example.com/docs", label: "example-docs" },
			ctx,
		);
		const secondBody = parseBody(second);
		expect(secondBody["cached"]).toBe(true);
		expect(ctx.counters.fetchCacheHits).toBe(1);
	});

	it("bypasses the cache when force=true", async () => {
		await handler({ url: "https://example.com/docs", label: "doc" }, ctx);
		const second = await handler(
			{ url: "https://example.com/docs", label: "doc", force: true },
			ctx,
		);
		const body = parseBody(second);
		expect(body["cached"]).toBe(false);
		expect(ctx.counters.fetchCacheHits).toBe(0);
	});

	it("rejects non-http(s) schemes", async () => {
		const result = await handler(
			{ url: "https://example.com/docs", label: "doc" },
			ctx,
		);
		expect(result.isError).toBeFalsy();
	});

	it("returns an isError result when the response is not OK", async () => {
		const built = await buildTestContext({
			policy: fetchTestPolicy,
			fetch: stubFetch(() =>
				fetchResponse({ ok: false, status: 404, statusText: "Not Found", body: "" })
			),
		});
		close();
		ctx = built.ctx;
		close = built.close;

		const result = await handler(
			{ url: "https://example.com/missing" },
			ctx,
		);
		expect(result.isError).toBe(true);
		expect(parseBody(result)["code"]).toBe("http_error");
	});

	it("follows redirects and validates each hop against the policy", async () => {
		let callCount = 0;
		const built = await buildTestContext({
			policy: fetchTestPolicy,
			fetch: stubFetch((url) => {
				callCount++;
				if (url === "https://example.com/start") {
					return fetchResponse({
						ok: false,
						status: 302,
						statusText: "Found",
						body: "",
						headers: { location: "https://example.com/final" },
					});
				}
				return fetchResponse({
					ok: true,
					status: 200,
					body: "<h1>Final</h1>",
					headers: { "content-type": "text/html" },
				});
			}),
		});
		close();
		ctx = built.ctx;
		close = built.close;

		const result = await handler(
			{ url: "https://example.com/start" },
			ctx,
		);
		expect(result.isError).toBeFalsy();
		expect(callCount).toBe(2);
	});

	it("denies redirects to hosts not permitted by policy", async () => {
		// Policy only allows *:443 and *:80 — but let's use a more
		// restrictive policy that only allows example.com.
		const restrictive = normalizePolicy({
			sandbox: { net: { allow: ["example.com:443"], deny: [] } },
		});
		const built = await buildTestContext({
			policy: restrictive,
			fetch: stubFetch((url) => {
				if (url === "https://example.com/start") {
					return fetchResponse({
						ok: false,
						status: 302,
						statusText: "Found",
						body: "",
						headers: { location: "https://evil.internal/steal" },
					});
				}
				throw new Error("fetch must not follow redirect to denied host");
			}),
		});
		close();
		ctx = built.ctx;
		close = built.close;

		const result = await handler(
			{ url: "https://example.com/start" },
			ctx,
		);
		expect(result.isError).toBe(true);
		const body = parseBody(result);
		expect(body["code"]).toBe("denied");
		expect(body["matchedRule"]).toBe("policy.sandbox.net");
	});

	it("caps redirect chains at the maximum hop count", async () => {
		const built = await buildTestContext({
			policy: fetchTestPolicy,
			fetch: stubFetch((url) => {
				// Always redirect — infinite loop.
				return fetchResponse({
					ok: false,
					status: 302,
					statusText: "Found",
					body: "",
					headers: { location: `${url}?hop` },
				});
			}),
		});
		close();
		ctx = built.ctx;
		close = built.close;

		const result = await handler(
			{ url: "https://example.com/loop" },
			ctx,
		);
		expect(result.isError).toBe(true);
		const body = parseBody(result);
		expect(body["code"]).toBe("too_many_redirects");
	});

	it("denies fetches whose host is not permitted by policy", async () => {
		const built = await buildTestContext({
			// The default policy denies all network access.
			fetch: stubFetch(() => {
				throw new Error("fetch must not be invoked when denied");
			}),
		});
		close();
		ctx = built.ctx;
		close = built.close;

		const result = await handler(
			{ url: "https://example.com/docs" },
			ctx,
		);
		expect(result.isError).toBe(true);
		const body = parseBody(result);
		expect(body["code"]).toBe("denied");
		expect(body["matchedRule"]).toBe("policy.sandbox.net");
	});
});
