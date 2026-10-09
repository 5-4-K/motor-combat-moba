import { beforeEach, describe, expect, it } from "vitest";
import {
  ArenaState,
  GameMode,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  TICK_RATE_HZ,
  installMode,
  modeConfigOf,
  withMode,
  type ModeConfig,
} from "@motor-combat-moba/shared";
import { ArenaRoom } from "./ArenaRoom.js";

/**
 * White-box, like `view-leak.test.ts`: no `onCreate` (matchmaker, transport). The room's
 * `modeConfig` and state are set by hand and the private seams Task 5 extracted are driven directly.
 */
interface Harness {
  state: ArenaState;
  modeConfig: ModeConfig;
  arenaRandom: () => number;
  setState(state: unknown): void;
  beginMatch(readyIds: string[]): void;
  onArenaHighlight(sessionId: string, msg: unknown): void;
  onArenaPick(sessionId: string, msg: unknown): void;
  advanceFlow(): void;
}

function room(config: ModeConfig, ids: string[] = ["host", "guest"]) {
  const r = new ArenaRoom() as unknown as Harness;
  const state = new ArenaState();
  state.mode = config.id;
  r.setState(state);
  r.modeConfig = config;
  ids.forEach((id, i) => {
    const p = new PlayerState();
    p.sessionId = id;
    p.name = id;
    p.status = PlayerStatus.READY;
    p.joinedAtTick = i;
    state.players.set(id, p);
  });
  state.hostSessionId = ids[0];
  const run = <T>(fn: () => T): T => withMode(config, fn);
  const start = (readyIds: string[] = ids) => run(() => r.beginMatch(readyIds));
  /** Sets the room's tick and runs the flow deadlines once, as `step()` would. */
  const at = (tick: number) =>
    run(() => {
      r.state.tick = tick;
      r.advanceFlow();
    });
  return { r, state, run, start, at };
}

const brawl = () => modeConfigOf(GameMode.FFA_LAST_STANDING);
const conquer = () => modeConfigOf(GameMode.CONQUER);

beforeEach(() => installMode(brawl()));

describe("Start (AR13-AR14)", () => {
  it("opens ARENA_SELECT on arenas[0] with the choosing clock running", () => {
    const { state, start } = room(brawl());
    state.tick = 100;
    start();
    expect(state.phase).toBe(RoomPhase.ARENA_SELECT);
    expect(state.arenaHighlightId).toBe("arena-01");
    expect(state.arenaSelectDeadlineTick).toBe(100 + 10 * TICK_RATE_HZ);
    expect(state.arenaRevealEndsTick).toBe(0);
    expect(state.players.get("guest")?.status).toBe(PlayerStatus.IN_MATCH);
  });

  it("with one arena, lands the pick at once and shows only the reveal", () => {
    const { state, start } = room(conquer(), ["h", "a", "b", "c"]);
    state.tick = 50;
    start();
    expect(state.phase).toBe(RoomPhase.ARENA_SELECT);
    expect(state.arenaId).toBe("arena-03");
    expect(state.arenaPickRandom).toBe(false);
    expect(state.arenaRevealEndsTick).toBe(50 + 3 * TICK_RATE_HZ);
  });

  it("does not carry the previous match's deadline into a one-arena start", () => {
    const { state, start } = room(conquer(), ["h", "a", "b", "c"]);
    state.tick = 50;
    state.arenaSelectDeadlineTick = 99999;
    start();
    expect(state.arenaSelectDeadlineTick).toBe(50);
  });

  it("does not carry the previous match's deadline into a screen-off start", () => {
    const base = brawl();
    const off = { ...base, flow: { ...base.flow, arenaSelectEnabled: false } } as ModeConfig;
    const { state, start } = room(off);
    state.tick = 70;
    state.arenaSelectDeadlineTick = 99999;
    start();
    expect(state.arenaSelectDeadlineTick).toBe(70);
  });

  it("with the screen off, goes straight to CAR_SELECT on arenas[0]", () => {
    const base = brawl();
    const off = { ...base, flow: { ...base.flow, arenaSelectEnabled: false } } as ModeConfig;
    const { state, start } = room(off);
    state.arenaId = "arena-02";
    start();
    expect(state.phase).toBe(RoomPhase.CAR_SELECT);
    expect(state.arenaId).toBe("arena-01");
  });
});

describe("host messages (AR16-AR18)", () => {
  it("moves the highlight for the host only", () => {
    const { r, state, start, run } = room(brawl());
    start();
    run(() => r.onArenaHighlight("guest", { arenaId: "arena-02" }));
    expect(state.arenaHighlightId).toBe("arena-01");
    run(() => r.onArenaHighlight("host", { arenaId: "arena-02" }));
    expect(state.arenaHighlightId).toBe("arena-02");
  });

  it("commits a named pick and refuses a second one", () => {
    const { r, state, start, run } = room(brawl());
    state.tick = 10;
    start();
    run(() => r.onArenaPick("host", { arenaId: "arena-02" }));
    expect(state.arenaId).toBe("arena-02");
    expect(state.arenaRevealEndsTick).toBe(10 + 3 * TICK_RATE_HZ);
    run(() => r.onArenaPick("host", { arenaId: "arena-01" }));
    expect(state.arenaId).toBe("arena-02");
  });

  it("draws a random pick on the server and lengthens the reveal for the roulette", () => {
    const { r, state, start, run } = room(brawl());
    r.arenaRandom = () => 0.99;
    state.tick = 10;
    start();
    run(() => r.onArenaPick("host", { random: true }));
    expect(state.arenaId).toBe("arena-02");
    expect(state.arenaPickRandom).toBe(true);
    expect(state.arenaRevealEndsTick).toBe(10 + Math.ceil(4.5 * TICK_RATE_HZ));
  });
});

describe("deadlines (AR19)", () => {
  it("picks the highlighted arena when the clock runs out, then opens car select after the reveal", () => {
    const { r, state, start, run, at } = room(brawl());
    state.tick = 0;
    start();
    run(() => r.onArenaHighlight("host", { arenaId: "arena-02" }));
    at(10 * TICK_RATE_HZ - 1);
    expect(state.arenaRevealEndsTick).toBe(0);
    at(10 * TICK_RATE_HZ);
    expect(state.arenaId).toBe("arena-02");
    expect(state.arenaPickRandom).toBe(false);
    const revealEnds = state.arenaRevealEndsTick;
    expect(revealEnds).toBe(13 * TICK_RATE_HZ);
    at(revealEnds - 1);
    expect(state.phase).toBe(RoomPhase.ARENA_SELECT);
    at(revealEnds);
    expect(state.phase).toBe(RoomPhase.CAR_SELECT);
    expect(state.carSelectDeadlineTick).toBeGreaterThan(revealEnds);
  });
});

describe("host leaves mid-pick (AR20)", () => {
  it("a lobby player who inherits host cannot pick; the clock decides", () => {
    const { r, state, start, run } = room(brawl(), ["host", "guest", "lurker"]);
    start(["host", "guest"]);
    state.players.delete("host");
    state.hostSessionId = "lurker";
    run(() => r.onArenaPick("lurker", { arenaId: "arena-02" }));
    expect(state.arenaRevealEndsTick).toBe(0);
  });

  it("a roster player who inherits host can pick", () => {
    const { r, state, start, run } = room(brawl());
    start();
    state.hostSessionId = "guest";
    run(() => r.onArenaPick("guest", { arenaId: "arena-02" }));
    expect(state.arenaId).toBe("arena-02");
  });
});
