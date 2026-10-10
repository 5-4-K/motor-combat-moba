/**
 * Test groups for the server. `vitest.config.ts` (`npm test`) excludes both lists;
 * `vitest.slow.config.ts` (`npm run test:slow`) runs SLOW_TESTS minus BENCH_TESTS;
 * `vitest.bench.config.ts` (`npm run test:bench`) runs only BENCH_TESTS. Entries are globs or paths
 * relative to this package root.
 *
 * SLOW tests play real headless matches or drive the bot brain through many ticks, and take minutes
 * rather than seconds. BENCH tests assert on wall-clock timing, which is flaky under load.
 *
 * `scripts/test-scope.mjs`'s `owesSlowTests` decides when a diff owes the slow group — a change under a
 * `sim/`, `rooms/`, `modes/`, `bot/` or `balance/` folder in shared or server. The cheap balance
 * harness tests (attribution, baseline, cli, fingerprint, report, stats) stay in the normal suite.
 */
export const SLOW_TESTS: string[] = ["src/bot/**/*.test.ts", "balance/match.test.ts", "balance/runner.test.ts", "src/netsim/netsim.sweep.test.ts"];
export const BENCH_TESTS: string[] = ["src/bot/brain/brain.bench.test.ts"];
