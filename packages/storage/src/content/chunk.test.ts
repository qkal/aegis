/**
 * Unit tests for the chunker and the code/prose classifier.
 */

import { describe, expect, it } from "vitest";
import { chunkContent, classifyContent } from "./index.js";

describe("classifyContent", () => {
	it("classifies plain English as prose", () => {
		expect(classifyContent("The quick brown fox jumps over the lazy dog.")).toBe("prose");
	});

	it("classifies a TypeScript snippet as code", () => {
		expect(classifyContent("function foo(x: number): number { return x * 2 + bar(x); }")).toBe(
			"code",
		);
	});

	it("classifies an empty string as prose", () => {
		expect(classifyContent("")).toBe("prose");
	});

	it("classifies a markdown doc with headings as prose", () => {
		expect(
			classifyContent(
				"# Title\n\nThis paragraph has lots of regular words and a couple of commas, plus a question mark?",
			),
		).toBe("prose");
	});
});

describe("chunkContent", () => {
	it("returns no chunks for empty input", () => {
		expect(chunkContent("")).toEqual([]);
	});

	it("emits a single chunk for a small document", () => {
		const chunks = chunkContent("Hello world.");
		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.body).toBe("Hello world.");
		expect(chunks[0]?.contentType).toBe("prose");
		expect(chunks[0]?.ordinal).toBe(0);
	});

	it("respects maxBytes by splitting prose on paragraph boundaries", () => {
		const para = "abcdef".repeat(20); // 120 chars
		const text = [para, para, para, para].join("\n\n");
		const chunks = chunkContent(text, { maxBytes: 200 });
		expect(chunks.length).toBeGreaterThanOrEqual(2);
		for (const c of chunks) expect(c.byteLength).toBeLessThanOrEqual(200);
	});

	it("hard-splits a single oversized prose paragraph", () => {
		const huge = "x ".repeat(400); // 800 chars, no paragraph breaks
		const chunks = chunkContent(huge, { maxBytes: 100 });
		expect(chunks.length).toBeGreaterThan(1);
		for (const c of chunks) expect(c.byteLength).toBeLessThanOrEqual(100);
	});

	it("never splits mid-line for code", () => {
		const code = Array.from({ length: 30 }, (_, i) => `line${i}_${"y".repeat(10)};`).join("\n");
		const chunks = chunkContent(code, { maxBytes: 80, contentType: "code" });
		for (const c of chunks) {
			// No line should be cut in half — every chunk's body should be a clean
			// concatenation of complete `lineN_yyy...;` lines.
			const lines = c.body.split("\n");
			for (const line of lines) {
				if (line.length === 0) continue;
				expect(line).toMatch(/^line\d+_y+;$/);
			}
		}
	});

	it("assigns ordinals 0, 1, 2, …", () => {
		const text = ["a", "b", "c"].map((s) => s.repeat(50)).join("\n\n");
		const chunks = chunkContent(text, { maxBytes: 80 });
		expect(chunks.map((c) => c.ordinal)).toEqual(
			Array.from({ length: chunks.length }, (_, i) => i),
		);
	});

	it("propagates titlePrefix into chunk titles", () => {
		const chunks = chunkContent("First line.\nSecond line.", {
			titlePrefix: "doc.txt",
		});
		expect(chunks[0]?.title).toBe("doc.txt: First line.");
	});

	it("auto-classifies and forces contentType when supplied", () => {
		const chunks = chunkContent("function() {}", { contentType: "prose" });
		expect(chunks[0]?.contentType).toBe("prose");
	});
});
