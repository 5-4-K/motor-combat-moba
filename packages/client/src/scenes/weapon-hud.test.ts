import { describe, expect, it } from "vitest";
import type { TextureLookup } from "../assets/car-sprite.js";
import type { AssetManifest, SpriteEntry } from "../assets/manifest-schema.js";
import {
  HUD_DIM,
  countdownSeconds,
  resolveWeaponIcon,
  slotBarLayout,
  slotVisualState,
  sweepFraction,
} from "./weapon-hud.js";

describe("sweep", () => {
  it("is full the tick a recharge starts and empty when it ends", () => {
    expect(sweepFraction(115, 15, 100)).toBeCloseTo(1);
    expect(sweepFraction(115, 15, 115)).toBeCloseTo(0);
    expect(sweepFraction(115, 15, 107.5)).toBeCloseTo(0.5);
  });

  it("is zero when nothing is recharging", () => {
    expect(sweepFraction(0, 15, 100)).toBe(0);
  });

  it("never reports outside [0,1], however stale the tick", () => {
    expect(sweepFraction(115, 15, 900)).toBe(0);
    expect(sweepFraction(115, 15, 0)).toBe(1);
  });
});

describe("countdown", () => {
  it("shows seconds only above a second, so short cooldowns stay uncluttered", () => {
    expect(countdownSeconds(160, 100)).toBeCloseTo(2); // 60 ticks == 2s
    expect(countdownSeconds(115, 100)).toBeNull(); // 0.5s: no number
    expect(countdownSeconds(0, 100)).toBeNull();
  });
});

describe("slot state", () => {
  const cannon = { unlocksAt: 1 };
  const slot = { stocks: 1, rechargeEndsTick: 0 };

  it("reads ready when stocked, unlocked and unblocked", () => {
    expect(slotVisualState(slot, cannon, 1, 0, null, 100)).toBe("ready");
  });

  it("reads locked when the weapon is above the player's level", () => {
    expect(slotVisualState(slot, { unlocksAt: 2 }, 1, 0, null, 100)).toBe("locked");
  });

  it("reads recharging while its own timer runs", () => {
    expect(slotVisualState({ stocks: 0, rechargeEndsTick: 115 }, cannon, 1, 0, null, 100)).toBe("recharging");
  });

  it("reads car-locked for every slot during a wind-up or volley", () => {
    const pending = { slot: 0 };
    expect(slotVisualState(slot, cannon, 1, 0, pending, 100)).toBe("car-locked");
  });

  it("reads car-locked during recovery only for OTHER slots", () => {
    // switch lock to tick 150; this slot is not the one that fired
    expect(slotVisualState(slot, cannon, 1, 150, null, 100, false)).toBe("car-locked");
    expect(slotVisualState(slot, cannon, 1, 150, null, 100, true)).toBe("ready");
  });

  it("dims a locked slot harder than a recharging one", () => {
    expect(HUD_DIM.locked).toBeLessThan(HUD_DIM.recharging);
  });
});

describe("resolveWeaponIcon", () => {
  function iconEntry(over: Partial<SpriteEntry> = {}): SpriteEntry {
    return {
      file: "weapon-icons/cannon.png",
      rotationOffset: 0,
      scale: "fit",
      colorMode: "none",
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

  it("resolves an icon whose entry exists and whose texture loaded", () => {
    const resolved = resolveWeaponIcon(
      manifestOf({ "weapon-icon.cannon": iconEntry() }),
      loaded({ "weapon-icon.cannon": { width: 128, height: 128 } }),
      "cannon",
      64,
    );
    expect(resolved?.key).toBe("weapon-icon.cannon");
    expect(resolved?.fit.scale).toBeCloseTo(0.5);
  });

  it("falls through to undefined when there is no manifest entry", () => {
    const resolved = resolveWeaponIcon(
      manifestOf({}),
      loaded({ "weapon-icon.cannon": { width: 128, height: 128 } }),
      "cannon",
      64,
    );
    expect(resolved).toBeUndefined();
  });

  it("falls through to undefined when the entry exists but the texture never loaded", () => {
    const resolved = resolveWeaponIcon(
      manifestOf({ "weapon-icon.cannon": iconEntry() }),
      loaded({}),
      "cannon",
      64,
    );
    expect(resolved).toBeUndefined();
  });

  it("does not fall back to any other weapon's icon for an unknown id", () => {
    const resolved = resolveWeaponIcon(
      manifestOf({ "weapon-icon.cannon": iconEntry() }),
      loaded({ "weapon-icon.cannon": { width: 128, height: 128 } }),
      "repeater",
      64,
    );
    expect(resolved).toBeUndefined();
  });
});

describe("layout", () => {
  it("centres the bar horizontally and pins it near the bottom", () => {
    const boxes = slotBarLayout(3, 1280, 720);
    expect(boxes).toHaveLength(3);
    const centres = boxes.map((b) => b.x + b.size / 2);
    expect((centres[0]! + centres[2]!) / 2).toBeCloseTo(640, 0);
    for (const box of boxes) expect(box.y).toBeGreaterThan(600);
  });

  it("draws nothing for a car with no slots", () => {
    expect(slotBarLayout(0, 1280, 720)).toEqual([]);
  });
});
