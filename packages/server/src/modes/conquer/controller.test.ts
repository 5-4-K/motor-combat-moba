import { describe, expect, it } from "vitest";
import {
  ArenaState,
  ARENA_03,
  GameMode,
  PlayerState,
  carHullOf,
  derived,
  getArena,
  modeConfigOf,
  withMode,
  zoneCentreOf,
  zoneCoreOf,
  zonePresence,
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
    const centre = zoneCentreOf(arena.zone!.rects);
    const built = stateWith([{ sessionId: "a", team: 0, x: centre.x, y: centre.y }]);
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

describe("zone edge inset on the real map (CT8)", () => {
  // Bottom row's bottom edge, y 1320, x 600..760 (away from steps); the car approaches from below.
  const EDGE_Y = 1320;
  const present = (x: number, y: number, angle: number): number => {
    return withMode(modeConfigOf(GameMode.CONQUER), () => {
      const core = zoneCoreOf(ARENA_03.zone!.rects, 20);
      const hull = carHullOf(x, y, angle);
      return zonePresence(core, [{ hull, team: 0, alive: true, inRoster: true }])[0];
    });
  };

  it("a nose-first car counts at 21 u onto the metal edge, not at 19 u", () => {
    // Heading up (-pi/2): the 60 u long axis is vertical, the nose is the hull's top edge.
    const centreY = (depth: number): number => EDGE_Y - depth + 30;
    expect(present(680, centreY(19), -Math.PI / 2)).toBe(0);
    expect(present(680, centreY(21), -Math.PI / 2)).toBe(1);
  });

  it("a side-first car counts at 21 u onto the metal edge, not at 19 u", () => {
    // Heading +x: the 40 u short axis is vertical, so the hull's side is the top edge.
    const centreY = (depth: number): number => EDGE_Y - depth + 20;
    expect(present(680, centreY(19), 0)).toBe(0);
    expect(present(680, centreY(21), 0)).toBe(1);
  });
});
