# Plan 15 — `aegisctx doctor` failure-mode snapshot tests

**Priority:** P0-10.
**Size:** Small.
**Dependencies:** Plans 04, 05, 07, 08, 09, 10, 11 (each defines a
failure mode; snapshots must cover them).

## Why

`aegisctx doctor` is the single most-important DX moment for a new
user. Every documented failure mode in `PLAN.md §10.4` must produce
(a) an accurate pass/warn/fail status, (b) a concrete fix suggestion,
(c) stable output we can regression-test.

## Failure modes in scope

| # | Mode | Expected status | Fix hint |
|---|---|---|---|
| 1 | Node < 22 | fail | Upgrade to Node 22.0.0+ |
| 2 | Python runtime missing | warn | Install `python3` or (Windows) the `py` launcher |
| 3 | SQLite FTS5 unavailable | fail | Switch storage backend or rebuild binding |
| 4 | Audit key missing | warn | `aegisctx audit init` or wait for auto-create |
| 5 | Audit key wrong perms (POSIX) | fail | `chmod 600 ~/.aegisctx/audit-key` |
| 6 | Audit key wrong ACL (Windows) | fail | `icacls` rewrite command snippet |
| 7 | Audit chain broken | fail | Run `aegisctx audit verify` for the break point |
| 8 | Policy file invalid JSON | fail | Show file + line + column |
| 9 | Policy file denies every allowlist — sanity warn | warn | Suggest `aegisctx policy check` |
| 10 | Claude Code hooks not registered | warn | Re-run `aegisctx init claude-code` |
| 11 | Codex `codex_hooks` flag disabled | warn | One-line TOML edit snippet |
| 12 | Codex `config.toml` syntax-invalid | fail | Show parse error |
| 13 | OpenCode plugin not importable | warn | `npm install @aegisctx/opencode-plugin` |
| 14 | VS Code Codex extension MCP entry malformed | warn | Show JSON path + expected shape |
| 15 | Sandbox tempdir perms wrong (POSIX) | fail | `chmod 700` |
| 16 | Sandbox tempdir ACL wrong (Windows) | fail | `icacls` snippet |
| 17 | PowerShell execution policy too restrictive (Windows) | warn | `Set-ExecutionPolicy` snippet |
| 18 | `py` launcher missing (Windows) | warn | Install link |
| 19 | `AEGISCTX_NO_NETWORK=1` active | info | Inform user offline mode is on |
| 20 | Capability tier downgraded | warn | Explain why, per adapter probe |
| 21 | Migration pending on session DB | fail | `aegisctx session migrate` |
| 22 | Content DB schema mismatch | fail | Same |
| 23 | Corrupt session DB | fail | Renamed-then-recreated message |

## Design

### Test harness

- `packages/cli/src/commands/doctor.test.ts` — one `describe` per
  failure mode.
- Each test uses a `VirtualEnv` helper that constructs a fake
  filesystem (via `memfs`) + fake `os.platform()` + fake runtime
  probes, invokes `runDoctor(env)`, and snapshots the structured
  output.
- Snapshot format: the *structured* `DoctorReport` object, not the
  ANSI-rendered string. Rendering is tested separately with a single
  golden rendering test.

### `DoctorReport` shape

```ts
interface DoctorReport {
  readonly overall: 'pass' | 'warn' | 'fail';
  readonly sections: readonly DoctorSection[];
  readonly summary: { pass: number; warn: number; fail: number };
}
interface DoctorSection {
  readonly name: string;
  readonly checks: readonly DoctorCheck[];
}
interface DoctorCheck {
  readonly id: string;            // stable: 'node-version', 'audit-key-perms', ...
  readonly status: 'pass' | 'warn' | 'fail' | 'info';
  readonly message: string;
  readonly fixHint?: string;      // copy-paste-safe command
}
```

## Deliverables

1. **`packages/cli/src/commands/doctor/`**
   - [ ] Split the current `doctor.ts` into one file per section
     (`platform.ts`, `runtimes.ts`, `storage.ts`, `audit.ts`,
     `policy.ts`, `hooks.ts`, `sandbox.ts`, `network.ts`,
     `capabilities.ts`).
   - [ ] Each exports `runSection(env): Promise<DoctorSection>`.
2. **`@aegisctx/core/src/doctor-types.ts`**
   - [ ] The types above, shared with server (so
     `aegisctx_doctor` MCP tool returns the same shape).
3. **Test harness**
   - [ ] `packages/cli/src/commands/doctor/virtual-env.ts` — mock
     filesystem + runtime probe + env var injection.
4. **23 snapshot tests**, one per failure mode.
5. **Render golden**
   - [ ] `packages/cli/src/commands/doctor/render.test.ts` — ANSI
     render of a representative mixed-status report.

## Acceptance criteria

- All 23 failure modes have a passing snapshot test.
- Running `aegisctx doctor --json` on a failure-mode fixture produces
  the asserted `DoctorReport` shape.
- Renderer test asserts no secrets or env var *values* leak into
  output (only names).

## Test strategy

- All tests run on all three OSes (plan 06) with conditional
  `describe.skipIf` for platform-specific modes.

## Out of scope

- Actually fixing the issues discovered (that's the user's job via
  the fix hints).
- Phone-home telemetry of doctor runs. Never.

## Risks

- **Snapshot churn as fix hints evolve.** Mitigation: keep fix hints
  in a central map (`packages/cli/src/commands/doctor/fix-hints.ts`)
  so they're easy to update without touching 23 snapshots.
