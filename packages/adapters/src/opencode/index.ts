/**
 * OpenCode adapter stub.
 *
 * Tier 1: Full hook coverage via the `@opencode-ai/plugin` SDK
 * (`tool.execute.before`, `tool.execute.after`, `session.compacted`,
 * `session.idle`, `permission.asked`, etc.).
 *
 * Integration surface (per ADR-0016):
 *  - Plugin file: `~/.config/opencode/plugins/aegis.ts` (global)
 *    or `<project>/.opencode/plugins/aegis.ts` (per-project), or an npm
 *    package referenced from `opencode.json` `"plugin": ["@aegis/opencode-plugin"]`.
 *  - MCP registration: `opencode.json` (or `~/.config/opencode/opencode.json`).
 *
 * Implementation lands in M1.8.
 */

export const OPENCODE_PLATFORM = "opencode" as const;

/** OpenCode plugin event names Aegis subscribes to. */
export const OPENCODE_PLUGIN_EVENTS = [
	"tool.execute.before",
	"tool.execute.after",
	"session.compacted",
	"session.idle",
	"permission.asked",
] as const;