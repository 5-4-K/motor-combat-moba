import { describe, expect, it } from "vitest";
import type { Obstacle } from "../types.js";
import { compileTileArena, parseTileGrid, type TileArenaSource } from "./compile.js";
import { TILE_SIZE, isSolidTile } from "./tile-config.js";

const SPAWN = { x: 100, y: 100, angle: 0 };

function source(rows: readonly string[]): TileArenaSource {
  return { id: "test-arena", rows, ffaSpawns: [SPAWN], teamASpawns: [SPAWN], teamBSpawns: [SPAWN] };
}

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

describe("parseTileGrid", () => {
  it("reads one tile per character, row-major", () => {
    expect(parseTileGrid("a", ["#.", "^ "])).toEqual({
      cols: 2,
      rows: 2,
      cells: ["wall", "floor", "spike", "void"],
    });
  });

  it("throws on an unknown character, naming arena, row and column (TA17)", () => {
    expect(() => parseTileGrid("arena-x", ["##", "#?"])).toThrow(/arena-x.*row 1.*col 1.*"\?"/);
  });

  it("throws on ragged rows (TA17)", () => {
    expect(() => parseTileGrid("arena-x", ["###", "##"])).toThrow(/arena-x.*row 1/);
  });

  it("throws on an empty grid (TA17)", () => {
    expect(() => parseTileGrid("arena-x", [])).toThrow(/arena-x/);
    expect(() => parseTileGrid("arena-x", [""])).toThrow(/arena-x/);
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

  it("covers every solid cell exactly once and no floor cell (TA16)", () => {
    const arena = compileTileArena(source(MIXED));
    const grid = arena.tiles!;
    const { count, kind } = rasterise(arena.obstacles, grid.cols, grid.rows);
    grid.cells.forEach((id, i) => {
      expect(count[i], `cell ${i} (${id})`).toBe(isSolidTile(id) ? 1 : 0);
      if (id === "spike") expect(kind[i]).toBe("spike");
      if (id === "wall" || id === "void") expect(kind[i]).toBe("solid");
    });
  });

  it("merges wall and void together but never with spike (TA15)", () => {
    const arena = compileTileArena(source(["# ^", "# ^"]));
    expect(arena.obstacles).toEqual([
      { x: 0, y: 0, w: 2 * TILE_SIZE, h: 2 * TILE_SIZE },
      { x: 2 * TILE_SIZE, y: 0, w: TILE_SIZE, h: 2 * TILE_SIZE, kind: "spike" },
    ]);
  });

  it("emits no kind key at all on a plain solid", () => {
    const arena = compileTileArena(source(["#."]));
    expect(Object.keys(arena.obstacles[0]!)).toEqual(["x", "y", "w", "h"]);
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
