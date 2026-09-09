import { describe, expect, it } from "vitest";
import { ENVIRONMENT_FX } from "../fx/environment.js";
import type { EnvironmentFx } from "../fx/environment.js";
import {
  contactBandsFor,
  placeOutline,
  rimOffsetFor,
  shadowBandsFor,
  shadowOffsetFor,
  tintCornersFor,
} from "./car-lighting.js";

const LOOK = ENVIRONMENT_FX.carLook;
const RED = 0xbf1402; // COLOR_TABLE's Crimson — a real player colour, not a synthetic grey.

const look = (over: Partial<EnvironmentFx["carLook"]> = {}): EnvironmentFx["carLook"] => ({
  ...LOOK,
  ...over,
});

/** Every knob that scales an effect at zero — the "restore the flat look" configuration. */
const FLAT = look({
  shadowAlpha: 0,
  contactAlpha: 0,
  litStrength: 0,
  shadeStrength: 0,
  rimAlpha: 0,
});

const luma = (rgb: number) =>
  0.2126 * ((rgb >> 16) & 0xff) + 0.7152 * ((rgb >> 8) & 0xff) + 0.0722 * (rgb & 0xff);

describe("tintCornersFor", () => {
  it("collapses to the flat fill when both strengths are zero", () => {
    // The whole feature must be switchable off from the panel, not just dimmable.
    const corners = tintCornersFor(RED, 0, FLAT);
    expect(corners).toEqual({ topLeft: RED, topRight: RED, bottomLeft: RED, bottomRight: RED });
  });

  it("lights the corner facing the light and shades the one opposite it", () => {
    // Light straight up the screen (-90 degrees, +y being down), car unrotated: the two TOP corners
    // are the near ones and must come back brighter than the two bottom ones.
    const corners = tintCornersFor(RED, 0, look({ lightAngle: -90 }));
    expect(luma(corners.topLeft)).toBeGreaterThan(luma(RED));
    expect(luma(corners.topRight)).toBeGreaterThan(luma(RED));
    expect(luma(corners.bottomLeft)).toBeLessThan(luma(RED));
    expect(luma(corners.bottomRight)).toBeLessThan(luma(RED));
    // Symmetric about the light's axis: left and right of a vertical light are equally lit.
    expect(corners.topLeft).toBe(corners.topRight);
    expect(corners.bottomLeft).toBe(corners.bottomRight);
  });

  it("keeps the light WORLD-fixed as the car turns", () => {
    // The bug this guards: tinting by fixed corner constants makes the highlight spin with the car,
    // which reads as the car being lit by itself. Turn the car a quarter turn and each corner must
    // take the colour belonging to the WORLD position it has moved into. With +y down, a +pi/2
    // rotation sends local bottomLeft to world topLeft, local topLeft to world topRight, and so on
    // round — so the colours rotate the opposite way to the corners.
    const l = look({ lightAngle: -90 });
    const flat = tintCornersFor(RED, 0, l);
    const turned = tintCornersFor(RED, Math.PI / 2, l);
    expect(turned.bottomLeft).toBe(flat.topLeft);
    expect(turned.topLeft).toBe(flat.topRight);
    expect(turned.topRight).toBe(flat.bottomRight);
    expect(turned.bottomRight).toBe(flat.bottomLeft);
  });

  it("comes back to the same colours after a full turn", () => {
    const l = look({ lightAngle: 37 });
    expect(tintCornersFor(RED, 0, l)).toEqual(tintCornersFor(RED, Math.PI * 2, l));
  });

  it("returns valid 24-bit colours at every heading and every strength", () => {
    for (const strength of [0, 0.5, 1]) {
      const l = look({ litStrength: strength, shadeStrength: strength });
      for (let a = 0; a < Math.PI * 2; a += 0.3) {
        for (const corner of Object.values(tintCornersFor(RED, a, l))) {
          expect(Number.isInteger(corner)).toBe(true);
          expect(corner).toBeGreaterThanOrEqual(0);
          expect(corner).toBeLessThanOrEqual(0xffffff);
        }
      }
    }
  });

  it("never blows a channel past white or below black at full strength", () => {
    const full = look({ litStrength: 1, shadeStrength: 1, lightAngle: -90 });
    const corners = tintCornersFor(0xffffff, 0, full);
    expect(corners.topLeft).toBe(0xffffff);
    expect(tintCornersFor(0x000000, 0, full).bottomLeft).toBe(0x000000);
  });
});

describe("shadowOffsetFor", () => {
  it("throws the shadow AWAY from the light", () => {
    // Light overhead-left of the screen at 180 degrees means the shadow falls to +x.
    const p = shadowOffsetFor(look({ lightAngle: 180, shadowOffset: 10 }));
    expect(p.x).toBeCloseTo(10, 8);
    expect(p.y).toBeCloseTo(0, 8);
  });

  it("does not depend on the car's heading — one light lights the whole arena", () => {
    // Deliberately takes no angle: a shadow that swung round with its car would betray the light.
    const p = shadowOffsetFor(look({ lightAngle: -90, shadowOffset: 8 }));
    expect(p.x).toBeCloseTo(0, 8);
    expect(p.y).toBeCloseTo(8, 8);
  });

  it("sits straight under the car at zero offset", () => {
    const p = shadowOffsetFor(look({ shadowOffset: 0 }));
    expect(p.x).toBeCloseTo(0, 8);
    expect(p.y).toBeCloseTo(0, 8);
  });
});

describe("shadowBandsFor / contactBandsFor", () => {
  it("emits nothing at all when the shadow is switched off", () => {
    expect(shadowBandsFor(FLAT)).toEqual([]);
    expect(contactBandsFor(FLAT)).toEqual([]);
  });

  it("orders bands widest-first so later fills stack toward the centre", () => {
    const bands = shadowBandsFor(look({ shadowBands: 4 }));
    expect(bands).toHaveLength(4);
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i]!.scale).toBeLessThan(bands[i - 1]!.scale);
    }
  });

  it("spans exactly from the softness edge down to the hull", () => {
    const bands = shadowBandsFor(look({ shadowBands: 5, shadowSpread: 0.4 }));
    expect(bands[0]!.scale).toBeCloseTo(1.4, 8);
    expect(bands.at(-1)!.scale).toBeCloseTo(1, 8);
  });

  it("gives a single band the full alpha and no spread — a hard shadow", () => {
    const bands = shadowBandsFor(look({ shadowBands: 1, shadowAlpha: 0.5 }));
    expect(bands).toEqual([{ scale: 1, alpha: 0.5 }]);
  });

  it("stacks to roughly the AUTHORED alpha, not to a multiple of it", () => {
    // The bug this exists for: bands whose alphas each ramped up to `shadowAlpha` accumulated to
    // about 0.75 under the car and read as a hole in the road. What the author writes is what the
    // darkest part of the shadow comes out at.
    for (const count of [1, 3, 5, 8]) {
      const bands = shadowBandsFor(look({ shadowBands: count, shadowAlpha: 0.3 }));
      const stacked = 1 - bands.reduce((acc, b) => acc * (1 - b.alpha), 1);
      expect(stacked).toBeGreaterThan(0.24);
      expect(stacked).toBeLessThanOrEqual(0.3 + 1e-9);
    }
  });

  it("keeps every band's alpha inside 0..1 at any band count", () => {
    for (const count of [1, 2, 6, 10]) {
      for (const band of shadowBandsFor(look({ shadowBands: count, shadowAlpha: 1 }))) {
        expect(band.alpha).toBeGreaterThan(0);
        expect(band.alpha).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps the contact shadow inside the hull, where the gap it darkens is", () => {
    const bands = contactBandsFor(look({ contactScale: 0.8 }));
    expect(bands).toHaveLength(1);
    expect(bands[0]!.scale).toBeCloseTo(0.8, 8);
    expect(bands[0]!.alpha).toBeCloseTo(LOOK.contactAlpha, 8);
  });
});

describe("placeOutline", () => {
  const square = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ];

  it("moves an unrotated, unscaled outline straight to the centre", () => {
    expect(placeOutline(square, 1, 0, 10, 20)).toEqual([
      { x: 11, y: 20 },
      { x: 10, y: 21 },
      { x: 9, y: 20 },
      { x: 10, y: 19 },
    ]);
  });

  it("scales about the shape's own centre, not about the origin", () => {
    // The shadow band that is 1.4x the hull has to stay concentric with the car; scaling after the
    // move would throw it across the arena in proportion to how far from the origin the car is.
    const placed = placeOutline(square, 2, 0, 100, 100);
    expect(placed[0]).toEqual({ x: 102, y: 100 });
    expect(placed[2]).toEqual({ x: 98, y: 100 });
  });

  it("turns the outline to the car's heading", () => {
    const placed = placeOutline(square, 1, Math.PI / 2, 0, 0);
    expect(placed[0]!.x).toBeCloseTo(0, 8);
    expect(placed[0]!.y).toBeCloseTo(1, 8);
  });

  it("leaves the source points untouched, so a cached outline can be reused every frame", () => {
    const before = JSON.stringify(square);
    placeOutline(square, 3, 1.2, 50, 60);
    expect(JSON.stringify(square)).toBe(before);
  });
});

describe("rimOffsetFor", () => {
  it("nudges the rim copy TOWARD the light, so the lit sliver shows on the lit side", () => {
    const p = rimOffsetFor(0, look({ lightAngle: 0, rimWidth: 2 }));
    expect(p.x).toBeCloseTo(2, 8);
    expect(p.y).toBeCloseTo(0, 8);
  });

  it("counter-rotates, because the copy lives inside the car's own turning container", () => {
    // The offset is expressed in the CAR's frame, so it has to be turned backwards by the car's
    // heading; otherwise the lit edge would swing round the car as it steered.
    const l = look({ lightAngle: 0, rimWidth: 2 });
    const turned = rimOffsetFor(Math.PI / 2, l);
    expect(turned.x).toBeCloseTo(0, 8);
    expect(turned.y).toBeCloseTo(-2, 8);
  });

  it("lands in the same WORLD direction whatever the car's heading", () => {
    const l = look({ lightAngle: 35, rimWidth: 3 });
    const world = shadowOffsetFor(look({ lightAngle: 35, shadowOffset: -3 }));
    for (const angle of [0, 1, 2, 3, 4, 5]) {
      const local = rimOffsetFor(angle, l);
      // Rotate the local offset back out by the container's own rotation.
      const x = local.x * Math.cos(angle) - local.y * Math.sin(angle);
      const y = local.x * Math.sin(angle) + local.y * Math.cos(angle);
      expect(x).toBeCloseTo(world.x, 6);
      expect(y).toBeCloseTo(world.y, 6);
    }
  });

  it("collapses to nothing at zero width", () => {
    const p = rimOffsetFor(1.2, look({ rimWidth: 0 }));
    expect(p.x).toBeCloseTo(0, 8);
    expect(p.y).toBeCloseTo(0, 8);
  });
});
