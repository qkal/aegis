/**
 * aegis_stats — Session statistics tool.
 *
 * Reports context savings, call counts, and session statistics.
 *
 * Implementation deferred to Phase 1.
 */

export const TOOL_NAME = "aegis_stats" as const;

export const TOOL_DESCRIPTION = "Show session statistics: context bytes saved, tool call counts, "
	+ "cache hit rates, and sandbox execution metrics.";
