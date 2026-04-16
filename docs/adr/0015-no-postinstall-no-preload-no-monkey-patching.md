# ADR-0015: No Postinstall, No Preload Injection, No Monkey-Patching

## Status

Accepted

## Date

2025-01-15

## Context

The reference project:
- Uses `esbuild`-minified bundles that are hard to audit
- Writes preload scripts to tmpdir and injects them via `NODE_OPTIONS`
- Has a postinstall script that runs on `npm install`

These are standard patterns, but they create a meaningful attack surface for a tool that intercepts every command an AI agent runs.

## Decision

Aegis ships with **zero supply-chain attack surface in its installation and runtime**:

1. **No postinstall scripts**: All setup is explicit via `aegis init`. The npm package has zero lifecycle scripts.
2. **No NODE_OPTIONS / --require preload injection**: Aegis does not modify the Node.js runtime environment of other processes.
3. **No monkey-patching of Node.js builtins**: No patching of `fs.readFileSync`, `child_process.spawn`, or any other built-in module.
4. **No `eval()`, `Function()`, or `vm.runInNewContext()` on untrusted input**: All external data is parsed into Zod schemas.

## Rationale

- **Supply chain safety**: A postinstall script runs arbitrary code at `npm install` time. For a security tool, this is an unacceptable attack vector.
- **Transparency (Rule R12)**: No hidden magic. Every behavior is explicit and documented. Users can audit exactly what Aegis does.
- **Process isolation**: Aegis should not modify the runtime environment of other processes on the user's machine. `NODE_OPTIONS` affects all Node.js processes, not just Aegis.
- **Deserialization safety**: `eval()` and `Function()` on untrusted input are well-known attack vectors. Schema validation (Zod) provides the same functionality safely.

## Consequences

- First-run setup requires an explicit `aegis init` command (not automatic on install).
- Filesystem tracking uses explicit instrumentation, not preload injection. This may be less comprehensive but is more transparent.
- Some features that the reference implements via preload (e.g., filesystem access tracking) may need alternative approaches.
