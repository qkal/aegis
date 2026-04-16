/**
 * aegis_execute — Sandboxed code execution tool.
 *
 * Executes code in an isolated sandbox process.
 * Supports 11 languages. Returns only stdout to the agent's context.
 *
 * Implementation deferred to Phase 1.
 */

export const TOOL_NAME = "aegis_execute" as const;

export const TOOL_DESCRIPTION =
	"Execute code in a sandboxed environment. Returns stdout only. " +
	"Supports: javascript, typescript, python, shell, ruby, go, rust, php, r, perl, swift.";
