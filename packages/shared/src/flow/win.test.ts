import { describe, expect, it } from "vitest";
import { deathmatchOutcome, livingSides } from "./win.js";

const a = { sessionId: "a", team: 0 as const, alive: true, inRoster: true };
const b = { sessionId: "b", team: 1 as const, alive: true, inRoster: true };
const c = { sessionId: "c", team: 0 as const, alive: true, inRoster: true };

describe("livingSides FFA", () => {
  it("counts living roster members as sides", () => {
    expect(livingSides("ffa", [a, b, { ...c, alive: false }])).toEqual({
      sides: 2,
      winnerSessionId: "",
      winnerTeam: -1,
    });
  });

  it("names the last living roster player as winner", () => {
    expect(livingSides("ffa", [a, { ...b, alive: false }])).toEqual({
      sides: 1,
      winnerSessionId: "a",
      winnerTeam: -1,
    });
  });

  it("is a draw when nobody living remains", () => {
    expect(
      livingSides("ffa", [
        { ...a, alive: false },
        { ...b, alive: false },
      ]),
    ).toEqual({
      sides: 0,
      winnerSessionId: "",
      winnerTeam: -1,
    });
  });

  it("ignores spectators and players not on the roster", () => {
    expect(
      livingSides("ffa", [
        a,
        { sessionId: "spec", team: 1, alive: true, inRoster: false },
      ]),
    ).toEqual({
      sides: 1,
      winnerSessionId: "a",
      winnerTeam: -1,
    });
  });
});

describe("livingSides TEAM", () => {
  it("counts teams with at least one living roster member", () => {
    expect(livingSides("team", [a, b, c])).toEqual({
      sides: 2,
      winnerSessionId: "",
      winnerTeam: -1,
    });
  });

  it("awards the remaining team when the other is eliminated", () => {
    expect(
      livingSides("team", [
        a,
        c,
        { ...b, alive: false },
      ]),
    ).toEqual({
      sides: 1,
      winnerSessionId: "",
      winnerTeam: 0,
    });
  });

  it("is a draw when no team has a living roster member", () => {
    expect(
      livingSides("team", [
        { ...a, alive: false },
        { ...b, alive: false },
      ]),
    ).toEqual({
      sides: 0,
      winnerSessionId: "",
      winnerTeam: -1,
    });
  });

  it("does not count a living spectator as a team side", () => {
    expect(
      livingSides("team", [
        a,
        { sessionId: "spec", team: 1, alive: true, inRoster: false },
      ]),
    ).toEqual({
      sides: 1,
      winnerSessionId: "",
      winnerTeam: 0,
    });
  });
});

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
