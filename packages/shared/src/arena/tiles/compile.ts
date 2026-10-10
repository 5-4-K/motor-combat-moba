import type { WorldFace } from "../faces.js";
import type { Aabb } from "../../sim/collide.js";
import type { ArenaDef, ArenaPalette, ArenaZone, Obstacle, Spawn, TileCell, TileGrid, TileStamp } from "../types.js";
import { effectiveLegend, type TileCellSpec, type TileLegend } from "./legend.js";
import { TILE_DEFS, TILE_SIZE, rotateSides, type TileDef, type TileRotation } from "./tile-config.js";

/**
 * A tile arena as authored (spec tile arenas TA5, tile cells TC7, TC20): one string per row, one
 * character per cell, an optional legend for keys beyond the defaults, plus the things that are
 * points and circles rather than surfaces — spawns and the capture zone.
 */
export interface TileArenaSource {
  readonly id: string;
  readonly displayName: string;
  readonly rows: readonly string[];
  readonly legend?: TileLegend;
  readonly ffaSpawns: readonly Spawn[];
  readonly teamASpawns: readonly Spawn[];
  readonly teamBSpawns: readonly Spawn[];
  readonly palette?: ArenaPalette;
  readonly zone?: ArenaZone;
}

type TileDefs = Readonly<Record<string, TileDef>>;

const ROTATIONS: readonly number[] = [0, 90, 180, 270];
const isRotation = (v: unknown): boolean => ROTATIONS.includes(v as number);

/** The overlay's clockwise turn for each world face: art is authored for the TOP edge (TA6). */
const FACE_ROTATION: Readonly<Record<WorldFace, TileRotation>> = { n: 0, e: 90, s: 180, w: 270 };
/** The neighbour across each world face. */
const FACE_STEP: Readonly<Record<WorldFace, readonly [number, number]>> = {
  n: [0, -1],
  e: [1, 0],
  s: [0, 1],
  w: [-1, 0],
};

/** Every legend entry checked against the definitions, each error naming the arena and key (TC18). */
function validateLegend(id: string, legend: TileLegend, defs: TileDefs): void {
  for (const [key, spec] of Object.entries(legend)) {
    const where = `Tile arena ${id}: legend key ${JSON.stringify(key)}`;
    const def = defs[spec.tile];
    if (def === undefined) throw new Error(`${where} names unknown tile ${JSON.stringify(spec.tile)}`);
    if (spec.orientation !== undefined && !isRotation(spec.orientation)) {
      throw new Error(`${where} has orientation ${spec.orientation}; expected 0, 90, 180 or 270`);
    }
    if (spec.artOrientation !== undefined && !isRotation(spec.artOrientation)) {
      throw new Error(`${where} has artOrientation ${spec.artOrientation}; expected 0, 90, 180 or 270`);
    }
    if (spec.overlay !== undefined && spec.overlay !== "none" && !isRotation(spec.overlay.orientation)) {
      throw new Error(`${where} has an overlay orientation ${spec.overlay.orientation}; expected 0, 90, 180 or 270`);
    }
    if (spec.overlay !== undefined && spec.overlay !== "none" && def.draw === "none") {
      throw new Error(`${where} names an overlay on undrawn tile ${JSON.stringify(spec.tile)}`);
    }
    if (spec.art !== undefined && def.draw === "none") {
      throw new Error(`${where} names art ${JSON.stringify(spec.art)} on undrawn tile ${JSON.stringify(spec.tile)}`);
    }
    if (spec.overlayArt !== undefined && def.overlay === undefined) {
      throw new Error(`${where} names overlayArt on tile ${JSON.stringify(spec.tile)}, which has no automatic overlay`);
    }
    if (spec.overlayArt !== undefined && spec.overlay !== undefined) {
      throw new Error(`${where} names both overlayArt and overlay; overlayArt only reskins the automatic one`);
    }
  }
}

/** The rows mapped through the legend, throwing with arena, row and column on bad input (TA17, TC18). */
function specsOf(id: string, rows: readonly string[], legend: TileLegend): { cols: number; specs: TileCellSpec[] } {
  const cols = rows[0]?.length ?? 0;
  if (rows.length === 0 || cols === 0) throw new Error(`Tile arena ${id}: the grid is empty`);
  const specs: TileCellSpec[] = [];
  rows.forEach((row, r) => {
    if (row.length !== cols) {
      throw new Error(`Tile arena ${id}: row ${r} is ${row.length} tiles wide, expected ${cols}`);
    }
    for (let c = 0; c < cols; c += 1) {
      const ch = row[c]!;
      const spec = legend[ch];
      if (spec === undefined) {
        throw new Error(`Tile arena ${id}: row ${r}, col ${c} has key ${JSON.stringify(ch)}, which is not in its legend`);
      }
      specs.push(spec);
    }
  });
  return { cols, specs };
}

/**
 * Expand the authored rows into the fully resolved grid (TC9, TC17). Two passes: behaviour and base
 * art per cell, then overlays, which need every neighbour's `solid`.
 */
function resolveGrid(src: TileArenaSource, defs: TileDefs): TileGrid {
  const legend = effectiveLegend(src.id, src.legend);
  validateLegend(src.id, legend, defs);
  const { cols, specs } = specsOf(src.id, src.rows, legend);
  const rows = src.rows.length;

  const first = specs.map((spec) => {
    const def = defs[spec.tile]!;
    const orientation = spec.orientation ?? 0;
    const drawn = def.draw !== "none";
    const art = spec.art ?? def.defaultArt;
    return {
      tile: spec.tile,
      solid: def.collision === "solid",
      hazard: def.hazard?.kind ?? null,
      faces: def.hazard ? rotateSides(def.hazard.sides, orientation) : [],
      drawn,
      capture: def.capture === true,
      base: drawn && art !== undefined ? { art, rotation: spec.artOrientation ?? orientation } : null,
    };
  });

  /** Whether the cell across `face` from cell `i` is in the grid and open. The grid edge is a wall. */
  const exposed = (i: number, face: WorldFace): boolean => {
    const [dc, dr] = FACE_STEP[face];
    const c = (i % cols) + dc;
    const r = Math.floor(i / cols) + dr;
    return c >= 0 && r >= 0 && c < cols && r < rows && !first[r * cols + c]!.solid;
  };

  const cells: TileCell[] = first.map((cell, i) => {
    const spec = specs[i]!;
    const rule = defs[spec.tile]!.overlay;
    let overlays: TileStamp[] = [];
    if (spec.overlay !== undefined && spec.overlay !== "none") {
      overlays = [{ art: spec.overlay.art, rotation: spec.overlay.orientation }];
    } else if (spec.overlay === undefined && rule !== undefined) {
      const art = spec.overlayArt ?? rule.art;
      overlays = cell.faces.filter((face) => exposed(i, face)).map((face) => ({ art, rotation: FACE_ROTATION[face] }));
    }
    return { ...cell, overlays };
  });

  return { cols, rows, cells };
}

/**
 * What a solid cell merges with (TA15, TC21): its hazard (or plain `solid`) plus its damaging faces.
 * Wall and void are both plain solid and merge together; art never splits a merge (TC10). `null` is
 * not solid.
 */
function classOf(cell: TileCell): string | null {
  if (!cell.solid) return null;
  // faces.join("") is a stable key only because rotateSides answers in n-e-s-w order.
  return `${cell.hazard ?? "solid"}|${cell.faces.join("")}`;
}

/**
 * Greedy rectangle merge (TA15): scan row-major; at the first unclaimed cell with a class take the
 * widest run of that class to the right, then grow it downward while the next row's same span is
 * that class and unclaimed. Exact cover of the classed cells (TA16), and deterministic. `classOf`
 * answers `null` for a cell that merges into nothing; `emit` receives each rect in world units and
 * its top-left cell.
 */
function mergeCells<T>(
  grid: TileGrid,
  classOf: (cell: TileCell) => string | null,
  emit: (rect: Aabb, cell: TileCell) => T,
): T[] {
  const { cols, rows, cells } = grid;
  const claimed = new Uint8Array(cols * rows);
  const free = (i: number, cls: string): boolean => claimed[i] === 0 && classOf(cells[i]!) === cls;
  const out: T[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const start = r * cols + c;
      const cell = cells[start]!;
      const cls = classOf(cell);
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
      out.push(emit({ x: c * TILE_SIZE, y: r * TILE_SIZE, w: w * TILE_SIZE, h: h * TILE_SIZE }, cell));
    }
  }
  return out;
}

/** The solid cells merged into obstacles (TA15). */
function mergeSolids(grid: TileGrid): Obstacle[] {
  return mergeCells(grid, classOf, (rect, cell) => {
    if (cell.hazard !== "spike") return rect;
    // TC22: all four faces is the absent default, so a `sides: "all"` spike compiles as before.
    if (cell.faces.length < 4) return { ...rect, kind: "spike", damageFaces: cell.faces };
    return { ...rect, kind: "spike" };
  });
}

/**
 * The capture cells merged into maximal rectangles in world units, by the same greedy merge as the
 * obstacles (CT7). `[]` when the grid has none.
 */
export function captureRectsOf(grid: TileGrid): Aabb[] {
  return mergeCells(grid, (cell) => (cell.capture ? "capture" : null), (rect) => rect);
}

/**
 * A tile grid as an ordinary `ArenaDef` (TA14–TA17, TC20). The sim, vision and shots read the
 * compiled `obstacles` exactly as they read a hand-written arena's; `tiles` is the resolved grid the
 * client bakes. `defs` exists for tests' fixture definitions (TC19) — production never passes it.
 * Reads no mode accessor, so it may run at module load.
 */
export function compileTileArena(src: TileArenaSource, defs: TileDefs = TILE_DEFS): ArenaDef {
  const tiles = resolveGrid(src, defs);
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
