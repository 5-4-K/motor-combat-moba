import { describe, expect, it } from "vitest";
import { TILE_DEFS, TILE_SIZE, rotateSides, type TileDef, type TileSide } from "./tile-config.js";

const rows = Object.entries(TILE_DEFS) as ReadonlyArray<[string, TileDef]>;

describe("TILE_DEFS", () => {
  it("is 40 world units a tile (TA3)", () => {
    expect(TILE_SIZE).toBe(40);
  });

  it("makes every hazard definition solid (TC12)", () => {
    for (const [id, def] of rows) {
      if (def.hazard !== undefined) expect(def.collision, id).toBe("solid");
    }
  });

  it("never gives an undrawn definition a default art (TC12)", () => {
    for (const [id, def] of rows) {
      if (def.draw === "none") expect(def.defaultArt, id).toBeUndefined();
    }
  });

  it("lets no row author a surface until the sim reads one (TA12)", () => {
    const authored = rows.filter(([, def]) => def.surface !== undefined).map(([id]) => id);
    expect(authored, "tile surfaces are not wired into the sim yet").toEqual([]);
  });

  it("only uses the full shape (TA2)", () => {
    for (const [, def] of rows) expect(def.shape).toBe("full");
  });

  it("ships the house look as defaults (TC14, TC29)", () => {
    const defs: Readonly<Record<string, TileDef>> = TILE_DEFS;
    expect(defs.floor!.defaultArt).toBe("metal-plate");
    expect(defs.wall!.defaultArt).toBe("checker-plate");
    expect(defs.spike!.defaultArt).toBe("checker-plate");
    expect(defs.spike!.overlay?.art).toBe("spike-teeth");
    expect(defs.spike!.hazard?.sides).toBe("all");
    expect(defs.void!.draw).toBe("none");
  });
});

describe("rotateSides (TC3, TC4)", () => {
  it("turns the front side clockwise with the orientation", () => {
    expect(rotateSides(["front"], 0)).toEqual(["n"]);
    expect(rotateSides(["front"], 90)).toEqual(["e"]);
    expect(rotateSides(["front"], 180)).toEqual(["s"]);
    expect(rotateSides(["front"], 270)).toEqual(["w"]);
  });

  it("answers in n-e-s-w order", () => {
    expect(rotateSides(["front", "right"], 270)).toEqual(["n", "w"]);
  });

  it("answers every face for all sides", () => {
    expect(rotateSides("all", 90)).toEqual(["n", "e", "s", "w"]);
  });

  it("throws on an unknown side, naming it", () => {
    expect(() => rotateSides(["top"] as unknown as readonly TileSide[], 0)).toThrow(/"top"/);
  });
});
