/**
 * Output processing pipeline.
 *
 * Processes raw sandbox output before it enters the agent's context window:
 * - Truncation: enforce a hard cap on output size in UTF-8 bytes
 * - Filtering: strip ANSI escape sequences and control characters so the
 *   captured output is safe to embed in structured responses
 * - Trimming: optionally remove leading / trailing whitespace
 *
 * All functions in this module are pure: no I/O, no globals, no mutation
 * of the inputs. Identical inputs produce identical outputs.
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

/**
 * Result of processing a raw output buffer.
 *
 * - `text`: the processed output
 * - `truncated`: whether bytes were dropped to honour `maxBytes`
 * - `originalByteLength`: the UTF-8 byte length of the raw input
 */
export interface ProcessedOutput {
	readonly text: string;
	readonly truncated: boolean;
	readonly originalByteLength: number;
}

/**
 * Matches CSI / OSC / SS2 / SS3 / reset sequences emitted by terminal
 * programs (colour codes, cursor moves, title sets, …).
 *
 * The pattern is intentionally conservative and avoids unbounded
 * backtracking. It is a single alternation with fixed-shape branches,
 * so it remains linear in input length even on adversarial input.
 */
const ANSI_PATTERN =
	// eslint-disable-next-line no-control-regex
	/[\u001b\u009b](?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[PX^_][^\u0007\u001b]*(?:\u0007|\u001b\\)|[()#][0-9A-Za-z]|[=>78MHEDcZ])/g;

/**
 * Remove ANSI escape sequences from `input`.
 *
 * Only terminal control sequences are stripped; printable text, newlines,
 * tabs, and non-ASCII characters are preserved verbatim.
 */
export function stripAnsi(input: string): string {
	return input.replace(ANSI_PATTERN, "");
}

/**
 * Remove C0 control characters that terminals interpret but that would
 * corrupt structured output. Preserves tab (\t), newline (\n), and
 * carriage return (\r). Also removes the DEL character.
 */
const CONTROL_PATTERN =
	// eslint-disable-next-line no-control-regex
	/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function stripControlCharacters(input: string): string {
	return input.replace(CONTROL_PATTERN, "");
}

/**
 * Truncate `input` so that its UTF-8 byte length does not exceed
 * `maxBytes`. Returns the original string if it is already within the
 * cap. Never splits a UTF-8 multibyte sequence: the result is always
 * valid UTF-8.
 *
 * @throws RangeError if `maxBytes` is negative or not an integer.
 */
export function truncateToByteLength(input: string, maxBytes: number): {
	readonly text: string;
	readonly truncated: boolean;
	readonly originalByteLength: number;
} {
	if (!Number.isInteger(maxBytes) || maxBytes < 0) {
		throw new RangeError(`maxBytes must be a non-negative integer, got ${maxBytes}`);
	}
	const buffer = Buffer.from(input, "utf8");
	const originalByteLength = buffer.byteLength;
	if (originalByteLength <= maxBytes) {
		return { text: input, truncated: false, originalByteLength };
	}
	// Walk back from maxBytes to the nearest UTF-8 code-point boundary.
	// A continuation byte has the top two bits set to 10 (0b10xxxxxx).
	let end = maxBytes;
	while (end > 0) {
		const byte = buffer[end];
		if (byte === undefined || (byte & 0b1100_0000) !== 0b1000_0000) {
			break;
		}
		end -= 1;
	}
	return {
		text: buffer.subarray(0, end).toString("utf8"),
		truncated: true,
		originalByteLength,
	};
}

/**
 * Apply the full output-processing pipeline to `input`.
 *
 * The pipeline is ordered so that stripping happens before truncation:
 * truncating first would let ANSI sequences pad the byte budget with
 * invisible data.
 */
export function processOutput(
	input: string,
	options: OutputProcessorOptions = DEFAULT_OUTPUT_OPTIONS,
): ProcessedOutput {
	let text = input;
	if (options.stripAnsi) {
		text = stripAnsi(text);
		text = stripControlCharacters(text);
	}
	if (options.trimWhitespace) {
		text = text.trim();
	}
	const truncation = truncateToByteLength(text, options.maxBytes);
	return {
		text: truncation.text,
		truncated: truncation.truncated,
		originalByteLength: truncation.originalByteLength,
	};
}
