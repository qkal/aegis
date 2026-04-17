/**
 * Hook orchestration.
 *
 * Coordinates the flow of hook events through the Aegis pipeline:
 * Adapter → Router → Policy Engine → Execution Engine → Storage → Response.
 *
 * M1.4 populates the capture / snapshot / restore leg; policy routing
 * (M1.5) and full Policy → Execution wiring land in subsequent milestones.
 */

// The canonical hook-kind list lives in `@aegis/adapters` (the untrusted
// input boundary). Re-export it here so server-side consumers can import
// from `@aegis/server` without pulling every adapter in directly.
export { HOOK_TYPES, type HookType } from "@aegis/adapters";

// M1.4 — session event capture, compaction snapshot, and restore.
export {
	captureToolResult,
	countEventsByKind,
	defaultEventIdFactory,
	generateSnapshot,
	restoreSnapshot,
} from "./capture.js";
export type { CaptureContext } from "./capture.js";

// M1.4 — idle-window snapshot scheduler (fallback for Codex / AmpCode).
export {
	DEFAULT_IDLE_WINDOW_MS,
	IdleWindowSnapshotter,
	MIN_IDLE_WINDOW_MS,
} from "./idle-snapshot.js";
export type { IdleWindowOptions, TimerHandle, TimerLike } from "./idle-snapshot.js";
