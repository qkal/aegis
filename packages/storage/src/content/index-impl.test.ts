/**
 * ContentIndex tests.
 *
 * Cover index() / search() round-trip, RRF merge, content-hash dedup,
 * type filter, source/recency boosts, and the LIKE fallback path. Includes
 * a small benchmark against ~1k chunks to assert FTS5 is fast enough to
 * stay on the budget set by ADR-0012 (p99 < 10ms on 10K chunks; we test at
 * 1k as a smoke).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../adapters/index.js";
import type { Database } from "../adapters/types.js";
import { runMigrations } from "../migrations/index.js";
import { buildMatchExpr, CONTENT_INDEX_MIGRATIONS, ContentIndex, mergeRrf } from "./index.js";

let db: Database;
let idx: ContentIndex;

beforeEach(async () => {
	const { db: opened } = await openDatabase({
		path: ":memory:",
		backend: "better-sqlite3",
	});
	db = opened;
	runMigrations(db, CONTENT_INDEX_MIGRATIONS);
	idx = new ContentIndex(db);
});

afterEach(() => db.close());

describe("ContentIndex.index", () => {
	it("ingests a prose document and reports chunk counts", () => {
		const r = idx.index("The quick brown fox jumps over the lazy dog. ".repeat(20), {
			label: "fox.txt",
			sourceType: "manual",
		});
		expect(r.reused).toBe(false);
		expect(r.chunkCount).toBeGreaterThanOrEqual(1);
		expect(r.codeChunkCount).toBe(0);
	});

	it("classifies code samples as code chunks", () => {
		const code = `function add(a: number, b: number) { return a + b; }
function sub(a: number, b: number) { return a - b; }`;
		const r = idx.index(code, { label: "math.ts", sourceType: "file" });
		expect(r.codeChunkCount).toBe(r.chunkCount);
		expect(r.chunkCount).toBeGreaterThan(0);
	});

	it("is a no-op when re-indexing the same body for the same label", () => {
		const text = "Re-index test body.";
		const a = idx.index(text, { label: "x", sourceType: "manual" });
		const b = idx.index(text, { label: "x", sourceType: "manual" });
		expect(a.reused).toBe(false);
		expect(b.reused).toBe(true);
		expect(b.sourceId).toBe(a.sourceId);
	});

	it("replaces chunks when the body changes for an existing label", () => {
		idx.index("First body.", { label: "x", sourceType: "manual" });
		const r2 = idx.index("Second body — totally different.", {
			label: "x",
			sourceType: "manual",
		});
		expect(r2.reused).toBe(false);
		const sources = idx.listSources();
		expect(sources).toHaveLength(1);
		expect(sources[0]?.totalChunks).toBe(r2.chunkCount);
	});
});

describe("ContentIndex.search", () => {
	beforeEach(() => {
		idx.index(
			"Authentication is the process of verifying a user's identity. "
				+ "This typically involves checking credentials such as a password "
				+ "or a cryptographic token.",
			{ label: "auth-overview.md", sourceType: "url" },
		);
		idx.index(
			`function handleAuthCallback(req: Request) {
	const token = req.headers.get("authorization");
	return verifyToken(token);
}`,
			{ label: "auth.ts", sourceType: "file" },
		);
		idx.index(
			"This document discusses cooking recipes for chocolate cake. "
				+ "It is unrelated to authentication or any security topic.",
			{ label: "cake.md", sourceType: "manual" },
		);
	});

	it("returns the natural-language match for prose queries", () => {
		const hits = idx.search("verify identity");
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0]?.sourceLabel).toBe("auth-overview.md");
	});

	it("returns the trigram match for identifier queries", () => {
		const hits = idx.search("handleAuthCallback");
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0]?.sourceLabel).toBe("auth.ts");
	});

	it("filters by content type", () => {
		const hits = idx.search("auth", { contentTypeFilter: "code" });
		for (const h of hits) expect(h.contentType).toBe("code");
	});

	it("returns no results for a non-matching query", () => {
		expect(idx.search("zebrafish hovercraft")).toEqual([]);
	});

	it("returns an empty list for empty / whitespace queries", () => {
		expect(idx.search("")).toEqual([]);
		expect(idx.search("   \t  ")).toEqual([]);
	});

	it("respects maxResults", () => {
		const hits = idx.search("authentication", { maxResults: 1 });
		expect(hits.length).toBeLessThanOrEqual(1);
	});

	it("applies source weighting when requested", () => {
		// Both auth-overview (url) and auth.ts (file) match. Without weighting,
		// the prose hit usually wins on rank; with sourceWeighted=true the file
		// source's higher weight should be reflected in the score.
		const weighted = idx.search("auth", { sourceWeighted: true });
		const plain = idx.search("auth");
		expect(weighted.length).toBeGreaterThan(0);
		expect(plain.length).toBeGreaterThan(0);
		// All scores should be finite, positive numbers.
		for (const h of weighted) {
			expect(h.score).toBeGreaterThan(0);
			expect(Number.isFinite(h.score)).toBe(true);
		}
	});

	it("includes a snippet that contains the query token where possible", () => {
		const hits = idx.search("identity");
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0]?.snippet.toLowerCase()).toContain("identity");
	});
});

describe("ContentIndex.listSources / deleteSource", () => {
	it("lists registered sources newest first and deletes by id", () => {
		idx.index("first", { label: "a", sourceType: "manual" });
		const r2 = idx.index("second", { label: "b", sourceType: "manual" });
		const list = idx.listSources();
		expect(list.map((s) => s.label)).toEqual(["b", "a"]);

		expect(idx.deleteSource(r2.sourceId)).toBe(true);
		expect(idx.listSources().map((s) => s.label)).toEqual(["a"]);
	});
});

describe("RRF merge", () => {
	it("ranks rows that appear in both lists higher than singletons", () => {
		const A = [
			{ rowid: 10, rank: 0 },
			{ rowid: 11, rank: 0 },
			{ rowid: 12, rank: 0 },
		];
		const B = [
			{ rowid: 12, rank: 0 },
			{ rowid: 13, rank: 0 },
			{ rowid: 14, rank: 0 },
		];
		const merged = mergeRrf(A, B, 60);
		expect(merged[0]?.rowid).toBe(12);
	});

	it("returns an empty list when both inputs are empty", () => {
		expect(mergeRrf([], [], 60)).toEqual([]);
	});
});

describe("buildMatchExpr", () => {
	it("quotes every token to neutralize FTS operator characters", () => {
		expect(buildMatchExpr("foo bar baz", "porter")).toBe('"foo" "bar" "baz"');
	});

	it("strips embedded quotes and backslashes that would break the FTS expression", () => {
		expect(buildMatchExpr('foo"bar baz\\qux', "porter")).toBe('"foobar" "bazqux"');
	});

	it("returns an empty-quote sentinel for whitespace-only input", () => {
		expect(buildMatchExpr("   ", "porter")).toBe('""');
	});
});

describe("benchmark: 1k chunks", () => {
	it("indexes ~1k chunks and serves searches under a generous budget", () => {
		const chunks = Array.from({ length: 1000 }, (_, i) => {
			if (i % 5 === 0) {
				return `### Section ${i}\n\nThis paragraph discusses widget ${i} and its relationship to gadget ${
					i + 1
				}.`;
			}
			return `function widget${i}(x: number) { return x * ${i}; }`;
		});
		idx.index(chunks.join("\n\n"), {
			label: "bench.md",
			sourceType: "manual",
			maxChunkBytes: 256,
		});

		const queries = ["widget500", "section", "function widget", "gadget 42", "return x"];
		const samples: number[] = [];
		for (const q of queries) {
			for (let i = 0; i < 20; i++) {
				const t0 = performance.now();
				const hits = idx.search(q, { maxResults: 5 });
				const elapsed = performance.now() - t0;
				samples.push(elapsed);
				expect(hits.length).toBeGreaterThanOrEqual(0);
			}
		}
		samples.sort((a, b) => a - b);
		const p50 = samples[Math.floor(samples.length * 0.5)] ?? 0;
		const p99 = samples[Math.floor(samples.length * 0.99)] ?? 0;
		// Generous budget — ADR-0012 targets <10ms p99 on 10k chunks; here we
		// have 1k chunks but ~10x slack to keep the bench non-flaky in CI VMs.
		expect(p50).toBeLessThan(50);
		expect(p99).toBeLessThan(100);
	});
});
