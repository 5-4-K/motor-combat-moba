import type { TileGrid, TileRotation } from "@motor-combat-moba/shared";

/**
 * How a tile arena's floor is baked (spec tile arenas TA22–TA25, tile cells TC32–TC34). Pure, so it
 * is tested in node; `ArenaScene.bakeTileFloor` only executes the plan into render textures. Shared's
 * compiler has already resolved every cell's art and overlays, so the plan is a flat read.
 */

/** Baked pixels per world unit: tile art is 80 px for a 40 u tile (TA4). */
export const TILE_BAKE_SCALE = 2;
/** Largest chunk side, in px — a safe texture size on every WebGL target (TA23). */
export const TILE_BAKE_MAX_CHUNK_PX = 2048;

/** One stamp of the bake: what to draw, where, and the cell's behaviour for the fallback (TC33). */
export interface BakeStamp {
  readonly col: number;
  readonly row: number;
  /** Tile art id, or null for a drawn cell that names none (it draws the behaviour fallback). */
  readonly art: string | null;
  /** Clockwise degrees. Overlay art is authored for the TOP edge; 90 right, 180 bottom, 270 left. */
  readonly rotation: TileRotation;
  readonly overlay: boolean;
  readonly solid: boolean;
  readonly hazard: "spike" | null;
}

/** Every stamp the bake draws (TA22, TC32): every drawn cell's base row-major, then every overlay row-major. */
export function tileBakePlan(grid: TileGrid): BakeStamp[] {
  const bases: BakeStamp[] = [];
  const overlays: BakeStamp[] = [];
  grid.cells.forEach((cell, i) => {
    const col = i % grid.cols;
    const row = Math.floor(i / grid.cols);
    const facts = { col, row, solid: cell.solid, hazard: cell.hazard };
    if (cell.drawn) bases.push({ ...facts, art: cell.base?.art ?? null, rotation: cell.base?.rotation ?? 0, overlay: false });
    for (const o of cell.overlays) overlays.push({ ...facts, art: o.art, rotation: o.rotation, overlay: true });
  });
  return [...bases, ...overlays];
}

/** A chunk of the bake, in tiles. */
export interface BakeChunk {
  readonly col: number;
  readonly row: number;
  readonly cols: number;
  readonly rows: number;
}

/** Split the grid into whole-tile chunks no larger than `maxPx` a side (TA23). */
export function bakeChunks(cols: number, rows: number, tilePx: number, maxPx: number): BakeChunk[] {
  const step = Math.max(1, Math.floor(maxPx / tilePx));
  const out: BakeChunk[] = [];
  for (let row = 0; row < rows; row += step) {
    for (let col = 0; col < cols; col += step) {
      out.push({ col, row, cols: Math.min(step, cols - col), rows: Math.min(step, rows - row) });
    }
  }
  return out;
}

export type ToothTriangle = [number, number, number, number, number, number];

/** Teeth per tile edge in the procedural fallback, and how far into the tile their bases sit. */
const FALLBACK_TEETH = 4;
const FALLBACK_DEPTH = 0.45;

/**
 * The procedural teeth for one edge of the tile whose top-left is `(x, y)` (TA25): bases inside the
 * tile, points ON the open edge, never past it — the tile is the hitbox. Each triangle is base, base,
 * point, the order `Graphics.fillTriangle` takes.
 */
export function fallbackTeeth(rotation: TileRotation, x: number, y: number, size: number): ToothTriangle[] {
  const width = size / FALLBACK_TEETH;
  const depth = size * FALLBACK_DEPTH;
  const out: ToothTriangle[] = [];
  for (let i = 0; i < FALLBACK_TEETH; i += 1) {
    const a = i * width;
    const b = a + width;
    const m = a + width / 2;
    if (rotation === 0) out.push([x + a, y + depth, x + b, y + depth, x + m, y]);
    else if (rotation === 90) out.push([x + size - depth, y + a, x + size - depth, y + b, x + size, y + m]);
    else if (rotation === 180) out.push([x + a, y + size - depth, x + b, y + size - depth, x + m, y + size]);
    else out.push([x + depth, y + a, x + depth, y + b, x, y + m]);
  }
  return out;
}
