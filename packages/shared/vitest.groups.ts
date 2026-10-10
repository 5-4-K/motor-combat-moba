/**
 * Test groups for shared. `vitest.config.ts` (`npm test`) excludes both lists; `vitest.slow.config.ts`
 * (`npm run test:slow`) runs SLOW_TESTS. Entries are globs or paths relative to this package root.
 * Both lists are empty until tests are moved into them.
 */
export const SLOW_TESTS: string[] = ["src/net/input-scheduler.envelope.test.ts"];
export const BENCH_TESTS: string[] = [];
