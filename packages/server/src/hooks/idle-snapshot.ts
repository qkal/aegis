/**
 * Idle-window snapshot scheduler (M1.4).
 *
 * Fallback path for platforms without a first-class `PreCompact` hook
 * (Codex, AmpCode, and OpenCode's `session.idle` window). The agent
 * tells us every time it finishes producing work; if nothing happens
 * for `idleMs`, we snapshot proactively so a restart or context reset
 * doesn't lose the session state.
 *
 * Design notes:
 *
 *   • The scheduler is a plain state machine around a single timer
 *     handle — it does NOT own a wall clock or a timer implementation.
 *     Both are injected so the whole thing unit-tests against a fake
 *     clock (`scheduler.tick(5000)`) without real setTimeout.
 *
 *   • `bump()` is the only input. Call it from every tool call result,
 *     every MCP request, every SessionStart. The scheduler resets the
 *     idle window and, when it fires, invokes the injected `onIdle`
 *     callback inside a try/catch so a snapshot failure can never
 *     tear down the server.
 *
 *   • `stop()` is idempotent. Call it when the session ends.
 */

/** Minimal timer surface: returns an opaque handle; cancel with the matching clear. */
export interface TimerLike {
	readonly setTimeout: (fn: () => void, ms: number) => TimerHandle;
	readonly clearTimeout: (handle: TimerHandle) => void;
}

export type TimerHandle = unknown;

export interface IdleWindowOptions {
	/** How long of no activity (ms) triggers a snapshot. Default: 5 minutes. */
	readonly idleMs?: number;
	/** Timer implementation. Defaults to global `setTimeout` / `clearTimeout`. */
	readonly timer?: TimerLike;
	/** Callback invoked when the idle window fires. Must be side-effect-only. */
	readonly onIdle: () => void | Promise<void>;
	/** Error sink for failures inside `onIdle`. Defaults to `console.error`. */
	readonly onError?: (err: unknown) => void;
}

export const DEFAULT_IDLE_WINDOW_MS = 5 * 60 * 1000;
export const MIN_IDLE_WINDOW_MS = 1_000;

/**
 * Idle-window snapshot scheduler. One instance per session.
 *
 * Lifecycle:
 *   1. `bump()` — call on every captured event / hook to reset the window.
 *   2. After `idleMs` of silence the timer fires and invokes `onIdle()`.
 *   3. `stop()` — call on session end to cancel any pending timer.
 */
export class IdleWindowSnapshotter {
	readonly #idleMs: number;
	readonly #timer: TimerLike;
	readonly #onIdle: () => void | Promise<void>;
	readonly #onError: (err: unknown) => void;

	#handle: TimerHandle | undefined;
	#stopped = false;
	#pendingFire = false;

	constructor(options: IdleWindowOptions) {
		const raw = options.idleMs ?? DEFAULT_IDLE_WINDOW_MS;
		this.#idleMs = Math.max(MIN_IDLE_WINDOW_MS, raw);
		this.#timer = options.timer ?? defaultTimer();
		this.#onIdle = options.onIdle;
		this.#onError = options.onError ?? defaultOnError;
	}

	/** Reset the idle window. Call on every captured event or hook. */
	bump(): void {
		if (this.#stopped) return;
		if (this.#handle !== undefined) {
			this.#timer.clearTimeout(this.#handle);
		}
		this.#handle = this.#timer.setTimeout(() => this.#fire(), this.#idleMs);
	}

	/** Stop the scheduler. Idempotent. */
	stop(): void {
		this.#stopped = true;
		if (this.#handle !== undefined) {
			this.#timer.clearTimeout(this.#handle);
			this.#handle = undefined;
		}
	}

	/** True once `stop()` has been invoked. */
	get stopped(): boolean {
		return this.#stopped;
	}

	/** Effective idle window in ms, after clamping. */
	get idleMs(): number {
		return this.#idleMs;
	}

	/**
	 * True if an `onIdle` invocation is currently in-flight. Exposed so
	 * integration tests can await completion deterministically.
	 */
	get firing(): boolean {
		return this.#pendingFire;
	}

	#fire(): void {
		this.#handle = undefined;
		if (this.#stopped) return;
		this.#pendingFire = true;
		try {
			const result = this.#onIdle();
			if (result instanceof Promise) {
				result
					.catch((err: unknown) => this.#onError(err))
					.finally(() => {
						this.#pendingFire = false;
					});
				return;
			}
		} catch (err) {
			this.#onError(err);
		}
		this.#pendingFire = false;
	}
}

function defaultTimer(): TimerLike {
	return {
		setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
		clearTimeout: (handle) => {
			// Node / browsers / Bun all accept any opaque handle here.
			globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
		},
	};
}

function defaultOnError(err: unknown): void {
	// eslint-disable-next-line no-console
	console.error("[aegis:idle-snapshot] onIdle failed:", err);
}
