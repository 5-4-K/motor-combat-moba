import { describe, expect, it } from "vitest";
import {
  ArenaState,
  GameMode,
  PlayerState,
  derived,
  modeConfigOf,
  withMode,
} from "@motor-combat-moba/shared";
import { DEATHMATCH_CONTROLLER } from "./controller.js";
import type { ModeRoomView } from "../types.js";

function stateWith(
  players: readonly { sessionId: string; kills: number; deaths: number }[],
): { state: ArenaState; roster: Set<string> } {
  const state = new ArenaState();
  state.mode = GameMode.FFA_DEATHMATCH;
  const roster = new Set<string>();
  for (const p of players) {
    const player = new PlayerState();
    player.sessionId = p.sessionId;
    player.kills = p.kills;
    player.deaths = p.deaths;
    state.players.set(p.sessionId, player);
    roster.add(p.sessionId);
  }
  return { state, roster };
}

function viewOf(built: { state: ArenaState; roster: Set<string> }): ModeRoomView {
  return { state: built.state, roster: built.roster };
}

describe("DEATHMATCH_CONTROLLER", () => {
  it("onMatchStart stamps matchEndsTick = tick + derived().deathmatchTicks.match", () => {
    const built = stateWith([]);
    built.state.tick = 500;
    withMode(modeConfigOf(GameMode.FFA_DEATHMATCH), () => {
      DEATHMATCH_CONTROLLER.onMatchStart(viewOf(built));
    });
    withMode(modeConfigOf(GameMode.FFA_DEATHMATCH), () => {
      expect(built.state.matchEndsTick).toBe(500 + derived().deathmatchTicks.match);
    });
  });

  it("onStartRequested leaves zone fields untouched", () => {
    const built = stateWith([]);
    built.state.controlTicksA = 5;
    built.state.zoneHolder = 1;
    withMode(modeConfigOf(GameMode.FFA_DEATHMATCH), () => {
      DEATHMATCH_CONTROLLER.onStartRequested(viewOf(built));
    });
    expect(built.state).toMatchObject({ controlTicksA: 5, zoneHolder: 1 });
  });

  it("before matchEndsTick with 2+ roster players is not over", () => {
    const built = stateWith([
      { sessionId: "a", kills: 1, deaths: 0 },
      { sessionId: "b", kills: 0, deaths: 1 },
    ]);
    built.state.tick = 10;
    built.state.matchEndsTick = 1000;
    const outcome = withMode(modeConfigOf(GameMode.FFA_DEATHMATCH), () =>
      DEATHMATCH_CONTROLLER.afterTick(viewOf(built), []),
    );
    expect(outcome).toBeUndefined();
  });

  it("at matchEndsTick, highest kills wins", () => {
    const built = stateWith([
      { sessionId: "a", kills: 5, deaths: 2 },
      { sessionId: "b", kills: 3, deaths: 1 },
    ]);
    built.state.tick = 1000;
    built.state.matchEndsTick = 1000;
    const outcome = withMode(modeConfigOf(GameMode.FFA_DEATHMATCH), () =>
      DEATHMATCH_CONTROLLER.afterTick(viewOf(built), []),
    );
    expect(outcome).toStrictEqual({ winnerSessionId: "a", winnerTeam: -1 });
  });

  it("afterLeave with 1 roster player left ends the match", () => {
    const built = stateWith([{ sessionId: "a", kills: 2, deaths: 0 }]);
    built.state.tick = 10;
    built.state.matchEndsTick = 1000;
    const outcome = withMode(modeConfigOf(GameMode.FFA_DEATHMATCH), () =>
      DEATHMATCH_CONTROLLER.afterLeave(viewOf(built)),
    );
    expect(outcome).toStrictEqual({ winnerSessionId: "a", winnerTeam: -1 });
  });
});
