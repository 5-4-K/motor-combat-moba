// packages/client/src/assets/sprite-fit.test.ts
import { describe, expect, it } from "vitest";
import type { SpriteEntry } from "./manifest-schema.js";
import { fitSprite } from "./sprite-fit.js";

const HULL = { width: 48, height: 32 };

function entry(over: Partial<SpriteEntry> = {}): SpriteEntry {
  return {
    file: "cars/x.png",
    rotationOffset: 0,
    scale: "fit",
    colorMode: "tint",
    origin: [0.5, 0.5],
    ...over,
  };
}

describe("fitSprite", () => {
  it("contains square art inside the hull using the tighter axis", () => {
    const fit = fitSprite(entry(), { width: 128, height: 128 }, HULL);
    expect(fit.scale).toBeCloseTo(32 / 128);
  });

  it("contains wide art using the width axis when that is tighter", () => {
    const fit = fitSprite(entry(), { width: 256, height: 32 }, HULL);
    expect(fit.scale).toBeCloseTo(48 / 256);
  });

  it("passes an explicit numeric scale straight through", () => {
    expect(fitSprite(entry({ scale: 2 }), { width: 128, height: 128 }, HULL).scale).toBe(2);
  });

  it("falls back to scale 1 for a zero-sized texture rather than producing NaN", () => {
    expect(fitSprite(entry(), { width: 0, height: 0 }, HULL).scale).toBe(1);
    expect(fitSprite(entry(), { width: 64, height: 0 }, HULL).scale).toBe(1);
  });

  it("reports rotationOffset and origin unchanged", () => {
    const fit = fitSprite(
      entry({ rotationOffset: Math.PI / 2, origin: [0.25, 0.75] }),
      { width: 64, height: 64 },
      HULL,
    );
    expect(fit.rotation).toBeCloseTo(Math.PI / 2);
    expect(fit.originX).toBe(0.25);
    expect(fit.originY).toBe(0.75);
  });
});
