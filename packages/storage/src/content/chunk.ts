/**
 * Content chunking.
 *
 * Splits a raw document into FTS-indexable chunks. Two strategies:
 *
 *   - **prose**: paragraph-aware. Split on blank lines; merge adjacent paragraphs
 *     up to `maxBytes`. Soft-wrap if a single paragraph exceeds the budget.
 *
 *   - **code**: line-aware. Split on blank lines first (to keep functions
 *     together), then hard-split overflow on line boundaries. Never splits
 *     mid-line, so identifier-style queries always hit a contiguous body.
 *
 * Chunk size is bounded by `maxBytes` (UTF-8). Empty chunks are dropped.
 * The classifier `classifyContent` makes a coarse code-vs-prose call based
 * on punctuation density — good enough for retrieval ranking without
 * pulling in tree-sitter or a language list.
 */

import type { ContentType } from "./types.js";

/** Default chunk size. Tuned to stay well under FTS5's 1 MiB row limit. */
export const DEFAULT_MAX_CHUNK_BYTES = 4 * 1024;

/** A single chunk produced by `chunkContent`. */
export interface RawChunk {
	readonly ordinal: number;
	readonly title: string;
	readonly body: string;
	readonly contentType: ContentType;
	readonly byteLength: number;
}

/** Options for `chunkContent`. */
export interface ChunkOptions {
	readonly maxBytes?: number;
	/** If supplied, force the contentType for every chunk (skip auto-classify). */
	readonly contentType?: ContentType;
	/** Title prefix used for each chunk (e.g. the source label). */
	readonly titlePrefix?: string;
}

/** Split `text` into FTS-ready chunks. */
export function chunkContent(text: string, opts: ChunkOptions = {}): RawChunk[] {
	const maxBytes = opts.maxBytes ?? DEFAULT_MAX_CHUNK_BYTES;
	const declared = opts.contentType;
	if (text.length === 0) return [];

	// Normalize line endings so the splitting logic doesn't have to think
	// about \r\n. We deliberately don't trim leading/trailing whitespace —
	// some code documents (e.g. patches) lead with whitespace meaningfully.
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

	const inferredType = declared ?? classifyContent(normalized);
	const splitter = inferredType === "code" ? splitCode : splitProse;
	const blocks = splitter(normalized, maxBytes);

	const out: RawChunk[] = [];
	let ordinal = 0;
	for (const body of blocks) {
		if (body.length === 0) continue;
		const byteLength = byteLen(body);
		if (byteLength === 0) continue;
		out.push({
			ordinal,
			title: makeTitle(body, opts.titlePrefix),
			body,
			contentType: inferredType,
			byteLength,
		});
		ordinal += 1;
	}
	return out;
}

/**
 * Classify a document as `code` or `prose`. Heuristic, not exact:
 * documents whose lines average more than 20% non-alphanumeric, non-whitespace
 * characters are flagged as code. Catches all common languages plus markdown
 * with embedded fenced blocks.
 */
export function classifyContent(text: string): ContentType {
	if (text.length === 0) return "prose";
	let nonAlphaNum = 0;
	let totalNonWs = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c <= 32) continue;
		totalNonWs += 1;
		const isAlpha = (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
		const isDigit = c >= 48 && c <= 57;
		if (!isAlpha && !isDigit) nonAlphaNum += 1;
	}
	if (totalNonWs === 0) return "prose";
	const ratio = nonAlphaNum / totalNonWs;
	return ratio > 0.2 ? "code" : "prose";
}

function splitProse(text: string, maxBytes: number): string[] {
	const paragraphs = text.split(/\n{2,}/g);
	const out: string[] = [];
	let buf = "";
	for (const para of paragraphs) {
		const candidate = buf.length === 0 ? para : `${buf}\n\n${para}`;
		if (byteLen(candidate) <= maxBytes) {
			buf = candidate;
			continue;
		}
		if (buf.length > 0) {
			out.push(buf);
			buf = "";
		}
		// Single paragraph exceeds the budget — soft-wrap on word boundaries.
		if (byteLen(para) > maxBytes) {
			out.push(...softWrap(para, maxBytes));
		} else {
			buf = para;
		}
	}
	if (buf.length > 0) out.push(buf);
	return out;
}

function splitCode(text: string, maxBytes: number): string[] {
	const sections = text.split(/\n{2,}/g);
	const out: string[] = [];
	let buf = "";
	for (const section of sections) {
		const candidate = buf.length === 0 ? section : `${buf}\n\n${section}`;
		if (byteLen(candidate) <= maxBytes) {
			buf = candidate;
			continue;
		}
		if (buf.length > 0) {
			out.push(buf);
			buf = "";
		}
		if (byteLen(section) > maxBytes) {
			out.push(...hardSplitLines(section, maxBytes));
		} else {
			buf = section;
		}
	}
	if (buf.length > 0) out.push(buf);
	return out;
}

function softWrap(text: string, maxBytes: number): string[] {
	const words = text.split(/(\s+)/);
	const out: string[] = [];
	let buf = "";
	for (const w of words) {
		const candidate = buf + w;
		if (byteLen(candidate) <= maxBytes) {
			buf = candidate;
			continue;
		}
		if (buf.length > 0) {
			out.push(buf);
			buf = "";
		}
		// A single token longer than maxBytes — hard-truncate to keep ingestion
		// alive; pathological input shouldn't crash the indexer.
		if (byteLen(w) > maxBytes) {
			out.push(...hardSliceBytes(w, maxBytes));
		} else {
			buf = w;
		}
	}
	if (buf.length > 0) out.push(buf);
	return out;
}

function hardSplitLines(text: string, maxBytes: number): string[] {
	const lines = text.split("\n");
	const out: string[] = [];
	let buf = "";
	for (const line of lines) {
		const candidate = buf.length === 0 ? line : `${buf}\n${line}`;
		if (byteLen(candidate) <= maxBytes) {
			buf = candidate;
			continue;
		}
		if (buf.length > 0) {
			out.push(buf);
			buf = "";
		}
		if (byteLen(line) > maxBytes) {
			out.push(...hardSliceBytes(line, maxBytes));
		} else {
			buf = line;
		}
	}
	if (buf.length > 0) out.push(buf);
	return out;
}

function hardSliceBytes(text: string, maxBytes: number): string[] {
	const enc = new TextEncoder();
	const dec = new TextDecoder();
	const bytes = enc.encode(text);
	const out: string[] = [];
	for (let i = 0; i < bytes.length; i += maxBytes) {
		const slice = bytes.slice(i, i + maxBytes);
		// Decode with `fatal: false` so a slice that lands in the middle of a
		// multibyte sequence is still recoverable (replacement char rather
		// than throw).
		out.push(dec.decode(slice));
	}
	return out;
}

function makeTitle(body: string, prefix?: string): string {
	const firstLine = body.split("\n", 1)[0] ?? "";
	const trimmed = firstLine.trim().slice(0, 120);
	if (prefix && trimmed) return `${prefix}: ${trimmed}`;
	if (prefix) return prefix;
	return trimmed || "untitled";
}

function byteLen(s: string): number {
	// Cheap UTF-8 byte count without allocating a TextEncoder per call.
	let bytes = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c < 0x80) bytes += 1;
		else if (c < 0x800) bytes += 2;
		else if (c >= 0xd800 && c <= 0xdbff) {
			bytes += 4;
			i += 1; // surrogate pair
		} else bytes += 3;
	}
	return bytes;
}
