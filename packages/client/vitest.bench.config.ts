import { defineConfig } from "vitest/config";
import { BENCH_TESTS } from "./vitest.groups";

// Runs ONLY the timing-sensitive bench tests the normal config excludes — `npm run test:bench`.
export default defineConfig({ test: { environment: "node", include: BENCH_TESTS } });
