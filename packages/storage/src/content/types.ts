/**
 * Content index types.
 *
 * FTS5-backed content indexing with dual Porter stemming + trigram search,
 * merged via Reciprocal Rank Fusion (RRF) for ranked retrieval.
 */

import type { ContentSourceId } from "@aegis/core";

/**
 * Canonical content-type classification for indexed chunks.
 *
 * Defined as a single union so `SearchResult.contentType` and
 * `SearchOptions.contentTypeFilter` stay in lock-step; adding a new
 * category is a one-line change that the compiler then propagates.
 */
export type ContentType = "code" | "prose";

/** A content source registered in the index. */
export interface ContentSource {
	readonly id: ContentSourceId;
	readonly label: string;
	readonly sourceType: "file" | "url" | "session-events" | "manual";
	readonly createdAt: string;
	readonly expiresAt: string | null;
	readonly totalChunks: number;
	readonly codeChunks: number;
	readonly contentHash: string | null;
}

/** A search result from the content index. */
export interface SearchResult {
	readonly sourceId: ContentSourceId;
	readonly title: string;
	readonly snippet: string;
	readonly score: number;
	readonly sourceLabel: string;
	readonly contentType: ContentType;
}

/** Options for content indexing. */
export interface IndexOptions {
	readonly label: string;
	readonly sourceType: ContentSource["sourceType"];
	readonly expiresAt?: string;
	readonly maxChunkBytes?: number;
}

/** Options for content search. */
export interface SearchOptions {
	readonly maxResults?: number;
	readonly contentTypeFilter?: ContentType;
	readonly recencyBias?: boolean;
	readonly sourceWeighted?: boolean;
}
