# ADR-0014: Explicit Failure Modes, No Silent Degradation in Safety-Critical Flows

## Status

Accepted

## Date

2025-01-15

## Context

The reference project uses `try/catch` with silent fallback when FTS5 is unavailable, when SQLite adapters fail to load, or when runtimes aren't found. There is no structured capability reporting. Failures are absorbed silently.

For a security tool, silent failure is worse than loud failure. A user who thinks policy is being enforced when it isn't has a false sense of security.

## Decision

Adopt two rules from the ground-up rules (R9, R10):

### R9: Explicit Failure Modes
- Every operation that can fail has a typed error result (discriminated union or Result type).
- No silent swallowing of exceptions in security-critical paths.
- Failures are reported to the user AND the agent with actionable context.
- The system degrades gracefully but never silently drops security guarantees.

### R10: No Silent Degradation in Safety-Critical Flows
- If the policy engine cannot evaluate a rule → tool call is **DENIED**, not allowed.
- If the audit logger cannot write → operation is **BLOCKED**, not silently unlogged.
- If a required component fails → explicit error to user, not silent fallback.

### Non-safety degradation is allowed:
- FTS5 unavailable → fall back to LIKE queries (slower, but not a security issue).
- Missing runtime → report error with install instructions (not a security issue).
- These are logged as warnings via `aegis doctor`.

## Rationale

- **Security-critical path clarity**: The distinction between "safety-critical" and "convenience" degradation is explicit. Safety never degrades silently.
- **Auditability**: If the audit log can't write, continuing to process tool calls would create unaudited actions — a violation of the audit guarantee.
- **User trust**: Users can verify the system's capability level via `aegis doctor` and trust that what it reports is accurate.
- **Debuggability**: Typed errors with context make it possible to diagnose failures after the fact.

## Consequences

- Operations may fail loudly when the reference project would have silently continued. This is intentional.
- Disk full → audit writes blocked → tool calls blocked. This may frustrate users, but the alternative (unaudited tool calls) is worse for a security tool.
- Error handling adds code volume. Every fallible operation needs explicit handling.
