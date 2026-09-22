// Test-only helper. Wraps `fn` in `withMode` using `DEFAULT_GAME_MODE`'s assembled bundle, for
// suites that need SOME mode installed but are not about any particular mode's numbers. Prefer an
// explicit `withMode(modeConfigOf(SOME_MODE), fn)` when the test IS about a specific mode.
//
// This file is test-only scaffolding, not shipped config: nothing under `src/` outside a `.test.ts`
// file may import it, and it is never part of the package's public `index.ts` surface.
import { DEFAULT_GAME_MODE, modeConfigOf } from "./registry.js";
import { withMode } from "./active.js";

export function withDefaultMode<T>(fn: () => T): T {
  return withMode(modeConfigOf(DEFAULT_GAME_MODE), fn);
}
