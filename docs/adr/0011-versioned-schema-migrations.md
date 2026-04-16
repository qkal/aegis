# ADR-0011: Versioned Schema Migrations

## Status

Accepted

## Date

2025-01-15

## Context

The reference project manages SQLite schema changes with ad-hoc `ALTER TABLE` checks scattered across constructors. There is no migration versioning, no way to track which migrations have been applied, and no guarantee of idempotency.

## Decision

Implement a **numbered, forward-only migration system**:

```typescript
interface Migration {
	version: number; // Sequential: 1, 2, 3, ...
	description: string; // Human-readable: "Add expires_at to sources"
	up: (db: Database) => void; // Forward migration only
}
```

Migrations are applied at database open time:

1. Create `schema_version` table if not exists
2. Read current version (`MAX(version)`)
3. Apply all migrations with version > current, in order, inside transactions
4. Each migration inserts its version into `schema_version` on success

No rollbacks. If a migration fails, the database is left at the previous version and the error is reported.

## Rationale

- **Deterministic schema state**: Given a version number, the exact schema is known.
- **Idempotent application**: Running migrations twice is safe (already-applied migrations are skipped).
- **Forward-only**: Rollbacks are dangerous in production. If a migration is wrong, a new migration fixes it.
- **Transactional**: Each migration runs inside a transaction. A failed migration doesn't leave the schema in a partial state.
- **No ad-hoc ALTER TABLE**: All schema changes go through the migration system. This is the single source of truth for schema history.

## Consequences

- Every schema change requires a new migration file, even small ones.
- Migration numbering must be strictly sequential (no gaps, no duplicates).
- Rollbacks are not supported. This is intentional — forward-only is safer.
- Migration testing requires running the full migration sequence from version 0 on an empty database.
