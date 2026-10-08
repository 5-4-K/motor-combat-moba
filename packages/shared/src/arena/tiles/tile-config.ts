/**
 * The tile vocabulary arenas are authored in (spec 2026-10-09 tile arenas, TA1–TA13).
 *
 * GLOBAL, not per mode: a tile type is a piece of level geometry, like an arena, and the art for one
 * is shared by every arena that uses it. Reading `TILE_SIZE`/`TILE_TABLE` at module scope is fine —
 * they are constants, not mode accessors.
 *
 * Each behaviour is its own optional field, so they combine freely. Only floor, solid and damaging
 * solid exist today; `surface` (grip, drag, accel — TA1's movement behaviour) is declared so the
 * shape is ready, and is refused by `tile-config.test.ts` until the sim reads it.
 */

/** World units per tile side (TA3). 1280 x 720 is a 32 x 18 grid. */
export const TILE_SIZE = 40;

export type TileCollision = "none" | "solid";
/** TA2: diagonal half-tiles arrive here later. */
export type TileShape = "full";
/** Damage numbers stay in the active mode's `spike()` table; the tile only says WHICH hazard. */
export type TileHazard = "spike";

/** Reserved for movement behaviour (TA1 "C"). Multipliers, 1 = neutral, like `Modifiers`. */
export interface TileSurface {
  readonly grip?: number;
  readonly drag?: number;
  readonly accel?: number;
}

export interface TileDef {
  /** The one character this tile is typed as in an arena grid (TA5). */
  readonly char: string;
  /** Tile art id (`arena.common.tile.<art>`), or null for a tile drawn as backdrop. */
  readonly art: string | null;
  readonly collision: TileCollision;
  readonly shape: TileShape;
  readonly hazard?: TileHazard;
  readonly surface?: TileSurface;
}

export const TILE_TABLE = {
  floor: { char: ".", art: "floor", collision: "none", shape: "full" },
  wall: { char: "#", art: "wall", collision: "solid", shape: "full" },
  spike: { char: "^", art: "spike", collision: "solid", shape: "full", hazard: "spike" },
  void: { char: " ", art: null, collision: "solid", shape: "full" },
} as const satisfies Record<string, TileDef>;

export type TileId = keyof typeof TILE_TABLE;

/** The row for a tile id, widened to `TileDef` so optional fields read as optional. */
export function tileDefOf(id: TileId): TileDef {
  return TILE_TABLE[id];
}

/** Whether a car, a shot or a sightline is stopped by this tile. */
export function isSolidTile(id: TileId): boolean {
  return tileDefOf(id).collision === "solid";
}
