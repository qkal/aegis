# Plan 09 — Codex GUI adapter (M1.7b, Tier 1)

**Priority:** P0-1 / P0-13. Second of the three MVP primary targets.
**Size:** Medium.
**Dependencies:** Plan 08 (Codex CLI schemas + hook binary pattern),
plan 11 (capability advertisement).

## Why

Codex GUI (the VS Code Codex extension and the Codex desktop app) is
where many users actually run Codex. The adapter must detect the
installed variant, write MCP registration to the correct config, and
provide a routing AGENTS.md template for sessions that don't expose
hooks.

## Design

### Probe strategy (in order)

1. **VS Code Codex extension settings**
   - Windows: `%APPDATA%\Code\User\settings.json`,
     `%APPDATA%\Code - Insiders\User\settings.json`
   - macOS: `~/Library/Application Support/Code/User/settings.json`,
     `~/Library/Application Support/Code - Insiders/User/settings.json`
   - Linux: `~/.config/Code/User/settings.json`,
     `~/.config/Code - Insiders/User/settings.json`
   - Key: `codex.mcpServers` (if the extension uses it) or the
     generic `"mcp"`/`"mcpServers"` key used by the extension's shipped
     schema (to be confirmed at implementation time).
2. **Codex desktop app config**
   - Path TBD during implementation; `aegisctx init codex-gui`
     always prints the resolved path and a full diff before writing.
3. **Fallback: MCP-only registration + AGENTS.md routing**
   - If neither config is found, `aegisctx init codex-gui` creates
     `<project>/.codex/AGENTS.md` with routing instructions and warns
     the user that they need to manually register the MCP server.

### Capability advertisement

- VS Code extension branch: `{ tier: 1, supportedHooks: [...] }` when
  the extension supports hooks; otherwise `{ tier: 3, supportedHooks:
  [] }`.
- Desktop app branch: same logic, per detected app version.

`aegisctx doctor` reports the probe branch taken.

### Settings rewrite (VS Code `settings.json`)

VS Code supports JSON-with-comments (`jsonc`). Use `jsonc-parser` to
read + apply an edit op (preserves comments and formatting).

Example target state:

```jsonc
{
	// ... existing keys ...
	"codex.mcpServers": {
		"aegisctx": {
			"command": "aegisctx",
			"args": ["serve"],
			"env": { "AEGISCTX_PLATFORM": "codex-gui" },
		},
	},
}
```

## Deliverables

1. **`packages/adapters/src/codex/gui/`**
   - [ ] `probe.ts` — per-OS config probe with the order above.
   - [ ] `vscode-settings.ts` — `jsonc-parser` read/edit/write.
   - [ ] `adapter.ts` — `HookAdapter` impl (reuses event extraction
         from plan 08's `codex/events.ts` where overlap exists).
   - [ ] `fixtures/` — sample `settings.json` files for Windows,
         macOS, Linux; dry-run + apply goldens.
   - [ ] `adapter.test.ts`.
2. **`packages/cli/src/commands/init.ts`**
   - [ ] New branch: `aegisctx init codex-gui`.
   - [ ] `--config-path <path>` override for users with non-standard
         VS Code installs (Portable Mode, Flatpak, etc.).
3. **AGENTS.md template**
   - [ ] `configs/codex-gui.AGENTS.md` — routing instructions for the
         Tier-3 fallback.
4. **Doctor integration**
   - [ ] `aegisctx doctor` reports: which config branch was taken, MCP
         entry present, AGENTS.md present (if fallback branch), hook
         support detected vs not.

## Acceptance criteria

- `aegisctx init codex-gui --dry-run` works on Windows, macOS, Linux
  with default VS Code installed — prints the correct settings path
  and a valid JSON edit.
- Idempotent on a second run; no duplicate MCP entries.
- If no VS Code found, falls through to the desktop-app probe, then to
  the Tier-3 fallback, with clear messaging at each step.
- `aegisctx doctor` on a GUI-configured project passes.

## Test strategy

- `probe.test.ts` with fake filesystem (memfs) per OS to validate the
  probe order.
- `vscode-settings.test.ts` with fixture input → edited output golden;
  preserves `// comments` and trailing commas.
- Integration: on a fresh VS Code User dir, run `aegisctx init
  codex-gui`, assert settings are merged in.

## Out of scope

- Auto-restarting VS Code after config changes (user-visible prompt
  suffices).
- Codex desktop app auto-update handling.
- Probing Cursor's settings (that's plan 12's wave-2 scope).

## Risks

- **Codex extension MCP config key is not yet finalized upstream.**
  Mitigation: abstract the key path behind `vscode-settings.ts` so a
  single string change + test update adapts to it; document as an
  ADR-linked decision if upstream ships a new shape.
- **Per-OS VS Code paths.** Mitigation: existing ecosystem knowledge is
  reliable; cover with per-OS fixture tests.
- **Portable VS Code installations.** Mitigation: `--config-path`
  override + `aegisctx doctor` surfacing the exact probe order it
  tried.
