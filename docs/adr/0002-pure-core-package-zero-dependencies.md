# ADR-0002: Pure Core Package with Zero Dependencies

## Status

Accepted

## Date

2025-01-15

## Context

The policy engine, event model, and routing logic are the most critical components of Aegis. They define the security posture and architectural contracts. These components must be:

- Testable without setup, mocking, or I/O
- Auditable by security reviewers without chasing through dependency trees
- Deterministic — same input always produces same output

## Decision

`@aegis/core` has **zero npm dependencies** and **zero I/O**. It contains only:

- Branded type definitions (`SessionId`, `EventId`, `PolicyId`, etc.)
- Discriminated union event model (`SessionEvent`, `FileEvent`, `GitEvent`, etc.)
- Policy schema and evaluation functions (pure functions)
- Routing decision logic (pure functions)
- Glob matching utilities

The package uses only TypeScript language features. No `fs`, no `net`, no `child_process`, no third-party libraries.

## Rationale

- **Zero-setup testing**: Every function in core can be tested with `import` + `assert`. No database, no filesystem, no network.
- **Supply chain safety**: Zero dependencies means zero transitive vulnerabilities in the security-critical path.
- **Auditability**: A security reviewer can read the entire policy engine without consulting `node_modules`.
- **Determinism**: Pure functions with no I/O guarantee deterministic behavior — same policy + same tool call = same decision, every time. This is verifiable with property-based tests.

## Consequences

- Any feature that requires I/O must live in a different package (`engine`, `storage`, `server`).
- Utilities that seem "core" but need dependencies (e.g., Zod schema validation) are placed at the package boundary that consumes them, not in core.
- Core types are re-exported by downstream packages, so consumers rarely import from `@aegis/core` directly.
