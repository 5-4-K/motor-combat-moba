import { configDefaults, defineConfig } from "vitest/config";
import { BENCH_TESTS, NET_TESTS, SLOW_TESTS } from "./vitest.groups";

// Slow, net and bench tests run separately (`npm run test:slow|net|bench`, see `vitest.groups.ts`).
export default defineConfig({
  test: { environment: "node", exclude: [...configDefaults.exclude, ...SLOW_TESTS, ...NET_TESTS, ...BENCH_TESTS] },
});
