# Plan 08 — Codex CLI adapter (M1.7, Tier 1L)

**Priority:** P0-1 / P0-13. One of the three MVP primary targets.
**Size:** Medium-large.
**Dependencies:** Plan 01 (rename), plan 04 (audit writes for policy),
plan 07 (Windows paths), plan 11 (capability advertisement).

## Why

Codex CLI is a co-equal MVP primary target with Claude Code. The
current adapter is a stub with only platform constants. We ship a full
Tier 1L adapter: MCP registration, hook binaries for
PreToolUse/PostToolUse/UserPromptSubmit/SessionStart/Stop, safe TOML
rewrites, and `[features] codex_hooks = true` handling.

## Design

### Files Codex touches

| Path                    | POSIX                                                   | Windows                                                             |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| MCP server registration | `~/.codex/config.toml`                                  | `%USERPROFILE%\.codex\config.toml`                                  |
| Hooks                   | `~/.codex/hooks.json` and `<project>/.codex/hooks.json` | `%USERPROFILE%\.codex\hooks.json` and `<project>\.codex\hooks.json` |
| Feature flag            | `[features] codex_hooks = true` in `config.toml`        | same                                                                |

### `config.toml` edits

Example target state:

```toml
[mcp_servers.aegisctx]
command = "aegisctx"
args = ["serve"]

[mcp_servers.aegisctx.env]
AEGISCTX_PLATFORM = "codex-cli"

[features]
codex_hooks = true
```

Rewrite must:

- preserve existing keys + comments + ordering elsewhere in the file
- be idempotent (re-running `aegisctx init codex-cli` is a no-op)
- accept `--dry-run` and print a unified diff
- back up to `config.toml.aegisctx.bak.<timestamp>` on first write

Library: `@iarna/toml` (permissive, preserves comments better than
`toml` or `@ltd/j-toml`). Vendor the exact version.

### `hooks.json` structure

```json
{
	"hooks": [
		{
			"event": "PreToolUse",
			"matcher": "Bash",
			"command": "aegisctx hook codex pre-tool-use"
		},
		{
			"event": "PostToolUse",
			"matcher": "Bash",
			"command": "aegisctx hook codex post-tool-use"
		},
		{
			"event": "UserPromptSubmit",
			"matcher": "*",
			"command": "aegisctx hook codex user-prompt-submit"
		},
		{
			"event": "SessionStart",
			"matcher": "*",
			"command": "aegisctx hook codex session-start"
		},
		{
			"event": "Stop",
			"matcher": "*",
			"command": "aegisctx hook codex stop"
		}
	]
}
```

Merge semantics: any existing `aegisctx hook codex *` entries are
replaced; other entries are preserved.

### Capability advertisement

`{ platform: 'codex-cli', tier: '1L', supportedHooks: ['PreToolUse',
'PostToolUse', 'UserPromptSubmit', 'SessionStart', 'Stop'],
interceptedTools: ['Bash'], codexHooksEnabled: true|false }`.

When `[features] codex_hooks` is not `true`, capability downgrades to
`{ tier: '3', supportedHooks: [], reason: 'codex_hooks feature flag
not enabled' }` and `aegisctx doctor` warns with the exact TOML edit
needed.

### Hook binary

`aegisctx hook codex <event>` reads JSON from stdin, writes JSON to
stdout (or exit 2 + JSON stderr on deny), matching Codex's hook
protocol exactly.

Flow:

1. Parse stdin with Zod against the `CodexHookPayload` discriminated
   union.
2. For PreToolUse: call the policy engine; on deny, emit
   `{"decision":"block","reason":"..."}`; on allow, emit
   `{"decision":"continue"}`.
3. For PostToolUse: extract session events (`FileEvent`, `GitEvent`,
   `ExecutionEvent`, etc.) and insert into the session store.
4. For SessionStart: build and emit the priority-tiered snapshot.
5. For Stop: flush any pending writes.

## Deliverables

1. **`packages/adapters/src/codex/`**
   - [ ] `schemas.ts` — Zod schemas for Codex hook payloads (per event
         type).
   - [ ] `events.ts` — normalized-event extraction from Codex payloads.
   - [ ] `adapter.ts` — `HookAdapter` impl; platform detection via
         `CODEX_HOME`, `CODEX_SESSION_ID`, `~/.codex/`.
   - [ ] `fixtures/` — recorded JSON payloads for every event × tool
         permutation we support.
   - [ ] `adapter.test.ts` — fixture-based tests.
2. **`packages/adapters/src/codex/config/`**
   - [ ] `toml.ts` — safe TOML read/merge/write using `@iarna/toml`.
   - [ ] `hooks.ts` — hooks.json merge.
   - [ ] `features.ts` — `codex_hooks` flag probe and prompt.
   - [ ] Unit tests for each, including comment-preservation goldens.
3. **`packages/cli/src/commands/init.ts`**
   - [ ] New branch: `aegisctx init codex-cli` (alias: `codex`).
   - [ ] Prints a unified diff under `--dry-run`.
   - [ ] Prompts for the `codex_hooks` feature flag if not enabled.
4. **Hook binary**
   - [ ] `aegisctx hook codex <event>` subcommand in
         `packages/cli/src/commands/hook.ts` (or a dedicated
         `packages/cli/src/commands/hook/codex.ts`).
   - [ ] Emits JSON on stdout; exits 0 on allow/continue, 2 on block.
5. **Doctor integration**
   - [ ] `aegisctx doctor` checks: `config.toml` has the MCP entry,
         `hooks.json` has all expected entries, `codex_hooks` is enabled,
         the hook binary resolves on `PATH`.

## Acceptance criteria

- `aegisctx init codex-cli --dry-run` prints the diff, exits 0, does
  not modify any files.
- `aegisctx init codex-cli` applies the edits, is idempotent on a
  second run, and creates a backup on first run.
- A Codex CLI session started from a project with the adapter
  installed:
  - Calls `aegisctx hook codex pre-tool-use` before each `Bash` tool
    call; a policy-denied command is blocked with a structured error.
  - Calls `aegisctx hook codex post-tool-use` after each `Bash` tool
    call; the event lands in the session DB (verified via `aegisctx
    session show`).
- On Windows, same flow works with `%USERPROFILE%\.codex\` paths
  correctly quoted in TOML.
- `aegisctx doctor` reports Tier 1L with `codex_hooks` true, all five
  hooks registered.

## Test strategy

- Fixture-based adapter tests on all three OSes.
- TOML rewrite: golden-file test with comment preservation.
- Hook binary: integration test that pipes fixture stdin in, asserts
  stdout JSON.
- `aegisctx init` idempotence: run twice, assert `git diff` is empty
  after the second run.

## Out of scope

- Codex hooks for non-Bash tools (upstream doesn't emit them yet).
- Codex multi-project global config (user-level hook registration — the
  per-project `.codex/hooks.json` is sufficient for MVP).

## Risks

- **Codex `config.toml` schema drift.** Mitigation: pin the exact
  expected shape in tests; if Codex renames a key, fail loudly and
  version-bump our adapter.
- **Windows TOML path quoting.** Mitigation: integration test that
  writes a config referring to `C:\Program Files\aegisctx\aegisctx.exe`
  and round-trips through `@iarna/toml` cleanly.
- **Simultaneous edits race with Codex updating `config.toml` itself.**
  Mitigation: advisory file lock (`proper-lockfile`) around the
  read-modify-write; fall back to refusing the write + printing a retry
  hint.
