export type { ChunkOptions, RawChunk } from "./chunk.js";
export { chunkContent, classifyContent, DEFAULT_MAX_CHUNK_BYTES } from "./chunk.js";
export type { ContentIndexCapabilities, IndexedSourceResult, RrfOptions } from "./index-impl.js";
export { buildMatchExpr, ContentIndex, mergeRrf } from "./index-impl.js";
export { CONTENT_INDEX_MIGRATIONS } from "./schema.js";
export type {
	ContentSource,
	ContentType,
	IndexOptions,
	SearchOptions,
	SearchResult,
} from "./types.js";
