/**
 * First-order intercept: when does a shot at `speed` meet a target offset (dx, dy) moving at
 * (tvx, tvy)? Solves |D + V t| = speed * t — the standard quadratic — returning the smallest
 * positive root, or null when no intercept exists (target faster than the shot and diverging).
 *
 * Used by aim assist (spec S1): the lock aims at the intercept instead of the current position,
 * which is what stops the far half of every lock acquiring reliably and missing reliably.
 */
export function interceptTime(
  dx: number,
  dy: number,
  tvx: number,
  tvy: number,
  speed: number,
): number | null {
  const a = tvx * tvx + tvy * tvy - speed * speed;
  const b = 2 * (dx * tvx + dy * tvy);
  const c = dx * dx + dy * dy;
  if (Math.abs(a) < 1e-9) {
    // Target speed equals shot speed: the quadratic degenerates to b t + c = 0.
    if (Math.abs(b) < 1e-9) return null;
    const t = -c / b;
    return t > 0 && Number.isFinite(t) ? t : null;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  let best: number | null = null;
  for (const t of [t1, t2]) {
    if (t > 0 && Number.isFinite(t) && (best === null || t < best)) best = t;
  }
  return best;
}

/** The angle to fire at to intercept, or the direct bearing when no intercept exists. */
export function interceptAngle(
  mx: number,
  my: number,
  tx: number,
  ty: number,
  tvx: number,
  tvy: number,
  speed: number,
): number {
  const dx = tx - mx;
  const dy = ty - my;
  const t = interceptTime(dx, dy, tvx, tvy, speed);
  if (t === null) return Math.atan2(dy, dx);
  return Math.atan2(dy + tvy * t, dx + tvx * t);
}
