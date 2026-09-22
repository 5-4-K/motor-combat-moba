import { TICK_RATE_HZ } from "../constants.js";

/**
 * `TURRET_CONFIG`'s shape. Written out rather than inferred from an `as const` literal, which pinned
 * `maxSwingDeg` to the type `360` — a tuning root (`setTuning`'s `turret`, TR57) holds numbers that
 * move, and a literal type would make every `maxSwingDeg < 360` branch look dead to the compiler.
 * `readonly` because `setTuning` is the only writer, and it writes through its own untyped walk.
 */
export interface TurretConfig {
  readonly turnRateDegPerSec: number;
  readonly defaultOffset: number;
  readonly maxSwingDeg: number;
}

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
 *
 * A playground tuning root (TR57): `setTuning` overrides it in place, and `rebuildTurretTicks`
 * re-derives the one artifact computed from it.
 */
export const TURRET_CONFIG: TurretConfig = {
  turnRateDegPerSec: 540,
  defaultOffset: 25,
  maxSwingDeg: 360,
};

function turnPerTickOf(turnRateDegPerSec: number): number {
  return (turnRateDegPerSec * Math.PI) / 180 / TICK_RATE_HZ;
}

/** `TURRET_CONFIG` resolved to the tick grid. */
export interface TurretTicks {
  turnPerTick: number;
}

/** Radians per tick, from the passed config. */
export function resolveTurretTicks(turret: TurretConfig = TURRET_CONFIG): TurretTicks {
  return { turnPerTick: turnPerTickOf(turret.turnRateDegPerSec) };
}

/**
 * One object for the life of the process, rewritten IN PLACE by `rebuildTurretTicks`, so every
 * reader that reads the field at use time — `turnTurret`'s default step, the bot's turn budget —
 * sees a playground retune (TR57).
 */
export const TURRET_TICKS: TurretTicks = resolveTurretTicks();
