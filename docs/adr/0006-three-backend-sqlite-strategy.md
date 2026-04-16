# ADR-0006: Three-Backend SQLite Strategy

## Status

Accepted

## Date

2025-01-15

## Context

Aegis uses SQLite for all local persistence (sessions, content index, audit log). Three SQLite bindings exist in the Node.js ecosystem:

1. **better-sqlite3** — Most mature, synchronous API, native addon (requires node-gyp)
2. **node:sqlite** — Built into Node.js 22+, no native addon, but API differs
3. **bun:sqlite** — Built into Bun runtime, different API again

The reference project has three separate adapter classes with manual API bridging and `any` types.

## Decision

Implement a **unified `Database` interface** in `@aegis/storage` that abstracts over all three backends:

```typescript
interface Database {
	prepare<TRow>(sql: string): PreparedStatement<TRow>;
	exec(sql: string): void;
	transaction<T>(fn: () => T): () => T;
	close(): void;
}
```

Backend selection priority:

1. `node:sqlite` (Node.js 22+) — preferred, no native addon
2. `bun:sqlite` (Bun runtime) — preferred on Bun
3. `better-sqlite3` (fallback) — widest compatibility

Each backend has a thin adapter that implements `Database`. Storage code never touches backend-specific APIs.

## Rationale

- **No native addon on modern Node**: `node:sqlite` eliminates the most common installation failure (node-gyp build errors on Windows, Alpine, CentOS).
- **Bun compatibility**: Bun users get native SQLite without any npm dependency.
- **Typed interface**: The `Database` interface uses generics for row types instead of `any`. `PreparedStatement<TRow>` provides type-safe row access.
- **Single abstraction**: Storage code is written once against the interface. Backend differences are confined to adapter files.
- **Testability**: In-memory databases (`:memory:`) work identically across all backends.

## Consequences

- The `Database` interface is a lowest-common-denominator abstraction. Backend-specific features (e.g., better-sqlite3's `pragma` method) are not exposed.
- Backend auto-detection adds complexity to startup.
- Integration tests must run against all three backends in CI.
- `better-sqlite3` is the only option for Node.js < 22.
