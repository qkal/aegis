/**
 * Discriminated union event model for session events.
 *
 * Each event kind has a fixed shape with a `kind` discriminant field.
 * This enables exhaustive pattern matching at the type level and
 * per-event-kind payload validation.
 */
import type { EventPriority } from "./priority.js";

/** A file operation tracked during the session. */
export interface FileEvent {
	readonly kind: "file";
	readonly action: "read" | "write" | "edit" | "delete" | "glob" | "grep";
	readonly path: string;
	readonly timestamp: string;
	readonly priority: typeof EventPriority.CRITICAL;
}

/** A git operation tracked during the session. */
export interface GitEvent {
	readonly kind: "git";
	readonly action:
		| "checkout"
		| "commit"
		| "merge"
		| "rebase"
		| "push"
		| "pull"
		| "stash"
		| "diff"
		| "status";
	readonly ref?: string;
	readonly message?: string;
	readonly timestamp: string;
	readonly priority: typeof EventPriority.HIGH;
}

/** A task lifecycle event. */
export interface TaskEvent {
	readonly kind: "task";
	readonly action: "create" | "update" | "complete";
	readonly description: string;
	readonly timestamp: string;
	readonly priority: typeof EventPriority.CRITICAL;
}

/** An error encountered during tool execution. */
export interface ErrorEvent {
	readonly kind: "error";
	readonly tool: string;
	readonly message: string;
	readonly exitCode?: number;
	readonly timestamp: string;
	readonly priority: typeof EventPriority.HIGH;
}

/** A user correction or decision recorded during the session. */
export interface DecisionEvent {
	readonly kind: "decision";
	readonly original: string;
	readonly correction: string;
	readonly timestamp: string;
	readonly priority: typeof EventPriority.HIGH;
}

/** A project rule or convention discovered or applied. */
export interface RuleEvent {
	readonly kind: "rule";
	readonly path: string;
	readonly content: string;
	readonly timestamp: string;
	readonly priority: typeof EventPriority.CRITICAL;
}

/** An environment variable change. */
export interface EnvironmentEvent {
	readonly kind: "environment";
	readonly variable: string;
	readonly value: string;
	readonly action: "set" | "unset";
	readonly timestamp: string;
	readonly priority: typeof EventPriority.HIGH;
}

/** A sandboxed code execution result. */
export interface ExecutionEvent {
	readonly kind: "execution";
	readonly language: string;
	readonly exitCode: number;
	readonly outputSize: number;
	readonly timestamp: string;
	readonly priority: typeof EventPriority.NORMAL;
}

/** A search query and its result count. */
export interface SearchEvent {
	readonly kind: "search";
	readonly queries: readonly string[];
	readonly resultCount: number;
	readonly timestamp: string;
	readonly priority: typeof EventPriority.NORMAL;
}

/** A user prompt submitted to the agent. */
export interface PromptEvent {
	readonly kind: "prompt";
	readonly content: string;
	readonly timestamp: string;
	readonly priority: typeof EventPriority.CRITICAL;
}

/**
 * Union of all session event types.
 *
 * Use `event.kind` as the discriminant for exhaustive switch/case handling.
 */
export type SessionEvent =
	| FileEvent
	| GitEvent
	| TaskEvent
	| ErrorEvent
	| DecisionEvent
	| RuleEvent
	| EnvironmentEvent
	| ExecutionEvent
	| SearchEvent
	| PromptEvent;

/** All possible event kind discriminant values. */
export type SessionEventKind = SessionEvent["kind"];

/**
 * Helper to assert exhaustive handling of all event kinds.
 * Usage: `default: assertNever(event)` in a switch on `event.kind`.
 */
export function assertNeverEvent(event: never): never {
	throw new Error(`Unhandled session event kind: ${JSON.stringify(event)}`);
}
