// Test-only helper. Wraps `fn` in `withMode` using `DEFAULT_GAME_MODE`'s assembled bundle, for
// suites that need SOME mode installed but are not about any particular mode's numbers. Prefer an
// explicit `withMode(modeConfigOf(SOME_MODE), fn)` when the test IS about a specific mode.
//
// This file is test-only scaffolding, not shipped config: nothing under `src/` outside a `.test.ts`
// file may import it, and it is never part of the package's public `index.ts` surface.
import { DEFAULT_GAME_MODE, modeConfigOf } from "./registry.js";
import { withMode } from "./active.js";
import { applyOverrides } from "./overlay.js";

export function withDefaultMode<T>(fn: () => T): T {
  return withMode(modeConfigOf(DEFAULT_GAME_MODE), fn);
}

/**
 * GM9 (Task 4): `BASIC_ATTACK_CONFIG.enabled` is gone — the flag is per mode now
 * (`slots.basicAttackEnabled`). Runs `fn` under the DEFAULT mode's bundle with that flag set to
 * `enabled`, for suites that used to flip the global and restore it in an `afterEach`. Builds a
 * tuned sibling via `applyOverrides` rather than mutating anything, so there is nothing to restore.
 */
export function withBasicAttack<T>(enabled: boolean, fn: () => T): T {
  const base = modeConfigOf(DEFAULT_GAME_MODE);
  return withMode(applyOverrides(base, { "slots.basicAttackEnabled": enabled }), fn);
}
