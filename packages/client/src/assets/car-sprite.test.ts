import { describe, expect, it } from "vitest";
import { DEFAULT_CAR_ID } from "@motor-combat-moba/shared";
import { resolveCarSprite, resolveTurretSprite, type TextureLookup } from "./car-sprite.js";
import type { AssetManifest, SpriteEntry } from "./manifest-schema.js";

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

function manifestOf(sprites: Record<string, SpriteEntry>): AssetManifest {
  return { sprites };
}

/** Stands in for Phaser's TextureManager: every key it was given counts as loaded. */
function loaded(sizes: Record<string, { width: number; height: number }>): TextureLookup {
  return {
    exists: (key) => Object.hasOwn(sizes, key),
    sizeOf: (key) => sizes[key]!,
  };
}

describe("resolveCarSprite", () => {
  it("resolves a chassis whose entry exists and whose texture loaded", () => {
    const resolved = resolveCarSprite(
      manifestOf({ "car.bullseye": entry({ file: "cars/bullseye.png" }) }),
      loaded({ "car.bullseye": { width: 128, height: 128 } }),
      "bullseye",
      HULL,
    );
    expect(resolved?.key).toBe("car.bullseye");
    expect(resolved?.entry.file).toBe("cars/bullseye.png");
    expect(resolved?.fit.scale).toBeCloseTo(32 / 128);
  });

  it("returns undefined when the entry exists but its texture never loaded", () => {
    const resolved = resolveCarSprite(
      manifestOf({ "car.bullseye": entry() }),
      loaded({}),
      "bullseye",
      HULL,
    );
    expect(resolved).toBeUndefined();
  });

  it("returns undefined when the manifest has no entry for the chassis", () => {
    const resolved = resolveCarSprite(
      manifestOf({}),
      loaded({ "car.bullseye": { width: 128, height: 128 } }),
      "bullseye",
      HULL,
    );
    expect(resolved).toBeUndefined();
  });

  it("resolves an unrecognised carId through DEFAULT_CAR_ID", () => {
    const key = `car.${DEFAULT_CAR_ID}`;
    const resolved = resolveCarSprite(
      manifestOf({ [key]: entry() }),
      loaded({ [key]: { width: 64, height: 64 } }),
      "not-a-car",
      HULL,
    );
    expect(resolved?.key).toBe(key);
  });

  it("carries the entry's rotation and origin through the fit", () => {
    const resolved = resolveCarSprite(
      manifestOf({ "car.bastion": entry({ rotationOffset: Math.PI / 2, origin: [0.25, 0.75] }) }),
      loaded({ "car.bastion": { width: 64, height: 128 } }),
      "bastion",
      HULL,
    );
    expect(resolved?.fit.rotation).toBeCloseTo(Math.PI / 2);
    expect(resolved?.fit.originX).toBe(0.25);
    // Fitted against the rotated bounds, so the up-facing 64x128 fills the hull.
    expect(resolved?.fit.scale).toBeCloseTo(0.375);
  });
});

describe("resolveTurretSprite (TR42)", () => {
  const TURRET = { width: 72, height: 42 };

  it("prefers the chassis's own turret over the shared default", () => {
    const resolved = resolveTurretSprite(
      manifestOf({ "turret.bastion": entry(), "turret.default": entry() }),
      loaded({ "turret.bastion": TURRET, "turret.default": TURRET }),
      "bastion",
    );
    expect(resolved?.key).toBe("turret.bastion");
  });

  it("falls back to turret.default when the chassis has no row, or its texture never loaded", () => {
    const noRow = resolveTurretSprite(
      manifestOf({ "turret.default": entry() }),
      loaded({ "turret.default": TURRET }),
      "bastion",
    );
    expect(noRow?.key).toBe("turret.default");
    const unloaded = resolveTurretSprite(
      manifestOf({ "turret.bastion": entry(), "turret.default": entry() }),
      loaded({ "turret.default": TURRET }),
      "bastion",
    );
    expect(unloaded?.key).toBe("turret.default");
  });

  it("returns undefined when neither key resolves, so the caller draws the procedural turret", () => {
    expect(resolveTurretSprite(manifestOf({}), loaded({}), "bastion")).toBeUndefined();
  });

  it("scales the texture's long edge to the turret's display length, not to the hull", () => {
    const fit = resolveTurretSprite(
      manifestOf({ "turret.default": entry({ origin: [0.31, 0.5] }) }),
      loaded({ "turret.default": TURRET }),
      "bastion",
    )?.fit;
    expect(fit?.scale).toBeCloseTo(36 / 72);
    expect(fit?.originX).toBe(0.31);
    const scaled = resolveTurretSprite(
      manifestOf({ "turret.default": entry({ scale: 1.5 }) }),
      loaded({ "turret.default": TURRET }),
      "bastion",
    )?.fit;
    expect(scaled?.scale).toBeCloseTo(54 / 72);
  });
});
