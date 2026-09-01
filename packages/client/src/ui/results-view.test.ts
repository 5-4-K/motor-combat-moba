import { describe, expect, it } from "vitest";
import { GameMode, PlayerStatus, TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { durationLabel, resultsView } from "./results-view.js";

const roster = [
  { sessionId: "p1", name: "Vex", colorId: 0, team: 0, carId: "mirage", status: PlayerStatus.POST_MATCH },
  { sessionId: "p2", name: "Nyx", colorId: 2, team: 1, carId: "bullseye", status: PlayerStatus.POST_MATCH },
];

const state = (over = {}) => ({
  mode: GameMode.TEAM,
  winnerSessionId: "",
  winnerTeam: 0,
  tick: 0,
  matchStartedAtTick: 0,
  players: roster,
  ...over,
});

describe("durationLabel", () => {
  it("formats whole minutes and seconds", () => {
    expect(durationLabel(0, 222 * TICK_RATE_HZ)).toBe("3:42");
  });

  it("pads seconds to two digits", () => {
    expect(durationLabel(0, 65 * TICK_RATE_HZ)).toBe("1:05");
  });

  it("counts from the match start, not from tick zero", () => {
    expect(durationLabel(100 * TICK_RATE_HZ, 160 * TICK_RATE_HZ)).toBe("1:00");
  });

  it("floors a part-second rather than rounding up", () => {
    expect(durationLabel(0, 59 * TICK_RATE_HZ + TICK_RATE_HZ - 1)).toBe("0:59");
  });

  it("never renders a negative clock when the start stamp is missing", () => {
    expect(durationLabel(500, 0)).toBe("0:00");
  });
});

describe("resultsView", () => {
  it("names the winning player in Brawl", () => {
    const view = resultsView(state({ mode: GameMode.FFA_LAST_STANDING, winnerSessionId: "p1" }), "p1");
    expect(view.winnerLabel).toBe("Vex wins");
  });

  it("names the winning team in Team brawl", () => {
    expect(resultsView(state({ winnerTeam: 1 }), "p1").winnerLabel).toBe("Team B wins");
    expect(resultsView(state({ winnerTeam: 0 }), "p1").winnerLabel).toBe("Team A wins");
  });

  it("falls back to a draw when nobody won", () => {
    const view = resultsView(state({ winnerTeam: -1, winnerSessionId: "" }), "p1");
    expect(view.winnerLabel).toBe("Draw");
  });

  it("splits stat rows by team", () => {
    const view = resultsView(state(), "p1");
    expect(view.statsA.map((r) => r.name)).toEqual(["Vex"]);
    expect(view.statsB.map((r) => r.name)).toEqual(["Nyx"]);
  });

  it("reports zeroed K/D/A until the sim attributes kills", () => {
    const row = resultsView(state(), "p1").statsA[0];
    expect([row?.k, row?.d, row?.a]).toEqual([0, 0, 0]);
  });

  it("points each row at its car art", () => {
    expect(resultsView(state(), "p1").statsA[0]?.carImage).toBe('url("art/cars/mirage.png")');
  });

  it("marks the local player's row so it can be tinted", () => {
    const view = resultsView(state(), "p2");
    expect(view.statsA[0]?.isYou).toBe(false);
    expect(view.statsB[0]?.isYou).toBe(true);
  });

  it("omits players who never entered the match", () => {
    const withSpectator = [...roster, {
      sessionId: "p3", name: "Rune", colorId: 3, team: 0, carId: "", status: PlayerStatus.READY,
    }];
    const view = resultsView(state({ players: withSpectator }), "p1");
    expect(view.statsA.map((r) => r.name)).toEqual(["Vex"]);
  });
});
