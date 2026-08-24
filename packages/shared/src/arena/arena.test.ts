import { describe, expect, it } from "vitest";
import { ARENA_01 } from "./arena-01.js";
import { getArena } from "./registry.js";

describe("arena-01", () => {
  it("is 2400x1600 with 6 obstacles", () => {
    expect(ARENA_01.width).toBe(2400);
    expect(ARENA_01.height).toBe(1600);
    expect(ARENA_01.obstacles).toHaveLength(6);
  });

  it("keeps every obstacle inside bounds", () => {
    for (const o of ARENA_01.obstacles) {
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeGreaterThanOrEqual(0);
      expect(o.x + o.w).toBeLessThanOrEqual(ARENA_01.width);
      expect(o.y + o.h).toBeLessThanOrEqual(ARENA_01.height);
    }
  });

  it("exposes 6 FFA spawns and 3+3 team spawns, none overlapping an obstacle", () => {
    expect(ARENA_01.ffaSpawns).toHaveLength(6);
    expect(ARENA_01.teamASpawns).toHaveLength(3);
    expect(ARENA_01.teamBSpawns).toHaveLength(3);
    const all = [...ARENA_01.ffaSpawns, ...ARENA_01.teamASpawns, ...ARENA_01.teamBSpawns];
    for (const s of all) {
      expect(s.x).toBeGreaterThan(80);
      expect(s.x).toBeLessThan(ARENA_01.width - 80);
      for (const o of ARENA_01.obstacles) {
        const inside = s.x > o.x && s.x < o.x + o.w && s.y > o.y && s.y < o.y + o.h;
        expect(inside).toBe(false);
      }
    }
    for (const s of ARENA_01.teamASpawns) expect(s.x).toBeLessThan(ARENA_01.width / 2);
    for (const s of ARENA_01.teamBSpawns) expect(s.x).toBeGreaterThan(ARENA_01.width / 2);
  });

  it("registry resolves arena-01", () => {
    expect(getArena("arena-01")).toBe(ARENA_01);
  });

  it("throws for unknown arena id", () => {
    expect(() => getArena("nope")).toThrow();
  });
});
