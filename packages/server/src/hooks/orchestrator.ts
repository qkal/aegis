/**
 * Hook orchestration.
 *
 * Coordinates the flow of hook events through the Aegis pipeline:
 * Adapter → Router → Policy Engine → Execution Engine → Storage → Response.
 *
 * Implementation deferred to Phase 1.
 */

export const HOOK_TYPES = ["PreToolUse", "PostToolUse", "PreCompact", "SessionStart"] as const;
