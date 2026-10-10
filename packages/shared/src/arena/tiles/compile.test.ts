import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ARENA_01 } from "../arena-01.js";
import type { Obstacle } from "../types.js";
import { compileTileArena, type TileArenaSource } from "./compile.js";
import type { TileLegend } from "./legend.js";
import { TILE_DEFS, TILE_SIZE, type TileDef } from "./tile-config.js";

const SPAWN = { x: 100, y: 100, angle: 0 };

function source(rows: readonly string[], legend?: TileLegend): TileArenaSource {
  return {
    id: "test-arena",
    rows,
    ...(legend ? { legend } : {}),
    ffaSpawns: [SPAWN],
    teamASpawns: [SPAWN],
    teamBSpawns: [SPAWN],
  };
}

/** A one-sided spike (TC13, TC19): damages from its `front` only. Never shipped. */
const FIXTURE_DEFS: Readonly<Record<string, TileDef>> = {
  ...TILE_DEFS,
  "spike-front": { ...TILE_DEFS.spike, hazard: { kind: "spike", sides: ["front"] } },
};

/** How many obstacles cover each cell, and of which kind — the compile output rasterised back. */
function rasterise(obstacles: readonly Obstacle[], cols: number, rows: number) {
  const count = new Array<number>(cols * rows).fill(0);
  const kind = new Array<string>(cols * rows).fill("");
  for (const o of obstacles) {
    expect(o.x % TILE_SIZE).toBe(0);
    expect(o.y % TILE_SIZE).toBe(0);
    expect(o.w % TILE_SIZE).toBe(0);
    expect(o.h % TILE_SIZE).toBe(0);
    for (let r = o.y / TILE_SIZE; r < (o.y + o.h) / TILE_SIZE; r += 1) {
      for (let c = o.x / TILE_SIZE; c < (o.x + o.w) / TILE_SIZE; c += 1) {
        count[r * cols + c]! += 1;
        kind[r * cols + c] = o.kind ?? "solid";
      }
    }
  }
  return { count, kind };
}

const MIXED = [
  "##########",
  "#..^^....#",
  "#..^^.##.#",
  "#.....##.#",
  "  ^......#",
  "  ########",
];

/** Compile `rows` as arena `arena-x` and return the thunk, for the TC18 error tests. */
const loading = (rows: string[], legend?: TileLegend) => () =>
  compileTileArena({ ...source(rows, legend), id: "arena-x" });

describe("compileTileArena load errors (TC18)", () => {
  it("throws on an empty grid", () => {
    expect(loading([])).toThrow(/arena-x/);
    expect(loading([""])).toThrow(/arena-x/);
  });

  it("throws on a ragged row, naming it", () => {
    expect(loading(["###", "##"])).toThrow(/arena-x.*row 1/);
  });

  it("throws on a key not in the legend, naming row, column and key", () => {
    expect(loading(["##", "#?"])).toThrow(/arena-x.*row 1.*col 1.*"\?"/);
  });

  it("throws on a legend entry naming an unknown tile, naming the key", () => {
    expect(loading(["x"], { x: { tile: "lava" } })).toThrow(/arena-x.*"x".*lava/);
  });

  it("throws on an orientation outside the four values, naming the key", () => {
    const bad = { x: { tile: "wall", orientation: 45 } } as unknown as TileLegend;
    expect(loading(["x"], bad)).toThrow(/arena-x.*"x".*orientation/);
  });

  it("throws on an art orientation outside the four values, naming the key", () => {
    const bad = { x: { tile: "wall", artOrientation: 30 } } as unknown as TileLegend;
    expect(loading(["x"], bad)).toThrow(/arena-x.*"x".*artOrientation/);
  });

  it("throws on an explicit overlay with a bad orientation, naming the key", () => {
    const bad = { x: { tile: "spike", overlay: { art: "spike-teeth", orientation: 1 } } } as unknown as TileLegend;
    expect(loading(["x"], bad)).toThrow(/arena-x.*"x".*overlay/);
  });

  it("throws on art for an undrawn cell, naming the key", () => {
    expect(loading(["x"], { x: { tile: "void", art: "stars" } })).toThrow(/arena-x.*"x".*art/);
  });

  it("throws on an explicit overlay on an undrawn cell, naming the key", () => {
    const bad: TileLegend = { x: { tile: "void", overlay: { art: "saw", orientation: 0 } } };
    expect(loading(["x"], bad)).toThrow(/arena-x.*"x".*overlay.*undrawn/);
  });

  it("accepts overlay none on an undrawn cell", () => {
    expect(loading(["x"], { x: { tile: "void", overlay: "none" } })).not.toThrow();
  });

  it("throws on a legend key that is not one character", () => {
    expect(loading(["#"], { xy: { tile: "wall" } })).toThrow(/arena-x.*"xy"/);
  });
});

describe("compileTileArena", () => {
  it("sizes the arena from the grid and authors no polygon (TA14)", () => {
    const arena = compileTileArena(source(MIXED));
    expect(arena.width).toBe(10 * TILE_SIZE);
    expect(arena.height).toBe(6 * TILE_SIZE);
    expect(arena.boundary).toBeUndefined();
    expect(arena.tiles?.cols).toBe(10);
    expect(arena.tiles?.rows).toBe(6);
  });

  it("resolves one cell per character, row-major (TC9, TC17)", () => {
    const cells = compileTileArena(source(["#.", "^ "])).tiles!.cells;
    expect(cells.map((c) => c.tile)).toEqual(["wall", "floor", "spike", "void"]);
    expect(cells.map((c) => c.solid)).toEqual([true, false, true, true]);
    expect(cells.map((c) => c.hazard)).toEqual([null, null, "spike", null]);
    expect(cells[0]!.base).toEqual({ art: "checker-plate", rotation: 0 });
    expect(cells[1]!.base).toEqual({ art: "metal-plate", rotation: 0 });
    expect(cells[2]!.faces).toEqual(["n", "e", "s", "w"]);
    expect(cells[0]!.faces).toEqual([]);
  });

  it("covers every solid cell exactly once and no floor cell (TA16)", () => {
    const arena = compileTileArena(source(MIXED));
    const grid = arena.tiles!;
    const { count, kind } = rasterise(arena.obstacles, grid.cols, grid.rows);
    grid.cells.forEach((cell, i) => {
      expect(count[i], `cell ${i} (${cell.tile})`).toBe(cell.solid ? 1 : 0);
      if (cell.tile === "spike") expect(kind[i]).toBe("spike");
      if (cell.tile === "wall" || cell.tile === "void") expect(kind[i]).toBe("solid");
    });
  });

  it("merges wall and void together but never with spike (TA15)", () => {
    const arena = compileTileArena(source(["# ^", "# ^"]));
    expect(arena.obstacles).toEqual([
      { x: 0, y: 0, w: 2 * TILE_SIZE, h: 2 * TILE_SIZE },
      { x: 2 * TILE_SIZE, y: 0, w: TILE_SIZE, h: 2 * TILE_SIZE, kind: "spike" },
    ]);
  });

  it("emits no kind on a plain solid, and no damageFaces on an all-faces spike (TC22)", () => {
    const arena = compileTileArena(source(["#.^"]));
    expect(Object.keys(arena.obstacles[0]!)).toEqual(["x", "y", "w", "h"]);
    expect(Object.keys(arena.obstacles[1]!)).toEqual(["x", "y", "w", "h", "kind"]);
  });

  it("is deterministic", () => {
    expect(compileTileArena(source(MIXED)).obstacles).toEqual(compileTileArena(source(MIXED)).obstacles);
  });

  it("passes spawns, palette and zone through", () => {
    const palette = { floor: "#111111", obstacle: "#222222", border: "#333333" };
    const zone = { x: 200, y: 120, radius: 50 };
    const arena = compileTileArena({ ...source(MIXED), palette, zone });
    expect(arena.palette).toEqual(palette);
    expect(arena.zone).toEqual(zone);
    expect(arena.ffaSpawns).toEqual([SPAWN]);
    expect(arena.id).toBe("test-arena");
  });

  it("leaves palette and zone absent when the source has none", () => {
    const arena = compileTileArena(source(MIXED));
    expect("palette" in arena).toBe(false);
    expect("zone" in arena).toBe(false);
  });
});

describe("compileTileArena one-sided spikes (TC13, TC19, TC21, TC22)", () => {
  const compile = (rows: string[], legend: TileLegend) => compileTileArena(source(rows, legend), FIXTURE_DEFS);

  it("rotates a one-sided spike's faces and carries them onto its obstacle", () => {
    const arena = compile(["v"], { v: { tile: "spike-front", orientation: 180 } });
    expect(arena.tiles!.cells[0]!.faces).toEqual(["s"]);
    expect(arena.obstacles).toEqual([{ x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE, kind: "spike", damageFaces: ["s"] }]);
  });

  it("does not merge adjacent spikes that damage different faces", () => {
    const arena = compile(["^v"], {
      "^": { tile: "spike-front", orientation: 0 },
      v: { tile: "spike-front", orientation: 180 },
    });
    expect(arena.obstacles).toHaveLength(2);
  });

  it("merges adjacent spikes that damage the same faces", () => {
    const arena = compile(["vv"], { v: { tile: "spike-front", orientation: 180 } });
    expect(arena.obstacles).toEqual([
      { x: 0, y: 0, w: 2 * TILE_SIZE, h: TILE_SIZE, kind: "spike", damageFaces: ["s"] },
    ]);
  });

  it("merges adjacent walls whatever their art (TC10)", () => {
    const arena = compile(["#b"], { b: { tile: "wall", art: "bricks" } });
    expect(arena.obstacles).toEqual([{ x: 0, y: 0, w: 2 * TILE_SIZE, h: TILE_SIZE }]);
  });
});

describe("compileTileArena overlays (TC6, TC17)", () => {
  const compile = (rows: string[], legend?: TileLegend) => compileTileArena(source(rows, legend), FIXTURE_DEFS);
  const centre = (legend?: TileLegend, ch = "x") => compile(["...", `.${ch}.`, "..."], legend).tiles!.cells[4]!;

  it("gives a one-sided spike an overlay on its damaging face only", () => {
    expect(centre({ x: { tile: "spike-front", orientation: 180 } }).overlays).toEqual([
      { art: "spike-teeth", rotation: 180 },
    ]);
  });

  it("gives a mid-floor spike an overlay on every side", () => {
    expect(centre(undefined, "^").overlays.map((o) => o.rotation)).toEqual([0, 90, 180, 270]);
  });

  it("puts no overlay against a solid neighbour or past the grid edge", () => {
    const cells = compile(["#^#", "..."]).tiles!.cells;
    expect(cells[1]!.overlays).toEqual([{ art: "spike-teeth", rotation: 180 }]);
  });

  it("lets an explicit overlay win", () => {
    expect(centre({ x: { tile: "spike", overlay: { art: "saw", orientation: 90 } } }).overlays).toEqual([
      { art: "saw", rotation: 90 },
    ]);
  });

  it("draws no overlay when the cell says none", () => {
    expect(centre({ x: { tile: "spike", overlay: "none" } }).overlays).toEqual([]);
  });

  it("reskins the automatic overlay with overlayArt, keeping its edges (TC43)", () => {
    expect(centre({ x: { tile: "spike-front", orientation: 180, overlayArt: "wooden-spike" } }).overlays).toEqual([
      { art: "wooden-spike", rotation: 180 },
    ]);
  });
});

describe("compileTileArena overlayArt errors (TC43)", () => {
  it("throws on overlayArt for a tile with no automatic overlay, naming the key", () => {
    expect(loading(["x"], { x: { tile: "wall", overlayArt: "wooden-spike" } })).toThrow(/arena-x.*"x".*overlayArt.*no automatic overlay/);
  });

  it("throws on overlayArt beside an explicit overlay, naming the key", () => {
    const bad: TileLegend = { x: { tile: "spike", overlay: "none", overlayArt: "wooden-spike" } };
    expect(loading(["x"], bad)).toThrow(/arena-x.*"x".*both overlayArt and overlay/);
  });
});

describe("compileTileArena base art (TC5, TC17)", () => {
  const cell = (legend: TileLegend, defs = FIXTURE_DEFS) =>
    compileTileArena(source(["x"], legend), defs).tiles!.cells[0]!;

  it("rotates the base with the orientation by default", () => {
    expect(cell({ x: { tile: "spike-front", orientation: 90 } }).base).toEqual({ art: "checker-plate", rotation: 90 });
  });

  it("lets artOrientation override the rotation, and art the default art", () => {
    expect(cell({ x: { tile: "spike-front", orientation: 90, art: "rust", artOrientation: 270 } }).base).toEqual({
      art: "rust",
      rotation: 270,
    });
  });

  it("resolves a void cell as undrawn, with no base and no overlays", () => {
    const v = cell({ x: { tile: "void" } });
    expect(v.drawn).toBe(false);
    expect(v.base).toBeNull();
    expect(v.overlays).toEqual([]);
  });

  it("leaves a drawn cell that names no art, on a definition with none, a null base", () => {
    const bare = cell({ x: { tile: "bare" } }, { ...FIXTURE_DEFS, bare: { collision: "none", shape: "full" } });
    expect(bare.drawn).toBe(true);
    expect(bare.base).toBeNull();
  });
});

const frozen = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/arena-01.obstacles.json", import.meta.url)), "utf8"),
);

describe("arena-01 compile pin", () => {
  it("compiles arena-01 to exactly the pinned obstacles (TC22, TC35; re-pinned at 40 x 22, BAR8–BAR9)", () => {
    expect(ARENA_01.obstacles).toEqual(frozen);
  });
});
