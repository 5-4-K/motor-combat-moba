/**
 * Test groups for shared. `vitest.config.ts` (`npm test`) excludes every list; `vitest.slow.config.ts`
 * (`npm run test:slow`) runs SLOW_TESTS; `vitest.net.config.ts` (`npm run test:net`) runs NET_TESTS —
 * the long netcode sweeps, kept apart so `test:slow` stays short. Entries are globs or paths relative
 * to this package root.
 */
export const SLOW_TESTS: string[] = [];
export const BENCH_TESTS: string[] = [];
export const NET_TESTS: string[] = ["src/net/input-scheduler.envelope.test.ts"];
