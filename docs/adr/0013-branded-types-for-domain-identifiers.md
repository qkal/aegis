# ADR-0013: Branded Types for Domain Identifiers

## Status

Accepted

## Date

2025-01-15

## Context

Aegis uses string and number identifiers for sessions, events, policies, audit entries, and content sources. Without type-level distinction, it's easy to accidentally pass a `SessionId` where an `EventId` is expected — both are strings at runtime.

## Decision

Use **branded types** (nominal typing via intersection with a unique symbol) for all domain identifiers:

```typescript
declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

type SessionId = Brand<string, "SessionId">;
type EventId = Brand<string, "EventId">;
type PolicyId = Brand<string, "PolicyId">;
type AuditEntryId = Brand<string, "AuditEntryId">;
type ContentSourceId = Brand<number, "ContentSourceId">;
```

Constructor functions validate and create branded values:
```typescript
function sessionId(raw: string): SessionId { return raw as SessionId; }
```

## Rationale

- **Compile-time safety**: `function getEvent(id: EventId)` cannot be called with a `SessionId`. TypeScript catches this at compile time.
- **Zero runtime cost**: Branded types are erased at compile time. No runtime wrapper objects, no performance impact.
- **Self-documenting**: Function signatures clearly communicate which identifier type is expected.
- **Consistent with Rule R11**: Typed contracts everywhere — no stringly-typed IDs.

## Consequences

- All ID creation must go through constructor functions (enforced by convention, not runtime).
- Branded types add syntactic overhead to type annotations.
- External JSON deserialization must explicitly construct branded IDs (via Zod transforms or manual construction).
- The `__brand` symbol is never accessed at runtime — it exists only for the type checker.
