/**
 * World velocity to and from the car's own frame.
 *
 * This is the ONLY place the conversion is written. Before this rework, `cos(angle) * speed` was
 * open-coded in the drive integration, the collision resolver, the ram maths, and twice inside the
 * bot's brain — five copies of the same assumption, one of which (the bot's) was silently wrong for
 * any car carrying sideways motion. Route every frame conversion through these four functions.
 *
 * Sign conventions, which nothing downstream may re-derive:
 *   forward > 0  driving nose-first;  forward < 0  reversing
 *   lateral > 0  sliding to the car's LEFT
 */

/** Signed speed along the car's nose. Negative means reversing. */
export function forwardOf(vx: number, vy: number, angle: number): number {
  return vx * Math.cos(angle) + vy * Math.sin(angle);
}

/** Signed speed across the car's nose. Positive is to the car's left. */
export function lateralOf(vx: number, vy: number, angle: number): number {
  return -vx * Math.sin(angle) + vy * Math.cos(angle);
}

/** Total speed regardless of direction. Always >= 0. */
export function speedOf(vx: number, vy: number): number {
  return Math.hypot(vx, vy);
}

/** Rebuild a world velocity from its two components in the car's frame. */
export function toWorld(angle: number, forward: number, lateral: number): { vx: number; vy: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    vx: forward * cos - lateral * sin,
    vy: forward * sin + lateral * cos,
  };
}
