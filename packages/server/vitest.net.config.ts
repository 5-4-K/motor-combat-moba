import { configDefaults, defineConfig } from "vitest/config";
import { NET_TESTS } from "./vitest.groups";

// Runs ONLY the long netcode sweeps the normal config excludes — `npm run test:net`.
export default defineConfig({
  test: { environment: "node", include: NET_TESTS, exclude: [...configDefaults.exclude] },
});
