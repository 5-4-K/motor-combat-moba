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

export interface ArenaDef {
  id: string;
  width: number;
  height: number;
  obstacles: readonly Obstacle[];
  ffaSpawns: readonly Spawn[];
  teamASpawns: readonly Spawn[];
  teamBSpawns: readonly Spawn[];
  palette?: ArenaPalette;
}
