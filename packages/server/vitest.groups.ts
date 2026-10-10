/**
 * Test groups for the server. `vitest.config.ts` (`npm test`) excludes every list;
 * `vitest.slow.config.ts` (`npm run test:slow`) runs SLOW_TESTS minus BENCH_TESTS;
 * `vitest.net.config.ts` (`npm run test:net`) runs NET_TESTS (the full netsim link sweep, kept apart
 * so `test:slow` stays short); `vitest.bench.config.ts` (`npm run test:bench`) runs only BENCH_TESTS. Entries are globs or paths
 * relative to this package root.
 *
 * SLOW tests play real headless matches or drive the bot brain through many ticks, and take minutes
 * rather than seconds. The bot's calibration checks are not tests at all: they report through
 * `npm run bot:report` (`playtest/bot/`). BENCH tests assert on wall-clock timing, which is flaky
 * under load.
 *
 * `scripts/test-scope.mjs` decides when a diff owes each group (`owesSlowTests`, `owesNet`,
 * `owesBench`). The cheap balance
 * harness tests (attribution, baseline, cli, fingerprint, report, stats) stay in the normal suite.
 */
export const SLOW_TESTS: string[] = ["balance/match.test.ts", "balance/runner.test.ts", "src/bot/brain/tiers.test.ts"];
export const NET_TESTS: string[] = ["src/netsim/netsim.sweep.test.ts"];
export const BENCH_TESTS: string[] = ["src/bot/brain/brain.bench.test.ts"];
