import { describe, expect, it } from "vitest";
import {
  ArenaState,
  GameMode,
  PlayerState,
  derived,
  getArena,
  modeConfigOf,
  withMode,
} from "@motor-combat-moba/shared";
import { CONQUER_CONTROLLER } from "./controller.js";
import type { ModeRoomView } from "../types.js";

function stateWith(
  players: readonly { sessionId: string; team: 0 | 1; x: number; y: number; alive?: boolean }[],
): { state: ArenaState; roster: Set<string> } {
  const state = new ArenaState();
  state.mode = GameMode.CONQUER;
  state.arenaId = modeConfigOf(GameMode.CONQUER).arenas[0];
  const roster = new Set<string>();
  for (const p of players) {
    const player = new PlayerState();
    player.sessionId = p.sessionId;
    player.team = p.team;
    player.x = p.x;
    player.y = p.y;
    player.alive = p.alive ?? true;
    state.players.set(p.sessionId, player);
    roster.add(p.sessionId);
  }
  return { state, roster };
}

function viewOf(built: { state: ArenaState; roster: Set<string> }): ModeRoomView {
  return { state: built.state, roster: built.roster };
}

describe("CONQUER_CONTROLLER", () => {
  it("onMatchStart resets zone fields and stamps the clock", () => {
    const built = stateWith([]);
    built.state.tick = 20;
    built.state.controlTicksA = 5;
    built.state.zoneHolder = 1;
    built.state.zoneStreakTicks = 2;
    built.state.zoneContested = true;
    built.state.overtime = true;
    withMode(modeConfigOf(GameMode.CONQUER), () => {
      CONQUER_CONTROLLER.onMatchStart(viewOf(built));
    });
    withMode(modeConfigOf(GameMode.CONQUER), () => {
      expect(built.state.matchEndsTick).toBe(20 + derived().deathmatchTicks.match);
    });
    expect(built.state).toMatchObject({
      controlTicksA: 0,
      controlTicksB: 0,
      zoneHolder: -1,
      zoneStreakTicks: 0,
      zoneContested: false,
      overtime: false,
    });
  });

  it("onStartRequested resets the zone fields", () => {
    const built = stateWith([]);
    built.state.controlTicksA = 5;
    built.state.controlTicksB = 3;
    built.state.zoneHolder = 1;
    built.state.zoneStreakTicks = 2;
    built.state.zoneContested = true;
    built.state.overtime = true;
    withMode(modeConfigOf(GameMode.CONQUER), () => {
      CONQUER_CONTROLLER.onStartRequested(viewOf(built));
    });
    expect(built.state).toMatchObject({
      controlTicksA: 0,
      controlTicksB: 0,
      zoneHolder: -1,
      zoneStreakTicks: 0,
      zoneContested: false,
      overtime: false,
    });
  });

  it("one team-0 car in the zone for the capture delay then the control target wins team 0", () => {
    const arena = getArena(modeConfigOf(GameMode.CONQUER).arenas[0]);
    const zone = arena.zone!;
    const built = stateWith([{ sessionId: "a", team: 0, x: zone.x, y: zone.y }]);
    built.state.matchEndsTick = 1_000_000;
    withMode(modeConfigOf(GameMode.CONQUER), () => {
      const ticks = derived().conquerTicks;
      const total = ticks.captureDelay + ticks.controlTarget;
      let outcome: ReturnType<typeof CONQUER_CONTROLLER.afterTick> | undefined;
      for (let i = 0; i < total; i++) {
        built.state.tick += 1;
        outcome = CONQUER_CONTROLLER.afterTick(viewOf(built), []);
        if (outcome) break;
      }
      expect(outcome).toStrictEqual({ winnerSessionId: "", winnerTeam: 0 });
    });
  });

  it("afterLeave with team 1 emptied ends with team 0 as winner", () => {
    const built = stateWith([{ sessionId: "a", team: 0, x: 0, y: 0 }]);
    const outcome = withMode(modeConfigOf(GameMode.CONQUER), () =>
      CONQUER_CONTROLLER.afterLeave(viewOf(built)),
    );
    expect(outcome).toStrictEqual({ winnerSessionId: "", winnerTeam: 0 });
  });
});
