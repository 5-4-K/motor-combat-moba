import { TICK_RATE_HZ } from "../constants.js";

/**
 * The turret muzzle (spec TR1). A weapon row opts in with `turret` (`WeaponBase.turret`); these are
 * the knobs every turret shares.
 *
 * `defaultOffset` is world units from the turret's PIVOT (`CarDef.turretMount`) to its barrel tip
 * at the shipped drawn size (the client's `TURRET_VISUAL.lengthUnits`). It is a sim number because
 * the server spawns the shot there; resizing the art does not move it — line the two up in
 * `?dev=assets`, which draws the spawn point on the barrel (TR45).
 */
export const TURRET_CONFIG = {
  turnRateDegPerSec: 540,
  defaultOffset: 25,
} as const;

/** `TURRET_CONFIG` resolved to the tick grid once. Radians per tick. */
export const TURRET_TICKS = {
  turnPerTick: (TURRET_CONFIG.turnRateDegPerSec * Math.PI) / 180 / TICK_RATE_HZ,
} as const;
