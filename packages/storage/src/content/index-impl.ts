/**
 * `ContentIndex` — dual-FTS5 search per ADR-0012.
 *
 * Two FTS5 virtual tables index the same canonical `content_chunks` body:
 *
 *   - `content_chunks_fts_porter`  — `tokenize='porter unicode61'` for natural
 *     language ("how does authentication work").
 *   - `content_chunks_fts_trigram` — `tokenize='trigram'` for substring /
 *     identifier matches ("handleAuthCallback").
 *
 * Search runs both tables in parallel, merges the ranked lists with
 * Reciprocal Rank Fusion (RRF, k = 60 by default), and reranks for
 * proximity / recency / source weight before returning the top N.
 *
 * Indexing is content-hashed: re-indexing the same body for the same source
 * label is a no-op (the source row is updated; chunks are not rewritten).
 *
 * The implementation is sync — every operation runs against the synchronous
 * `Database` interface from `@aegis/storage/adapters`.
 */

import { createHash } from "node:crypto";
import type { ContentSourceId } from "@aegis/core";
import type { Database } from "../adapters/types.js";
import type { ChunkOptions } from "./chunk.js";
import { chunkContent, DEFAULT_MAX_CHUNK_BYTES } from "./chunk.js";
import type {
	ContentSource,
	ContentType,
	IndexOptions,
	SearchOptions,
	SearchResult,
} from "./types.js";

/**
 * Local copy of `contentSourceIdUnsafe` from `@aegis/core`. Inlined so the
 * storage test suite does not need a runtime `@aegis/core` build — CI runs
 * `pnpm test:coverage` before `pnpm build`, and `@aegis/core`'s package.json
 * maps the `import` condition to `./dist/index.js`. The cast is identity at
 * runtime since branded number types carry no shape.
 */
const contentSourceIdUnsafe = (raw: number): ContentSourceId =>
	raw as ContentSourceId;

/** Result of an `index()` call. */
export interface IndexedSourceResult {
	readonly sourceId: ContentSourceId;
	readonly chunkCount: number;
	readonly codeChunkCount: number;
	readonly contentHash: string;
	/** True if the source already existed with the same content hash; no work was done. */
	readonly reused: boolean;
}

/** Capabilities of the underlying SQLite build. */
export interface ContentIndexCapabilities {
	/** True if `CREATE VIRTUAL TABLE ... USING fts5` works on this SQLite. */
	readonly fts5: boolean;
	/** True if FTS5 supports the `trigram` tokenizer (SQLite 3.34+). */
	readonly trigramTokenizer: boolean;
}

/** RRF parameters — exposed for test/benchmark tuning. */
export interface RrfOptions {
	readonly k?: number;
	readonly recencyBias?: boolean;
	readonly sourceWeighted?: boolean;
}

interface ChunkRow {
	id: number;
	source_id: number;
	ordinal: number;
	content_type: ContentType;
	title: string;
	body: string;
}

interface RankedHit {
	rowid: number;
	rank: number;
	porterRank?: number;
	trigramRank?: number;
}

const RRF_K_DEFAULT = 60;

/**
 * High-level facade for indexing and searching content. Construct once per
 * database and reuse — prepared statements are cached internally.
 */
export class ContentIndex {
	readonly capabilities: ContentIndexCapabilities;
	#db: Database;

	constructor(db: Database) {
		this.#db = db;
		this.capabilities = probeCapabilities(db);
	}

	/**
	 * Insert or replace a source. If the supplied content hashes to the same
	 * value as an existing source with the same label, the existing source is
	 * returned unchanged (`reused: true`).
	 */
	index(text: string, opts: IndexOptions): IndexedSourceResult {
		const contentHash = sha256Hex(text);
		const existing = this.#db
			.prepare<{
				id: number;
				content_hash: string | null;
				total_chunks: number;
				code_chunks: number;
			}>("SELECT id, content_hash, total_chunks, code_chunks FROM content_sources WHERE label = ?")
			.get(opts.label);

		if (existing && existing.content_hash === contentHash) {
			return {
				sourceId: contentSourceIdUnsafe(existing.id),
				chunkCount: existing.total_chunks,
				codeChunkCount: existing.code_chunks,
				contentHash,
				reused: true,
			};
		}

		const chunkOpts: ChunkOptions = {
			maxBytes: opts.maxChunkBytes ?? DEFAULT_MAX_CHUNK_BYTES,
			titlePrefix: opts.label,
		};
		const chunks = chunkContent(text, chunkOpts);
		const codeCount = chunks.filter((c) => c.contentType === "code").length;
		const now = new Date().toISOString();

		const tx = this.#db.transaction(() => {
			let sourceId: number;
			if (existing) {
				sourceId = existing.id;
				this.#db.prepare<unknown>("DELETE FROM content_chunks WHERE source_id = ?").run(sourceId);
				this.#db
					.prepare<unknown>(
						`UPDATE content_sources
						 SET source_type=?, created_at=?, expires_at=?,
						     content_hash=?, total_chunks=?, code_chunks=?
						 WHERE id = ?`,
					)
					.run(
						opts.sourceType,
						now,
						opts.expiresAt ?? null,
						contentHash,
						chunks.length,
						codeCount,
						sourceId,
					);
			} else {
				const r = this.#db
					.prepare<unknown>(
						`INSERT INTO content_sources
						 (label, source_type, created_at, expires_at, content_hash, total_chunks, code_chunks)
						 VALUES (?, ?, ?, ?, ?, ?, ?)`,
					)
					.run(
						opts.label,
						opts.sourceType,
						now,
						opts.expiresAt ?? null,
						contentHash,
						chunks.length,
						codeCount,
					);
				sourceId = Number(r.lastInsertRowid);
			}
			const insert = this.#db.prepare<unknown>(
				`INSERT INTO content_chunks
				 (source_id, ordinal, content_type, title, body, byte_length)
				 VALUES (?, ?, ?, ?, ?, ?)`,
			);
			for (const c of chunks) {
				insert.run(sourceId, c.ordinal, c.contentType, c.title, c.body, c.byteLength);
			}
			return sourceId;
		});

		const sourceId = tx();
		return {
			sourceId: contentSourceIdUnsafe(sourceId),
			chunkCount: chunks.length,
			codeChunkCount: codeCount,
			contentHash,
			reused: false,
		};
	}

	/**
	 * Run a search query, RRF-merging the porter and trigram FTS results.
	 * Returns up to `maxResults` (default 5) snippets ranked by RRF score.
	 */
	search(query: string, opts: SearchOptions & RrfOptions = {}): SearchResult[] {
		const max = opts.maxResults ?? 5;
		const k = opts.k ?? RRF_K_DEFAULT;
		const trimmed = query.trim();
		if (trimmed.length === 0) return [];

		if (!this.capabilities.fts5) {
			return this.#searchLike(trimmed, max, opts.contentTypeFilter);
		}

		const porter = this.#runFtsQuery("porter", trimmed, max * 4);
		const trigram = this.capabilities.trigramTokenizer
			? this.#runFtsQuery("trigram", trimmed, max * 4)
			: [];

		const merged = mergeRrf(porter, trigram, k);
		if (merged.length === 0) return [];

		const ids = merged.map((m) => m.rowid);
		const rows = this.#chunksByIds(ids);
		const sources = this.#sourceMeta(rows.map((r) => r.source_id));

		const enriched: SearchResult[] = [];
		for (const m of merged) {
			const row = rows.find((r) => r.id === m.rowid);
			if (!row) continue;
			if (opts.contentTypeFilter && row.content_type !== opts.contentTypeFilter) continue;
			const src = sources.get(row.source_id);
			if (!src) continue;
			let score = m.rank;
			if (opts.sourceWeighted) score *= sourceWeight(src.source_type);
			if (opts.recencyBias) score *= recencyMultiplier(src.created_at);
			enriched.push({
				sourceId: contentSourceIdUnsafe(row.source_id),
				title: row.title,
				snippet: makeSnippet(row.body, trimmed),
				score,
				sourceLabel: src.label,
				contentType: row.content_type,
			});
		}
		enriched.sort((a, b) => b.score - a.score);
		return enriched.slice(0, max);
	}

	/** Return metadata for every registered source (most recent first). */
	listSources(): ContentSource[] {
		return this.#db
			.prepare<{
				id: number;
				label: string;
				source_type: ContentSource["sourceType"];
				created_at: string;
				expires_at: string | null;
				content_hash: string | null;
				total_chunks: number;
				code_chunks: number;
			}>(
				`SELECT id, label, source_type, created_at, expires_at,
				        content_hash, total_chunks, code_chunks
				 FROM content_sources
				 ORDER BY created_at DESC, id DESC`,
			)
			.all()
			.map((r) => ({
				id: contentSourceIdUnsafe(r.id),
				label: r.label,
				sourceType: r.source_type,
				createdAt: r.created_at,
				expiresAt: r.expires_at,
				totalChunks: r.total_chunks,
				codeChunks: r.code_chunks,
				contentHash: r.content_hash,
			}));
	}

	/** Delete a source and (via FK cascade) all of its chunks. */
	deleteSource(id: ContentSourceId): boolean {
		const r = this.#db.prepare<unknown>("DELETE FROM content_sources WHERE id = ?").run(id);
		return r.changes > 0;
	}

	#runFtsQuery(tokenizer: "porter" | "trigram", query: string, limit: number): RankedHit[] {
		const table = `content_chunks_fts_${tokenizer}`;
		const matchExpr = buildMatchExpr(query, tokenizer);
		try {
			const rows = this.#db
				.prepare<{ rowid: number; rank: number }>(
					`SELECT rowid, rank
					 FROM ${table}
					 WHERE ${table} MATCH ?
					 ORDER BY rank
					 LIMIT ?`,
				)
				.all(matchExpr, limit);
			return rows.map((r) => ({ rowid: r.rowid, rank: r.rank }));
		} catch {
			// Malformed FTS query (e.g. punctuation-only). Treat as empty.
			return [];
		}
	}

	#searchLike(query: string, max: number, typeFilter: ContentType | undefined): SearchResult[] {
		const like = `%${query.replace(/[%_]/g, (c) => `\\${c}`)}%`;
		const sql = typeFilter
			? `SELECT c.id, c.source_id, c.title, c.body, c.content_type,
			          s.label, s.source_type
			   FROM content_chunks c JOIN content_sources s ON s.id = c.source_id
			   WHERE c.body LIKE ? ESCAPE '\\' AND c.content_type = ?
			   LIMIT ?`
			: `SELECT c.id, c.source_id, c.title, c.body, c.content_type,
			          s.label, s.source_type
			   FROM content_chunks c JOIN content_sources s ON s.id = c.source_id
			   WHERE c.body LIKE ? ESCAPE '\\'
			   LIMIT ?`;
		const params = typeFilter ? [like, typeFilter, max] : [like, max];
		const rows = this.#db
			.prepare<{
				id: number;
				source_id: number;
				title: string;
				body: string;
				content_type: ContentType;
				label: string;
				source_type: ContentSource["sourceType"];
			}>(sql)
			.all(...params);
		return rows.map((r, i) => ({
			sourceId: contentSourceIdUnsafe(r.source_id),
			title: r.title,
			snippet: makeSnippet(r.body, query),
			score: 1 / (i + 1),
			sourceLabel: r.label,
			contentType: r.content_type,
		}));
	}

	#chunksByIds(ids: readonly number[]): ChunkRow[] {
		if (ids.length === 0) return [];
		const placeholders = ids.map(() => "?").join(",");
		return this.#db
			.prepare<ChunkRow>(
				`SELECT id, source_id, ordinal, content_type, title, body
				 FROM content_chunks WHERE id IN (${placeholders})`,
			)
			.all(...ids);
	}

	#sourceMeta(
		ids: readonly number[],
	): Map<number, { label: string; source_type: ContentSource["sourceType"]; created_at: string }> {
		const out = new Map<
			number,
			{ label: string; source_type: ContentSource["sourceType"]; created_at: string }
		>();
		if (ids.length === 0) return out;
		const placeholders = ids.map(() => "?").join(",");
		const rows = this.#db
			.prepare<{
				id: number;
				label: string;
				source_type: ContentSource["sourceType"];
				created_at: string;
			}>(
				`SELECT id, label, source_type, created_at
				 FROM content_sources WHERE id IN (${placeholders})`,
			)
			.all(...ids);
		for (const r of rows) {
			out.set(r.id, {
				label: r.label,
				source_type: r.source_type,
				created_at: r.created_at,
			});
		}
		return out;
	}
}

/* ---------------- helpers ---------------- */

function probeCapabilities(db: Database): ContentIndexCapabilities {
	let fts5 = false;
	let trigram = false;
	try {
		db.exec("CREATE VIRTUAL TABLE _aegis_fts5_probe USING fts5(x, tokenize='porter unicode61')");
		fts5 = true;
		db.exec("DROP TABLE _aegis_fts5_probe");
	} catch {
		fts5 = false;
	}
	if (fts5) {
		try {
			db.exec("CREATE VIRTUAL TABLE _aegis_fts5_trigram_probe USING fts5(x, tokenize='trigram')");
			trigram = true;
			db.exec("DROP TABLE _aegis_fts5_trigram_probe");
		} catch {
			trigram = false;
		}
	}
	return { fts5, trigramTokenizer: trigram };
}

/**
 * Reciprocal Rank Fusion. Each input list is assumed to be sorted ascending by
 * its native rank score (FTS5's `rank` is more-negative-is-better, and we
 * already used `ORDER BY rank` so the array index *is* the rank). We sum
 * `1 / (k + position)` across both lists and sort descending.
 */
export function mergeRrf(
	listA: readonly RankedHit[],
	listB: readonly RankedHit[],
	k: number,
): RankedHit[] {
	const map = new Map<number, RankedHit>();
	const fold = (list: readonly RankedHit[], key: "porterRank" | "trigramRank") => {
		for (let i = 0; i < list.length; i++) {
			const hit = list[i];
			if (!hit) continue;
			const score = 1 / (k + i + 1);
			const prev = map.get(hit.rowid);
			if (prev) {
				prev.rank += score;
				prev[key] = i + 1;
			} else {
				map.set(hit.rowid, {
					rowid: hit.rowid,
					rank: score,
					[key]: i + 1,
				});
			}
		}
	};
	fold(listA, "porterRank");
	fold(listB, "trigramRank");
	return [...map.values()].sort((a, b) => b.rank - a.rank);
}

/**
 * Build an FTS5 MATCH expression for a free-text query. Tokens are wrapped
 * in double quotes so SQL injection / FTS operator-character abuse is
 * impossible. The trigram tokenizer doesn't understand operators (NEAR, AND)
 * — we pass quoted phrases for both backends to keep behavior consistent.
 */
export function buildMatchExpr(query: string, _tokenizer: "porter" | "trigram"): string {
	const tokens = query
		.split(/\s+/)
		.map((t) => t.replace(/["\\]/g, ""))
		.filter((t) => t.length > 0);
	if (tokens.length === 0) return '""';
	return tokens.map((t) => `"${t}"`).join(" ");
}

function sourceWeight(t: ContentSource["sourceType"]): number {
	switch (t) {
		case "session-events":
			return 1.5;
		case "manual":
			return 1.2;
		case "file":
			return 1.0;
		case "url":
			return 0.85;
	}
}

function recencyMultiplier(createdAt: string): number {
	const ts = Date.parse(createdAt);
	if (Number.isNaN(ts)) return 1;
	const ageDays = Math.max(0, (Date.now() - ts) / (1000 * 60 * 60 * 24));
	// Half-life 30 days; clamps to [0.5, 1.5] so recency tweaks never dominate.
	return 0.5 + Math.exp(-ageDays / 30);
}

function makeSnippet(body: string, query: string): string {
	const tokens = query
		.split(/\s+/)
		.filter((t) => t.length > 1)
		.map((t) => t.toLowerCase());
	const lower = body.toLowerCase();
	let bestIdx = -1;
	for (const t of tokens) {
		const idx = lower.indexOf(t);
		if (idx >= 0 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx;
	}
	if (bestIdx < 0) return body.slice(0, 200);
	const start = Math.max(0, bestIdx - 60);
	const end = Math.min(body.length, bestIdx + 200);
	const head = start > 0 ? "…" : "";
	const tail = end < body.length ? "…" : "";
	return head + body.slice(start, end) + tail;
}

/** Synchronous SHA-256 hex digest of `text` (UTF-8). */
function sha256Hex(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}
