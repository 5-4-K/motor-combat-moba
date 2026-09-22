// The active-mode scope. `withMode` installs one bundle for a synchronous stretch of work and
// restores whatever was installed before it, even if that work throws. `cfg()` is the raw read;
// every accessor below is a one-line projection of it, and callers should prefer a named accessor
// over `cfg()` at the call site (see interfaces.md's "Naming rules").
//
// This file imports TYPES ONLY from outside `modes/`, and nothing from `registry.ts` or `build.ts`.
// That is what keeps it out of any cycle: `registry.ts` imports the mode folders to assemble
// `MODE_TABLE`, so a value import from here back into that graph could run against a
// partially-initialised module. Type-only imports are erased at compile time and cannot.
import type { CombatConfig } from "../config/combat-config.js";
import type { DeathmatchConfig } from "../config/deathmatch-config.js";
import type { CameraConfig, DriveConfig } from "../config/drive-config.js";
import type { FlowConfig } from "../config/flow-config.js";
import type { ImpulseConfig } from "../config/impulse-config.js";
import type { RamConfig } from "../config/ram-config.js";
import type { SpikeConfig } from "../config/spike-config.js";
import type { StatusConfig, StatusLimits } from "../config/status-config.js";
import type { StatusDef, StatusId } from "../config/status-types.js";
import type { TurretConfig } from "../config/turret-config.js";
import type { CarDef, CarId } from "../config/types.js";
import type { WeaponSlotConfig } from "../config/weapon-slots.js";
import type { WeaponDef, WeaponId } from "../config/weapon-types.js";
import type { ModeConfig, ModeDerived } from "./types.js";

let current: ModeConfig | null = null;

/**
 * Installs `config` for the (synchronous) duration of `fn`, then restores whatever was installed
 * before — including when `fn` throws. This is the only sanctioned way to make a bundle active.
 *
 * `fn` MUST be synchronous. Node cannot preempt synchronous work, so two `withMode` scopes can
 * never interleave — that is the whole safety property. An async callback breaks it: `fn()` would
 * return its Promise immediately, `finally` would restore the previous bundle before the awaited
 * work ever ran, and any config read inside that awaited work would silently read the WRONG mode's
 * bundle (or another room's, or none) with no error and no failing test (MC11). This is checked
 * here rather than only at server call sites so every caller — server rooms, the client, headless
 * harnesses — is covered by the same guard.
 */
export function withMode<T>(config: ModeConfig, fn: () => T): T {
  const prev = current;
  current = config;
  try {
    const result = fn();
    // Duck-typed rather than `result instanceof Promise`: a native Promise is only one shape a
    // deferred value can take. A thenable — any object with a callable `.then` — reproduces the
    // exact same early-restore hazard (a non-native promise implementation, a custom awaitable)
    // and `instanceof` misses every one of those, since `instanceof Promise` is only true for the
    // realm's actual Promise constructor.
    if (typeof (result as { then?: unknown } | null)?.then === "function") {
      throw new Error(
        "withMode: callback must be synchronous, but it returned a thenable. Returning early " +
          "would restore the previous mode's bundle before the awaited work runs, letting two " +
          "modes' config interleave mid-tick with nothing to catch it. Do the async work outside " +
          "withMode and pass only the synchronous part in.",
      );
    }
    return result;
  } finally {
    current = prev;
  }
}

/**
 * Boot-time install, no restore. Nothing in shipped code calls this any more — every real entry
 * point (each room type, the playground, the balance/playtest harnesses) scopes its config with
 * `withMode` instead. It survives as a test convenience: a handful of tests install a bundle once
 * in a `beforeEach`/`afterEach` rather than wrapping every assertion in `withMode`. `cfg()` has no
 * fallback (MC12) — call this, or use `withDefaultMode`/`withMode`, before reading config in a test.
 */
export function installMode(config: ModeConfig): void {
  current = config;
}

/** Diagnostics and tests only. */
export function hasMode(): boolean {
  return current !== null;
}

/** The raw bundle read. Throws outside a `withMode` scope (MC12) — there is deliberately no
 * default-mode fallback: silently serving one mode's numbers to another mode's room is the exact
 * failure this design exists to prevent. */
export function cfg(): ModeConfig {
  if (current === null) {
    throw new Error(
      "config read outside a mode scope — wrap the entry point in withMode(config, ...)",
    );
  }
  return current;
}

export function cars(): Readonly<Record<CarId, CarDef>> {
  return cfg().cars;
}

export function weapons(): Readonly<Record<WeaponId, WeaponDef>> {
  return cfg().weapons;
}

export function drive(): DriveConfig {
  return cfg().drive;
}

export function ram(): RamConfig {
  return cfg().ram;
}

export function impulse(): ImpulseConfig {
  return cfg().impulse;
}

export function combat(): CombatConfig {
  return cfg().combat;
}

export function turret(): TurretConfig {
  return cfg().turret;
}

export function statusConfig(): StatusConfig {
  return cfg().statusConfig;
}

export function statusTable(): Readonly<Record<StatusId, StatusDef>> {
  return cfg().statusTable;
}

export function statusLimits(): StatusLimits {
  return cfg().statusLimits;
}

export function spike(): SpikeConfig {
  return cfg().spike;
}

export function slots(): WeaponSlotConfig {
  return cfg().slots;
}

export function flow(): FlowConfig {
  return cfg().flow;
}

export function deathmatch(): DeathmatchConfig {
  return cfg().deathmatch;
}

export function camera(): CameraConfig {
  return cfg().camera;
}

export function derived(): ModeDerived {
  return cfg().derived;
}
