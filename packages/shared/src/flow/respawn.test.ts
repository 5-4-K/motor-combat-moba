import { describe, expect, it } from "vitest";
import type { Spawn } from "../arena/types.js";
import { DEATHMATCH_TICKS } from "../config/deathmatch-config.js";
import { farthestSpawn, isDueToRespawn, phaseDecision, type PhaseInput } from "./respawn.js";

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

describe("isDueToRespawn", () => {
  it("waits out the full delay, then fires", () => {
    expect(isDueToRespawn(100, 100 + DEATHMATCH_TICKS.respawnDelay - 1)).toBe(false);
    expect(isDueToRespawn(100, 100 + DEATHMATCH_TICKS.respawnDelay)).toBe(true);
  });

  it("never fires for a car that has not died", () => {
    // 0 is the "alive" sentinel `diedAtTick` carries, not tick zero.
    expect(isDueToRespawn(0, 999999)).toBe(false);
  });
});

describe("phaseDecision", () => {
  const input = (over: Partial<PhaseInput> = {}): PhaseInput => ({
    tick: 100,
    endsTick: 200,
    capTick: 300,
    fired: false,
    overlapping: false,
    ...over,
  });

  it("leaves protection alone while its minimum window is still running", () => {
    expect(phaseDecision(input())).toBe("run");
  });

  it("drops it the moment the player fires, whatever else is true", () => {
    expect(phaseDecision(input({ fired: true }))).toBe("drop");
    expect(phaseDecision(input({ fired: true, overlapping: true }))).toBe("drop");
  });

  it("drops it at the hard cap even while overlapped, so it cannot be held forever", () => {
    expect(phaseDecision(input({ tick: 300, endsTick: 400, overlapping: true }))).toBe("drop");
  });

  it("lets it lapse on schedule when the car is clear", () => {
    expect(phaseDecision(input({ tick: 199, endsTick: 200 }))).toBe("drop");
  });

  it("extends it when it would otherwise lapse inside another car", () => {
    expect(phaseDecision(input({ tick: 199, endsTick: 200, overlapping: true }))).toBe("extend");
  });

  it("does not extend early — overlap only matters on the tick it would lapse", () => {
    expect(phaseDecision(input({ tick: 100, endsTick: 200, overlapping: true }))).toBe("run");
  });

  it("prefers the cap over an extension when both apply", () => {
    expect(
      phaseDecision(input({ tick: 250, endsTick: 251, capTick: 250, overlapping: true })),
    ).toBe("drop");
  });
});
