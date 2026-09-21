import { turretMountOf } from "../../config/car-config.js";
import { TURRET_TICKS } from "../../config/turret-config.js";
import { BASIC_ATTACK_CONFIG, isWeaponId, weaponDefOf } from "../../config/weapon-config.js";
import { weaponTicksOf } from "../../config/weapon-ticks.js";
import { WEAPON_SLOT_CONFIG } from "../../config/weapon-slots.js";
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
 * One tick of the turret (spec TR13). Pure. With a pending turret press, turn toward the frozen world
 * bearing along the shortest arc, at most `step` per tick, snapping when within one step. The first
 * tick on target marks the press aligned and starts its wind-up. With nothing to aim at the turret
 * holds its car-relative angle (D2), which is why a fixed-muzzle press leaves it alone.
 */
export function turnTurret(
  state: FireState,
  carAngle: number,
  tick: number,
  step: number = TURRET_TICKS.turnPerTick,
): FireState {
  const pending = state.pending;
  if (!pending || pending.bearing === null || pending.bearing === undefined) return state;
  const target = wrapAngle(pending.bearing - carAngle);
  const delta = wrapAngle(target - state.turretAngle);
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
 * only while `basicAttackEnabled` (default `BASIC_ATTACK_CONFIG.enabled`, the shipped flag), and
 * nothing at or past `WEAPON_SLOT_CONFIG.maxFireSlots` counts — a longer array (an un-truncated kit,
 * say) simply has its tail ignored, the same way an unfireable slot never reaches a player. An
 * unrecognised id (empty string, a stale row) is skipped rather than thrown on: a malformed slot
 * must never crash a render.
 */
export function carHasTurretWeapon(
  fireSlotWeaponIds: readonly string[],
  basicAttackEnabled: boolean = BASIC_ATTACK_CONFIG.enabled,
): boolean {
  const fireSlots = Math.min(fireSlotWeaponIds.length, WEAPON_SLOT_CONFIG.maxFireSlots);
  for (let index = 0; index < fireSlots; index++) {
    if (index === WEAPON_SLOT_CONFIG.basicAttackSlotIndex && !basicAttackEnabled) continue;
    const id = fireSlotWeaponIds[index];
    if (isWeaponId(id) && weaponDefOf(id).turret) return true;
  }
  return false;
}
