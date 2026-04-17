/**
 * Minimal ANSI terminal helpers.
 *
 * No third-party color dependency — Aegis keeps its CLI surface
 * zero-runtime-dep so the binary stays slim and auditable. Callers
 * always pass an explicit `useColor` flag (typically derived from
 * `NO_COLOR` / `stdout.isTTY` at the entry point) rather than
 * probing the environment inside every call site.
 */

export interface TermStyle {
	/** Whether ANSI escape sequences should be emitted. */
	readonly useColor: boolean;
}

const ESC = "\u001b[";

function wrap(code: number, reset: number, useColor: boolean, text: string): string {
	if (!useColor || text === "") return text;
	return `${ESC}${code}m${text}${ESC}${reset}m`;
}

export const bold = (s: string, t: TermStyle): string => wrap(1, 22, t.useColor, s);
export const dim = (s: string, t: TermStyle): string => wrap(2, 22, t.useColor, s);
export const red = (s: string, t: TermStyle): string => wrap(31, 39, t.useColor, s);
export const green = (s: string, t: TermStyle): string => wrap(32, 39, t.useColor, s);
export const yellow = (s: string, t: TermStyle): string => wrap(33, 39, t.useColor, s);
export const cyan = (s: string, t: TermStyle): string => wrap(36, 39, t.useColor, s);

/**
 * Render a status symbol for a check-style line. The symbol is always
 * ASCII so it renders correctly in tests, CI logs, and Windows
 * terminals without requiring a Unicode-capable font.
 */
export function statusSymbol(status: "ok" | "warn" | "fail", t: TermStyle): string {
	switch (status) {
		case "ok":
			return green("[OK]  ", t);
		case "warn":
			return yellow("[WARN]", t);
		case "fail":
			return red("[FAIL]", t);
	}
}

/**
 * Decide whether the current terminal should receive color escapes.
 * Honors the conventional `NO_COLOR` environment variable, and
 * falls back to `isTTY` when the stream exposes it.
 */
export function shouldUseColor(
	env: Readonly<Record<string, string | undefined>>,
	stream: { isTTY?: boolean; },
): boolean {
	if (env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "") return false;
	if (env["FORCE_COLOR"] !== undefined && env["FORCE_COLOR"] !== "") return true;
	return stream.isTTY === true;
}
