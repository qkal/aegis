/**
 * aegis_doctor — Diagnostics tool.
 *
 * Full health check: runtimes, hooks, FTS5, policy, versions.
 *
 * Implementation deferred to Phase 1.
 */

export const TOOL_NAME = "aegis_doctor" as const;

export const TOOL_DESCRIPTION = "Run diagnostics: check platform detection, available runtimes, "
	+ "storage health, policy validity, and hook registration.";
