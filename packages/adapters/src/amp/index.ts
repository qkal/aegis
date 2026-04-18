/**
 * AmpCode (Sourcegraph Amp) adapter stub.
 *
 * Tier 3: MCP-only. Amp has no public hook / lifecycle API as of 2026-04.
 * Policy enforcement happens inside the MCP tool wrapper, not at the
 * agent's tool-call boundary. Routing is steered by an instruction file
 * (`.amp/AGENTS.md`) installed by `aegisctx init amp`.
 *
 * Integration surface (per ADR-0016):
 *  - MCP registration: `amp mcp add aegisctx -- aegisctx serve` (CLI), or an
 *    `amp.mcpServers.aegisctx` entry in `~/.amp/settings.json` /
 *    `<project>/.amp/settings.json`.
 *  - Routing instructions: `<project>/.amp/AGENTS.md`.
 *
 * Implementation lands in M1.9.
 */

export const AMP_PLATFORM = "amp" as const;
