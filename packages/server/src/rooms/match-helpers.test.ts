import { describe, expect, it } from "vitest";
import { CAR_TABLE } from "@motor-arena/shared";
import {
  copySpawnNumbers,
  firstAliveRosterWinner,
  isCarId,
  livingAfterLeave,
  pickRandomCarId,
} from "./match-helpers.js";

describe("isCarId", () => {
  it("accepts CAR_TABLE keys and rejects unknown ids", () => {
    expect(isCarId("rectangle")).toBe(true);
    expect(isCarId("oval")).toBe(true);
    expect(isCarId("hexagon")).toBe(true);
    expect(isCarId("triangle")).toBe(false);
    expect(isCarId("")).toBe(false);
    expect(isCarId(1)).toBe(false);
  });
});

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

describe("firstAliveRosterWinner", () => {
  const players = new Map([
    ["b", { alive: true, team: 1 }],
    ["a", { alive: false, team: 0 }],
    ["c", { alive: true, team: 0 }],
  ]);

  it("FFA: names the first alive roster player and leaves winnerTeam at -1", () => {
    expect(firstAliveRosterWinner("ffa", ["a", "b", "c"], players)).toEqual({
      sessionId: "b",
      winnerTeam: -1,
    });
  });

  it("TEAM: awards that player's team and leaves winnerSessionId empty", () => {
    expect(firstAliveRosterWinner("team", ["a", "b", "c"], players)).toEqual({
      sessionId: "",
      winnerTeam: 1,
    });
  });

  it("returns empty winner when nobody on the roster is alive", () => {
    const none = new Map([["a", { alive: false, team: 0 }]]);
    expect(firstAliveRosterWinner("ffa", ["a"], none)).toEqual({
      sessionId: "",
      winnerTeam: -1,
    });
    expect(firstAliveRosterWinner("team", ["a"], none)).toEqual({
      sessionId: "",
      winnerTeam: -1,
    });
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
