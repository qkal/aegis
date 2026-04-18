/**
 * Command planning for sandboxed execution.
 *
 * Given a detected runtime and a chunk of source code, return the exact
 * `{ executable, args }` pair that `PolyglotExecutor` should `spawn()`,
 * plus the filename suffix the source should be written under.
 *
 * The planning layer is pure: it never touches the filesystem and never
 * spawns processes. It exists so that sandbox spawning logic stays
 * language-agnostic and so that command construction is independently
 * testable.
 */

import type { Language } from "@aegisctx/core";
import type { AvailableRuntime } from "./detect.js";

/** A fully-specified invocation for a runtime. */
export interface CommandPlan {
	/** Absolute path to the runtime binary that will be spawned. */
	readonly executable: string;
	/**
	 * Argument vector (excluding `argv[0]`). When the runtime needs a
	 * source file on disk, the path where the source must be written is
	 * substituted in place of the literal sentinel `"{{SOURCE}}"`.
	 */
	readonly args: readonly string[];
	/** File extension (with leading dot) under which the source is written. */
	readonly sourceExtension: string;
	/**
	 * When `true`, the plan references the source file path via the
	 * `{{SOURCE}}` sentinel in `args`. The sandbox substitutes the real
	 * path at spawn time.
	 */
	readonly needsSourceFile: true;
}

/** Sentinel replaced by the real source path at spawn time. */
export const SOURCE_PLACEHOLDER = "{{SOURCE}}";

/** Fallback binary name for the shell runtime. */
export const SHELL_BINARY_FALLBACK = "sh" as const;

/** File extension used when writing source for each language. */
export const FILE_EXTENSION: Record<Language, string> = {
	javascript: ".mjs",
	typescript: ".ts",
	python: ".py",
	shell: ".sh",
	ruby: ".rb",
	go: ".go",
	rust: ".rs",
	php: ".php",
	r: ".R",
	perl: ".pl",
	swift: ".swift",
};

/**
 * Build a {@link CommandPlan} for running `runtime` against source code
 * of language `runtime.language`. The caller is responsible for writing
 * the source to the path that replaces `SOURCE_PLACEHOLDER`.
 *
 * @throws Error when the runtime is unsupported (should be unreachable
 *         if `runtime.language` is a valid `Language`).
 */
export function planExecution(runtime: AvailableRuntime): CommandPlan {
	const ext = FILE_EXTENSION[runtime.language];
	switch (runtime.language) {
		case "javascript":
			return plan(runtime.path, [SOURCE_PLACEHOLDER], ext);
		case "typescript": {
			// `bun <file>` and `tsx <file>` share the same shape.
			return plan(runtime.path, [SOURCE_PLACEHOLDER], ext);
		}
		case "python":
			return plan(runtime.path, [SOURCE_PLACEHOLDER], ext);
		case "shell":
			return plan(runtime.path, [SOURCE_PLACEHOLDER], ext);
		case "ruby":
			return plan(runtime.path, [SOURCE_PLACEHOLDER], ext);
		case "php":
			return plan(runtime.path, [SOURCE_PLACEHOLDER], ext);
		case "r":
			return plan(runtime.path, [SOURCE_PLACEHOLDER], ext);
		case "perl":
			return plan(runtime.path, [SOURCE_PLACEHOLDER], ext);
		case "go":
			// `go run <file>` compiles-and-runs a single file in one step.
			return plan(runtime.path, ["run", SOURCE_PLACEHOLDER], ext);
		case "rust":
			// `rustc` only compiles. A correct plan would need a second
			// spawn to execute the produced binary (compile-then-run),
			// which is deferred to Phase 2. Fail fast so callers do not
			// mistake a successful `rustc` invocation for a successful
			// program run.
			throw new Error("rust execution is not yet supported");
		case "swift":
			// Swift's default binary accepts a file and runs it directly.
			return plan(runtime.path, [SOURCE_PLACEHOLDER], ext);
	}
}

function plan(executable: string, args: readonly string[], ext: string): CommandPlan {
	return { executable, args, sourceExtension: ext, needsSourceFile: true };
}
