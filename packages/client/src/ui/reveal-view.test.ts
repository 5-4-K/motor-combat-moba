import { describe, expect, it } from "vitest";
import { GameMode, PlayerStatus, TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { REVEAL_SLOTS, revealView, secondsLeft } from "./reveal-view.js";

const p = (sessionId: string, team: number, carId = "mirage") => ({
  sessionId,
  name: sessionId,
  colorId: 0,
  team,
  carId,
  status: PlayerStatus.IN_MATCH,
});

const state = (players: ReturnType<typeof p>[], over = {}) => ({
  mode: GameMode.TEAM,
  hostSessionId: "a1",
  tick: 0,
  revealEndsTick: 10 * TICK_RATE_HZ,
  players,
  ...over,
});

describe("secondsLeft", () => {
  it("counts whole seconds remaining, rounding up so 10s shows as 10", () => {
    expect(secondsLeft(10 * TICK_RATE_HZ, 0)).toBe(10);
  });

  it("reaches zero exactly at the deadline", () => {
    expect(secondsLeft(300, 300)).toBe(0);
  });

  it("never goes negative past the deadline", () => {
    expect(secondsLeft(300, 400)).toBe(0);
  });
});

describe("revealView — team brawl", () => {
  it("titles the panels and shows occupancy", () => {
    const view = revealView(state([p("a1", 0), p("b1", 1)]), "a1");
    expect(view.showTeamHeadings).toBe(true);
    expect(view.panelA.title).toBe("Team A");
    expect(view.panelB.title).toBe("Team B");
    expect(view.panelA.count).toBe(`1 / ${REVEAL_SLOTS}`);
  });

  it("splits by the player's team", () => {
    const view = revealView(state([p("a1", 0), p("a2", 0), p("b1", 1)]), "a1");
    expect(view.panelA.rows.filter((r) => r.filled).map((r) => r.name)).toEqual(["a1", "a2"]);
    expect(view.panelB.rows.filter((r) => r.filled).map((r) => r.name)).toEqual(["b1"]);
  });
});

describe("revealView — brawl", () => {
  const brawl = (players: ReturnType<typeof p>[]) =>
    revealView(state(players, { mode: GameMode.FFA }), "a1");

  it("drops the team headings and occupancy entirely", () => {
    const view = brawl([p("a1", 0), p("b1", 1)]);
    expect(view.showTeamHeadings).toBe(false);
    expect(view.panelA.title).toBe("");
    expect(view.panelA.count).toBe("");
    expect(view.panelB.title).toBe("");
  });

  it("ignores team and splits the roster three and three", () => {
    // Every player on team 0 — in Brawl the schema's team is meaningless.
    const six = ["p1", "p2", "p3", "p4", "p5", "p6"].map((id) => p(id, 0));
    const view = brawl(six);
    expect(view.panelA.rows.map((r) => r.name)).toEqual(["p1", "p2", "p3"]);
    expect(view.panelB.rows.map((r) => r.name)).toEqual(["p4", "p5", "p6"]);
  });

  it("fills the first panel before the second", () => {
    const view = brawl([p("p1", 1), p("p2", 1), p("p3", 1), p("p4", 1)]);
    expect(view.panelA.rows.filter((r) => r.filled)).toHaveLength(3);
    expect(view.panelB.rows.filter((r) => r.filled).map((r) => r.name)).toEqual(["p4"]);
  });
});

describe("revealView — rows", () => {
  it("pads each panel to REVEAL_SLOTS with driverless rows", () => {
    const view = revealView(state([p("a1", 0)]), "a1");
    expect(view.panelA.rows).toHaveLength(REVEAL_SLOTS);
    expect(view.panelA.rows[1]?.filled).toBe(false);
    expect(view.panelA.rows[1]?.name).toBe("No driver");
    expect(view.panelA.rows[1]?.carImage).toBe("");
  });

  it("grows past the padding rather than hiding a player", () => {
    const four = [p("a1", 0), p("a2", 0), p("a3", 0), p("a4", 0)];
    const view = revealView(state(four), "a1");
    expect(view.panelA.rows).toHaveLength(4);
  });

  it("marks the host row and the local row independently", () => {
    const view = revealView(state([p("a1", 0), p("b1", 1)]), "b1");
    expect(view.panelA.rows[0]?.isHostRow).toBe(true);
    expect(view.panelA.rows[0]?.isYou).toBe(false);
    expect(view.panelB.rows[0]?.isHostRow).toBe(false);
    expect(view.panelB.rows[0]?.isYou).toBe(true);
  });

  it("points each row at the car that player locked in", () => {
    const view = revealView(state([p("a1", 0, "bastion")]), "a1");
    expect(view.panelA.rows[0]?.carImage).toBe('url("art/cars/bastion.png")');
  });

  it("omits players who are not in the match", () => {
    const spectator = { ...p("s1", 0), status: PlayerStatus.READY };
    const view = revealView(state([p("a1", 0), spectator]), "a1");
    expect(view.panelA.rows.filter((r) => r.filled).map((r) => r.name)).toEqual(["a1"]);
  });

  it("labels the countdown and flags the final three seconds", () => {
    expect(revealView(state([p("a1", 0)]), "a1").urgent).toBe(false);
    const late = revealView(state([p("a1", 0)], { tick: 8 * TICK_RATE_HZ }), "a1");
    expect(late.secondsLeft).toBe(2);
    expect(late.urgent).toBe(true);
  });

  it("counts every driver, both panels, in the header pill", () => {
    const view = revealView(state([p("a1", 0), p("b1", 1)]), "a1");
    expect(view.countLabel).toBe("2 / 6 players");
  });
});
