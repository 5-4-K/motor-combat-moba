import type { WeaponId } from "@motor-combat-moba/shared";

/**
 * How every weapon looks when it fires and when it lands.
 *
 * **Client-side on purpose (VFX30).** `balanceStamp` hashes the shared tables whole — including
 * purely visual fields, which is why changing `WEAPON_TABLE.color` fails the manual test — so a
 * table like this one living in shared would make every effect tweak owe a `npm run build:manual`
 * and a stamp update. Here it owes nothing: no playtest probe is invalidated, no balance number
 * moves, no doc falls out of date.
 */

/**
 * Which emitter a burst goes to.
 *
 * The channel IS the emitter. There are four emitters and each has its blend mode set once at
 * construction, because `packages/client/CLAUDE.md` warns that a per-instance `setBlendMode`
 * flushes the batch and turns one draw call into one per particle. Making the channel part of the
 * type is what makes per-particle blending unrepresentable rather than merely discouraged.
 */
export type FxChannel = "smoke" | "fire" | "spark" | "debris";

export interface FxBurst {
  readonly channel: FxChannel;
  readonly count: number;
  /** Peak launch speed, world units per second. Each particle takes a random fraction of it. */
  readonly speed: number;
  readonly lifeMs: number;
  readonly size: number;
  readonly growPerSec: number;
  readonly alpha: number;
  /** Smoke only: warm mid-grey soot rather than light dust (VFX7). Ignored on other channels. */
  readonly soot: boolean;
  /** Spread in radians. `Math.PI * 2` is an even sphere; a small cone aims along the event angle. */
  readonly coneRad: number;
}

export interface WeaponFxRow {
  readonly muzzle: readonly FxBurst[];
  readonly impact: readonly FxBurst[];
}

const TAU = Math.PI * 2;

/**
 * What a weapon with no authored row does. Deliberately modest: a new weapon should look
 * plausible on the day it lands and be authored properly later, never look like an explosion by
 * accident.
 */
export const DEFAULT_WEAPON_FX: WeaponFxRow = {
  muzzle: [
    { channel: "fire", count: 6, speed: 60, lifeMs: 160, size: 30, growPerSec: 14, alpha: 0.9, soot: false, coneRad: 0.9 },
    { channel: "spark", count: 10, speed: 280, lifeMs: 260, size: 5, growPerSec: -3, alpha: 1, soot: false, coneRad: 0.8 },
  ],
  impact: [
    { channel: "spark", count: 14, speed: 250, lifeMs: 320, size: 5, growPerSec: -3, alpha: 1, soot: false, coneRad: TAU },
    { channel: "smoke", count: 5, speed: 40, lifeMs: 700, size: 22, growPerSec: 24, alpha: 0.24, soot: false, coneRad: TAU },
  ],
};

export const WEAPON_FX: Partial<Record<WeaponId, WeaponFxRow>> = {
  /** The roster's one explosion — the only row that spends all four channels (VFX6). */
  magmablast: {
    muzzle: [
      { channel: "fire", count: 8, speed: 70, lifeMs: 180, size: 34, growPerSec: 16, alpha: 0.9, soot: false, coneRad: 1 },
      { channel: "smoke", count: 6, speed: 34, lifeMs: 900, size: 26, growPerSec: 26, alpha: 0.3, soot: false, coneRad: 1.2 },
    ],
    impact: [
      { channel: "fire", count: 46, speed: 150, lifeMs: 500, size: 82, growPerSec: 20, alpha: 1, soot: false, coneRad: TAU },
      { channel: "smoke", count: 40, speed: 120, lifeMs: 3000, size: 78, growPerSec: 80, alpha: 0.72, soot: true, coneRad: TAU },
      { channel: "spark", count: 64, speed: 420, lifeMs: 800, size: 8, growPerSec: -3, alpha: 1, soot: false, coneRad: TAU },
      { channel: "debris", count: 30, speed: 150, lifeMs: 900, size: 5, growPerSec: 0, alpha: 1, soot: false, coneRad: TAU },
    ],
  },
  /** A heavy shell: muzzle smoke, and an impact that throws grit rather than fire. */
  thumper: {
    muzzle: [
      { channel: "fire", count: 10, speed: 60, lifeMs: 180, size: 34, growPerSec: 14, alpha: 0.95, soot: false, coneRad: 0.9 },
      { channel: "spark", count: 16, speed: 300, lifeMs: 300, size: 5, growPerSec: -3, alpha: 1, soot: false, coneRad: 0.9 },
      { channel: "smoke", count: 7, speed: 34, lifeMs: 900, size: 26, growPerSec: 26, alpha: 0.3, soot: false, coneRad: 1.1 },
    ],
    impact: [
      { channel: "fire", count: 10, speed: 80, lifeMs: 300, size: 44, growPerSec: 18, alpha: 0.9, soot: false, coneRad: TAU },
      { channel: "spark", count: 22, speed: 280, lifeMs: 400, size: 6, growPerSec: -3, alpha: 1, soot: false, coneRad: TAU },
      { channel: "debris", count: 10, speed: 130, lifeMs: 700, size: 4, growPerSec: 0, alpha: 1, soot: false, coneRad: TAU },
    ],
  },
  /** A beam: a bright muzzle and almost nothing at the far end. */
  lance: {
    muzzle: [
      { channel: "fire", count: 12, speed: 50, lifeMs: 140, size: 30, growPerSec: 10, alpha: 1, soot: false, coneRad: 0.7 },
      { channel: "spark", count: 18, speed: 320, lifeMs: 280, size: 5, growPerSec: -3, alpha: 1, soot: false, coneRad: 0.6 },
    ],
    impact: [
      { channel: "spark", count: 12, speed: 240, lifeMs: 260, size: 5, growPerSec: -3, alpha: 1, soot: false, coneRad: TAU },
    ],
  },
  /** A missile: a smoky launch and a real detonation, one step down from magmablast. */
  predator: {
    muzzle: [
      { channel: "smoke", count: 10, speed: 40, lifeMs: 1100, size: 24, growPerSec: 28, alpha: 0.32, soot: false, coneRad: 1.3 },
      { channel: "fire", count: 8, speed: 66, lifeMs: 190, size: 30, growPerSec: 14, alpha: 0.9, soot: false, coneRad: 0.9 },
    ],
    impact: [
      { channel: "fire", count: 30, speed: 130, lifeMs: 430, size: 66, growPerSec: 18, alpha: 1, soot: false, coneRad: TAU },
      { channel: "smoke", count: 24, speed: 90, lifeMs: 2200, size: 60, growPerSec: 64, alpha: 0.6, soot: true, coneRad: TAU },
      { channel: "spark", count: 40, speed: 360, lifeMs: 620, size: 7, growPerSec: -3, alpha: 1, soot: false, coneRad: TAU },
      { channel: "debris", count: 18, speed: 140, lifeMs: 800, size: 4, growPerSec: 0, alpha: 1, soot: false, coneRad: TAU },
    ],
  },
};

/** The row for a weapon, or the modest default. Never throws on an unknown id. */
export function weaponFxOf(weaponId: string): WeaponFxRow {
  return WEAPON_FX[weaponId as WeaponId] ?? DEFAULT_WEAPON_FX;
}
