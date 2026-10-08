import { defineConfig } from "vitest/config";
import { SLOW_TESTS } from "./vitest.slow-tests";

// Runs ONLY the slow tests the normal config excludes — `npm run test:slow`.
export default defineConfig({ test: { environment: "node", include: SLOW_TESTS } });
