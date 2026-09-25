import { describe, expect, it } from "vitest";
import { ArenaState, GameMode, derived, modeConfigOf, withMode } from "@motor-combat-moba/shared";
import { controllerOf, MODE_CONTROLLERS } from "./registry.js";
import { LAST_STANDING_CONTROLLER } from "./last-standing/controller.js";
import { DEATHMATCH_CONTROLLER } from "./deathmatch/controller.js";
import { CONQUER_CONTROLLER } from "./conquer/controller.js";
import type { ModeRoomView } from "./types.js";

describe("registry", () => {
  it("has a controller for every mode", () => {
    expect(MODE_CONTROLLERS[GameMode.FFA_LAST_STANDING]).toBe(LAST_STANDING_CONTROLLER);
    expect(MODE_CONTROLLERS[GameMode.TEAM]).toBe(LAST_STANDING_CONTROLLER);
    expect(MODE_CONTROLLERS[GameMode.FFA_DEATHMATCH]).toBe(DEATHMATCH_CONTROLLER);
    expect(MODE_CONTROLLERS[GameMode.CONQUER]).toBe(CONQUER_CONTROLLER);
  });

  it("brawl and team share the same controller", () => {
    expect(controllerOf(GameMode.FFA_LAST_STANDING)).toBe(controllerOf(GameMode.TEAM));
  });

  it("falls back to the default mode's controller for an unrecognised byte", () => {
    expect(controllerOf(250)).toBe(controllerOf(GameMode.FFA_LAST_STANDING));
  });

  // Review Focus 4: `controllerOf` resolves per call, never cached, so a host switching mode
  // between matches gets the new family's controller immediately.
  it("resolves per call rather than being pinned to the first mode seen", () => {
    const state = { mode: GameMode.FFA_LAST_STANDING };
    expect(controllerOf(state.mode)).toBe(LAST_STANDING_CONTROLLER);
    state.mode = GameMode.CONQUER;
    expect(controllerOf(state.mode)).toBe(CONQUER_CONTROLLER);
  });

  // Review Focus 4, strengthened: a Brawl match followed by a Conquer match on the same room must
  // not carry over a Brawl-flavoured `onMatchStart` — it has to actually reset the zone and stamp
  // the clock the moment the room's `state.mode` says Conquer, not whatever mode was seen first.
  it("a host switching mode between matches gets Conquer's real onMatchStart, not Brawl's", () => {
    const state = new ArenaState();
    state.mode = GameMode.FFA_LAST_STANDING;
    const view: ModeRoomView = { state, roster: new Set() };

    withMode(modeConfigOf(GameMode.FFA_LAST_STANDING), () => {
      controllerOf(state.mode).onMatchStart(view);
    });
    expect(state.matchEndsTick).toBe(0);

    state.mode = GameMode.CONQUER;
    state.tick = 42;
    state.controlTicksA = 9;
    state.zoneHolder = 1;
    state.zoneStreakTicks = 4;
    state.zoneContested = true;
    state.overtime = true;
    withMode(modeConfigOf(GameMode.CONQUER), () => {
      controllerOf(state.mode).onMatchStart(view);
      expect(state.matchEndsTick).toBe(42 + derived().deathmatchTicks.match);
    });
    expect(state).toMatchObject({
      controlTicksA: 0,
      controlTicksB: 0,
      zoneHolder: -1,
      zoneStreakTicks: 0,
      zoneContested: false,
      overtime: false,
    });
  });
});
