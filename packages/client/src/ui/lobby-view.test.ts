import { describe, expect, it } from "vitest";
import { GameMode, MAX_TEAM_SIZE, PlayerStatus } from "@motor-combat-moba/shared";
import { lobbyView, TEAM_SLOTS } from "./lobby-view.js";

const player = (over: Partial<LobbyTestPlayer> = {}): LobbyTestPlayer => ({
  sessionId: "p1",
  name: "Vex",
  colorId: 0,
  team: 0,
  status: PlayerStatus.READY,
  ...over,
});

type LobbyTestPlayer = {
  sessionId: string;
  name: string;
  colorId: number;
  team: number;
  status: PlayerStatus;
};

const state = (players: LobbyTestPlayer[], over: Partial<{ mode: GameMode; hostSessionId: string }> = {}) => ({
  mode: GameMode.TEAM,
  hostSessionId: "p1",
  players,
  ...over,
});

describe("lobbyView", () => {
  it("splits players into the two team columns", () => {
    const view = lobbyView(
      state([player({ sessionId: "p1", team: 0 }), player({ sessionId: "p2", name: "Nyx", team: 1 })]),
      "p1",
      "",
    );
    expect(view.teamA.filter((s) => s.filled).map((s) => s.name)).toEqual(["Vex"]);
    expect(view.teamB.filter((s) => s.filled).map((s) => s.name)).toEqual(["Nyx"]);
  });

  it("pads each column to TEAM_SLOTS with open slots", () => {
    const view = lobbyView(state([player()]), "p1", "");
    expect(view.teamA).toHaveLength(TEAM_SLOTS);
    expect(view.teamB).toHaveLength(TEAM_SLOTS);
    expect(view.teamA[1]?.filled).toBe(false);
    expect(view.teamA[1]?.name).toBe("Open slot");
  });

  it("pads to the cap the server enforces", () => {
    expect(TEAM_SLOTS).toBe(MAX_TEAM_SIZE);
  });

  it("grows past the padding rather than dropping players", () => {
    const crowded = Array.from({ length: 5 }, (_, i) =>
      player({ sessionId: `p${i}`, name: `P${i}`, team: 0 }),
    );
    const view = lobbyView(state(crowded), "p0", "");
    expect(view.teamA).toHaveLength(5);
    expect(view.teamA.every((s) => s.filled)).toBe(true);
  });

  it("marks the host row and only the host row", () => {
    const view = lobbyView(
      state([player({ sessionId: "p1" }), player({ sessionId: "p2", name: "Nyx", team: 1 })]),
      "p2",
      "",
    );
    expect(view.teamA[0]?.isHostRow).toBe(true);
    expect(view.teamB[0]?.isHostRow).toBe(false);
  });

  it("marks the local player's own row", () => {
    const view = lobbyView(
      state([player({ sessionId: "p1" }), player({ sessionId: "p2", name: "Nyx", team: 1 })]),
      "p2",
      "",
    );
    expect(view.teamA[0]?.isYou).toBe(false);
    expect(view.teamB[0]?.isYou).toBe(true);
  });

  it("offers kick to the host on everyone but themselves", () => {
    const view = lobbyView(
      state([player({ sessionId: "p1" }), player({ sessionId: "p2", name: "Nyx", team: 1 })]),
      "p1",
      "",
    );
    expect(view.teamA[0]?.canKick).toBe(false);
    expect(view.teamB[0]?.canKick).toBe(true);
  });

  it("never offers kick to a guest", () => {
    const view = lobbyView(
      state([player({ sessionId: "p1" }), player({ sessionId: "p2", name: "Nyx", team: 1 })]),
      "p2",
      "",
    );
    expect(view.teamA[0]?.canKick).toBe(false);
    expect(view.teamB[0]?.canKick).toBe(false);
  });

  it("refuses a kick on a player who is mid-match", () => {
    const view = lobbyView(
      state([
        player({ sessionId: "p1" }),
        player({ sessionId: "p2", name: "Nyx", team: 1, status: PlayerStatus.IN_MATCH }),
      ]),
      "p1",
      "",
    );
    expect(view.teamB[0]?.canKick).toBe(false);
  });

  it("disables the switch when the destination team is full", () => {
    const full = Array.from({ length: MAX_TEAM_SIZE }, (_, i) =>
      player({ sessionId: `b${i}`, name: `B${i}`, team: 1 }),
    );
    const view = lobbyView(state([player({ sessionId: "p1", team: 0 }), ...full]), "p1", "");
    expect(view.canSwitchTeam).toBe(false);
  });

  it("allows the switch when the destination has room", () => {
    const view = lobbyView(
      state([player({ sessionId: "p1", team: 0 }), player({ sessionId: "p2", name: "Nyx", team: 1 })]),
      "p1",
      "",
    );
    expect(view.canSwitchTeam).toBe(true);
  });

  it("labels mode and player count", () => {
    const view = lobbyView(state([player()], { mode: GameMode.FFA }), "p1", "");
    expect(view.modeLabel).toBe("Brawl");
    expect(view.countLabel).toBe("1 / 6 players");
    expect(view.teamACount).toBe(`1 / ${MAX_TEAM_SIZE}`);
  });

  it("carries the start error through untouched", () => {
    const view = lobbyView(state([player()]), "p1", "Teams must be equal to start");
    expect(view.startError).toBe("Teams must be equal to start");
  });

  it("falls back to the session id when a name is empty", () => {
    const view = lobbyView(state([player({ name: "" })]), "p1", "");
    expect(view.teamA[0]?.name).toBe("p1");
  });
});
