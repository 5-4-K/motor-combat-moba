import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArenaState,
  DEFAULT_GAME_MODE,
  MS_PER_TICK,
  NET_CONFIG,
  PlaygroundState,
  installMode,
  modeConfigOf,
} from "@motor-combat-moba/shared";
import { ArenaRoom } from "./ArenaRoom.js";
import { PracticeRoom, newPracticeState } from "./PracticeRoom.js";
import { PlaygroundRoom } from "./PlaygroundRoom.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));
afterEach(() => vi.restoreAllMocks());

/**
 * White-box harness: `onFrame`, `tick` and `broadcastPatch` are private or framework-owned, and
 * standing up the real room (`onCreate`'s matchmaker queries, a live transport) is machinery this
 * file has no business running — same reasoning as the Task 8 harnesses in `practice-room.test.ts`.
 * `onFrame` is exactly what `setSimulationInterval`'s callback calls with Colyseus's measured delta.
 */
interface CadenceHarness {
  state: { tick: number; paused?: boolean };
  setState(state: unknown): void;
  onFrame(deltaMs: number): void;
  tick(): void;
  broadcastPatch(): boolean;
}

const ROOMS: { name: string; make: () => CadenceHarness }[] = [
  {
    name: "ArenaRoom",
    make: () => {
      const room = new ArenaRoom() as unknown as CadenceHarness;
      room.setState(new ArenaState());
      return room;
    },
  },
  {
    name: "PracticeRoom",
    make: () => {
      const room = new PracticeRoom() as unknown as CadenceHarness;
      room.setState(newPracticeState());
      return room;
    },
  },
  {
    name: "PlaygroundRoom",
    make: () => {
      const room = new PlaygroundRoom() as unknown as CadenceHarness;
      room.setState(new PlaygroundState());
      return room;
    },
  },
];

describe.each(ROOMS)("$name tick cadence (Phase C I1)", ({ make }) => {
  it("ticks at exactly TICK_RATE_HZ from Node's truncated 16 ms frames", () => {
    const room = make();
    let ticks = 0;
    vi.spyOn(room, "tick").mockImplementation(() => {
      ticks += 1;
    });
    // 6000 frames of 16 ms = 96 s of wall clock; one tick per frame would be 6000 (~62.5/s).
    for (let i = 0; i < 6000; i++) room.onFrame(16);
    expect(Math.abs(ticks - Math.floor((6000 * 16) / MS_PER_TICK))).toBeLessThanOrEqual(1);
  });

  it("runs at most NET_CONFIG.maxCatchUpTicks ticks after a stall", () => {
    const room = make();
    let ticks = 0;
    vi.spyOn(room, "tick").mockImplementation(() => {
      ticks += 1;
    });
    room.onFrame(1000);
    expect(ticks).toBe(NET_CONFIG.maxCatchUpTicks);
  });
});

describe.each(ROOMS)("$name broadcasts its own snapshots (NR12, Phase C minor 6)", ({ make }) => {
  it("calls broadcastPatch at the end of every snapshot tick", () => {
    const room = make();
    const seenAtTick: number[] = [];
    vi.spyOn(room, "broadcastPatch").mockImplementation(() => {
      seenAtTick.push(room.state.tick);
      return true;
    });
    // SNAPSHOT_RATE_HZ === TICK_RATE_HZ, so every tick is a snapshot tick. Driven through `onFrame`
    // so the stepper, the mode scope and `tick()` are all the production path.
    for (let i = 0; i < 5; i++) room.onFrame(MS_PER_TICK);
    expect(seenAtTick.length).toBe(5);
    // Broadcast AFTER the step: each snapshot carries the tick it is the state of.
    expect(seenAtTick).toEqual(seenAtTick.map((_, i) => seenAtTick[0]! + i));
  });
});

describe.each(ROOMS.filter((r) => r.name !== "ArenaRoom"))(
  "$name broadcasts on the paused path",
  ({ make }) => {
    it("still broadcasts while paused, with state.tick frozen", () => {
      const room = make();
      room.state.paused = true;
      const before = room.state.tick;
      const spy = vi.spyOn(room, "broadcastPatch").mockImplementation(() => true);
      for (let i = 0; i < 3; i++) room.onFrame(MS_PER_TICK);
      expect(spy).toHaveBeenCalledTimes(3);
      expect(room.state.tick).toBe(before);
    });
  },
);

describe.each(ROOMS.filter((r) => r.name !== "ArenaRoom"))(
  "$name keeps the view clock running while paused (G5, NR47)",
  ({ make }) => {
    it("hands the view manager a tick that advances one per paused room tick", () => {
      const room = make() as CadenceHarness & { views: { update: (...args: unknown[]) => void } };
      room.state.paused = true;
      const frozen = room.state.tick;
      vi.spyOn(room, "broadcastPatch").mockImplementation(() => true);
      const ticks: number[] = [];
      vi.spyOn(room.views, "update").mockImplementation((_state, _viewers, tick) => {
        ticks.push(tick as number);
      });
      for (let i = 0; i < 4; i++) room.onFrame(MS_PER_TICK);
      expect(room.state.tick).toBe(frozen);
      // Without the clock every call would read `frozen` and an enemy that left vision during the
      // pause would stay in the view until the room resumed.
      expect(ticks).toEqual([frozen + 1, frozen + 2, frozen + 3, frozen + 4]);
      // Unpaused: the sim tick moves again and the held ticks stay on top, so the clock never runs back.
      room.state.paused = false;
      room.onFrame(MS_PER_TICK);
      expect(ticks.at(-1)).toBe(room.state.tick + 4);
    });
  },
);
