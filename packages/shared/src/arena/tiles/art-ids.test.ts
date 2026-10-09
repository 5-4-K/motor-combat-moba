import { describe, expect, it } from "vitest";
import { overlayArtIds, referencedTileArtIds } from "./art-ids.js";

describe("tile art ids (TC31)", () => {
  it("names the overlay art the definitions carry", () => {
    expect(overlayArtIds()).toEqual(["spike-teeth"]);
  });

  it("lists every art id the definitions and the registered arenas reference, sorted and unique", () => {
    expect(referencedTileArtIds()).toEqual(["checker-plate", "metal-plate", "spike-teeth"]);
  });
});
