/**
 * @aegis/cli — Command-line interface.
 *
 * User-facing commands for setup, diagnostics, policy management,
 * audit inspection, and configuration. Depends on all other packages.
 */

export { CLI_DESCRIPTION, CLI_NAME, CLI_VERSION, dispatch, renderUsage } from "./cli.js";
export {
	type CheckResult,
	defaultDoctorEnv,
	type DoctorEnv,
	renderReport,
	runChecks,
} from "./commands/doctor.js";
export {
	applyInit,
	defaultInitEnv,
	INIT_PLATFORMS,
	type InitEnv,
	type InitOptions,
	type InitPlatform,
	parseInitArgs,
	plan,
	type PlannedFile,
	renderPreview,
	renderSummary,
	resolve as resolveInit,
	type ResolvedFile,
} from "./commands/init.js";
export {
	bold,
	cyan,
	dim,
	green,
	red,
	shouldUseColor,
	statusSymbol,
	type TermStyle,
	yellow,
} from "./term.js";
