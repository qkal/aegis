/**
 * Output processing pipeline.
 *
 * Processes raw sandbox output before it enters the agent's context window:
 * - Truncation: enforce max output size
 * - Filtering: remove ANSI escape codes, control characters
 * - Intent matching: extract structured data from known output formats
 */

/** Options for output processing. */
export interface OutputProcessorOptions {
	readonly maxBytes: number;
	readonly stripAnsi: boolean;
	readonly trimWhitespace: boolean;
}

/** Default output processing options. */
export const DEFAULT_OUTPUT_OPTIONS: OutputProcessorOptions = {
	maxBytes: 5_242_880,
	stripAnsi: true,
	trimWhitespace: true,
};
