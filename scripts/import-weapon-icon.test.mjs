import { test } from "node:test";
import assert from "node:assert/strict";
import { iconManifestRow, weaponIconKeyOf, ICON_PX } from "./import-weapon-icon.mjs";

test("namespaces the manifest key", () => {
  assert.equal(weaponIconKeyOf("cannon"), "weapon-icon.cannon");
});

test("writes an untinted, fitted row", () => {
  const row = iconManifestRow("cannon");
  assert.equal(row.file, "weapon-icons/cannon.png");
  assert.equal(row.colorMode, "none");
  assert.equal(row.scale, "fit");
});

test("preserves hand-tuned fields on re-import", () => {
  const existing = { file: "weapon-icons/cannon.png", origin: [0.4, 0.6], colorMode: "none" };
  const row = iconManifestRow("cannon", existing);
  assert.deepEqual(row.origin, [0.4, 0.6]);
});

test("renders at twice the HUD box so the icon stays sharp", () => {
  assert.equal(ICON_PX, 128);
});
