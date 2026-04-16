/**
 * Schema migrations for the content index.
 *
 * Three tables backing the dual-FTS5 search per ADR-0012:
 *
 *   content_sources             — registered sources (file / url / session-events / manual)
 *   content_chunks              — fact-table of indexed chunks
 *   content_chunks_fts_porter   — FTS5 virtual table tokenized with `porter unicode61`
 *   content_chunks_fts_trigram  — FTS5 virtual table tokenized with `trigram`
 *
 * Both FTS5 tables are external-content tables (`content='content_chunks'`)
 * so the body text is stored exactly once. INSERT / DELETE / UPDATE triggers
 * keep both FTS indexes in sync.
 *
 * If the host SQLite was built without FTS5 the migration falls back to a
 * plain index; `ContentIndex.search` then degrades to LIKE queries (per
 * ADR-0014 we surface degradation explicitly via `BackendCapabilities`).
 */

import type { Migration } from "../migrations/types.js";

/** All migrations the content index requires. */
export const CONTENT_INDEX_MIGRATIONS: readonly Migration[] = [
	{
		version: 1,
		description: "content index: sources + chunks + dual FTS5",
		up: (db) => {
			db.exec(`
				CREATE TABLE content_sources (
					id           INTEGER PRIMARY KEY AUTOINCREMENT,
					label        TEXT    NOT NULL,
					source_type  TEXT    NOT NULL CHECK (source_type IN ('file','url','session-events','manual')),
					created_at   TEXT    NOT NULL,
					expires_at   TEXT,
					content_hash TEXT,
					total_chunks INTEGER NOT NULL DEFAULT 0,
					code_chunks  INTEGER NOT NULL DEFAULT 0
				);

				CREATE INDEX content_sources_created_at_idx
					ON content_sources (created_at DESC);

				CREATE TABLE content_chunks (
					id           INTEGER PRIMARY KEY AUTOINCREMENT,
					source_id    INTEGER NOT NULL REFERENCES content_sources(id) ON DELETE CASCADE,
					ordinal      INTEGER NOT NULL,
					content_type TEXT    NOT NULL CHECK (content_type IN ('code','prose')),
					title        TEXT    NOT NULL,
					body         TEXT    NOT NULL,
					byte_length  INTEGER NOT NULL,
					UNIQUE (source_id, ordinal)
				);

				CREATE INDEX content_chunks_source_idx ON content_chunks (source_id);
				CREATE INDEX content_chunks_type_idx   ON content_chunks (content_type);
			`);
			// FTS5 virtual tables. We use external-content mode keyed off
			// content_chunks.id so FTS only stores the inverted index, not
			// duplicate body text. Wrapped in try-catch so that if FTS5 is
			// unavailable the core tables are still created and search
			// degrades to LIKE queries (per ADR-0012 / ADR-0014).
			try {
				db.exec(`
					CREATE VIRTUAL TABLE content_chunks_fts_porter USING fts5(
						body,
						content='content_chunks',
						content_rowid='id',
						tokenize='porter unicode61'
					);

					CREATE VIRTUAL TABLE content_chunks_fts_trigram USING fts5(
						body,
						content='content_chunks',
						content_rowid='id',
						tokenize='trigram'
					);
				`);
				// Triggers keep both FTS tables in sync with the canonical chunks
				// table. Because the FTS tables are external-content, we issue the
				// special `delete` row to clean them up on UPDATE/DELETE.
				db.exec(`
					CREATE TRIGGER content_chunks_ai AFTER INSERT ON content_chunks BEGIN
						INSERT INTO content_chunks_fts_porter  (rowid, body) VALUES (new.id, new.body);
						INSERT INTO content_chunks_fts_trigram (rowid, body) VALUES (new.id, new.body);
					END;

					CREATE TRIGGER content_chunks_ad AFTER DELETE ON content_chunks BEGIN
						INSERT INTO content_chunks_fts_porter  (content_chunks_fts_porter, rowid, body)
							VALUES ('delete', old.id, old.body);
						INSERT INTO content_chunks_fts_trigram (content_chunks_fts_trigram, rowid, body)
							VALUES ('delete', old.id, old.body);
					END;

					CREATE TRIGGER content_chunks_au AFTER UPDATE ON content_chunks BEGIN
						INSERT INTO content_chunks_fts_porter  (content_chunks_fts_porter, rowid, body)
							VALUES ('delete', old.id, old.body);
						INSERT INTO content_chunks_fts_trigram (content_chunks_fts_trigram, rowid, body)
							VALUES ('delete', old.id, old.body);
						INSERT INTO content_chunks_fts_porter  (rowid, body) VALUES (new.id, new.body);
						INSERT INTO content_chunks_fts_trigram (rowid, body) VALUES (new.id, new.body);
					END;
				`);
			} catch {
				// FTS5 unavailable — ContentIndex.capabilities will detect
				// this at runtime and fall back to LIKE-based search.
			}
		},
	},
];
