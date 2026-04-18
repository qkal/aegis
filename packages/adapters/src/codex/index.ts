/**
 * Codex CLI adapter stub.
 *
 * Tier 1L (Limited): Full hook wiring (PreToolUse, PostToolUse,
 * UserPromptSubmit, SessionStart, Stop) but the Codex hook runtime
 * currently only emits PreToolUse/PostToolUse for the `Bash` tool.
 *
 * Integration surface (per ADR-0016):
 *  - `~/.codex/config.toml` — `[mcp_servers.aegisctx]` (stdio command/args/env)
 *  - `~/.codex/hooks.json` and `<project>/.codex/hooks.json` — command hooks
 *  - Feature flag: `[features] codex_hooks = true`
 *
 * Implementation lands in M1.7. This stub exists so the platform constant,
 * detect signals, and `aegisctx init codex` skeleton can compile against the
 * adapter package boundary.
 */

export const CODEX_PLATFORM = "codex" as const;

/** Tools Codex's hook runtime currently emits PreToolUse/PostToolUse for. */
export const CODEX_INTERCEPTED_TOOLS = ["Bash"] as const;
