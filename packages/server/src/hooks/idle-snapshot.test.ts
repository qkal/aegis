/**
 * Tests for IdleWindowSnapshotter.
 *
 * Uses a fake TimerLike so the scheduler runs synchronously against a
 * controllable clock — no real setTimeout, no flaky waits.
 */
import { describe, expect, it, vi } from "vitest";

import {
	DEFAULT_IDLE_WINDOW_MS,
	IdleWindowSnapshotter,
	MIN_IDLE_WINDOW_MS,
	type TimerHandle,
	type TimerLike,
} from "./idle-snapshot.js";

interface FakeTimer extends TimerLike {
	advance(ms: number): void;
	readonly scheduled: number;
}

function fakeTimer(): FakeTimer {
	let now = 0;
	let pending:
		| { fireAt: number; fn: () => void; handle: TimerHandle; }
		| undefined;
	let scheduled = 0;

	const timer: FakeTimer = {
		setTimeout(fn, ms) {
			scheduled += 1;
			const handle = Symbol(`fake-timer-${scheduled}`);
			pending = { fireAt: now + ms, fn, handle };
			return handle;
		},
		clearTimeout(handle) {
			if (pending !== undefined && pending.handle === handle) {
				pending = undefined;
			}
		},
		advance(ms) {
			now += ms;
			if (pending !== undefined && pending.fireAt <= now) {
				const fn = pending.fn;
				pending = undefined;
				fn();
			}
		},
		get scheduled() {
			return scheduled;
		},
	};
	return timer;
}

describe("IdleWindowSnapshotter", () => {
	it("invokes onIdle after idleMs of silence", () => {
		const timer = fakeTimer();
		const onIdle = vi.fn<() => void>();
		const snap = new IdleWindowSnapshotter({ idleMs: 1000, timer, onIdle });
		snap.bump();
		timer.advance(999);
		expect(onIdle).not.toHaveBeenCalled();
		timer.advance(1);
		expect(onIdle).toHaveBeenCalledTimes(1);
	});

	it("bump() resets the window each time it's called", () => {
		const timer = fakeTimer();
		const onIdle = vi.fn<() => void>();
		const snap = new IdleWindowSnapshotter({ idleMs: 1000, timer, onIdle });

		snap.bump();
		timer.advance(900);
		snap.bump(); // extends the window by 1000ms from now
		timer.advance(900);
		expect(onIdle).not.toHaveBeenCalled();
		timer.advance(100);
		expect(onIdle).toHaveBeenCalledTimes(1);
	});

	it("stop() cancels any pending idle fire and is idempotent", () => {
		const timer = fakeTimer();
		const onIdle = vi.fn<() => void>();
		const snap = new IdleWindowSnapshotter({ idleMs: 1000, timer, onIdle });
		snap.bump();
		snap.stop();
		snap.stop();
		timer.advance(10_000);
		expect(onIdle).not.toHaveBeenCalled();
		expect(snap.stopped).toBe(true);
	});

	it("bump() is a no-op after stop()", () => {
		const timer = fakeTimer();
		const onIdle = vi.fn<() => void>();
		const snap = new IdleWindowSnapshotter({ idleMs: 1000, timer, onIdle });
		snap.stop();
		snap.bump();
		timer.advance(10_000);
		expect(onIdle).not.toHaveBeenCalled();
	});

	it("clamps sub-second idleMs up to MIN_IDLE_WINDOW_MS", () => {
		const timer = fakeTimer();
		const snap = new IdleWindowSnapshotter({ idleMs: 5, timer, onIdle: () => {} });
		expect(snap.idleMs).toBe(MIN_IDLE_WINDOW_MS);
	});

	it("defaults to DEFAULT_IDLE_WINDOW_MS when no idleMs is supplied", () => {
		const timer = fakeTimer();
		const snap = new IdleWindowSnapshotter({ timer, onIdle: () => {} });
		expect(snap.idleMs).toBe(DEFAULT_IDLE_WINDOW_MS);
	});

	it("routes synchronous onIdle exceptions to onError without tearing down", () => {
		const timer = fakeTimer();
		const onError = vi.fn<(err: unknown) => void>();
		const snap = new IdleWindowSnapshotter({
			idleMs: 1000,
			timer,
			onIdle: () => {
				throw new Error("kaboom");
			},
			onError,
		});
		snap.bump();
		timer.advance(1000);
		expect(onError).toHaveBeenCalledTimes(1);
		expect(String((onError.mock.calls[0] ?? [undefined])[0])).toContain("kaboom");
	});

	it("routes rejected onIdle promises to onError", async () => {
		const timer = fakeTimer();
		const onError = vi.fn<(err: unknown) => void>();
		const snap = new IdleWindowSnapshotter({
			idleMs: 1000,
			timer,
			onIdle: async () => {
				await Promise.resolve();
				throw new Error("async-boom");
			},
			onError,
		});
		snap.bump();
		timer.advance(1000);
		// Allow the microtask queue to drain.
		await Promise.resolve();
		await Promise.resolve();
		expect(onError).toHaveBeenCalled();
	});

	it("allows re-scheduling after a fire", () => {
		const timer = fakeTimer();
		const onIdle = vi.fn<() => void>();
		const snap = new IdleWindowSnapshotter({ idleMs: 1000, timer, onIdle });
		snap.bump();
		timer.advance(1000);
		expect(onIdle).toHaveBeenCalledTimes(1);
		snap.bump();
		timer.advance(1000);
		expect(onIdle).toHaveBeenCalledTimes(2);
	});
});
