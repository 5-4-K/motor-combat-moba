import { describe, expect, it } from "vitest";
import {
  ArenaState,
  GameMode,
  PlayerState,
  modeConfigOf,
  withMode,
} from "@motor-combat-moba/shared";
import { LAST_STANDING_CONTROLLER } from "./controller.js";
import type { ModeRoomView } from "../types.js";

function stateWith(
  mode: GameMode,
  players: readonly { sessionId: string; team: 0 | 1; alive: boolean }[],
): { state: ArenaState; roster: Set<string> } {
  const state = new ArenaState();
  state.mode = mode;
  const roster = new Set<string>();
  for (const p of players) {
    const player = new PlayerState();
    player.sessionId = p.sessionId;
    player.team = p.team;
    player.alive = p.alive;
    state.players.set(p.sessionId, player);
    roster.add(p.sessionId);
  }
  return { state, roster };
}

function viewOf(built: { state: ArenaState; roster: Set<string> }): ModeRoomView {
  return { state: built.state, roster: built.roster };
}

describe("LAST_STANDING_CONTROLLER (FFA)", () => {
  it("onMatchStart clears matchEndsTick", () => {
    const built = stateWith(GameMode.FFA_LAST_STANDING, []);
    built.state.matchEndsTick = 999;
    withMode(modeConfigOf(GameMode.FFA_LAST_STANDING), () => {
      LAST_STANDING_CONTROLLER.onMatchStart(viewOf(built));
    });
    expect(built.state.matchEndsTick).toBe(0);
  });

  it("2 dead of 3 roster ends with the survivor as winner", () => {
    const built = stateWith(GameMode.FFA_LAST_STANDING, [
      { sessionId: "a", team: 0, alive: true },
      { sessionId: "b", team: 0, alive: false },
      { sessionId: "c", team: 1, alive: false },
    ]);
    const outcome = withMode(modeConfigOf(GameMode.FFA_LAST_STANDING), () =>
      LAST_STANDING_CONTROLLER.afterTick(
        viewOf(built),
        [...built.state.players.values()].map((p) => ({
          sessionId: p.sessionId,
          team: p.team as 0 | 1,
          alive: p.alive,
          inRoster: true,
        })),
      ),
    );
    expect(outcome).toStrictEqual({ winnerSessionId: "a", winnerTeam: -1 });
  });

  it("all dead is a draw", () => {
    const built = stateWith(GameMode.FFA_LAST_STANDING, [
      { sessionId: "a", team: 0, alive: false },
      { sessionId: "b", team: 0, alive: false },
    ]);
    const outcome = withMode(modeConfigOf(GameMode.FFA_LAST_STANDING), () =>
      LAST_STANDING_CONTROLLER.afterTick(
        viewOf(built),
        [...built.state.players.values()].map((p) => ({
          sessionId: p.sessionId,
          team: p.team as 0 | 1,
          alive: p.alive,
          inRoster: true,
        })),
      ),
    );
    expect(outcome).toStrictEqual({ winnerSessionId: "", winnerTeam: -1 });
  });

  it("2 alive is not over yet", () => {
    const built = stateWith(GameMode.FFA_LAST_STANDING, [
      { sessionId: "a", team: 0, alive: true },
      { sessionId: "b", team: 1, alive: true },
    ]);
    const outcome = withMode(modeConfigOf(GameMode.FFA_LAST_STANDING), () =>
      LAST_STANDING_CONTROLLER.afterTick(
        viewOf(built),
        [...built.state.players.values()].map((p) => ({
          sessionId: p.sessionId,
          team: p.team as 0 | 1,
          alive: p.alive,
          inRoster: true,
        })),
      ),
    );
    expect(outcome).toBeUndefined();
  });

  it("afterLeave: 2-player ffa, one leaves, the remaining player wins", () => {
    const built = stateWith(GameMode.FFA_LAST_STANDING, [{ sessionId: "a", team: 0, alive: true }]);
    // "b" left already: removed from both players and roster before the controller runs, exactly
    // as ArenaRoom.onLeave does before calling afterLeave.
    const outcome = withMode(modeConfigOf(GameMode.FFA_LAST_STANDING), () =>
      LAST_STANDING_CONTROLLER.afterLeave(viewOf(built)),
    );
    expect(outcome).toStrictEqual({ winnerSessionId: "a", winnerTeam: -1 });
  });
});

describe("LAST_STANDING_CONTROLLER (Team)", () => {
  it("team 1 all dead ends with team 0 as winner", () => {
    const built = stateWith(GameMode.TEAM, [
      { sessionId: "a", team: 0, alive: true },
      { sessionId: "b", team: 1, alive: false },
      { sessionId: "c", team: 1, alive: false },
    ]);
    const outcome = withMode(modeConfigOf(GameMode.TEAM), () =>
      LAST_STANDING_CONTROLLER.afterTick(
        viewOf(built),
        [...built.state.players.values()].map((p) => ({
          sessionId: p.sessionId,
          team: p.team as 0 | 1,
          alive: p.alive,
          inRoster: true,
        })),
      ),
    );
    expect(outcome).toStrictEqual({ winnerSessionId: "", winnerTeam: 0 });
  });
});
