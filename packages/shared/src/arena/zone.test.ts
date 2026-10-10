import { describe, expect, it } from "vitest";
import type { Aabb } from "../sim/collide.js";
import { zoneCentreOf, zoneCoreOf } from "./zone.js";

const area = (rs: readonly Aabb[]): number => rs.reduce((s, r) => s + r.w * r.h, 0);
const inside = (rs: readonly Aabb[], x: number, y: number): boolean =>
  rs.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);

/** The CT6 patch: widths 4,6,8,10,10,10,10,8,6,4 tiles (40 u) centred on x 680, rows from y 920. */
const PATCH: Aabb[] = [4, 6, 8, 10, 10, 10, 10, 8, 6, 4].map((tiles, i) => ({
  x: 680 - (tiles * 40) / 2,
  y: 920 + i * 40,
  w: tiles * 40,
  h: 40,
}));

describe("zoneCoreOf (CT9)", () => {
  it("a single 80x80 square shrinks by the inset on every side", () => {
    const core = zoneCoreOf([{ x: 0, y: 0, w: 80, h: 80 }], 20);
    expect(core).toEqual([{ x: 20, y: 20, w: 40, h: 40 }]);
    expect(area(core)).toBe(1600);
  });

  it("an inset of 0 is the patch", () => {
    expect(area(zoneCoreOf(PATCH, 0))).toBe(area(PATCH));
  });

  it("a concave corner keeps a notch", () => {
    const core = zoneCoreOf([{ x: 0, y: 0, w: 80, h: 40 }, { x: 0, y: 40, w: 40, h: 40 }], 10);
    expect(inside(core, 25, 35)).toBe(true);
    expect(inside(core, 35, 25)).toBe(true);
    expect(core.some((r) => 35 > r.x && 35 < r.x + r.w && 35 > r.y && 35 < r.y + r.h)).toBe(false);
  });

  it("a large inset empties the core", () => {
    expect(zoneCoreOf([{ x: 0, y: 0, w: 80, h: 80 }], 40)).toEqual([]);
  });

  it("every core rect lies inside the patch", () => {
    const core = zoneCoreOf(PATCH, 20);
    for (const r of core) {
      for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]] as const) {
        expect(inside(PATCH, x, y)).toBe(true);
      }
    }
    expect(Math.abs(area(core) - 91200) / 91200).toBeLessThan(0.01);
  });

  it("returns disjoint rects", () => {
    const core = zoneCoreOf(PATCH, 20);
    for (let i = 0; i < core.length; i += 1) {
      for (let j = i + 1; j < core.length; j += 1) {
        const a = core[i]!;
        const b = core[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe("zoneCentreOf (CT9)", () => {
  it("is the bounding-box centre", () => {
    expect(zoneCentreOf(PATCH)).toEqual({ x: 680, y: 1120 });
  });
});
