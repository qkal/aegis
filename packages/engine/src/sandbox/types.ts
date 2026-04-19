/**
 * Sandbox execution types.
 *
 * Defines the contract for sandboxed process execution.
 * The sandbox spawns isolated child processes with constrained
 * environments, captures output, and enforces timeouts.
 */

import type { Language } from "@aegisctx/core";

/** Configuration for a sandbox execution. */
export interface SandboxConfig {
	/** The code to execute. */
	readonly code: string;
	/** The language runtime to use. */
	readonly language: Language;
	/** Maximum execution time in milliseconds. */
	readonly timeoutMs: number;
	/** Maximum output size in bytes. */
	readonly maxOutputBytes: number;
	/** Explicitly allowed environment variables (key-value pairs). */
	readonly env: Readonly<Record<string, string>>;
	/** Working directory for the sandbox process. */
	readonly workingDir?: string;
	/** Whether to allow network access. */
	readonly allowNetwork: boolean;
}

/**
 * Result of a sandbox execution.
 * Discriminated union on `status`.
 */
export type ExecOutcome =
	| {
		readonly status: "success";
		readonly stdout: string;
		readonly stderr: string;
		readonly exitCode: 0;
		readonly durationMs: number;
	}
	| {
		readonly status: "failure";
		readonly stdout: string;
		readonly stderr: string;
		readonly exitCode: number;
		readonly durationMs: number;
	}
	| {
		readonly status: "timeout";
		readonly stdout: string;
		readonly stderr: string;
		readonly durationMs: number;
	}
	| {
		readonly status: "denied";
		readonly reason: string;
		readonly matchedRule: string;
	}
	| {
		readonly status: "error";
		readonly error: string;
	};
