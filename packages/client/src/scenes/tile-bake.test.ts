import { describe, expect, it } from "vitest";
import { compileTileArena, type TileGrid } from "@motor-combat-moba/shared";
import { bakeChunks, fallbackTeeth, tileBakePlan, type BakeStamp } from "./tile-bake.js";

const SPAWN = { x: 0, y: 0, angle: 0 };

/** The resolved grid shared compiles from `rows` with the default legend. */
function grid(rows: string[]): TileGrid {
  return compileTileArena({ id: "t", rows, ffaSpawns: [SPAWN], teamASpawns: [SPAWN], teamBSpawns: [SPAWN] }).tiles!;
}
const overlays = (plan: BakeStamp[]) => plan.filter((s) => s.overlay);

describe("tileBakePlan (TA22, TC32)", () => {
  it("stamps one base per drawn cell, and nothing for void", () => {
    expect(tileBakePlan(grid(["#. "]))).toEqual([
      { col: 0, row: 0, solid: true, hazard: null, art: "checker-plate", rotation: 0, overlay: false },
      { col: 1, row: 0, solid: false, hazard: null, art: "metal-plate", rotation: 0, overlay: false },
    ]);
  });

  it("gives a mid-arena spike pillar an overlay on all four sides", () => {
    const plan = overlays(tileBakePlan(grid(["...", ".^.", "..."])));
    expect(plan.map((s) => s.rotation)).toEqual([0, 90, 180, 270]);
    expect(plan.every((s) => s.col === 1 && s.row === 1 && s.hazard === "spike")).toBe(true);
  });

  it("gives a wall-row spike exactly one overlay, on its floor side", () => {
    expect(overlays(tileBakePlan(grid(["#^#", "..."])))).toEqual([
      { col: 1, row: 0, solid: true, hazard: "spike", art: "spike-teeth", rotation: 180, overlay: true },
    ]);
  });

  it("stamps every base before any overlay", () => {
    const plan = tileBakePlan(grid(["...", ".^.", "..."]));
    const first = plan.findIndex((s) => s.overlay);
    expect(first).toBe(9);
    expect(plan.slice(first).every((s) => s.overlay)).toBe(true);
  });
});

describe("bakeChunks (TA23)", () => {
  it("splits arena-01 (32 x 18 at 80 px) into two whole-tile chunks", () => {
    expect(bakeChunks(32, 18, 80, 2048)).toEqual([
      { col: 0, row: 0, cols: 25, rows: 18 },
      { col: 25, row: 0, cols: 7, rows: 18 },
    ]);
  });

  it("covers the grid exactly with chunks no larger than the cap", () => {
    const chunks = bakeChunks(60, 70, 80, 2048);
    let area = 0;
    for (const c of chunks) {
      expect(c.cols * 80).toBeLessThanOrEqual(2048);
      expect(c.rows * 80).toBeLessThanOrEqual(2048);
      area += c.cols * c.rows;
    }
    expect(area).toBe(60 * 70);
  });
});

describe("fallbackTeeth", () => {
  it("keeps every tooth inside its own tile", () => {
    for (const rot of [0, 90, 180, 270] as const) {
      const tris = fallbackTeeth(rot, 100, 200, 40);
      expect(tris.length).toBeGreaterThan(0);
      for (const t of tris) {
        for (let i = 0; i < 6; i += 2) {
          expect(t[i]!).toBeGreaterThanOrEqual(100);
          expect(t[i]!).toBeLessThanOrEqual(140);
          expect(t[i + 1]!).toBeGreaterThanOrEqual(200);
          expect(t[i + 1]!).toBeLessThanOrEqual(240);
        }
      }
    }
  });

  it("puts each point on the open edge", () => {
    for (const t of fallbackTeeth(0, 100, 200, 40)) expect(t[5]).toBe(200);
    for (const t of fallbackTeeth(90, 100, 200, 40)) expect(t[4]).toBe(140);
    for (const t of fallbackTeeth(180, 100, 200, 40)) expect(t[5]).toBe(240);
    for (const t of fallbackTeeth(270, 100, 200, 40)) expect(t[4]).toBe(100);
  });
});
