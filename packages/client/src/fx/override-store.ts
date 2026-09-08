import { resolveWeaponFx, type FxOverrides, type WeaponFxResolver } from "./tuning.js";

/**
 * The live VFX override map (spec PG46, PG54).
 *
 * A module-level singleton for exactly the reason `config/view-options.ts` is one: the thing that
 * SETS it is a DOM overlay with no handle on the Phaser scene, and the thing that READS it is a
 * particle spawn several layers down.
 *
 * Being global is not what decides its reach. Only a playground room ever builds a resolver over it
 * (`ArenaScene`), so a shipped arena or practice session never reads a byte of this even when a
 * developer has a tuning session saved in the same browser. `PlaygroundScene` loads it on start and
 * clears it on shutdown, the same lifecycle `setTuning` and `setShowHitboxes` already follow.
 */
let current: FxOverrides = {};

export function fxOverrides(): FxOverrides {
  return current;
}

/** Replace the map. `null` clears it — what `PlaygroundScene.onShutdown` calls. */
export function setFxOverrides(next: FxOverrides | null): void {
  current = next ?? {};
}

/**
 * A resolver that reads the store at CALL time.
 *
 * Not `fxResolverFor(fxOverrides())`: the panel edits the map while the `FxLayer` that will render
 * the next burst already exists, so a resolver that captured the map at construction would render
 * the state the panel opened with until the next arena restart.
 */
export function liveFxResolver(): WeaponFxResolver {
  return (weaponId) => resolveWeaponFx(weaponId, current);
}
