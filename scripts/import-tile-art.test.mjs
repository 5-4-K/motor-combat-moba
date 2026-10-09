import { test } from "node:test";
import assert from "node:assert/strict";
import { isTileArtId, TILE_PX, tileArtKeyOf, tileManifestRow } from "./import-tile-art.mjs";

test("imports at 80 px, twice the 40 u tile", () => {
  assert.equal(TILE_PX, 80);
});

test("accepts any kebab-case art id, since art is named by look (TC30)", () => {
  for (const id of ["metal-plate", "grass", "spike-teeth", "a1"]) assert.equal(isTileArtId(id), true, id);
  for (const id of ["Floor", "a--b", "-a", "a-", "a_b", ""]) assert.equal(isTileArtId(id), false, id);
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
