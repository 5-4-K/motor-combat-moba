import type { WorldFace } from "./faces.js";
import type { TileRotation } from "./tiles/tile-config.js";

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
  /**
   * Which world faces of a `kind: "spike"` obstacle damage (tile cells TC22). Absent means EVERY
   * face — the meaning every hand-written spike already has, and what a tile spike whose faces are
   * all four compiles to. Read only on a spike; meaningless on a plain block.
   */
  damageFaces?: readonly WorldFace[];
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

/** One drawn piece of tile art: an art id (`arena.common.tile.<art>`) and its clockwise turn. */
export interface TileStamp {
  readonly art: string;
  readonly rotation: TileRotation;
}

/**
 * One cell of a compiled tile grid, fully resolved (tile cells TC9, TC17): behaviour copied off its
 * definition so no reader needs `TILE_DEFS`, and its art and overlays already chosen and rotated.
 */
export interface TileCell {
  /** The definition id. */
  readonly tile: string;
  /** `def.collision === "solid"`. */
  readonly solid: boolean;
  /** `def.hazard?.kind ?? null`. */
  readonly hazard: "spike" | null;
  /** Damaging world faces, n-e-s-w order; `[]` with no hazard. */
  readonly faces: readonly WorldFace[];
  /** `def.draw !== "none"`. */
  readonly drawn: boolean;
  /** `null` when not drawn, or drawn with no art (the bake then draws the behaviour fallback). */
  readonly base: TileStamp | null;
  /** Resolved, edge-rotated, in draw order. */
  readonly overlays: readonly TileStamp[];
}

/**
 * The grid a tile arena was compiled from (spec tile arenas §3.2, tile cells §3.3). Row-major:
 * `cells[r * cols + c]`. Static shared data like the rest of `ArenaDef` — never a schema field
 * (invariant 8 untouched).
 */
export interface TileGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly TileCell[];
}

export interface ArenaDef {
  id: string;
  /**
   * What players read on the arena select screen (AR1). Unique across `ARENAS`, ignoring case and
   * surrounding space — `display-names.test.ts` holds it. Never used as a key: `id` is the key.
   */
  displayName: string;
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
   * Present when this arena was compiled from a tile grid (`compileTileArena`). The client bakes its
   * floor from it; the sim never reads it — `obstacles` already carries the compiled solids.
   */
  readonly tiles?: TileGrid;
}
