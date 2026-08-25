import { describe, expect, it } from "vitest";
import { DEFAULT_CAR_ID } from "@motor-combat-moba/shared";
import {
  carAtDeadline,
  copySpawnNumbers,
  livingAfterLeave,
} from "./match-helpers.js";

describe("copySpawnNumbers", () => {
  it("copies x,y,angle by value, not by mutating the source", () => {
    const source = { x: 10, y: 20, angle: 0.5 };
    const copied = copySpawnNumbers(source);
    copied.x = 99;
    expect(source.x).toBe(10);
    expect(copied).toEqual({ x: 99, y: 20, angle: 0.5 });
  });
});

describe("livingAfterLeave", () => {
  it("marks remaining roster members; the leaver is absent", () => {
    const remaining = [
      { sessionId: "b", team: 1 as const, alive: true },
      { sessionId: "spec", team: 0 as const, alive: true },
    ];
    const snapshot = livingAfterLeave(remaining, new Set(["a", "b"]));
    expect(snapshot).toEqual([
      { sessionId: "b", team: 1, alive: true, inRoster: true },
      { sessionId: "spec", team: 0, alive: true, inRoster: false },
    ]);
  });
});

describe("carAtDeadline", () => {
  it("hands back the previewed car, so choosing without locking in still counts", () => {
    expect(carAtDeadline("hexagon")).toBe("hexagon");
    expect(carAtDeadline("oval")).toBe("oval");
  });

  it("falls back to the chassis car select opens on, never to chance", () => {
    expect(carAtDeadline(undefined)).toBe(DEFAULT_CAR_ID);
  });

  it("is deterministic — the same input always yields the same car", () => {
    const runs = Array.from({ length: 20 }, () => carAtDeadline(undefined));
    expect(new Set(runs).size).toBe(1);
  });
});
