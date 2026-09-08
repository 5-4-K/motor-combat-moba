import { describe, expect, it } from "vitest";
import { AIR_FX_DEPTH, DECAL_DEPTH, FLOOR_DEPTH, GROUND_FX_DEPTH, SMOKE_DEPTH } from "./depths.js";

// Mirrors the ladder in ArenaScene.ts. Duplicated as literals on purpose: if someone moves one of
// those constants, this test is what says the FX layers moved with it or need to.
const ARENA_DEPTH = -10;
const SHOT_DEPTH = -5;
const CAR_DEPTH = 0;
const MANEUVER_DEPTH = 2;
const ARROW_DEPTH = 52;
const HP_BAR_DEPTH = 60;

describe("fx depth constants", () => {
  it("puts the generated floor beneath the arena's own graphics", () => {
    expect(FLOOR_DEPTH).toBeLessThan(ARENA_DEPTH);
  });

  it("puts decals above the arena and below the shots", () => {
    expect(DECAL_DEPTH).toBeGreaterThan(ARENA_DEPTH);
    expect(DECAL_DEPTH).toBeLessThan(SHOT_DEPTH);
  });

  it("puts ground FX above decals and still below the shots", () => {
    expect(GROUND_FX_DEPTH).toBeGreaterThan(DECAL_DEPTH);
    expect(GROUND_FX_DEPTH).toBeLessThan(SHOT_DEPTH);
  });

  it("puts air FX above the cars, because smoke is in the air", () => {
    expect(AIR_FX_DEPTH).toBeGreaterThan(CAR_DEPTH);
    expect(AIR_FX_DEPTH).toBeGreaterThan(MANEUVER_DEPTH);
  });

  it("puts smoke above the cars but below fire and sparks, so a fireball is not buried", () => {
    // A strict ordering, not a tie: Phaser breaks equal depths by display-list insertion order, so
    // sharing AIR_FX_DEPTH would leave which of smoke and fire wins decided by constructor line
    // order in FxLayer — which is how the smoke layer came to draw over the fire it belongs to.
    expect(SMOKE_DEPTH).toBeGreaterThan(MANEUVER_DEPTH);
    expect(SMOKE_DEPTH).toBeLessThan(AIR_FX_DEPTH);
  });

  it("keeps air FX BELOW every HUD marker (VFX24) — the second readability guarantee", () => {
    // A car inside a smoke cloud keeps its hp bar, lock bracket and off-screen arrow. The eraser
    // mask keeps the car readable; this keeps its information readable regardless of how that mask
    // is later tuned.
    expect(AIR_FX_DEPTH).toBeLessThan(ARROW_DEPTH);
    expect(AIR_FX_DEPTH).toBeLessThan(HP_BAR_DEPTH);
  });
});
