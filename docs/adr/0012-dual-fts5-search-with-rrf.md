# ADR-0012: Dual FTS5 Search with Reciprocal Rank Fusion

## Status

Accepted

## Date

2025-01-15

## Context

Aegis indexes content into a local knowledge base for retrieval by the AI agent. The search system must handle:

- Semantic queries ("how does authentication work")
- Exact substring matches ("handleAuthCallback")
- Multi-term queries with proximity relevance
- Fast queries (<10ms on 10K chunks)

## Decision

Use **dual FTS5 tables** with **Reciprocal Rank Fusion (RRF)** merge:

1. **Porter stemming FTS5 table**: `tokenize='porter unicode61'` for semantic/natural language search
2. **Trigram FTS5 table**: `tokenize='trigram'` for substring and partial matching

Search pipeline:
```
Query → [Porter FTS5 MATCH] → ranked list A
      → [Trigram FTS5 MATCH] → ranked list B
      → RRF merge (k=60, configurable)
      → Proximity reranking (multi-term queries)
      → Smart snippet extraction
      → Results (max 5 per query, configurable)
```

Improvements over the reference:
- Configurable RRF k-parameter
- Source-weighted scoring (session events > URL content)
- Recency bias (newer content scores higher for equal relevance)
- Content-type filtering at query time (`code` vs `prose`)

## Rationale

- **FTS5 is built into SQLite**: No additional dependencies. Available everywhere SQLite runs.
- **Dual indexing covers both use cases**: Porter stemming handles natural language ("find the auth logic"). Trigram handles code identifiers ("handleAuthCallback").
- **RRF is simple and effective**: No model weights to tune. The k-parameter controls how much to favor top results.
- **<10ms query latency**: FTS5 on 10K chunks is well within budget. No need for external search infrastructure.

## Consequences

- Dual indexing doubles storage for content (Porter + trigram tables).
- FTS5 trigram tokenizer can be slow on very large corpora (>100K chunks). Benchmark required.
- If FTS5 is unavailable (rare, but possible on custom SQLite builds), search falls back to LIKE queries.
- RRF k-parameter tuning may be needed based on real-world usage patterns.
