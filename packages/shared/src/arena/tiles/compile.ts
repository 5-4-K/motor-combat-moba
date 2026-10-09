import type { ArenaDef, ArenaPalette, ArenaZone, Obstacle, Spawn, TileGrid } from "../types.js";
import { TILE_SIZE, TILE_TABLE, tileDefOf, type TileId } from "./tile-config.js";

/**
 * A tile arena as authored (spec TA5): one string per row, one character per tile, plus the things
 * that are points and circles rather than surfaces — spawns and the capture zone.
 */
export interface TileArenaSource {
  readonly id: string;
  readonly displayName: string;
  readonly rows: readonly string[];
  readonly ffaSpawns: readonly Spawn[];
  readonly teamASpawns: readonly Spawn[];
  readonly teamBSpawns: readonly Spawn[];
  readonly palette?: ArenaPalette;
  readonly zone?: ArenaZone;
}

const TILE_BY_CHAR: ReadonlyMap<string, TileId> = new Map(
  (Object.keys(TILE_TABLE) as TileId[]).map((id) => [tileDefOf(id).char, id]),
);

/** Parse the authored rows into a grid, throwing with arena, row and column on bad input (TA17). */
export function parseTileGrid(id: string, rows: readonly string[]): TileGrid {
  const cols = rows[0]?.length ?? 0;
  if (rows.length === 0 || cols === 0) throw new Error(`Tile arena ${id}: the grid is empty`);
  const cells: TileId[] = [];
  rows.forEach((row, r) => {
    if (row.length !== cols) {
      throw new Error(`Tile arena ${id}: row ${r} is ${row.length} tiles wide, expected ${cols}`);
    }
    for (let c = 0; c < cols; c += 1) {
      const ch = row[c]!;
      const tile = TILE_BY_CHAR.get(ch);
      if (tile === undefined) {
        throw new Error(`Tile arena ${id}: row ${r}, col ${c} has unknown tile ${JSON.stringify(ch)}`);
      }
      cells.push(tile);
    }
  });
  return { cols, rows: rows.length, cells };
}

/**
 * What a solid cell merges with (TA15): `(collision, hazard)`. Wall and void are both plain solid and
 * merge together; a hazard is its own class so it can carry its `kind`. `null` is not solid.
 */
function classOf(id: TileId): string | null {
  const def = tileDefOf(id);
  if (def.collision !== "solid") return null;
  return def.hazard ?? "solid";
}

/**
 * Greedy rectangle merge (TA15): scan row-major; at the first unclaimed solid cell take the widest
 * run of its class to the right, then grow it downward while the next row's same span is that class
 * and unclaimed. Exact cover of the solid cells (TA16), and deterministic.
 */
function mergeSolids(grid: TileGrid): Obstacle[] {
  const { cols, rows, cells } = grid;
  const claimed = new Uint8Array(cols * rows);
  const free = (i: number, cls: string): boolean => claimed[i] === 0 && classOf(cells[i]!) === cls;
  const out: Obstacle[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const start = r * cols + c;
      const cls = classOf(cells[start]!);
      if (cls === null || claimed[start] !== 0) continue;
      let w = 1;
      while (c + w < cols && free(start + w, cls)) w += 1;
      let h = 1;
      grow: while (r + h < rows) {
        for (let k = 0; k < w; k += 1) if (!free((r + h) * cols + c + k, cls)) break grow;
        h += 1;
      }
      for (let dr = 0; dr < h; dr += 1) {
        for (let k = 0; k < w; k += 1) claimed[(r + dr) * cols + c + k] = 1;
      }
      const rect = { x: c * TILE_SIZE, y: r * TILE_SIZE, w: w * TILE_SIZE, h: h * TILE_SIZE };
      out.push(cls === "spike" ? { ...rect, kind: "spike" as const } : rect);
    }
  }
  return out;
}

/**
 * A tile grid as an ordinary `ArenaDef` (TA14–TA17). The sim, vision and shots read the compiled
 * `obstacles` exactly as they read a hand-written arena's; `tiles` is for the client's bake. Reads no
 * mode accessor, so it may run at module load.
 */
export function compileTileArena(src: TileArenaSource): ArenaDef {
  const tiles = parseTileGrid(src.id, src.rows);
  return {
    id: src.id,
    displayName: src.displayName,
    width: tiles.cols * TILE_SIZE,
    height: tiles.rows * TILE_SIZE,
    obstacles: mergeSolids(tiles),
    ffaSpawns: src.ffaSpawns,
    teamASpawns: src.teamASpawns,
    teamBSpawns: src.teamBSpawns,
    ...(src.palette ? { palette: src.palette } : {}),
    ...(src.zone ? { zone: src.zone } : {}),
    tiles,
  };
}
