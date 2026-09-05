import { describe, expect, it } from "vitest";
import { activeGameModes, GameMode, MAX_TEAM_SIZE, MODE_TABLE, PlayerStatus } from "@motor-combat-moba/shared";
import { lobbyView, modeCards, modeLabel, TEAM_SLOTS } from "./lobby-view.js";

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

  it("is allReady when every seated player is PlayerStatus.READY", () => {
    const view = lobbyView(
      state([player({ sessionId: "p1" }), player({ sessionId: "p2", name: "Nyx", team: 1 })]),
      "p1",
      "",
    );
    expect(view.allReady).toBe(true);
  });

  it("is not allReady when a seated player is mid-match or post-match", () => {
    const inMatch = lobbyView(
      state([
        player({ sessionId: "p1" }),
        player({ sessionId: "p2", name: "Nyx", team: 1, status: PlayerStatus.IN_MATCH }),
      ]),
      "p1",
      "",
    );
    expect(inMatch.allReady).toBe(false);

    const postMatch = lobbyView(
      state([
        player({ sessionId: "p1" }),
        player({ sessionId: "p2", name: "Nyx", team: 1, status: PlayerStatus.POST_MATCH }),
      ]),
      "p1",
      "",
    );
    expect(postMatch.allReady).toBe(false);
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
    const view = lobbyView(state([player()], { mode: GameMode.FFA_LAST_STANDING }), "p1", "");
    expect(view.modeLabel).toBe("Brawl");
    expect(view.countLabel).toBe("1 / 6 players");
  });

  it("heads the columns Team A and Team B only in Team brawl", () => {
    const view = lobbyView(state([player()], { mode: GameMode.TEAM }), "p1", "");
    expect(view.showTeamHeadings).toBe(true);
    expect(view.teamACount).toBe(`1 / ${MAX_TEAM_SIZE}`);
    expect(view.teamBCount).toBe(`0 / ${MAX_TEAM_SIZE}`);
  });

  /**
   * Brawl has no teams — `targets.ts` calls every car hostile and `spawns.ts` never reads `team` —
   * so heading the columns "Team A" and "Team B" named a division the mode does not have. The
   * occupancy goes with the heading: "1 / 3" counts seats on a team nobody is on.
   */
  it("drops the team headings and their occupancy in Brawl", () => {
    const view = lobbyView(state([player()], { mode: GameMode.FFA_LAST_STANDING }), "p1", "");
    expect(view.showTeamHeadings).toBe(false);
    expect(view.teamACount).toBe("");
    expect(view.teamBCount).toBe("");
  });

  /**
   * The columns still split on `team` in Brawl, because `pickTeam` runs in every mode and keeps
   * them even. Losing the headings must not lose the seats — a player seated on team 1 belongs in
   * the right-hand column whether or not that column is called anything.
   */
  it("still seats players across both columns in Brawl", () => {
    const view = lobbyView(
      state([player(), player({ sessionId: "p2", team: 1 })], { mode: GameMode.FFA_LAST_STANDING }),
      "p1",
      "",
    );
    expect(view.teamA.filter((s) => s.filled).map((s) => s.sessionId)).toEqual(["p1"]);
    expect(view.teamB.filter((s) => s.filled).map((s) => s.sessionId)).toEqual(["p2"]);
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

describe("modeLabel", () => {
  it("names all three modes distinctly", () => {
    expect(modeLabel(GameMode.FFA_LAST_STANDING)).toBe("Brawl");
    expect(modeLabel(GameMode.TEAM)).toBe("Team brawl");
    expect(modeLabel(GameMode.FFA_DEATHMATCH)).toBe("Deathmatch");
  });

  it("reads names from MODE_TABLE, so a rename cannot leave the tag behind", () => {
    expect(modeLabel(GameMode.FFA_LAST_STANDING)).toBe(MODE_TABLE[GameMode.FFA_LAST_STANDING].name);
    expect(modeLabel(GameMode.TEAM)).toBe(MODE_TABLE[GameMode.TEAM].name);
    expect(modeLabel(GameMode.FFA_DEATHMATCH)).toBe(MODE_TABLE[GameMode.FFA_DEATHMATCH].name);
  });
});

describe("mode picker", () => {
  it("offers only active modes, in activeGameModes order", () => {
    expect(modeCards().map((c) => c.id)).toEqual(activeGameModes());
  });

  it("shows the Game modes menu only when there is a second mode to pick", () => {
    const view = lobbyView(state([player()]), "p1", "");
    expect(view.canChangeMode).toBe(activeGameModes().length >= 2);
  });
});
