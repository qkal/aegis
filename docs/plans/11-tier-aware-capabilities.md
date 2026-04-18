# Plan 11 — Tier-aware capability advertisement

**Priority:** P0-1 (cross-cutting).
**Size:** Small.
**Dependencies:** Plans 08, 09, 10 for wiring; can land as a standalone
PR after the adapters.

## Why

`packages/server/src/capabilities.ts` has a shape for advertising tier
and supported hooks but adapters don't consistently report their true
capability. Honest advertisement is the single best UX decision — the
agent should know whether it's Tier 1, 1L, 2, or 3 and adjust its
behavior. The README `R14` ("defaults favor clarity over convenience")
depends on this.

## Design

### Capability payload — extend, don't replace

`packages/adapters/src/types.ts` already defines `PlatformCapabilities`
(with `platform`, `tier`, `tierLabel: '1' | '1L' | '2' | '3'`,
`hasSessionStart`, `hasPreCompact`, `hookEnforcement`, etc.) and the
server in `packages/server/src/capabilities.ts` is already wired to
return this shape from `aegisctx_doctor` and `aegisctx_stats`.

This plan **extends** that interface rather than introducing a new
parallel `Capabilities` type, so adapters, server, and doctor all
continue to read and write the same object. The migration is
purely additive:

```ts
// packages/adapters/src/types.ts (extended)
export interface PlatformCapabilities {
	// existing, unchanged
	readonly platform: "claude-code" | "codex-cli" | "codex-gui" | "opencode" | "amp" | "unknown";
	readonly tier: 1 | 2 | 3;
	readonly tierLabel: "1" | "1L" | "2" | "3";
	readonly hookEnforcement: "full" | "partial" | "mcp-only";
	readonly hasSessionStart: boolean;
	readonly hasPreCompact: boolean;
	readonly supportedHooks: readonly HookName[];

	// NEW in this plan — additive fields
	readonly interceptedTools: readonly string[];
	readonly notes: readonly string[]; // e.g. "codex_hooks flag disabled"
	readonly aegisctxVersion: string;
	readonly storageBackend: "better-sqlite3" | "node-sqlite" | "bun-sqlite";
	readonly configDir?: string; // e.g. ~/.codex, %APPDATA%/Code/User
	readonly sessionDir?: string; // adapter-specific session store
	readonly platformDetails: Record<string, unknown>;
}
```

No `Capabilities` type is introduced. No mapping layer is required.
Adapters that already return a `PlatformCapabilities` simply populate
the new fields; the existing `tierLabel`/`hasSessionStart`/
`hasPreCompact` flags remain the source of truth for downgrade
decisions. Emitted at MCP session start via a non-standard-but-harmless
`aegisctx/capabilities` notification, plus returned from
`aegisctx_doctor` tool calls using this same shape.

### Detection

Each adapter exports a `probeCapabilities(): Capabilities` function.
The server runs the active adapter's probe at startup and caches the
result.

### Downgrade rules

- Codex CLI without `[features] codex_hooks`: tier `3`, hooks `[]`,
  note "`codex_hooks` feature flag not enabled".
- Codex GUI without detectable VS Code/desktop config: tier `3`, hooks
  `[]`, note "no hook-capable Codex config found; using AGENTS.md
  fallback".
- OpenCode with SDK missing `session.idle`: drop `session.idle` from
  `supportedHooks`, tier stays 1.
- Claude Code at an unsupported version: tier `2` with only PreToolUse
  and PostToolUse.

## Deliverables

1. **`packages/adapters/src/types.ts` (extend, don't replace)**
   - [ ] Add the new fields (`interceptedTools`, `notes`,
         `aegisctxVersion`, `storageBackend`, `configDir`,
         `sessionDir`, `platformDetails`) to the existing
         `PlatformCapabilities` interface.
   - [ ] Update existing `CAPABILITIES` constants (Claude Code, the
         generic fallback in the server) to populate the new fields
         with honest defaults so no downstream consumer breaks.
2. **Per-adapter `probeCapabilities`**
   - [ ] `claude-code/adapter.ts`: probe Claude Code version + hook
         registration.
   - [ ] `codex/adapter.ts`: probe `config.toml` + `hooks.json` +
         `codex_hooks` flag.
   - [ ] `codex/gui/adapter.ts`: return the probe branch from plan 09.
   - [ ] `opencode/adapter.ts`: probe SDK version, list loaded event
         handlers.
3. **Server wiring**
   - [ ] `packages/server/src/capabilities.ts`: replace static TODO
         with a call to the active adapter's probe.
   - [ ] Emit the capability payload at session start.
   - [ ] Expose via `aegisctx_doctor` MCP tool response.
4. **CLI**
   - [ ] `aegisctx doctor` prints the capability table prominently.

## Acceptance criteria

- Each adapter's fixture tests include a capability assertion for
  every downgrade path listed in the design section.
- `aegisctx doctor --json` output contains the full `Capabilities`
  object.
- At session start, the server writes a `capabilities_advertised`
  audit entry with the probed payload.

## Test strategy

- `packages/server/src/capabilities.test.ts`: adapter × downgrade
  matrix.
- `packages/adapters/src/<platform>/adapter.test.ts`: per-platform
  probe goldens.

## Out of scope

- AmpCode probe (Phase 1.5).
- Cross-session capability caching.

## Risks

- **Probe performance at session start.** Budget: <50 ms combined
  across adapters. Mitigation: probe runs once; cached thereafter.
