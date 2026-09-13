import { describe, expect, it } from "vitest";
import { floorTintOf, resolveArenaFloor, type FloorTextureLookup } from "./arena-floor.js";
import { ENVIRONMENT_FX } from "../fx/environment.js";
import type { EnvironmentFx } from "../fx/environment.js";
import { arenaFloorKey } from "./asset-keys.js";

/** Stands in for Phaser's TextureManager: every key it was given counts as loaded. */
function loaded(...keys: string[]): FloorTextureLookup {
  return { exists: (key) => keys.includes(key) };
}

describe("resolveArenaFloor", () => {
  it("resolves an arena whose floor texture loaded", () => {
    const resolved = resolveArenaFloor(loaded(arenaFloorKey("arena-01")), "arena-01");
    expect(resolved?.key).toBe("arena.arena-01.floor");
  });

  it("returns undefined when the arena's floor texture never loaded (missing PNG or manifest row)", () => {
    const resolved = resolveArenaFloor(loaded(), "arena-01");
    expect(resolved).toBeUndefined();
  });

  it("checks the key namespaced to the requested arena, not any loaded texture", () => {
    // Only arena-02's floor texture loaded. Asking for arena-01 must not be satisfied by it.
    const textures = loaded(arenaFloorKey("arena-02"));
    expect(resolveArenaFloor(textures, "arena-01")).toBeUndefined();
    expect(resolveArenaFloor(textures, "arena-02")?.key).toBe("arena.arena-02.floor");
  });
});

const art = (over: Partial<EnvironmentFx["floorArt"]> = {}): EnvironmentFx["floorArt"] => ({
  ...ENVIRONMENT_FX.floorArt,
  ...over,
});

describe("floorTintOf", () => {
  it("is a no-op white at the shipped-off setting", () => {
    // The switch-it-off guarantee: `setTint(0xffffff)` multiplies by one, which is pixel-identical
    // to the untinted draw the floor sprite shipped with. The panel must be able to get back here.
    expect(floorTintOf(art({ darken: 0, tint: 0xffffff }))).toBe(0xffffff);
  });

  it("scales every channel down as it darkens", () => {
    expect(floorTintOf(art({ darken: 0.5, tint: 0xffffff }))).toBe(0x808080);
    expect(floorTintOf(art({ darken: 1, tint: 0xffffff }))).toBe(0x000000);
  });

  it("carries the tint colour through when nothing is darkened", () => {
    expect(floorTintOf(art({ darken: 0, tint: 0x8899aa }))).toBe(0x8899aa);
  });

  it("composes the tint with the darkening", () => {
    // Two knobs with distinct jobs — `tint` picks the deck's temperature, `darken` picks its value
    // — and they multiply, so cooling a floor does not also dim it by accident.
    expect(floorTintOf(art({ darken: 0.5, tint: 0x8899aa }))).toBe(0x444d55);
  });

  it("clamps a darken outside 0..1 rather than wrapping the channels", () => {
    // A negative darken would otherwise scale channels ABOVE 255 and overflow into the next byte,
    // turning a brightening mistake into a hue change.
    expect(floorTintOf(art({ darken: -1, tint: 0xffffff }))).toBe(0xffffff);
    expect(floorTintOf(art({ darken: 2, tint: 0xffffff }))).toBe(0x000000);
  });

  it("ships as a no-op, so floor art draws exactly as authored", () => {
    // Deliberately identity as shipped. The first cut darkened by 0.45 on the theory that a quieter
    // ground makes cars pop — which is only true if the cars are LIGHTER than the floor. They are
    // not: they are dark, desaturated sprites, so darkening the deck moved the floor toward their
    // own value and cost the dark-on-light silhouette contrast that was doing the work.
    //
    // The knob stays because it is the right lever for a floor sprite that IS bright or busy enough
    // to need it. It just does not ship on for the two decks in the game today.
    expect(floorTintOf(ENVIRONMENT_FX.floorArt)).toBe(0xffffff);
  });
});
