import { describe, expect, it } from "vitest";
import { livingSides } from "./win.js";

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
