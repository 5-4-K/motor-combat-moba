import { TICK_RATE_HZ } from "../constants.js";

/**
 * The turret muzzle (spec TR1). A weapon row opts in with `turret` (`WeaponBase.turret`); these are
 * the knobs every turret shares.
 *
 * `defaultOffset` is world units from the turret's PIVOT (`CarDef.turretMount`) to its barrel tip
 * at the shipped drawn size (the client's `TURRET_VISUAL.lengthUnits`). It is a sim number because
 * the server spawns the shot there; resizing the art does not move it — line the two up in
 * `?dev=assets`, which draws the spawn point on the barrel (TR45).
 *
 * `maxSwingDeg` is the arc the turret may point in, centred on the car's nose (±half either side;
 * spec TR55). An aim outside it is clamped to the nearer edge and fires there. 360 (or more) is
 * unrestricted — the turret turns the short way round, through the back if that is shorter. Read
 * at use time (`clampToSwing`'s default), never copied, so a live retune takes effect on the next
 * call.
 */
export const TURRET_CONFIG = {
  turnRateDegPerSec: 540,
  defaultOffset: 25,
  maxSwingDeg: 360,
} as const;

/** `TURRET_CONFIG` resolved to the tick grid once. Radians per tick. */
export const TURRET_TICKS = {
  turnPerTick: (TURRET_CONFIG.turnRateDegPerSec * Math.PI) / 180 / TICK_RATE_HZ,
} as const;
