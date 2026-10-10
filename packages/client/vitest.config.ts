import { configDefaults, defineConfig } from "vitest/config";
import { BENCH_TESTS, SLOW_TESTS } from "./vitest.groups";

// Slow and bench tests run separately (`npm run test:slow`, see `vitest.groups.ts`).
export default defineConfig({
  test: { environment: "node", exclude: [...configDefaults.exclude, ...SLOW_TESTS, ...BENCH_TESTS] },
});
