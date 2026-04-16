# ADR-0007: Platform Adapter Tier System

## Status

Accepted

## Date

2025-01-15

## Context

AI coding agent platforms have wildly different capabilities. Claude Code supports four hook types with full JSON-stdio integration. Cursor supports two hooks. Codex CLI supports only MCP tools with no hooks at all. Pretending all platforms are equal leads to false guarantees.

## Decision

Adopt a **three-tier system** that honestly communicates each platform's capability level:

| Tier | Capabilities | Platforms |
|------|-------------|-----------|
| **Tier 1: Full** | MCP + all hooks (PreToolUse, PostToolUse, PreCompact, SessionStart) + policy enforcement + session continuity | Claude Code, Gemini CLI, VS Code Copilot |
| **Tier 2: Hooks** | MCP + partial hooks (PreToolUse, PostToolUse) + policy enforcement + partial session | Cursor, Kiro, OpenCode, KiloCode |
| **Tier 3: MCP-only** | MCP tools only, no hooks, instruction-file routing | Codex CLI, Zed, Antigravity |

Each adapter implements the `HookAdapter` interface and reports its capabilities via `capabilities()`. The server reports the capability tier to the agent at session start.

## Rationale

- **Honesty over marketing**: Tier 3 platforms have ~60% routing compliance (instruction-file only). We don't hide this — the agent and user both know.
- **Graceful degradation**: Missing hooks don't crash the system. The server adapts its behavior per tier.
- **Isolation**: Each adapter is independently testable. A bug in the Cursor adapter doesn't affect Claude Code.
- **Incremental rollout**: Phase 1 implements only Claude Code (Tier 1). Other platforms are added in later phases with their tested adapter.

## Consequences

- Users on Tier 3 platforms get a degraded experience. This is documented clearly.
- Each new platform requires a dedicated adapter with fixture-based tests.
- Platform API changes require adapter updates (isolated to one file per platform).
- The tier system may need adjustment as platforms evolve their hook support.
