import { describe, expect, it } from "vitest";
import { ARENA_ART_COMMON, ARENA_ART_PREFIX, arenaIdFromArtKey } from "./art-keys.js";

describe("arenaIdFromArtKey", () => {
  it("returns undefined for keys outside the arena namespace", () => {
    expect(arenaIdFromArtKey("car.rectangle")).toBeUndefined();
    expect(arenaIdFromArtKey("powerup.boost")).toBeUndefined();
    expect(arenaIdFromArtKey("")).toBeUndefined();
  });

  it("extracts the arena id from a namespaced key", () => {
    expect(arenaIdFromArtKey("arena.arena-02.floor")).toBe("arena-02");
    expect(arenaIdFromArtKey("arena.arena-02.obstacle.crate")).toBe("arena-02");
  });

  it("treats a key with no slot as naming its arena", () => {
    expect(arenaIdFromArtKey("arena.arena-02")).toBe("arena-02");
  });

  it("recognises the shared namespace", () => {
    expect(arenaIdFromArtKey(`${ARENA_ART_PREFIX}${ARENA_ART_COMMON}.wall`)).toBe(ARENA_ART_COMMON);
  });

  it("returns undefined rather than an empty id", () => {
    expect(arenaIdFromArtKey("arena.")).toBeUndefined();
    expect(arenaIdFromArtKey("arena..floor")).toBeUndefined();
  });
});
