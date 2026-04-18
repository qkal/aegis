# ADR-0003: Capability-Based Policy Engine

## Status

Accepted

## Date

2025-01-15

## Context

The reference project (context-mode) uses glob pattern matching against Claude Code's `settings.json` deny/allow lists. This has limitations:

- No process-level isolation — sandbox inherits parent environment
- Glob bypasses exist for command chaining, subshells, heredocs
- Single policy format tied to Claude Code
- No structured audit of policy decisions

Aegis needs a policy engine that is platform-agnostic, auditable, and evaluates multiple dimensions (tool calls, env vars, filesystem paths, network access).

## Decision

Implement a **declarative, multi-dimensional policy engine** with:

1. **Evaluation order**: deny → ask → allow → default-deny
2. **Four policy dimensions**:
   - `tools`: Tool call patterns (e.g., `Bash(sudo *)`, `Read(.env*)`)
   - `sandbox.env`: Environment variable allow/deny patterns
   - `sandbox.fs`: Filesystem path read/write/deny patterns
   - `sandbox.net`: Network host:port allow/deny patterns
3. **Scope hierarchy**: project-local > project-shared > user-global > built-in defaults
4. **Static per session**: Policy is loaded at session start and not hot-reloaded (prevents TOCTOU races)

```typescript
type PolicyDecision =
	| { verdict: "allow"; matchedRule: string; }
	| { verdict: "deny"; matchedRule: string; reason: string; }
	| { verdict: "ask"; matchedRule: string; prompt: string; }
	| { verdict: "default_deny"; reason: string; };
```

## Rationale

- **Deny-first**: Default posture is deny-unless-allowed. This is the correct security default — users opt into permissions, not out of restrictions.
- **Multi-dimensional**: Evaluating env vars, filesystem, and network separately prevents bypass via one dimension when another is blocked.
- **Platform-agnostic**: The policy schema is Aegis-specific, not tied to any agent platform's config format.
- **Static loading**: Prevents an attacker from modifying the policy file mid-session to escalate privileges.
- **Deterministic**: Pure evaluation function with no side effects enables property-based testing (10K random inputs).

## Consequences

- Users must learn Aegis's policy format (not just their platform's settings).
- `ask` mode requires a mechanism to prompt the user and record their decision.
- Policy changes require session restart (no hot-reload).
- Default deny may frustrate users initially — clear error messages and `aegisctx policy check` CLI command mitigate this.
