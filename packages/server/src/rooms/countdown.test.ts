import { describe, expect, it } from "vitest";
import {
  FLOW_CONFIG,
  RoomPhase,
  TICK_RATE_HZ,
  PracticeState,
} from "@motor-combat-moba/shared";
import { COUNTDOWN_TICKS, beginCountdown, countdownSweep } from "./countdown.js";

/** Any concrete `ArenaState` will do — this module only reads `tick` and writes the two phase fields. */
function stateAtTick(tick: number): PracticeState {
  const state = new PracticeState();
  state.tick = tick;
  return state;
}

describe("COUNTDOWN_TICKS", () => {
  it("is the same three seconds ArenaRoom hands its reducer", () => {
    expect(COUNTDOWN_TICKS).toBe(FLOW_CONFIG.countdownSeconds * TICK_RATE_HZ);
  });
});

describe("beginCountdown", () => {
  it("puts the room in COUNTDOWN", () => {
    const state = stateAtTick(0);
    beginCountdown(state);
    expect(state.phase).toBe(RoomPhase.COUNTDOWN);
  });

  // Anchored to the room's clock, not to a constant: practice re-stamps this on join, after the
  // room has already been ticking, and the player is owed a full three seconds from that moment.
  it("ends a full countdown after the CURRENT tick, not after tick zero", () => {
    const state = stateAtTick(500);
    beginCountdown(state);
    expect(state.countdownEndsTick).toBe(500 + COUNTDOWN_TICKS);
  });

  it("restarts cleanly when called a second time", () => {
    const state = stateAtTick(0);
    beginCountdown(state);
    state.tick = 40;
    beginCountdown(state);
    expect(state.countdownEndsTick).toBe(40 + COUNTDOWN_TICKS);
  });
});

describe("countdownSweep", () => {
  it("holds COUNTDOWN while the clock is still running", () => {
    const state = stateAtTick(0);
    beginCountdown(state);
    state.tick = COUNTDOWN_TICKS - 1;
    countdownSweep(state);
    expect(state.phase).toBe(RoomPhase.COUNTDOWN);
  });

  it("opens MATCH on the tick the clock runs out", () => {
    const state = stateAtTick(0);
    beginCountdown(state);
    state.tick = COUNTDOWN_TICKS;
    countdownSweep(state);
    expect(state.phase).toBe(RoomPhase.MATCH);
  });

  // The gate `serverTick` and `combatTick` both check is the phase alone, so a sweep that ran a
  // second time must not walk the room back out of the match it just started.
  it("is inert once the match is live", () => {
    const state = stateAtTick(COUNTDOWN_TICKS + 100);
    state.phase = RoomPhase.MATCH;
    state.countdownEndsTick = COUNTDOWN_TICKS;
    countdownSweep(state);
    expect(state.phase).toBe(RoomPhase.MATCH);
  });

  // Both callers hide the match clock by leaving this at 0 (PR9 / PG6). A sweep that stamped a
  // deadline would put a three-minute timer on the practice HUD and end a sandbox session.
  it("never stamps matchEndsTick", () => {
    const state = stateAtTick(0);
    beginCountdown(state);
    state.tick = COUNTDOWN_TICKS;
    countdownSweep(state);
    expect(state.matchEndsTick).toBe(0);
  });
});
