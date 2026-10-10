import { configDefaults, defineConfig } from "vitest/config";
import { BENCH_TESTS, SLOW_TESTS } from "./vitest.groups";

// Runs ONLY the slow tests the normal config excludes — `npm run test:slow`.
export default defineConfig({
  test: { environment: "node", include: SLOW_TESTS, exclude: [...configDefaults.exclude, ...BENCH_TESTS] },
});
