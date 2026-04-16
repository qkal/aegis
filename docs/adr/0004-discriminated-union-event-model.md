# ADR-0004: Discriminated Union Event Model

## Status

Accepted

## Date

2025-01-15

## Context

The reference project uses a flat event model: `{ type: string; category: string; data: string; priority: number }`. This is a bag of strings with no type-level guarantees:

- Cannot distinguish event shapes at the type level
- Cannot validate event payloads per-kind
- Cannot evolve event schemas without breaking consumers
- Cannot query by structured fields (everything is in `data: string`)

## Decision

Use **TypeScript discriminated unions** with a `kind` field as the discriminant for all session events:

```typescript
type SessionEvent =
	| FileEvent // kind: "file"
	| GitEvent // kind: "git"
	| TaskEvent // kind: "task"
	| ErrorEvent // kind: "error"
	| DecisionEvent // kind: "decision"
	| RuleEvent // kind: "rule"
	| EnvironmentEvent // kind: "environment"
	| ExecutionEvent // kind: "execution"
	| SearchEvent // kind: "search"
	| PromptEvent; // kind: "prompt"
```

Each event kind has:

- A fixed `kind` discriminant
- Kind-specific payload fields (e.g., `FileEvent` has `path`; `GitEvent` has `ref`)
- A fixed `priority` level (not user-configurable per-event)

## Rationale

- **Exhaustive pattern matching**: `switch (event.kind)` with TypeScript's `--noFallthroughCasesInSwitch` ensures every handler covers all event kinds.
- **Per-kind validation**: Each event kind can have its own Zod schema for runtime validation at storage boundaries.
- **Schema evolution**: Adding a new event kind is additive — existing consumers continue to work (they just don't handle the new kind until updated).
- **Structured queries**: Events can be queried by `kind`, `action`, `path`, etc. instead of parsing a `data: string` blob.
- **Serialization safety**: The `kind` field serves as a version discriminator when reading events from SQLite.

## Consequences

- Adding a new event kind requires updating the union type and all exhaustive switch statements.
- Serialization to/from SQLite must handle the discriminated union correctly (JSON column with `kind` field).
- Event model changes are more visible in diffs (each kind is a separate interface) but also more verbose.
