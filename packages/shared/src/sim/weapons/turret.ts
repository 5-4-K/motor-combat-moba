import { turretMountOf } from "../../config/car-config.js";
import { isWeaponId, weaponDefOf } from "../../config/weapon-config.js";
import { weaponTicksOf } from "../../config/weapon-ticks.js";
import { derived, slots, turret } from "../../modes/active.js";
import type { FireState } from "./fire.js";

const TAU = Math.PI * 2;

/** Normalise an angle into (-pi, pi]. */
export function wrapAngle(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}

/**
 * The turret mount's world point for a pose (spec TR6). The ONLY place the car-local -> world
 * rotation of the mount is written: the sim's spawn, the client's turret drawing and the crosshair
 * bearing all call this. `mount` is a test seam; production callers leave it to default.
 */
export function turretPivotOf(
  pose: { x: number; y: number; angle: number },
  carId: string,
  mount: { x: number; y: number } = turretMountOf(carId),
): { x: number; y: number } {
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  return { x: pose.x + mount.x * c - mount.y * s, y: pose.y + mount.x * s + mount.y * c };
}

/**
 * Clamp a turret angle RELATIVE to the car's heading into the swing arc (spec TR55):
 * [-maxSwingDeg/2, +maxSwingDeg/2] radians. The identity at 360 or more — an unrestricted turret —
 * so the shipped value changes nothing. `relAngle` is expected already wrapped into (-pi, pi].
 * `maxSwingDeg` defaults to `turret().maxSwingDeg`, read on every call so a live retune lands.
 */
export function clampToSwing(relAngle: number, maxSwingDeg: number = turret().maxSwingDeg): number {
  if (maxSwingDeg >= 360) return relAngle;
  const half = (Math.max(0, maxSwingDeg) * Math.PI) / 360;
  return Math.min(half, Math.max(-half, relAngle));
}

/**
 * A WORLD bearing clamped into the swing arc of a car heading `carAngle` (spec TR55): the press
 * bearing in `beginFire`, the spawn bearing in `spawnInstances`, the bot's solved lead. Returns
 * `bearing` itself, untouched, at 360 or more, so an unrestricted turret is byte-for-byte what it
 * was before the arc existed.
 */
export function clampBearingToSwing(
  bearing: number,
  carAngle: number,
  maxSwingDeg: number = turret().maxSwingDeg,
): number {
  if (maxSwingDeg >= 360) return bearing;
  return carAngle + clampToSwing(wrapAngle(bearing - carAngle), maxSwingDeg);
}

/**
 * The signed turn from `fromRel` to `toRel`, both car-relative (spec TR13, TR55). Unrestricted, it
 * is the shortest arc, through the back if that is shorter. Below 360 it is the plain difference in
 * UNWRAPPED relative space: with both ends inside the arc, the straight line between them never
 * leaves it, so the turret never sweeps through the dead zone behind the car. The bot budgets its
 * turn time with the same function, so the two cannot disagree about which way round is taken.
 */
export function turretTurnDelta(
  fromRel: number,
  toRel: number,
  maxSwingDeg: number = turret().maxSwingDeg,
): number {
  return maxSwingDeg >= 360 ? wrapAngle(toRel - fromRel) : toRel - fromRel;
}

/**
 * One tick of the turret (spec TR13, TR55). Pure. With a pending turret press, turn toward the frozen
 * world bearing — clamped into the swing arc, recomputed every tick because the car may have turned
 * the bearing out of it since the press — at most `step` per tick, snapping when within one step.
 * The first tick on target marks the press aligned and starts its wind-up. With nothing to aim at the
 * turret holds its car-relative angle (D2), which is why a fixed-muzzle press leaves it alone.
 */
export function turnTurret(
  state: FireState,
  carAngle: number,
  tick: number,
  step: number = derived().turretTicks.turnPerTick,
  maxSwingDeg: number = turret().maxSwingDeg,
): FireState {
  const pending = state.pending;
  if (!pending || pending.bearing === null || pending.bearing === undefined) return state;
  const target = clampToSwing(wrapAngle(pending.bearing - carAngle), maxSwingDeg);
  const delta = turretTurnDelta(state.turretAngle, target, maxSwingDeg);
  const arrived = Math.abs(delta) <= step;
  const turretAngle = arrived ? target : wrapAngle(state.turretAngle + Math.sign(delta) * step);
  if (pending.aligned !== false || !arrived) return { ...state, turretAngle };
  return {
    ...state,
    turretAngle,
    pending: { ...pending, aligned: true, nextShotTick: tick + weaponTicksOf(pending.weaponId).startUp },
  };
}

/**
 * Whether this car draws a turret at all (spec TR53): true when at least one weapon it can actually
 * FIRE carries `WeaponDef.turret`. `fireSlotWeaponIds` is index-aligned with a fire slot exactly the
 * way `fireSlotsOf`/`PlayerState.weapons` are — 0 is the basic attack, 1..N the ability kit — so the
 * client's synced `WeaponSlotState` rows are a direct fit, and a playground loadout swap is covered
 * for free without this function knowing anything about the playground.
 *
 * Two things a caller does NOT have to pre-trim, because this does it: the basic-attack slot counts
 * only while `basicAttackEnabled` (default `slots().basicAttackEnabled`, the shipped flag), and
 * nothing at or past `slots().maxFireSlots` counts — a longer array (an un-truncated kit,
 * say) simply has its tail ignored, the same way an unfireable slot never reaches a player. An
 * unrecognised id (empty string, a stale row) is skipped rather than thrown on: a malformed slot
 * must never crash a render.
 */
export function carHasTurretWeapon(
  fireSlotWeaponIds: readonly string[],
  basicAttackEnabled: boolean = slots().basicAttackEnabled,
): boolean {
  const s = slots();
  const fireSlots = Math.min(fireSlotWeaponIds.length, s.maxFireSlots);
  for (let index = 0; index < fireSlots; index++) {
    if (index === s.basicAttackSlotIndex && !basicAttackEnabled) continue;
    const id = fireSlotWeaponIds[index];
    if (isWeaponId(id) && weaponDefOf(id).turret) return true;
  }
  return false;
}
