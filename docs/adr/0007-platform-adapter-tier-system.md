# ADR-0007: Platform Adapter Tier System

## Status

Accepted (Revised 2026-04-16)

## Date

2025-01-15 (initial); 2026-04-16 (revised after Codex hooks GA + OpenCode plugin SDK research)

## Context

AI coding agent platforms have wildly different capabilities. The 2026
landscape is no longer "Claude Code has hooks, everyone else doesn't":

- **Claude Code** — four hook types (`PreToolUse`, `PostToolUse`, `PreCompact`,
  `SessionStart`) over JSON-stdio. Full coverage.
- **Codex CLI** — gained lifecycle hooks in early 2026 behind the
  `[features] codex_hooks = true` flag (`SessionStart`, `PreToolUse`,
  `PostToolUse`, `UserPromptSubmit`, `Stop`). Tool matchers currently only emit
  `Bash`, so non-Bash tools are not interceptable; no `PreCompact` equivalent.
- **OpenCode** (`sst/opencode`) — TypeScript/JS plugin SDK loaded from
  `.opencode/plugins/` or `~/.config/opencode/plugins/`. Hooks include
  `tool.execute.before`, `tool.execute.after`, plus session events
  (`session.created`, `session.compacted`, `session.idle`), permission events,
  and shell env injection. Full programmatic coverage of the agent loop.
- **AmpCode** (Sourcegraph Amp) — MCP-only. MCP servers configured via
  `amp.mcpServers` in IDE settings or workspace `.amp/settings.json`, plus
  `amp mcp add` CLI. No public hook/lifecycle API as of 2026-04.
- **Cursor** — partial hooks (`PreToolUse`, `PostToolUse`); no `PreCompact`.
- **Windsurf**, **Antigravity**, **Zed**, **Kiro**, **KiloCode** — MCP-only or
  experimental hooks (subject to change).

Pretending all platforms are equal leads to false guarantees. The tier system
must be **honest**: each adapter reports the exact subset of capabilities Aegis
can offer on that platform.

## Decision

Adopt a **four-tier system** that honestly communicates each platform's
capability level:

| Tier | Capabilities | Platforms |
|------|-------------|-----------|
| **Tier 1: Full** | MCP + tool-call interception (PreToolUse / PostToolUse) + session-start restore + (where supported) compaction snapshots + policy enforcement at the agent boundary | Claude Code, Gemini CLI, OpenCode, VS Code Copilot |
| **Tier 1L: Limited tool matchers** | Same wiring as Tier 1, but the platform's hook runtime only fires PreToolUse/PostToolUse for a subset of tools (e.g. Codex currently only emits `Bash`). Non-matched tools fall back to MCP-only enforcement. | Codex CLI |
| **Tier 2: Hooks** | MCP + partial hooks + policy enforcement + partial session capture (no PreCompact equivalent) | Cursor, Kiro, KiloCode |
| **Tier 3: MCP-only** | MCP tools only, no hooks, instruction-file routing (AGENTS.md / GEMINI.md / .amp/AGENTS.md). Policy enforced inside the MCP server, not at the agent's tool-call boundary. | AmpCode, Codex CLI (when `codex_hooks` disabled), Zed, Antigravity, Windsurf |

*Note: Tier placement indicates platform capability/support, not shipping phase (see ADR-0016 / README for MVP/Phase scheduling).*

Each adapter implements the `HookAdapter` interface and reports its
capabilities via `capabilities()`. The server reports the capability tier to
the agent at session start so the agent can adjust expectations.

**Tier 1L** is a sub-classification of Tier 1 — same code path, same adapter
contract, but the adapter's `capabilities()` advertises which tools the
platform actually intercepts (`interceptedTools: ['Bash']` for Codex today).
The MCP server uses this to decide whether to enforce policy via the hook
(when matched) or via the MCP tool wrapper (when unmatched).

## Rationale

- **Honesty over marketing**: Tier 3 platforms have ~60% routing compliance
  (instruction-file only). Tier 1L has 100% compliance for matched tools and
  ~MCP-only compliance for unmatched ones. We don't hide this — the agent
  and user both know.
- **Graceful degradation**: Missing hooks don't crash the system. The server
  adapts its behavior per tier and per `interceptedTools` set.
- **Isolation**: Each adapter is independently testable. A bug in the Cursor
  adapter doesn't affect Claude Code.
- **Incremental rollout**: Phase 1 (MVP) implements Tier 1 / Tier 1L for
  Claude Code, OpenCode, Codex CLI, and Tier 3 for AmpCode. Other platforms
  are added in later phases with their tested adapter (see
  [ADR-0016](./0016-mvp-adapter-scope.md)).

## Consequences

- Users on Tier 3 platforms (AmpCode today) get a degraded experience: policy
  is still enforced for Aegis-routed work but cannot block native tool calls
  the agent makes outside the MCP surface. This is documented clearly.
- Codex users get full enforcement on `Bash` and degraded enforcement on the
  agent's other native tools (file edits, etc.) until OpenAI extends the hook
  matcher set. The Codex adapter must re-evaluate its tier classification on
  each Codex CLI release.
- Each new platform requires a dedicated adapter with fixture-based tests.
- Platform API changes require adapter updates (isolated to one file per
  platform).
- The tier system may need adjustment as platforms evolve their hook support.
  Re-review every 6 months or on a major platform release.