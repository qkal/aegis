/**
 * Hook orchestration.
 *
 * Coordinates the flow of hook events through the Aegis pipeline:
 * Adapter → Router → Policy Engine → Execution Engine → Storage → Response.
 *
 * Implementation deferred to Phase 1.
 */

// The canonical hook-kind list lives in `@aegis/adapters` (the untrusted
// input boundary). Re-export it here so server-side consumers can import
// from `@aegis/server` without pulling every adapter in directly.
export { HOOK_TYPES, type HookType } from "@aegis/adapters";
