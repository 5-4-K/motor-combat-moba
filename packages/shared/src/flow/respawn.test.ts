import { describe, expect, it } from "vitest";
import type { Spawn } from "../arena/types.js";
import { farthestSpawn } from "./respawn.js";

const spawns: Spawn[] = [
  { x: 0, y: 0, angle: 0 },
  { x: 100, y: 0, angle: 0 },
  { x: 1000, y: 0, angle: 0 },
];

describe("farthestSpawn", () => {
  it("picks the spawn furthest from the nearest living enemy", () => {
    expect(farthestSpawn(spawns, [{ x: 0, y: 0 }])).toEqual({ x: 1000, y: 0, angle: 0 });
  });

  it("maximises the NEAREST enemy distance, not the total", () => {
    // 0 is 1000 from the far enemy but 0 from the near one; 100 is 100 away at worst.
    expect(farthestSpawn(spawns, [{ x: 0, y: 0 }, { x: 1000, y: 0 }])).toEqual({
      x: 100, y: 0, angle: 0,
    });
  });

  it("returns the first spawn when nobody is alive to avoid", () => {
    expect(farthestSpawn(spawns, [])).toEqual({ x: 0, y: 0, angle: 0 });
  });

  it("breaks ties toward the earlier spawn, so the choice is deterministic", () => {
    const mirrored: Spawn[] = [
      { x: -50, y: 0, angle: 1 },
      { x: 50, y: 0, angle: 2 },
    ];
    expect(farthestSpawn(mirrored, [{ x: 0, y: 0 }]).angle).toBe(1);
  });

  it("throws on an empty spawn list rather than returning undefined", () => {
    expect(() => farthestSpawn([], [])).toThrow(/spawn/i);
  });
});
