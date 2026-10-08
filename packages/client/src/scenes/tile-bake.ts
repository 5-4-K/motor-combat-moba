import { isSolidTile, tileDefOf, type TileGrid } from "@motor-combat-moba/shared";

/**
 * How a tile arena's floor is baked (spec tile arenas, TA22–TA25). Pure, so it is tested in node;
 * `ArenaScene.bakeTileFloor` only executes the plan into render textures.
 */

/** Baked pixels per world unit: tile art is 80 px for a 40 u tile (TA4). */
export const TILE_BAKE_SCALE = 2;
/** Largest chunk side, in px — a safe texture size on every WebGL target (TA23). */
export const TILE_BAKE_MAX_CHUNK_PX = 2048;
/** The edge overlay a spike tile wears on each side that borders open floor (TA6). */
export const SPIKE_TEETH_ART = "spike-teeth";

export type TileRotation = 0 | 90 | 180 | 270;

export interface TileStamp {
  readonly art: string;
  readonly col: number;
  readonly row: number;
  /** Clockwise degrees. Teeth art is authored for the TOP edge; 90 right, 180 bottom, 270 left. */
  readonly rotation: TileRotation;
}

/** Edge neighbours in rotation order: top, right, bottom, left. */
const EDGES: ReadonlyArray<readonly [number, number, TileRotation]> = [
  [0, -1, 0],
  [1, 0, 90],
  [0, 1, 180],
  [-1, 0, 270],
];

/** Every stamp the bake draws, bases first, then teeth (TA22). */
export function tileBakePlan(grid: TileGrid): TileStamp[] {
  const bases: TileStamp[] = [];
  const teeth: TileStamp[] = [];
  const { cols, rows, cells } = grid;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const def = tileDefOf(cells[row * cols + col]!);
      if (def.art !== null) bases.push({ art: def.art, col, row, rotation: 0 });
      if (def.hazard !== "spike") continue;
      for (const [dc, dr, rotation] of EDGES) {
        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        if (isSolidTile(cells[nr * cols + nc]!)) continue;
        teeth.push({ art: SPIKE_TEETH_ART, col, row, rotation });
      }
    }
  }
  return [...bases, ...teeth];
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
