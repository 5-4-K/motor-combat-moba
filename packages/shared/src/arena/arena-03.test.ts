import { describe, expect, it } from "vitest";
import { ARENA_03 } from "./arena-03.js";
import { getArena } from "./registry.js";

/** 180° about the arena centre. */
function rot(x: number, y: number): { x: number; y: number } {
  return { x: ARENA_03.width - x, y: ARENA_03.height - y };
}

describe("arena-03 (Conquer, CQ37–CQ40)", () => {
  it("is registered, 1280 x 2160, flips for team B, and has the centre zone", () => {
    expect(getArena("arena-03")).toBe(ARENA_03);
    expect([ARENA_03.width, ARENA_03.height]).toStrictEqual([1280, 2160]);
    expect(ARENA_03.flipForTeamB).toBe(true);
    expect(ARENA_03.zone).toStrictEqual({ x: 640, y: 1080, radius: 150 });
  });

  it("maps onto itself under a 180° rotation (obstacles, spawns A<->B, zone)", () => {
    const key = (o: { x: number; y: number; w: number; h: number }) => `${o.x},${o.y},${o.w},${o.h}`;
    const rotated = ARENA_03.obstacles.map((o) => {
      const p = rot(o.x + o.w, o.y + o.h); // the far corner becomes the new top-left
      return key({ x: p.x, y: p.y, w: o.w, h: o.h });
    });
    expect(new Set(rotated)).toStrictEqual(new Set(ARENA_03.obstacles.map(key)));
    const bFromA = ARENA_03.teamASpawns.map((s) => rot(s.x, s.y)).map((p) => `${p.x},${p.y}`);
    expect(new Set(bFromA)).toStrictEqual(new Set(ARENA_03.teamBSpawns.map((s) => `${s.x},${s.y}`)));
    const z = rot(ARENA_03.zone!.x, ARENA_03.zone!.y);
    expect([z.x, z.y]).toStrictEqual([ARENA_03.zone!.x, ARENA_03.zone!.y]);
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

  it("keeps every spawn at least ~800 u from the zone edge (CQ42's dependency)", () => {
    const z = ARENA_03.zone!;
    for (const s of [...ARENA_03.teamASpawns, ...ARENA_03.teamBSpawns]) {
      expect(Math.hypot(s.x - z.x, s.y - z.y) - z.radius).toBeGreaterThan(800);
    }
  });
});
