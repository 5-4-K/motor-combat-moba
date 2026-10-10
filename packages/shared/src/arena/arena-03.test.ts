import { describe, expect, it } from "vitest";
import { ARENA_03 } from "./arena-03.js";
import { getArena } from "./registry.js";
import { zoneCoreOf } from "./zone.js";
import { CONQUER_CONFIG } from "../config/conquer-config.js";

/** 180° about the arena centre. */
function rot(x: number, y: number): { x: number; y: number } {
  return { x: ARENA_03.width - x, y: ARENA_03.height - y };
}

describe("arena-03 (Conquer, CT1–CT6, CT10)", () => {
  it("is registered", () => {
    expect(getArena("arena-03")).toBe(ARENA_03);
  });

  it("is a 34 × 56 tile arena", () => {
    expect([ARENA_03.width, ARENA_03.height]).toStrictEqual([1360, 2240]);
    expect(ARENA_03.tiles?.cols).toBe(34);
    expect(ARENA_03.tiles?.rows).toBe(56);
  });

  it("has 76 capture cells drawn in metal-floor-drawn", () => {
    const capture = ARENA_03.tiles!.cells.filter((c) => c.capture);
    expect(capture).toHaveLength(76);
    for (const c of capture) expect(c.base.art).toBe("metal-floor-drawn");
  });

  it("the zone is the 76 metal cells (CT7)", () => {
    const area = ARENA_03.zone!.rects.reduce((sum, r) => sum + r.w * r.h, 0);
    expect(area).toBe(76 * 1600);
  });

  it("the shipped inset leaves a core (CT9)", () => {
    expect(zoneCoreOf(ARENA_03.zone!.rects, CONQUER_CONFIG.zoneEdgeInset).length).toBeGreaterThan(0);
  });

  it("puts spikes only on the side walls, rows 20–35", () => {
    const spikes = ARENA_03.obstacles.filter((o) => o.kind === "spike");
    expect(spikes.length).toBeGreaterThan(0);
    for (const s of spikes) {
      expect([0, 1320]).toContain(s.x);
      expect([s.y, s.w, s.h]).toStrictEqual([800, 40, 640]);
    }
  });

  it("maps onto itself under a 180° rotation (obstacles, zone cells, spawns A<->B)", () => {
    // The compiler merges cells into rectangles greedily, so the rectangle SET need not be
    // symmetric even when the map is; compare the cells each kind of obstacle, and the zone, covers instead.
    const T = 40;
    const covered = (flip: boolean): Set<string> => {
      const out = new Set<string>();
      const boxes = [
        ...ARENA_03.obstacles.map((o) => ({ ...o, label: o.kind ?? "wall" })),
        ...ARENA_03.zone!.rects.map((r) => ({ ...r, label: "zone" })),
      ];
      for (const o of boxes) {
        for (let x = o.x; x < o.x + o.w; x += T) {
          for (let y = o.y; y < o.y + o.h; y += T) {
            const c = flip ? rot(x + T, y + T) : { x, y };
            out.add(`${o.label}@${c.x},${c.y}`);
          }
        }
      }
      return out;
    };
    expect(covered(true)).toStrictEqual(covered(false));
    const bFromA = ARENA_03.teamASpawns.map((s) => rot(s.x, s.y)).map((p) => `${p.x},${p.y}`);
    expect(new Set(bFromA)).toStrictEqual(new Set(ARENA_03.teamBSpawns.map((s) => `${s.x},${s.y}`)));
  });

  it("spawns where CT10 puts them", () => {
    expect(ARENA_03.teamASpawns).toStrictEqual([
      { x: 500, y: 2120, angle: -Math.PI / 2 },
      { x: 680, y: 2120, angle: -Math.PI / 2 },
      { x: 860, y: 2120, angle: -Math.PI / 2 },
    ]);
    expect(ARENA_03.teamBSpawns).toStrictEqual([
      { x: 860, y: 120, angle: Math.PI / 2 },
      { x: 680, y: 120, angle: Math.PI / 2 },
      { x: 500, y: 120, angle: Math.PI / 2 },
    ]);
    expect(ARENA_03.ffaSpawns).toStrictEqual([...ARENA_03.teamASpawns, ...ARENA_03.teamBSpawns]);
  });

  it("team A spawns at the bottom facing up, team B at the top facing down", () => {
    for (const s of ARENA_03.teamASpawns) {
      expect(s.y).toBeGreaterThan(ARENA_03.height / 2);
      expect(s.angle).toBeCloseTo(-Math.PI / 2);
    }
    for (const s of ARENA_03.teamBSpawns) {
      expect(s.y).toBeLessThan(ARENA_03.height / 2);
      expect(s.angle).toBeCloseTo(Math.PI / 2);
    }
  });

  it("keeps every spawn more than 800 u from the counting core (CQ42)", () => {
    const core = zoneCoreOf(ARENA_03.zone!.rects, CONQUER_CONFIG.zoneEdgeInset);
    const toRect = (x: number, y: number, r: { x: number; y: number; w: number; h: number }): number =>
      Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h)));
    for (const s of [...ARENA_03.teamASpawns, ...ARENA_03.teamBSpawns]) {
      expect(Math.min(...core.map((r) => toRect(s.x, s.y, r)))).toBeGreaterThan(800);
    }
  });
});
