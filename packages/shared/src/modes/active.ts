// The active-mode scope. `withMode` installs one bundle for a synchronous stretch of work and
// restores whatever was installed before it, even if that work throws. `cfg()` is the raw read;
// every accessor below is a one-line projection of it, and callers should prefer a named accessor
// over `cfg()` at the call site (see interfaces.md's "Naming rules").
//
// This file imports TYPES ONLY from outside `modes/` — never `legacy.ts` — so it cannot take part
// in the `active -> legacy -> car-config -> active` cycle. See the controller ruling in this
// task's brief for why that matters.
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

/** Installs `config` for the (synchronous) duration of `fn`, then restores whatever was installed
 * before — including when `fn` throws. This is the only sanctioned way to make a bundle active. */
export function withMode<T>(config: ModeConfig, fn: () => T): T {
  const prev = current;
  current = config;
  try {
    return fn();
  } finally {
    current = prev;
  }
}

/**
 * Boot-time install, no restore. SCAFFOLDING (phases 1-2): phase 1 calls this once at module load
 * so the whole existing suite keeps passing while accessors move onto the bundle. Phase 3 deletes
 * that call, at which point `cfg()` genuinely throws outside a `withMode` scope (MC12) and every
 * test installs a mode in its own setup.
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
