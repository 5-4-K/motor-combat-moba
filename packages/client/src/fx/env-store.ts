import type { EnvironmentFx } from "./environment.js";
import { resolveEnvironment, type EnvOverrides, type EnvResolver } from "./env-tuning.js";

/**
 * The live environment override map (spec EV18, EV19).
 *
 * A module-level singleton for exactly the reason `fx/override-store.ts` is one: the thing that SETS
 * it is a DOM overlay with no handle on the Phaser scene, and the thing that READS it is several
 * layers down.
 *
 * Being global is not what decides its reach. Only a playground room builds a resolver over it
 * (`ArenaScene`), so a shipped arena or practice session never reads a byte of this even when a
 * developer has a tuning session saved in the same browser (EV34).
 */
let current: EnvOverrides = {};

/**
 * Bumped whenever the map changes. This is the one place the environment resolver must NOT copy the
 * weapon one (EV19): `resolveWeaponFx` runs once per event, a handful of times a frame, while
 * `resolveEnvironment` would run per particle per frame through `decalFadeAlpha` and its
 * neighbours. Rebuilding a sixty-field object that often is a per-frame allocation storm, so the
 * resolver caches on this counter and re-resolves once per EDIT instead.
 */
let version = 0;
let cachedVersion = -1;
let cached: EnvironmentFx | undefined;

export function envOverrides(): EnvOverrides {
  return current;
}

/** Replace the map. `null` clears it — what `PlaygroundScene.onShutdown` calls. */
export function setEnvOverrides(next: EnvOverrides | null): void {
  current = next ?? {};
  version++;
}

/**
 * Announce that the map was mutated in place.
 *
 * The panel mutates `current` directly, exactly as the physics and VFX panels mutate their own maps,
 * so there is no assignment for `setEnvOverrides` to catch. Every panel edit calls this.
 */
export function bumpEnvVersion(): void {
  version++;
}

export function liveEnvResolver(): EnvResolver {
  return () => {
    if (cachedVersion !== version || cached === undefined) {
      cached = resolveEnvironment(current);
      cachedVersion = version;
    }
    return cached;
  };
}
