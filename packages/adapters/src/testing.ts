/**
 * Test-only fixtures re-exported for sibling packages.
 *
 * Import via `@aegisctx/adapters/testing` — never from the root barrel —
 * so production bundles don't inadvertently include test data.
 */
export {
	postToolUseBashFailureFixture,
	postToolUseGitCommitFixture,
	postToolUseTodoWriteFixture,
	postToolUseWriteFixture,
	preCompactFixture,
	preToolUseBashFixture,
	preToolUseDotenvFixture,
	sessionStartFixture,
} from "./claude-code/fixtures.js";
