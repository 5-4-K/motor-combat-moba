import { turretMountOf } from "../../config/car-config.js";
import { TURRET_TICKS } from "../../config/turret-config.js";
import { weaponTicksOf } from "../../config/weapon-ticks.js";
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
