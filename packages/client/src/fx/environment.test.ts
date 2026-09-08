import { describe, expect, it } from "vitest";
import { ENVIRONMENT_FX } from "./environment.js";

/**
 * EV7: the lift must be behaviour-identical. These literals are the values the game shipped with
 * before `fx/environment.ts` existed, transcribed from `ArenaScene.drawArena`, `fx/camera.ts`,
 * `fx/decals.ts`, `fx/occlusion.ts`, `fx/textures.ts`, `fx/layer.ts` and `fx/emitters.ts`. If one
 * of these fails, the move changed a pixel.
 */
describe("ENVIRONMENT_FX", () => {
  it("carries the shipped grade and vignette", () => {
    expect(ENVIRONMENT_FX.grade).toEqual({
      saturate: -0.22,
      warmR: 1.07,
      warmB: 0.92,
      brightness: 0.96,
    });
    expect(ENVIRONMENT_FX.vignette).toEqual({ x: 0.5, y: 0.5, radius: 0.78, strength: 0.42 });
  });

  it("carries the shipped shake and hit-stop", () => {
    expect(ENVIRONMENT_FX.shake).toEqual({
      max: 0.02,
      diedMs: 260,
      damagedMs: 120,
      damagedBase: 0.0015,
      damagedPerHp: 0.00018,
      damagedCap: 0.6,
      explosionMs: 200,
      explosionCap: 0.75,
      ramMs: 120,
      ramFloor: 0.006,
      ramPerSpeed: 0.00002,
      ramCap: 0.6,
    });
    expect(ENVIRONMENT_FX.hitStop).toEqual({ ms: 90, scale: 0.25 });
  });

  it("carries the shipped decal and occlusion values", () => {
    expect(ENVIRONMENT_FX.decals).toEqual({
      halfLifeMs: 40_000,
      maxTotal: 600,
      maxScorch: 120,
      fadeCutoff: 0.02,
      tyreSpacing: 4.5,
      tyreMaxStep: 80,
      tyreSpeedFloor: 40,
      tyreTrackRatio: 1 / 3,
      tyreRadius: 2.7,
      tyreAlpha: 0.18,
      tyreTint: 0x141210,
      scorchAlphaShot: 0.55,
      scorchAlphaDeath: 0.7,
      scorchScaleDeath: 1.4,
      scorchScaleDefault: 0.35,
    });
    expect(ENVIRONMENT_FX.occlusion).toEqual({ halo: 14 });
  });

  it("carries the shipped floor, markings and car-burst values", () => {
    expect(ENVIRONMENT_FX.floor).toEqual({
      grainCells: 64,
      patchCells: 8,
      grainOctaves: 3,
      patchOctaves: 2,
      grainWeight: 0.62,
      patchWeight: 0.38,
      baseGrey: 50,
      greySpan: 46,
      warmR: 2,
      warmG: 1,
      warmB: -2,
    });
    expect(ENVIRONMENT_FX.markings).toEqual({
      laneColor: 0xdccd96,
      laneAlpha: 0.13,
      laneWidth: 6,
      laneSpacing: 46,
      laneDash: 26,
      laneMargin: 40,
      circleAlpha: 0.1,
      circleWidth: 4,
      circleRadius: 130,
    });
    expect(ENVIRONMENT_FX.carBursts).toEqual({ sparkPerHp: 0.5, countFloor: 1 });
  });
});
