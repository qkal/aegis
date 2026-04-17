/**
 * PolyglotExecutor — sandboxed process-based code execution.
 *
 * Responsibilities:
 * - Write the user-supplied source to a temp file with `0o700` permissions
 * - Spawn the runtime binary with an explicitly-constructed environment
 * - Detach the child into its own process group so timeouts can kill the
 *   entire tree with a single `SIGKILL`
 * - Capture stdout and stderr up to `maxOutputBytes`, streaming-safe
 * - Enforce `timeoutMs` via a wall-clock timer
 * - Process captured output (ANSI strip, truncation, trimming) before
 *   returning an {@link ExecOutcome}
 *
 * The executor never inherits the parent's environment, cwd, or stdio,
 * and never invokes a shell. Language-specific command planning lives in
 * `../runtime/command.ts`; runtime detection lives in `../runtime/detect.ts`.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Language } from "@aegis/core";

import { DEFAULT_OUTPUT_OPTIONS, processOutput } from "../output/index.js";
import { planExecution, SOURCE_PLACEHOLDER } from "../runtime/command.js";
import { cachedDetectRuntime, type DetectedRuntime } from "../runtime/detect.js";
import type { ExecOutcome, SandboxConfig } from "./types.js";

/**
 * How the executor locates a runtime for a given language. The default
 * delegates to {@link cachedDetectRuntime}; tests and alternative
 * deployments can inject a synchronous resolver.
 */
export type RuntimeResolver = (language: Language) => DetectedRuntime;

export interface PolyglotExecutorOptions {
	/** Override runtime resolution. Defaults to cached detection. */
	readonly resolveRuntime?: RuntimeResolver;
	/** Root directory for temporary sandbox workspaces. Defaults to `os.tmpdir()`. */
	readonly tempRoot?: string;
}

/**
 * Buffer-bounded stream sink. Captures bytes up to `maxBytes` and
 * silently drops the overflow. The raw buffer is returned as a UTF-8
 * string at capture end.
 */
class BoundedSink {
	private readonly chunks: Buffer[] = [];
	private size = 0;
	private overflowed = false;
	constructor(private readonly maxBytes: number) {}

	write(chunk: Buffer): void {
		if (this.overflowed) {
			return;
		}
		const remaining = this.maxBytes - this.size;
		if (chunk.byteLength <= remaining) {
			this.chunks.push(chunk);
			this.size += chunk.byteLength;
			return;
		}
		if (remaining > 0) {
			this.chunks.push(chunk.subarray(0, remaining));
			this.size += remaining;
		}
		this.overflowed = true;
	}

	toString(): string {
		return Buffer.concat(this.chunks, this.size).toString("utf8");
	}
}

/**
 * Write `source` to a uniquely-named file inside a freshly-created
 * `0o700` directory under `tempRoot`. Returns both the directory and
 * the source file path so the caller can clean up with `rmSync(..., { recursive: true, force: true })`.
 */
function materializeSource(
	tempRoot: string,
	source: string,
	extension: string,
): { readonly workDir: string; readonly sourcePath: string; } {
	const workDir = mkdtempSync(join(tempRoot, "aegis-sandbox-"));
	const sourcePath = join(workDir, `sandbox${extension}`);
	writeFileSync(sourcePath, source, { mode: 0o600 });
	return { workDir, sourcePath };
}

function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
	if (pid === undefined) {
		return;
	}
	try {
		// Negative pid → signal every process in the group, matching the
		// `detached: true` group we created at spawn time.
		process.kill(-pid, signal);
	} catch {
		// The child may have already exited or the OS may not support
		// killing process groups; fall back to killing the direct child.
		try {
			process.kill(pid, signal);
		} catch {
			/* swallow */
		}
	}
}

/**
 * Executes arbitrary source code in an isolated child process.
 *
 * Usage:
 * ```ts
 * const exec = new PolyglotExecutor();
 * const outcome = await exec.execute({
 *   code: "console.log('hi')",
 *   language: "javascript",
 *   timeoutMs: 5_000,
 *   maxOutputBytes: 1_048_576,
 *   env: { PATH: process.env.PATH ?? "" },
 *   allowNetwork: false,
 * });
 * ```
 */
export class PolyglotExecutor {
	private readonly resolveRuntime: RuntimeResolver;
	private readonly tempRoot: string;

	constructor(options: PolyglotExecutorOptions = {}) {
		this.resolveRuntime = options.resolveRuntime ?? cachedDetectRuntime;
		this.tempRoot = options.tempRoot ?? tmpdir();
	}

	async execute(config: SandboxConfig): Promise<ExecOutcome> {
		if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) {
			return { status: "error", error: "timeoutMs must be > 0" };
		}
		if (!Number.isFinite(config.maxOutputBytes) || config.maxOutputBytes <= 0) {
			return { status: "error", error: "maxOutputBytes must be > 0" };
		}

		const runtime = this.resolveRuntime(config.language);
		if (!runtime.available) {
			return {
				status: "error",
				error: `no runtime available for language "${config.language}"`,
			};
		}

		const plan = planExecution(runtime);

		let workDir: string | undefined;
		let sourcePath: string | undefined;
		try {
			const materialized = materializeSource(this.tempRoot, config.code, plan.sourceExtension);
			workDir = materialized.workDir;
			sourcePath = materialized.sourcePath;
			const args = plan.args.map((arg) => arg === SOURCE_PLACEHOLDER ? sourcePath! : arg);

			return await this.spawnAndCapture({
				config,
				executable: plan.executable,
				args,
				cwd: config.workingDir ?? workDir,
			});
		} catch (err) {
			return {
				status: "error",
				error: err instanceof Error ? err.message : String(err),
			};
		} finally {
			if (workDir !== undefined) {
				rmSync(workDir, { recursive: true, force: true });
			}
		}
	}

	private spawnAndCapture(params: {
		readonly config: SandboxConfig;
		readonly executable: string;
		readonly args: readonly string[];
		readonly cwd: string;
	}): Promise<ExecOutcome> {
		const { config, executable, args, cwd } = params;
		return new Promise<ExecOutcome>((resolve) => {
			const startedAt = performance.now();

			let child;
			try {
				child = spawn(executable, [...args], {
					cwd,
					env: { ...config.env },
					stdio: ["ignore", "pipe", "pipe"],
					detached: true,
					shell: false,
					windowsHide: true,
				});
			} catch (err) {
				resolve({
					status: "error",
					error: err instanceof Error ? err.message : String(err),
				});
				return;
			}

			const stdoutSink = new BoundedSink(config.maxOutputBytes);
			const stderrSink = new BoundedSink(config.maxOutputBytes);
			let timedOut = false;
			let settled = false;

			const timer = setTimeout(() => {
				timedOut = true;
				killProcessGroup(child.pid, "SIGKILL");
			}, config.timeoutMs);
			timer.unref?.();

			child.stdout?.on("data", (chunk: Buffer) => stdoutSink.write(chunk));
			child.stderr?.on("data", (chunk: Buffer) => stderrSink.write(chunk));

			const settle = (outcome: ExecOutcome): void => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				resolve(outcome);
			};

			child.on("error", (err) => {
				settle({ status: "error", error: err.message });
			});

			child.on("close", (code, signal) => {
				const durationMs = Math.round(performance.now() - startedAt);
				const stdout = processOutput(stdoutSink.toString(), {
					...DEFAULT_OUTPUT_OPTIONS,
					maxBytes: config.maxOutputBytes,
				}).text;
				const stderr = processOutput(stderrSink.toString(), {
					...DEFAULT_OUTPUT_OPTIONS,
					maxBytes: config.maxOutputBytes,
				}).text;
				if (timedOut) {
					settle({ status: "timeout", stdout, stderr, durationMs });
					return;
				}
				if (code === 0) {
					settle({ status: "success", stdout, stderr, exitCode: 0, durationMs });
					return;
				}
				const exitCode = code ?? signalToExitCode(signal);
				settle({ status: "failure", stdout, stderr, exitCode, durationMs });
			});
		});
	}
}

/** Convert a POSIX signal name to a conventional exit code (128 + signum). */
function signalToExitCode(signal: NodeJS.Signals | null): number {
	if (!signal) {
		return 1;
	}
	const map: Partial<Record<NodeJS.Signals, number>> = {
		SIGHUP: 129,
		SIGINT: 130,
		SIGQUIT: 131,
		SIGKILL: 137,
		SIGTERM: 143,
	};
	return map[signal] ?? 1;
}
