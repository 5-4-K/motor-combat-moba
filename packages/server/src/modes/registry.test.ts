import { describe, expect, it } from "vitest";
import { GameMode } from "@motor-combat-moba/shared";
import { controllerOf, MODE_CONTROLLERS } from "./registry.js";
import { LAST_STANDING_CONTROLLER } from "./last-standing/controller.js";
import { DEATHMATCH_CONTROLLER } from "./deathmatch/controller.js";
import { CONQUER_CONTROLLER } from "./conquer/controller.js";

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
});
