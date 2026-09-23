import { cfg, type ModeConfig } from "@motor-combat-moba/shared";

/**
 * Caches `compute()`'s result against the `ModeConfig` OBJECT it was derived from, not a boolean or
 * a tick count — mode bundles are frozen and identity-stable per mode, and `setTuning` installs a
 * NEW bundle object rather than mutating one, so a reference check is both a correct and a free
 * invalidation key. Rebuilds only when `cfg()` no longer `===` the bundle the cached value came
 * from: a mode switch, a `setTuning` retune, or a test installing its own bundle all invalidate it
 * for free, with one reference comparison on every other call.
 *
 * The cache is built the first time the returned function is CALLED, never at import time, and it
 * is re-derived the moment the installed bundle changes under it. That laziness is the whole point:
 * a module-scope `const x = weaponDefOf(...)` runs at import time, before any room has installed a
 * bundle, and throws (the C1 bug this primitive exists to prevent everywhere, not just once).
 *
 * Moved here from `scenes/combat-visual.ts` (2026-09-22 final review) because it is a general
 * client primitive, not a render-file detail — `scenes/maneuver-visual.ts`'s
 * `CHARGE_OUTLINE_COLOR` needed the exact same shape and had no correct place to import it from.
 */
export function memoOnBundle<T>(compute: () => T): () => T {
  let cached: { bundle: ModeConfig; value: T } | undefined;
  return () => {
    const bundle = cfg();
    if (cached === undefined || cached.bundle !== bundle) {
      cached = { bundle, value: compute() };
    }
    return cached.value;
  };
}
