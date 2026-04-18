# Plan 10 — OpenCode adapter + `@aegisctx/opencode-plugin` (M1.8)

**Priority:** P0-1. Fourth MVP adapter. (AmpCode deferred.)
**Size:** Medium.
**Dependencies:** Plan 01 (scope rename), plan 04 (audit writes), plan
11 (capability advertisement).

## Why

OpenCode has a richer plugin SDK than Codex's hook model:
`tool.execute.before/after`, `session.compacted`, `session.idle`,
`permission.asked`. We ship both a Tier-1 hook adapter _and_ a
standalone `@aegisctx/opencode-plugin` npm package so users can install
it via OpenCode's plugin mechanism.

## Design

### Plugin entrypoint

OpenCode loads plugins from:

- `~/.config/opencode/plugins/aegisctx.ts` (global)
- `<project>/.opencode/plugins/aegisctx.ts` (per-project)
- Or via `opencode.json` `"plugin": ["@aegisctx/opencode-plugin"]`

We ship the plugin as a published npm package so users add one line to
`opencode.json` and run `npm install @aegisctx/opencode-plugin`.

### Plugin interface (from `@opencode-ai/plugin`)

```ts
import { createHookAdapter } from "@aegisctx/adapters/opencode";
import type { Plugin } from "@opencode-ai/plugin";

const plugin: Plugin = (ctx) => {
	const adapter = createHookAdapter({ ctx });
	ctx.on("tool.execute.before", (e) => adapter.preToolUse(e));
	ctx.on("tool.execute.after", (e) => adapter.postToolUse(e));
	ctx.on("session.compacted", (e) => adapter.compact(e));
	ctx.on("session.idle", (e) => adapter.idle(e));
	ctx.on("permission.asked", (e) => adapter.permissionAsked(e));
};
export default plugin;
```

### MCP registration

Edits `opencode.json` as strict JSON only — no comments, no trailing
commas. `aegisctx init opencode` and `aegisctx doctor` both assume a
strict JSON parser. Any commentary lives in external docs
(`docs/getting-started/opencode.md`), not in the generated file.

```json
{
	"mcp": {
		"aegisctx": {
			"command": "aegisctx",
			"args": ["serve"],
			"env": { "AEGISCTX_PLATFORM": "opencode" }
		}
	},
	"plugin": ["@aegisctx/opencode-plugin"]
}
```

Plus per-project `.opencode/opencode.json` if that's how the project
scopes plugins.

### Capability advertisement

`{ platform: 'opencode', tier: 1, supportedHooks:
['tool.execute.before', 'tool.execute.after', 'session.compacted',
'session.idle', 'permission.asked'] }`.

If the SDK version doesn't export `session.idle`, advertise a
downgraded hook list honestly.

## Deliverables

1. **`packages/adapters/src/opencode/`**
   - [ ] `schemas.ts` — Zod schemas for each OpenCode event.
   - [ ] `events.ts` — normalized-event extraction.
   - [ ] `adapter.ts` — `HookAdapter` impl + `createHookAdapter`
         factory (used by the plugin).
   - [ ] `fixtures/` — recorded event payloads.
   - [ ] `adapter.test.ts`.
2. **New workspace package: `packages/opencode-plugin/`**
   - [ ] Published as `@aegisctx/opencode-plugin`.
   - [ ] Single `index.ts` that wires the `@aegisctx/adapters/opencode`
         factory into the `Plugin` shape expected by
         `@opencode-ai/plugin`.
   - [ ] Declares `@aegisctx/adapters` + `@opencode-ai/plugin` as peer
         dependencies; no runtime deps of its own.
   - [ ] Tiny test: plugin is a function with the expected signature.
3. **`packages/cli/src/commands/init.ts`**
   - [ ] New branch: `aegisctx init opencode`.
   - [ ] Detects per-project vs global OpenCode config, writes the MCP
         entry + plugin reference, prompts to run `npm install` if needed.
4. **Doctor integration**
   - [ ] `aegisctx doctor` checks: `opencode.json` present,
         `aegisctx` MCP entry present, `@aegisctx/opencode-plugin` importable
         from the project's `node_modules`, SDK version supported.

## Acceptance criteria

- `aegisctx init opencode --dry-run` prints the planned edits; apply
  is idempotent. Generated `opencode.json` is strict JSON (parses with
  `JSON.parse`); any user-added comments in pre-existing files trigger
  a clear error with a pointer to the external docs rather than being
  silently rewritten.
- In a real OpenCode session, `aegisctx_execute` runs sandboxed and
  returns only stdout; denied commands are blocked at
  `tool.execute.before`.
- Session events persist across `session.compacted` → next session
  start.
- `aegisctx doctor` reports Tier 1.
- `@aegisctx/opencode-plugin` publishes cleanly with `npm pack
  --dry-run` containing only `dist/`, `LICENSE`, `README.md`.

## Test strategy

- Fixture-based adapter tests; all three OSes.
- Plugin smoke test: build, require it, verify the exported shape.
- `init` integration: fake `opencode.json` input → edited output
  golden.

## Out of scope

- OpenCode's experimental tool-call streaming (not part of the stable
  SDK as of 2026-04).
- Cross-project OpenCode config discovery beyond `opencode.json` and
  `.opencode/opencode.json`.

## Risks

- **OpenCode SDK < 1.0.** Event names may rename. Mitigation: the
  adapter's event map is a single table, bumped with an ADR when
  upstream renames.
- **Plugin resolution rules across global vs per-project.**
  Mitigation: `aegisctx doctor` prints both paths and which one
  OpenCode is loading; `init` has a flag to target either.
