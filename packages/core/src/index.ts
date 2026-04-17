/**
 * @aegis/core — Pure logic package.
 *
 * Contains policy evaluation, event model, routing decisions,
 * and branded type definitions. Zero npm dependencies. Zero I/O.
 * Fully testable with just `import` and `assert`.
 */

// Event model
export * from "./events/index.js";
// Policy engine
export * from "./policy/index.js";
// Routing
export * from "./routing/index.js";
// Snapshot builder (priority-tiered context restoration)
export * from "./snapshot/index.js";
// Branded types
export * from "./types/index.js";
