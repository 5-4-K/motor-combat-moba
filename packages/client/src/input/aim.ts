/** World bearing from the turret pivot to the crosshair's world point (spec TR33). */
export function aimBearingOf(
  pivot: { x: number; y: number },
  world: { x: number; y: number },
  fallback: number,
): number {
  const dx = world.x - pivot.x;
  const dy = world.y - pivot.y;
  return dx === 0 && dy === 0 ? fallback : Math.atan2(dy, dx);
}
