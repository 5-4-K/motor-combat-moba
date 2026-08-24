import { DEFAULT_PATCH_RATE_HZ, hpOf, isCarId, DEFAULT_CAR_ID } from "@motor-combat-moba/shared";

/**
 * How full a car's hp bar is, in `[0, 1]`.
 *
 * The denominator comes from the car's own `CAR_TABLE` hp, not from a shared maximum: a hexagon at
 * half hp and a rectangle at half hp must both read as half a bar, or the bar tells you about the
 * chassis instead of about the fight. An unrecognised `carId` falls back to the default chassis,
 * the same fallback the sim uses, rather than dividing by an undefined maximum and rendering NaN.
 */
export function hpFraction(hp: number, carId: string): number {
  const max = hpOf(isCarId(carId) ? carId : DEFAULT_CAR_ID);
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, hp / max));
}

/** Bar colour by remaining hp: green, amber under a third, red under a sixth. */
export function hpBarColor(fraction: number): number {
  if (fraction <= 1 / 6) return 0xd94040;
  if (fraction <= 1 / 3) return 0xd9a03a;
  return 0x49c46a;
}

/**
 * How far a shot has travelled since the patch that reported it, for drawing only.
 *
 * Shots arrive at the patch rate (20 Hz) but move at 900 u/s, so a raw draw steps them 45 units at
 * a time. Advancing along the shot's own constant velocity is exact rather than a guess — the
 * server integrates the identical straight line — so this smooths the picture without inventing
 * motion. It is still *only* the picture: hits are decided on the server against the server's
 * positions, and nothing here feeds back into state.
 *
 * Capped at one patch interval so a stalled connection cannot fling a stale shot across the arena
 * while the client waits for the delete that already happened.
 */
export function extrapolateShot(
  x: number,
  y: number,
  angle: number,
  speed: number,
  elapsedMs: number,
): { x: number; y: number } {
  const maxMs = 1000 / DEFAULT_PATCH_RATE_HZ;
  const dt = Math.min(Math.max(elapsedMs, 0), maxMs) / 1000;
  return { x: x + Math.cos(angle) * speed * dt, y: y + Math.sin(angle) * speed * dt };
}
