import { describe, expect, it } from "vitest";
import { CAR_TABLE } from "@motor-arena/shared";
import {
  copySpawnNumbers,
  livingAfterLeave,
  pickRandomCarId,
} from "./match-helpers.js";

describe("pickRandomCarId", () => {
  it("picks a CAR_TABLE key from Object.keys order using random", () => {
    const keys = Object.keys(CAR_TABLE);
    expect(pickRandomCarId(() => 0)).toBe(keys[0]);
    expect(pickRandomCarId(() => 0.99)).toBe(keys[keys.length - 1]);
  });
});

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
