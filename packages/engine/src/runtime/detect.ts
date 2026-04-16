/**
 * Runtime detection.
 *
 * Detects available language runtimes on the host system.
 * Results are cached for the lifetime of the server process.
 */

import type { Language } from "@aegis/core";

/**
 * Runtime that was located on the host. Narrowing on `available: true`
 * surfaces the version and path; the unavailable variant carries only the
 * requested language so callers cannot accidentally read placeholder
 * version strings.
 */
export interface AvailableRuntime {
	readonly language: Language;
	readonly available: true;
	readonly version: string;
	readonly path: string;
}

export interface UnavailableRuntime {
	readonly language: Language;
	readonly available: false;
}

export type DetectedRuntime = AvailableRuntime | UnavailableRuntime;

/** Map of language to the binary name used for detection. */
export const RUNTIME_BINARIES: Record<Language, readonly string[]> = {
	javascript: ["node"],
	typescript: ["bun", "npx"],
	python: ["python3", "python"],
	shell: ["bash", "sh"],
	ruby: ["ruby"],
	go: ["go"],
	rust: ["rustc"],
	php: ["php"],
	r: ["Rscript"],
	perl: ["perl"],
	swift: ["swift"],
};
