import type Phaser from "phaser";

/** Anything with world coordinates — what `fillPoints`/`strokePoints` actually read. */
export interface PointLike {
  x: number;
  y: number;
}

/**
 * Widens a plain `{x, y}` array to what `Graphics.fillPoints`/`strokePoints` declare they take.
 *
 * Phaser 4 narrowed both signatures from `Vector2Like[]` to `Vector2[]`, but neither method's
 * implementation touches a `Vector2` method — each walks the array reading `.x` and `.y` and
 * nothing else. Honouring the declared type would mean constructing a `Vector2` per point per
 * frame for hulls, HP bars, arrows and weapon shapes — exactly the allocation this renderer's
 * shared scratch buffers exist to avoid.
 *
 * So the cast is the fix, and it lives here alone rather than at each call site: one place to
 * delete if a future Phaser release widens the signature back, and one place that says why it is
 * safe.
 */
export function pts(points: readonly PointLike[]): Phaser.Math.Vector2[] {
  return points as unknown as Phaser.Math.Vector2[];
}
