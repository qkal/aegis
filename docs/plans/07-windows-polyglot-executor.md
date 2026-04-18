# Plan 07 — Windows-native `PolyglotExecutor`

**Priority:** P0-12. Unblocks Windows as a first-class MVP target.
**Size:** Medium-large.
**Dependencies:** Plan 06 (Windows CI runner must exist before this
lands).

## Why

`@aegisctx/engine` today assumes POSIX semantics: a single default
shell, `spawn` with POSIX argv, `SIGKILL` to process groups, `0o700`
tempdirs, case-sensitive env lookups. On Windows this breaks or silently
diverges. We replace POSIX-specific call sites with OS-aware
abstractions.

## Design

### Runtime selection

```
detectRuntime(lang, platform) := {
  javascript: platform === 'win32'
    ? [which('node.exe'), which('bun.exe')]
    : [which('node'), which('bun')],
  typescript: platform === 'win32'
    ? [which('tsx.cmd'), which('bun.exe'), which('npx.cmd')+' tsx']
    : [which('tsx'), which('bun'), which('npx')+' tsx'],
  python:    platform === 'win32'
    ? [which('py.exe')+' -3', which('python.exe'), which('python3.exe')]
    : [which('python3'), which('python')],
  shell:     platform === 'win32'
    ? [which('bash.exe') /* Git Bash */,
       which('wsl.exe')+' --exec bash',
       { via: 'pwsh-translate' }]
    : [which('bash')],
  powershell: platform === 'win32'
    ? [which('pwsh.exe'), which('powershell.exe')]
    : [which('pwsh')],
  // ...
}
```

Probing happens once per server process and is cached in-memory.
`aegisctx doctor` reports the chosen runtime and all fallbacks.

### Spawn wrapper

New `@aegisctx/engine/sandbox/spawn.ts`:

```ts
export interface SpawnPlan {
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	readonly cwd: string;
	readonly timeoutMs: number;
	readonly stdin?: string;
}

export interface SpawnResult {
	readonly status: ExecOutcome;
	readonly stdout: string;
	readonly stderr: string;
	readonly durationMs: number;
}

export function spawnSandboxed(plan: SpawnPlan): Promise<SpawnResult>;
```

Inside, branch on `process.platform`. On Windows:

- `windowsHide: true`, `windowsVerbatimArguments: false`.
- Quote any argument containing spaces, double-quotes, or shell
  metacharacters using the CreateProcess quoting rules.
- CRLF normalize stdout/stderr before returning.

### Process tree kill

- POSIX: `process.kill(-child.pid, 'SIGTERM')` → 5s grace → `SIGKILL`.
- Windows: `child_process.spawnSync('taskkill', ['/T', '/F', '/PID',
  String(child.pid)])`.

### Tempdir

- POSIX: `mkdtempSync(path.join(os.tmpdir(), 'aegisctx-sbx-'))`, then
  `chmodSync(dir, 0o700)`.
- Windows: `mkdtempSync(path.join(process.env.LOCALAPPDATA!,
  'aegisctx', 'tmp', ''))`, then `spawnSync('icacls', [dir,
  '/inheritance:r', '/grant:r',`${process.env.USERNAME}:(OI)(CI)F`])`.

### Env filtering (case-insensitive branch)

`buildSandboxEnv` takes a `platform` param; when `win32`, performs a
case-insensitive match on env keys but emits the canonical casing
(`Path`, `Temp`, `Tmp`).

### Line-ending normalization

Before handing stdout/stderr to `packages/engine/src/output/processor.ts`,
replace `\r\n` with `\n`. This keeps snapshot tests OS-agnostic.

### Shell dispatch

`language: 'shell'` on Windows tries in order: Git Bash, WSL bash,
`pwsh` translation (best-effort). If none available, the tool returns a
structured error with install suggestions (Git for Windows or WSL).

## Deliverables

1. **`@aegisctx/engine/sandbox/spawn.ts`** — cross-OS spawn wrapper.
2. **`@aegisctx/engine/sandbox/kill.ts`** — cross-OS tree kill.
3. **`@aegisctx/engine/sandbox/tempdir.ts`** — cross-OS tempdir with
   restrictive perms.
4. **`@aegisctx/engine/runtime/detect.ts`** — extended with Windows
   branches; unit tests use a mocked `which`.
5. **`@aegisctx/engine/runtime/command.ts`** — quoting rules + argv
   assembly per OS.
6. **`@aegisctx/engine/output/processor.ts`** — CRLF normalization pass.
7. **Integration tests** under `packages/engine/src/sandbox/*.test.ts`,
   gated by `describe.skipIf(process.platform !== 'win32', ...)` for
   Windows-only behavior and running on all OSes for shared behavior.

## Acceptance criteria

- All engine tests pass on Ubuntu, macOS, and Windows CI runners (plan
  06).
- `aegisctx_execute` with `language: 'javascript'` runs identically on
  all three OSes (same stdout, same timing within 2×).
- `aegisctx_execute` with `language: 'shell'` on Windows uses Git Bash
  when present; falls back cleanly.
- Killing a long-running child on Windows: `tasklist /FI "PID eq
  <child>"` reports no matches within 2s of timeout.
- `aegisctx doctor` on Windows shows the chosen runtimes and fallbacks,
  warns on `py` launcher missing, warns on PowerShell execution policy
  if restrictive.

## Test strategy

- Unit: `sandbox/spawn.test.ts` mocks `child_process` and asserts
  per-OS argv/env construction.
- Integration: real subprocess spawn tests per OS for: happy path,
  timeout, CRLF stdout, env filtering, tempdir perms.
- Fuzz: property test that random command strings produce correctly
  quoted argv on Windows (against a known-good CreateProcess reference
  implementation).

## Out of scope

- WSL2-interop stdin streaming (too OS-version-dependent for MVP — if
  `wsl.exe` is the chosen shell, we pass stdin via file, not pipe).
- Windows AppContainer / Job Objects isolation (Phase 5).

## Risks

- **Git Bash path with spaces.** Mitigation: integration test asserts
  a `--version` invocation works when Git is installed at
  `C:\Program Files\Git\bin\bash.exe`.
- **`py` launcher not always installed.** Mitigation: probe + fall back
  to bare `python.exe`; `aegisctx doctor` surfaces a warn with install
  link.
- **Windows Defender quarantining spawned scripts during tests.**
  Mitigation: CI disables real-time scanning for test dirs (plan 06).
