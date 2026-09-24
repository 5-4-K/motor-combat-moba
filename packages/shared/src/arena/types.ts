/**
 * Axis-aligned solid. `x, y` is the **top-left** corner, matching `Aabb` in `sim/collide.ts`,
 * so arena obstacles pass into `resolveWorld` with no conversion.
 *
 * **Authoring constraint:** keep every obstacle at least one car diagonal
 * (`hypot(DRIVE_CONFIG.carWidth, carHeight)`) clear of the arena boundary, and leave at least
 * that much room in any corridor between two obstacles. `resolveWorld` ranks world bounds above
 * obstacles, so an obstacle touching a wall leaves a car nowhere to be pushed: it ends up
 * permanently embedded in the obstacle rather than merely grazing it. `arena.test.ts` enforces
 * both clearances.
 */
export interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * What this solid IS, for the rules that care. Absent means an ordinary block. `"spike"` marks
   * wall-mounted geometry that also damages (AS10) — it is the only kind today, and it is the only
   * obstacle allowed to sit flush against the boundary (AS13).
   */
  kind?: "spike";
}

export interface Spawn {
  x: number;
  y: number;
  angle: number;
}

/**
 * How an arena is painted. Hex strings in the manner of `COLOR_TABLE`, converted to Phaser's colour
 * integers on the client.
 *
 * Render-only: `stepSim` never reads it, so it is not a schema field and invariant 8 does not apply.
 * Optional — an arena without one uses the client's default palette, which is what `ARENA_01` does.
 */
export interface ArenaPalette {
  readonly floor: string;
  readonly obstacle: string;
  readonly border: string;
}

/** A capture circle (Conquer, CQ20). A car is "in" it when its CENTRE is within `radius`. */
export interface ArenaZone {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface ArenaDef {
  id: string;
  width: number;
  height: number;
  obstacles: readonly Obstacle[];
  ffaSpawns: readonly Spawn[];
  teamASpawns: readonly Spawn[];
  teamBSpawns: readonly Spawn[];
  /**
   * The playable region, as a CONVEX polygon wound clockwise in screen coordinates (`+y` down).
   * Absent means the plain rectangle `0,0 -> width,height`, which is what every arena had before
   * `arena-01` grew cut corners (AS6).
   *
   * This is NOT the same thing as `width`/`height`, which stay the image frame and the camera
   * bounds. The polygon is inset inside them.
   */
  boundary?: readonly { x: number; y: number }[];
  palette?: ArenaPalette;
  /** The capture zone. Required by any mode whose win rule is "conquer" (modes/invariants.test.ts). */
  readonly zone?: ArenaZone;
  /**
   * In a team mode, team 1's WORLD camera is rotated 180° so each team sees its own base at the
   * bottom (CQ46). Only meaningful on a layout that maps onto itself under that rotation.
   */
  readonly flipForTeamB?: boolean;
}
