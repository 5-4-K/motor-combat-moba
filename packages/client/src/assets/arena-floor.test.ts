import { describe, expect, it } from "vitest";
import { resolveArenaFloor, type FloorTextureLookup } from "./arena-floor.js";
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
