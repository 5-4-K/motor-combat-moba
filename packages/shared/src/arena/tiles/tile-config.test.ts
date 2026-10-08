import { describe, expect, it } from "vitest";
import { TILE_SIZE, TILE_TABLE, isSolidTile, tileDefOf, type TileDef } from "./tile-config.js";

const rows = Object.entries(TILE_TABLE) as ReadonlyArray<[string, TileDef]>;

describe("TILE_TABLE", () => {
  it("is 40 world units a tile (TA3)", () => {
    expect(TILE_SIZE).toBe(40);
  });

  it("gives every row exactly one character, unique across the table (TA13)", () => {
    for (const [id, def] of rows) expect([...def.char], id).toHaveLength(1);
    const chars = rows.map(([, def]) => def.char);
    expect(new Set(chars).size).toBe(chars.length);
  });

  it("makes every hazard tile solid (TA11)", () => {
    for (const [id, def] of rows) {
      if (def.hazard !== undefined) expect(def.collision, id).toBe("solid");
    }
  });

  it("lets no row author a surface until the sim reads one (TA12)", () => {
    const authored = rows.filter(([, def]) => def.surface !== undefined).map(([id]) => id);
    expect(authored, "tile surfaces are not wired into the sim yet").toEqual([]);
  });

  it("only uses the full shape (TA2)", () => {
    for (const [, def] of rows) expect(def.shape).toBe("full");
  });

  it("authors the four shipped tiles with their characters", () => {
    expect(tileDefOf("floor").char).toBe(".");
    expect(tileDefOf("wall").char).toBe("#");
    expect(tileDefOf("spike").char).toBe("^");
    expect(tileDefOf("void").char).toBe(" ");
  });

  it("knows which tiles are solid", () => {
    expect(isSolidTile("floor")).toBe(false);
    expect(isSolidTile("wall")).toBe(true);
    expect(isSolidTile("spike")).toBe(true);
    expect(isSolidTile("void")).toBe(true);
  });

  it("draws void as backdrop, with no art", () => {
    expect(tileDefOf("void").art).toBeNull();
  });
});
