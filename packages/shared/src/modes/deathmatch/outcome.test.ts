import { describe, expect, it } from "vitest";
import { deathmatchEnded, deathmatchOutcome } from "./outcome.js";

describe("deathmatchOutcome", () => {
  const p = (sessionId: string, kills: number, deaths: number, inRoster = true) => ({
    sessionId, kills, deaths, inRoster,
  });

  it("gives it to the most kills", () => {
    expect(deathmatchOutcome([p("a", 3, 5), p("b", 7, 1)]).winnerSessionId).toBe("b");
  });

  it("breaks a kill tie on fewest deaths", () => {
    expect(deathmatchOutcome([p("a", 5, 4), p("b", 5, 2)]).winnerSessionId).toBe("b");
  });

  it("declares a shared win when the top two match on both", () => {
    const result = deathmatchOutcome([p("a", 5, 2), p("b", 5, 2)]);
    expect(result.winnerSessionId).toBe("");
    expect(result.winnerTeam).toBe(-1);
  });

  it("ignores players who are not on the roster", () => {
    expect(deathmatchOutcome([p("a", 1, 0), p("spec", 99, 0, false)]).winnerSessionId).toBe("a");
  });

  it("counts a dead-last player, because deathmatch has no elimination", () => {
    expect(deathmatchOutcome([p("a", 0, 9)]).winnerSessionId).toBe("a");
  });

  it("draws on an empty roster rather than throwing", () => {
    expect(deathmatchOutcome([]).winnerSessionId).toBe("");
  });
});

describe("deathmatchEnded", () => {
  it("ends on the clock", () => {
    expect(deathmatchEnded(4, 899, 900)).toBe(false);
    expect(deathmatchEnded(4, 900, 900)).toBe(true);
  });

  it("ends early once there is nobody left to fight", () => {
    expect(deathmatchEnded(1, 10, 900)).toBe(true);
    expect(deathmatchEnded(0, 10, 900)).toBe(true);
  });

  it("never ends a mode that has no clock, however long it runs", () => {
    // `matchEndsTick` is 0 outside deathmatch, and 0 must not read as "already past the end".
    expect(deathmatchEnded(4, 5000, 0)).toBe(false);
  });
});
