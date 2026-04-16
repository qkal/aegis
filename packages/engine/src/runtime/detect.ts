/**
 * Runtime detection.
 *
 * Detects available language runtimes on the host system.
 * Results are cached for the lifetime of the server process.
 */

import type { Language } from "@aegis/core";

/** Detected runtime with version and path. */
export interface DetectedRuntime {
	readonly language: Language;
	readonly version: string;
	readonly path: string;
	readonly available: boolean;
}

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
