import { turretMountOf } from "../../config/car-config.js";

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
