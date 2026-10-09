import { describe, expect, it } from "vitest";
import { ARENA_01 } from "../arena-01.js";
import { overlayArtIds, referencedTileArtIds } from "./art-ids.js";
import { compileTileArena } from "./compile.js";

const SPAWN = { x: 100, y: 100, angle: 0 };

/** A fixture arena whose only cell names its own overlay art, as no definition does (TC31). */
const SAW_ARENA = compileTileArena({
  id: "saw-arena",
  rows: ["x"],
  legend: { x: { tile: "wall", overlay: { art: "saw", orientation: 0 } } },
  ffaSpawns: [SPAWN],
  teamASpawns: [SPAWN],
  teamBSpawns: [SPAWN],
});

describe("tile art ids (TC31)", () => {
  it("names the overlay art the definitions carry", () => {
    expect(overlayArtIds()).toEqual(["spike-teeth"]);
  });

  it("includes overlay art a registered arena names on a cell, sorted and unique", () => {
    expect(overlayArtIds([ARENA_01, SAW_ARENA])).toEqual(["saw", "spike-teeth"]);
  });

  it("lists every art id the definitions and the registered arenas reference, sorted and unique", () => {
    expect(referencedTileArtIds()).toEqual(["checker-plate", "metal-plate", "spike-teeth"]);
  });
});
