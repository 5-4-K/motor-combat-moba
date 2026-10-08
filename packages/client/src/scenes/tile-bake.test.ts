import { describe, expect, it } from "vitest";
import type { TileGrid, TileId } from "@motor-combat-moba/shared";
import { bakeChunks, fallbackTeeth, tileBakePlan, type TileStamp } from "./tile-bake.js";

function grid(rows: string[]): TileGrid {
  const map: Record<string, TileId> = { ".": "floor", "#": "wall", "^": "spike", " ": "void" };
  return { cols: rows[0]!.length, rows: rows.length, cells: rows.flatMap((r) => [...r].map((ch) => map[ch]!)) };
}
const teeth = (plan: TileStamp[]) => plan.filter((s) => s.art === "spike-teeth");

describe("tileBakePlan (TA22)", () => {
  it("stamps one base per cell with art, and nothing for void", () => {
    expect(tileBakePlan(grid(["#. "]))).toEqual([
      { art: "wall", col: 0, row: 0, rotation: 0 },
      { art: "floor", col: 1, row: 0, rotation: 0 },
    ]);
  });

  it("gives a mid-arena spike pillar teeth on all four sides", () => {
    const plan = tileBakePlan(grid(["...", ".^.", "..."]));
    expect(teeth(plan).map((s) => s.rotation).sort((a, b) => a - b)).toEqual([0, 90, 180, 270]);
    expect(teeth(plan).every((s) => s.col === 1 && s.row === 1)).toBe(true);
  });

  it("gives a wall-row spike teeth only on its floor side", () => {
    expect(teeth(tileBakePlan(grid(["#^#", "..."])))).toEqual([
      { art: "spike-teeth", col: 1, row: 0, rotation: 180 },
    ]);
  });

  it("puts no teeth on a grid edge or against void", () => {
    expect(teeth(tileBakePlan(grid([" ^ "])))).toEqual([]);
  });

  it("stamps every base before any teeth", () => {
    const plan = tileBakePlan(grid(["...", ".^.", "..."]));
    const firstTooth = plan.findIndex((s) => s.art === "spike-teeth");
    expect(firstTooth).toBe(9);
    expect(plan.slice(firstTooth).every((s) => s.art === "spike-teeth")).toBe(true);
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
