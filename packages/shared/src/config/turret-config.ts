import { TICK_RATE_HZ } from "../constants.js";

/**
 * `TURRET_CONFIG`'s shape. Written out rather than inferred from an `as const` literal, which pinned
 * `maxSwingDeg` to the type `360` — the `turret` tuning root (TR57) holds numbers that move, and a
 * literal type would make every `maxSwingDeg < 360` branch look dead to the compiler. `readonly`
 * because nothing may write `TURRET_CONFIG` at all: `setTuning` (`config/tuning.ts`) moves the
 * `turret` root by installing a freshly-assembled mode bundle rather than by writing this global in
 * place — a live override reaches `turret()` (`modes/active.js`), never `TURRET_CONFIG` itself.
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
 * A playground tuning root (TR57): `setTuning` moves it via `turret()`'s bundle, not by writing this
 * global. `TURRET_CONFIG` itself is never written and always reads the shipped defaults below.
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
 * Resolved once at module load and frozen, mirroring `WEAPON_TICKS`/`DEFAULT_RAM_TICKS` — kept as a
 * standalone value from `TURRET_CONFIG`'s shipped defaults; it never moves, and is no longer
 * rewritten in place (there is no `rebuildTurretTicks` any more). A live retune of the `turret` root
 * reaches `derived().turretTicks` (`modes/active.js`, resolved fresh into each assembled mode
 * bundle), not this export. `turnTurret`'s default step and the bot's turn budget both read that
 * accessor now, not `TURRET_TICKS` directly, so they do see a playground retune (TR57) — this global
 * itself simply does not.
 */
export const TURRET_TICKS: TurretTicks = resolveTurretTicks();
