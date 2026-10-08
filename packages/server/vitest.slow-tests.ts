/**
 * The server's SLOW tests: they play real headless matches or drive the bot brain through many
 * ticks, and take minutes rather than seconds. `vitest.config.ts` excludes them from the normal
 * suite (`npm test`); `vitest.slow.config.ts` runs only them (`npm run test:slow`).
 *
 * `scripts/test-scope.mjs`'s `owesSlowTests` decides when a diff owes them — a change under a
 * `sim/`, `rooms/`, `modes/`, `bot/` or `balance/` folder in shared or server. The cheap balance
 * harness tests (attribution, baseline, cli, fingerprint, report, stats) stay in the normal suite.
 */
export const SLOW_TESTS = ["src/bot/**/*.test.ts", "balance/match.test.ts", "balance/runner.test.ts"];
