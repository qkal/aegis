/**
 * aegis_fetch — URL fetch + minimal markdownification + index.
 *
 * Fetches a URL over HTTP(S), strips HTML to plain-ish markdown, and
 * pipes the result through `ContentIndex.index()`. The resulting
 * source is tagged `sourceType: "url"` with an optional TTL (default
 * 24h) so stale pages can expire.
 *
 * The HTML→markdown conversion is deliberately lightweight: a small
 * regex-driven transform that handles headings, links, code fences,
 * and list items. It is *not* a full DOM conversion — pulling in a
 * browser-grade parser would add a large native dependency to the
 * server for no win on the pages agents typically fetch (docs sites
 * + markdown). Callers that need high-fidelity scraping can POST the
 * pre-converted markdown to `aegis_index` directly.
 */

import { evaluateNetAccess } from "@aegis/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ServerContext } from "../runtime/context.js";
import { errorResult, jsonResult } from "./helpers.js";

export const TOOL_NAME = "aegis_fetch" as const;

export const TOOL_DESCRIPTION =
	"Fetch a URL, convert to markdown, and index into the knowledge base. "
	+ "Cached for 24 hours by default. Use force=true to bypass cache.";

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 10;

export const inputSchema = {
	url: z.string().url(),
	label: z.string().min(1).max(512).optional(),
	ttlSeconds: z.number().int().positive().max(MAX_TTL_SECONDS).optional(),
	force: z.boolean().optional(),
} as const;

const argsSchema = z.object(inputSchema);
export type FetchArgs = z.infer<typeof argsSchema>;

export async function handler(
	rawArgs: FetchArgs,
	ctx: ServerContext,
): Promise<CallToolResult> {
	const args = argsSchema.parse(rawArgs);
	const label = args.label ?? args.url;
	ctx.counters.fetchCalls += 1;

	// Enforce http(s) here even though the Zod schema already rejects
	// other shapes via `z.string().url()` — belt-and-braces: some URL
	// parsers are lenient about scheme.
	let parsed: URL;
	try {
		parsed = new URL(args.url);
	} catch (err) {
		return errorResult(`invalid URL: ${(err as Error).message}`, { code: "invalid_url" });
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return errorResult(`unsupported URL scheme: ${parsed.protocol}`, {
			code: "unsupported_scheme",
		});
	}

	// Policy enforcement at the MCP boundary. `evaluateNetAccess`
	// walks the sandbox.net deny/allow lists against `host:port`; the
	// default policy denies all network access, so `aegis_fetch` is a
	// no-op until the user opts in via their config.
	const hostPort = netHostPort(parsed);
	if (!evaluateNetAccess(hostPort, ctx.policy)) {
		return errorResult(
			`fetch denied by policy: ${hostPort} is not permitted by policy.sandbox.net`,
			{
				code: "denied",
				reason: `network access to ${hostPort} denied`,
				matchedRule: "policy.sandbox.net",
			},
		);
	}

	if (!args.force) {
		const cached = findFreshUrlSource(ctx, args.url);
		if (cached !== undefined) {
			ctx.counters.fetchCacheHits += 1;
			return jsonResult({
				url: args.url,
				label,
				cached: true,
				sourceId: cached.sourceId,
				chunkCount: cached.chunkCount,
				expiresAt: cached.expiresAt,
			});
		}
	}

	// Manual redirect handling: each hop is validated against the
	// network policy so an allowlisted origin cannot 30x to a denied
	// host. The loop caps at MAX_REDIRECTS to avoid infinite chains.
	let currentUrl = args.url;
	let response;
	for (let hops = 0;; hops++) {
		try {
			response = await ctx.fetch(currentUrl, {
				headers: {
					"user-agent": "aegis-mcp-server",
					accept: "text/html, text/markdown, text/plain;q=0.9, */*;q=0.5",
				},
				redirect: "manual",
			});
		} catch (err) {
			return errorResult(`fetch failed: ${(err as Error).message}`, { code: "network_error" });
		}

		const isRedirect = response.status >= 300 && response.status < 400;
		if (!isRedirect) break;

		if (hops >= MAX_REDIRECTS) {
			return errorResult(`too many redirects (max ${MAX_REDIRECTS})`, {
				code: "too_many_redirects",
			});
		}

		const location = response.headers.get("location");
		if (location === null || location === "") {
			return errorResult(
				`redirect ${response.status} with no Location header`,
				{ code: "http_error", status: response.status },
			);
		}

		let nextUrl: URL;
		try {
			nextUrl = new URL(location, currentUrl);
		} catch {
			return errorResult(`redirect to invalid URL: ${location}`, { code: "invalid_url" });
		}

		if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
			return errorResult(`redirect to unsupported scheme: ${nextUrl.protocol}`, {
				code: "unsupported_scheme",
			});
		}

		const nextHostPort = netHostPort(nextUrl);
		if (!evaluateNetAccess(nextHostPort, ctx.policy)) {
			return errorResult(
				`redirect to ${nextHostPort} denied by policy`,
				{
					code: "denied",
					reason: `network access to ${nextHostPort} denied (via redirect)`,
					matchedRule: "policy.sandbox.net",
				},
			);
		}

		currentUrl = nextUrl.href;
	}

	if (!response.ok) {
		return errorResult(`fetch returned HTTP ${response.status} ${response.statusText}`, {
			code: "http_error",
			status: response.status,
		});
	}

	// Early-reject when the server advertises a Content-Length that
	// exceeds the cap. This avoids buffering the full body in memory
	// for obviously-oversized responses. Not a complete guard (chunked
	// responses omit the header), but covers the common case cheaply.
	const contentLength = response.headers.get("content-length");
	if (contentLength !== null) {
		const declared = Number(contentLength);
		if (!Number.isNaN(declared) && declared > MAX_RESPONSE_BYTES) {
			return errorResult(
				`response Content-Length (${declared}) exceeds max fetchable size of ${MAX_RESPONSE_BYTES} bytes`,
				{
					code: "too_large",
					maxBytes: MAX_RESPONSE_BYTES,
				},
			);
		}
	}

	let body: string;
	try {
		body = await response.text();
	} catch (err) {
		return errorResult(`failed to read response body: ${(err as Error).message}`, {
			code: "read_error",
		});
	}
	if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
		return errorResult(`response exceeds max fetchable size of ${MAX_RESPONSE_BYTES} bytes`, {
			code: "too_large",
			maxBytes: MAX_RESPONSE_BYTES,
		});
	}

	ctx.counters.fetchBytesFetched += Buffer.byteLength(body, "utf8");

	const contentType = response.headers.get("content-type") ?? "";
	const markdown = isHtml(contentType, body) ? htmlToMarkdown(body) : body;
	const ttlSeconds = args.ttlSeconds ?? DEFAULT_TTL_SECONDS;
	const expiresAt = new Date(ctx.now().getTime() + ttlSeconds * 1_000).toISOString();

	// Cache-key by URL: the `label` param is a human-readable hint that the
	// agent may change between calls. Using the URL as the stored label
	// guarantees that a subsequent fetch of the same URL hits the cache
	// regardless of what label the caller supplied, and — critically —
	// prevents a *different* URL from ever aliasing onto this cache entry
	// just because the labels happened to collide.
	const indexed = ctx.contentIndex.index(markdown, {
		label: args.url,
		sourceType: "url",
		expiresAt,
	});

	return jsonResult({
		url: args.url,
		label,
		cached: false,
		sourceId: indexed.sourceId,
		chunkCount: indexed.chunkCount,
		codeChunkCount: indexed.codeChunkCount,
		contentHash: indexed.contentHash,
		reused: indexed.reused,
		expiresAt,
		contentType,
		bytes: Buffer.byteLength(markdown, "utf8"),
	});
}

interface FreshSource {
	readonly sourceId: number;
	readonly chunkCount: number;
	readonly expiresAt: string | null;
}

function findFreshUrlSource(ctx: ServerContext, url: string): FreshSource | undefined {
	const nowIso = ctx.now().toISOString();
	// Fetched sources are always stored under `label: url` (see handler),
	// so URL-equality is both necessary and sufficient for a safe cache hit.
	const match = ctx.contentIndex.listSources().find((s) =>
		s.label === url
		&& s.sourceType === "url"
		&& (s.expiresAt === null || s.expiresAt > nowIso)
	);
	if (match === undefined) return undefined;
	return {
		sourceId: match.id as unknown as number,
		chunkCount: match.totalChunks,
		expiresAt: match.expiresAt,
	};
}

function isHtml(contentType: string, body: string): boolean {
	if (contentType.toLowerCase().includes("html")) return true;
	// Content-Type was absent or vague; peek at the body.
	return /<(html|body|div|p|h[1-6]|pre|code|article|main)\b/i.test(body.slice(0, 512));
}

/**
 * Minimal HTML → markdown-ish conversion.
 *
 * Order matters: script/style blocks must be removed before tag
 * rewrites so their contents are dropped cleanly. Tags are handled as
 * non-greedy regex replacements rather than a DOM walk; this means we
 * cannot recover deeply-nested structure, but the output is still
 * searchable, which is all the content index needs.
 */
export function htmlToMarkdown(html: string): string {
	let out = html;
	out = out.replace(/<!--[\s\S]*?-->/g, "");
	out = out.replace(/<script\b[\s\S]*?<\/script>/gi, "");
	out = out.replace(/<style\b[\s\S]*?<\/style>/gi, "");
	out = out.replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag: string, inner: string) => {
		const level = Number(tag[1] ?? "1");
		const prefix = "#".repeat(level);
		return `\n\n${prefix} ${stripTags(inner).trim()}\n\n`;
	});
	out = out.replace(/<(pre|code)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag: string, inner: string) => {
		const text = decodeEntities(inner);
		return tag.toLowerCase() === "pre"
			? `\n\n\`\`\`\n${text.replace(/<[^>]+>/g, "")}\n\`\`\`\n\n`
			: `\`${text.replace(/<[^>]+>/g, "")}\``;
	});
	out = out.replace(
		/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
		(_, href: string, inner: string) => `[${stripTags(inner).trim()}](${href})`,
	);
	out = out.replace(
		/<li\b[^>]*>([\s\S]*?)<\/li>/gi,
		(_, inner: string) => `\n- ${stripTags(inner).trim()}`,
	);
	out = out.replace(/<br\s*\/?\s*>/gi, "\n");
	out = out.replace(/<\/p>/gi, "\n\n");
	out = stripTags(out);
	out = decodeEntities(out);
	// Collapse whitespace: three+ blank lines → two, trailing whitespace dropped.
	out = out.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
	return out;
}

function stripTags(input: string): string {
	return input.replace(/<[^>]+>/g, "");
}

const ENTITY_MAP: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

function decodeEntities(input: string): string {
	return input
		.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&([a-z]+);/gi, (full, name: string) => ENTITY_MAP[name.toLowerCase()] ?? full);
}

/**
 * Render a URL as `host:port` for {@link evaluateNetAccess}. Falls
 * back to the protocol's default port so policy globs like `*:443`
 * work whether or not the URL carried an explicit port.
 */
function netHostPort(url: URL): string {
	const port = url.port !== ""
		? url.port
		: url.protocol === "https:"
		? "443"
		: "80";
	return `${url.hostname}:${port}`;
}
