# ADR-0005: HMAC-Chained Append-Only Audit Log

## Status

Accepted

## Date

2025-01-15

## Context

Aegis makes security-relevant decisions on every tool call: allow, deny, sandbox, prompt. There is no structured record of these decisions in the reference project. A user cannot answer "what did the agent do on my machine?" after the fact.

For a security tool to be trustworthy, its decisions must be inspectable and tamper-evident.

## Decision

Implement an **append-only, HMAC-chained audit log** stored in a separate SQLite database per project:

```typescript
interface AuditEntry {
  id: AuditEntryId;          // UUIDv7 (time-sorted)
  timestamp: string;          // ISO-8601 UTC
  sessionId: SessionId;
  category: AuditCategory;    // "policy_eval" | "sandbox_exec" | "content_index" | ...
  action: string;             // "deny_command" | "allow_command" | ...
  subject: string;            // what was evaluated
  decision: "allow" | "deny" | "ask" | "error";
  reason: string;             // human-readable explanation
  context: Record<string, unknown>;
  prevHmac: string;           // HMAC of previous entry
  hmac: string;               // HMAC(key, id + timestamp + ... + prevHmac)
}
```

- **HMAC key**: Derived from a machine-local secret created on first run, stored at `~/.aegis/audit-key` with `0o600` permissions.
- **Chain integrity**: Each entry's HMAC includes the previous entry's HMAC. Modifying any entry breaks the chain from that point forward.
- **Verification**: `aegis audit verify` walks the chain and reports any breaks.

## Rationale

- **Forensic integrity**: The HMAC chain detects post-hoc tampering. If someone modifies an audit entry, the chain breaks and `aegis audit verify` reports it.
- **Not DRM**: This is forensic integrity, not prevention. A determined attacker with disk access can regenerate the chain. The goal is to detect accidental or casual tampering, not resist nation-state adversaries.
- **Separate database**: Audit data has different retention, access patterns, and integrity requirements than session data. Separating them prevents corruption in one from affecting the other.
- **Human-readable**: Every audit entry includes a `reason` field explaining the decision in plain language.

## Consequences

- HMAC computation adds latency to every audit write. Benchmark target: <1ms per entry.
- The audit key must be protected. If lost, the chain cannot be verified (but entries are still readable).
- Audit log grows indefinitely. `aegis audit purge --before <date>` provides manual cleanup.
- If the audit logger cannot write (disk full, permission error), operations are BLOCKED per Rule R10 (no silent degradation in safety-critical flows).
