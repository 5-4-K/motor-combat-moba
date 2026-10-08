import { test } from "node:test";
import assert from "node:assert/strict";
import { TILE_ART_IDS, TILE_PX, tileArtKeyOf, tileManifestRow } from "./import-tile-art.mjs";

test("imports at 80 px, twice the 40 u tile", () => {
  assert.equal(TILE_PX, 80);
});

test("knows the four tile art ids", () => {
  assert.deepEqual([...TILE_ART_IDS].sort(), ["floor", "spike", "spike-teeth", "wall"]);
});

test("keys and files art in the common arena namespace", () => {
  assert.equal(tileArtKeyOf("wall"), "arena.common.tile.wall");
  assert.deepEqual(tileManifestRow("wall"), { file: "arenas/common/tile-wall.png", colorMode: "none" });
});

test("keeps hand-set fields on re-import", () => {
  assert.deepEqual(tileManifestRow("wall", { origin: [0.5, 0.5] }), {
    origin: [0.5, 0.5],
    file: "arenas/common/tile-wall.png",
    colorMode: "none",
  });
});
