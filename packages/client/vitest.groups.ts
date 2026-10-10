/**
 * Test groups for the client. `vitest.config.ts` (`npm test`) excludes BENCH_TESTS;
 * `vitest.bench.config.ts` (`npm run test:bench`) runs only them. Timing tests live in BENCH_TESTS
 * because wall-clock assertions are flaky under load. Entries are globs or paths relative to this package root.
 */
export const SLOW_TESTS: string[] = [];
export const BENCH_TESTS: string[] = ["src/fx/perf.test.ts"];
