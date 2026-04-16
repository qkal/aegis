# ADR-0008: Sandbox Isolation Levels

## Status

Accepted

## Date

2025-01-15

## Context

The reference project's "sandbox" is not a sandbox — it's a child process that captures stdout. It inherits the parent's environment variables, has full filesystem access, and can make arbitrary network connections. The README advertises credential passthrough as a feature.

Aegis needs honest, layered isolation that clearly communicates what it does and doesn't protect against.

## Decision

Implement **three isolation levels**, with Level 1 as the default and higher levels as progressive hardening:

### Level 1: Process Isolation (Default)
- `child_process.spawn` with `detached: true` and new process group
- Environment explicitly constructed (not inherited): only `PATH`, `HOME`, `LANG`, `TERM`, and user-allowed vars
- Working directory set to temporary directory (not project root)
- stdout/stderr captured; only stdout enters agent context
- Process killed on timeout via `SIGKILL` to entire process group

### Level 2: Filesystem Scoping (Hardened)
- Restricted `PATH` with only declared runtimes
- Temporary directories with `0o700` permissions
- Read-only access to project directory (when needed)
- No access to `~/.ssh`, `~/.aws`, `~/.config`, `~/.gnupg`

### Level 3: Namespace Isolation (Future)
- Linux: `unshare` for PID/network namespace isolation
- macOS: `sandbox-exec` profile
- Fallback to Level 1 with monitoring

## Rationale

- **Honest about limits**: Level 1 is NOT a security boundary against a determined attacker. It prevents accidental credential leakage and casual data access. We document this explicitly.
- **Defense in depth**: Each level adds constraints. Level 1 + policy evaluation + audit logging creates meaningful protection even without kernel-level isolation.
- **No credential passthrough by default**: The most impactful security improvement over the reference. Sandboxed code starts with nothing and the user grants access.
- **Progressive hardening**: Users in sensitive environments can enable Level 2 or 3. Most users are well-served by Level 1.

## Consequences

- Level 1 is not a security boundary. This must be documented prominently.
- Level 3 requires elevated privileges on some systems. It's opt-in and Phase 3+.
- macOS `sandbox-exec` is deprecated but functional. Long-term macOS isolation strategy is uncertain.
- Environment construction (building the explicit env var set) adds startup latency to every sandbox execution.
