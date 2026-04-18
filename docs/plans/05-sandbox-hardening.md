# Plan 05 — Hardened sandbox defaults (M2.2 slice)

**Priority:** P0-3. Ship before public users adopt loose defaults.
**Size:** Medium. Split into POSIX slice (week 1) and Windows slice
(week 3).
**Dependencies:** Plan 04 (audit writes on sandbox events); plan 07
(Windows engine for the Windows slice).

## Why

README sells "least privilege" and "no credential passthrough by
default." Today `PolyglotExecutor` inherits more of the parent env than
it should. We tighten defaults now so we don't have to break users
later.

## Deliverables — POSIX slice (week 1)

1. **Default policy emitted by `aegisctx init`**
   - [ ] Deny in `sandbox.env.deny`: `AWS_*`, `AMAZON_*`, `GH_TOKEN`,
     `GITHUB_TOKEN`, `GITHUB_PAT`, `OPENAI_API_KEY`, `OPENAI_*`,
     `ANTHROPIC_API_KEY`, `ANTHROPIC_*`, `GOOGLE_API_KEY`, `GEMINI_*`,
     `GCP_*`, `AZURE_*`, `OP_*`, `BW_*`, `NPM_TOKEN`, `PYPI_TOKEN`,
     `CARGO_REGISTRY_TOKEN`, `CIRCLE_TOKEN`, `SENTRY_*`, `DD_API_KEY`,
     `VERCEL_TOKEN`, `NETLIFY_AUTH_TOKEN`, `CLOUDFLARE_API_TOKEN`,
     `SLACK_*_TOKEN`, `STRIPE_*`, `HEROKU_API_KEY`.
   - [ ] Allow in `sandbox.env.allow` (minimal): `PATH`, `HOME`, `LANG`,
     `LC_*`, `TERM`, `TZ`, `PWD`.
   - [ ] Default `sandbox.net.deny: ["*"]`.
2. **Engine: explicit env construction**
   - [ ] `@aegisctx/engine/sandbox/env.ts`: new `buildSandboxEnv(policy,
     parentEnv)` — starts empty, adds only allowed vars, applies deny
     last, returns `Record<string, string>`. Zero dependencies.
   - [ ] `PolyglotExecutor` uses `buildSandboxEnv` and passes `env:` to
     `spawn` with `{ env, useParentEnv: false }`.
3. **Engine: restricted PATH**
   - [ ] Sandbox `PATH` contains only the directories of runtimes
     detected on the host (e.g., `dirname(node)`, `dirname(python3)`).
   - [ ] User can opt into a broader PATH via
     `sandbox.env.pathDirs: string[]` in policy.
4. **Engine: tempdir**
   - [ ] POSIX: `mkdtempSync(path.join(os.tmpdir(), 'aegisctx-sbx-'))`
     with `0o700`. Verify perms with `fs.statSync` after creation.
   - [ ] Cleanup guarded by `try/finally` and on timeout (covered by
     timeout kill).
5. **Engine: default network deny**
   - [ ] For Node-based runtimes (`javascript`, `typescript`), inject a
     preamble (only into the isolated code stream, not via
     `NODE_OPTIONS`) that patches `net.connect`, `tls.connect`, and
     `dgram.createSocket` to throw when `sandbox.net.deny` matches.
   - [ ] For non-Node runtimes, rely on a wrapping `iptables -A OUTPUT
     -m owner --uid-owner <sandbox-uid> -j REJECT` approach (requires
     root; **we do NOT do this in MVP**). Document that non-Node
     runtimes' net deny is enforced at the policy layer (blocking
     commands like `curl`) rather than kernel layer.
6. **Timeout kill (POSIX slice)**
   - [ ] Already partially present; confirm SIGKILL to the entire
     process group via `process.kill(-pid, 'SIGKILL')` after
     `SIGTERM` grace period (5s default).
7. **Audit trail**
   - [ ] Every sandbox spawn writes `sandbox_exec` audit entries with
     resolved env var names (not values), timeout, runtime, and exit
     status.

## Deliverables — Windows slice (week 3, after plan 07)

1. **Tempdir ACLs**
   - [ ] `%LOCALAPPDATA%\aegisctx\tmp\<session>\<exec-uuid>` created,
     then `icacls <path> /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F"`.
   - [ ] Fall back to user's TEMP if LOCALAPPDATA unavailable
     (unlikely).
2. **Env filtering**
   - [ ] `buildSandboxEnv` treats keys case-insensitively on Windows.
     Normalize to `Path` casing for the single PATH entry.
3. **Timeout kill**
   - [ ] `taskkill /T /F /PID <pid>` via `child_process.spawnSync`.
4. **Credential vars specific to Windows**
   - [ ] Add to default deny: `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`,
     `COMPUTERNAME`, `USERDOMAIN`, `USERDNSDOMAIN`, `LOGONSERVER`,
     `AZURE_*` (already covered).

## Acceptance criteria

- Integration test: run `aegisctx_execute` with
  `{ language: 'javascript', code: 'console.log(process.env.AWS_SECRET_ACCESS_KEY)' }`
  — stdout must be `undefined`, and the parent test process must have
  `AWS_SECRET_ACCESS_KEY` set (prove it was filtered, not absent on
  host).
- Integration test: `code: 'await fetch("https://example.com")'` —
  throws with `NetworkDisabledError`.
- Integration test: spawn a 60s-sleep script with `timeout: 1000ms` —
  exits within 2s and a tempdir-exists assertion shows the dir was
  cleaned.
- Tempdir has `0o700` on POSIX; on Windows, `icacls <path>` shows only
  the current user with F perms.
- Every sandbox call writes a matching audit entry (verified via `aegisctx
  audit show --category sandbox_exec`).

## Test strategy

- `packages/engine/src/sandbox/env.test.ts`: pure unit tests for the
  allow/deny pipeline, case-insensitivity branch for Windows.
- `packages/engine/src/sandbox/polyglot.test.ts`: expand existing tests
  with credential-leak scenarios, net-deny scenario, timeout-kill
  scenario. Guard Windows-only tests with
  `describe.skipIf(process.platform !== 'win32', …)`.
- `packages/server/src/tools/execute.test.ts`: assert audit writes.

## Out of scope

- Linux namespaces, macOS `sandbox-exec`, Windows Job Objects /
  AppContainer (Level 3 sandbox — Phase 5).
- Network allowlist by host/port (MVP is binary deny-all / allow-all).

## Risks

- **Non-Node net deny is weaker than Node net deny.** Mitigation: be
  explicit in docs (`docs/security.md`) that the default policy also
  blocks `curl`, `wget`, `http.client`, `nc`, `ssh`, `git fetch` at the
  *command* layer, and this is how network is actually denied for
  Python/Ruby/Go/etc in MVP.
- **Windows ACL ceremony.** Mitigation: wrapper module + integration
  test on Windows CI; never silently skip the ACL call.
