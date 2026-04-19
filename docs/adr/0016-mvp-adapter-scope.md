# ADR-0016: MVP Adapter Scope — Claude Code, Codex, OpenCode, AmpCode

## Status

Accepted

## Date

2026-04-16

## Context

The original [PLAN.md §10.1](../../PLAN.md) and
[ADR-0007](./0007-platform-adapter-tier-system.md) (initial) targeted Claude
Code as the only Phase 1 platform, with all other adapters deferred to Phase 2
or Phase 3.

That plan predates three material changes in the 2026 ecosystem:

1. **Codex CLI shipped lifecycle hooks** (early 2026), promoting it from
   "MCP-only Tier 3" to "Tier 1L" (full hook wiring; tool-name matcher
   currently limited to `Bash`).
2. **OpenCode published a documented plugin SDK** (`@opencode-ai/plugin`) with
   `tool.execute.before` / `tool.execute.after` hooks plus a rich session
   event stream — promoting it from "Tier 2 with experimental hooks" to a
   first-class Tier 1 target.
3. **AmpCode (Sourcegraph Amp)** has consolidated as a major terminal coding
   agent in 2026 with stable MCP support (`amp.mcpServers` in IDE settings,
   workspace `.amp/settings.json`, `amp mcp add` CLI). It has no public hook
   API yet, but its MCP surface is stable enough to ship a Tier 3 adapter.

Meanwhile, **Cursor**, **Windsurf**, and **Antigravity** are either still
behind on hook stability (Cursor's `sessionStart` is rejected today; Windsurf
hooks are undocumented; Antigravity is MCP-only and pre-1.0). Shipping
adapters for these in MVP would dilute quality without expanding the user
base meaningfully.

## Decision

The **MVP** (Phase 1) ships Tier-1-class support for **four** platforms:

| Platform        | MVP Tier | Integration surface                                                                                           | Reason                                                                |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Claude Code** | Tier 1   | `~/.claude/settings.json` hooks + MCP server registration                                                     | Largest user base; reference implementation.                          |
| **Codex CLI**   | Tier 1L  | `~/.codex/config.toml` + `~/.codex/hooks.json` (feature flag `codex_hooks`); MCP via `[mcp_servers.aegisctx]` | Hooks GA in 2026; matcher limited to `Bash` today, MCP fills the gap. |
| **OpenCode**    | Tier 1   | `~/.config/opencode/plugins/aegisctx.ts` plugin + `opencode.json` MCP entry                                   | Documented plugin SDK with full event coverage.                       |
| **AmpCode**     | Tier 3   | `~/.amp/settings.json` `amp.mcpServers.aegisctx` + project `.amp/AGENTS.md` routing instructions              | MCP-only; honest tier reporting via `capabilities()`.                 |

**Phase 2** picks up Cursor (Tier 2 hooks), Windsurf (Tier 3 → Tier 2 if
hooks documented by then), Antigravity (Tier 3), Zed (Tier 3), and the
`generic` MCP-only fallback for any future platform.

**Phase 3** picks up VS Code Copilot, Gemini CLI, Kiro, KiloCode, and the
plugin system.

## MVP adapter responsibilities

Every MVP adapter must:

1. Implement `HookAdapter` from `@aegisctx/adapters`.
2. Report `capabilities()` honestly, including `interceptedTools` for Tier 1L.
3. Provide an `aegisctx init <platform>` flow that writes the platform-native
   config snippet (and prints a diff before applying).
4. Ship fixture-based tests against recorded real hook payloads (or, for
   Tier 3 platforms like AmpCode, against recorded MCP request/response
   pairs).
5. Expose a `doctor()` check that validates the platform-specific
   installation (config file present, hook command resolvable, MCP server
   reachable).

## Rationale

- **User reach**: Claude Code + Codex CLI + OpenCode + AmpCode covers the
  four largest 2026 terminal-coding-agent communities. Excluding Cursor for
  now is acceptable because Cursor users typically run their MCP servers
  through the IDE, where hook stability is poor.
- **Engineering focus**: Four adapters with fixture tests is shippable in the
  Phase 1 budget. Adding Cursor + Windsurf + Antigravity would push us past
  the budget for marginal Tier 3 coverage that the `generic` adapter (Phase
  2) already provides.
- **Honest tiers**: Including AmpCode at Tier 3 in MVP forces the server to
  exercise its tier-aware degradation logic from day one, which is healthier
  than retrofitting tier degradation in Phase 2.
- **Hook stability**: Codex and OpenCode hook surfaces are documented and
  stable enough to commit to in MVP. Cursor's hook surface is not.

## Consequences

- Phase 1 milestone count grows from M1.1–M1.6 (six) to M1.1–M1.9 (nine) to
  cover the three additional adapters. See [MILESTONES.md](../../MILESTONES.md)
  for the updated plan.
- Each new MVP adapter requires its own integration-test fixture set
  (`packages/adapters/test/fixtures/<platform>/`).
- The `aegisctx init` CLI must learn three more platform sub-commands
  (`codex`, `opencode`, `amp`).
- The `aegisctx doctor` CLI must learn three more platform check sets.
- README, CLI help, and docs must be updated to advertise four supported
  platforms in MVP (not one).
- If Codex extends its tool matcher beyond `Bash` during the Phase 1 window,
  the Codex adapter's `capabilities().interceptedTools` set must be updated;
  no other code change is required.
- If AmpCode ships a hook API during the Phase 1 window, the Amp adapter
  may be promoted to Tier 2 in a point release without breaking the
  contract.

## Re-evaluation triggers

Re-open this ADR if any of the following happen:

- A platform we deferred (Cursor, Windsurf) ships stable hooks.
- A platform we included (Codex, OpenCode, Amp) breaks its public surface.
- User research shows >10% of Aegis demand coming from a Phase 2/3 platform.
