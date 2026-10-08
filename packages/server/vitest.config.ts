import { configDefaults, defineConfig } from "vitest/config";
import { SLOW_TESTS } from "./vitest.slow-tests";

// The slow tests run separately, under `npm run test:slow` (see `vitest.slow-tests.ts`).
export default defineConfig({ test: { environment: "node", exclude: [...configDefaults.exclude, ...SLOW_TESTS] } });
