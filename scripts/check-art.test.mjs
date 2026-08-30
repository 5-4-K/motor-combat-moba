import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { artFilesOnDisk, checkManifestShape, isKnownNamespace } from "./check-art.mjs";
import { checkCars, checkCarSprite, GREYSCALE_CHROMA_LIMIT } from "./check-cars.mjs";
import {
  checkWeaponIcon,
  checkWeapons,
  COLOR_DRIFT_LIMIT,
  nearestColorDistance,
  rgbDistance,
  rgbFromHex,
} from "./check-weapons.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artDir = path.join(rootDir, "packages", "client", "public", "art");

const codes = (findings) => findings.map((f) => f.code);
const levelOf = (findings, code) => findings.find((f) => f.code === code)?.level;

/** A weapon icon with nothing wrong with it, so each test can break exactly one thing. */
const goodIcon = { width: 128, height: 128, channels: 4, hasAlpha: true, palettized: false };
const goodIconRow = { file: "weapon-icons/x.png", colorMode: "none", scale: "fit" };

/** A chassis sprite with nothing wrong with it. */
const goodSprite = { width: 96, height: 52, channels: 4, hasAlpha: true, palettized: false, maxChroma: 0 };
const goodSpriteRow = { file: "cars/x.png" };

describe("checkWeaponIcon", () => {
  it("passes an icon that is 32-bit, square, and untinted", () => {
    const out = checkWeaponIcon({
      weaponId: "x",
      row: goodIconRow,
      image: goodIcon,
      colorDistance: 10,
      iconPx: 128,
    });
    assert.deepEqual(out, []);
  });

  it("blocks an icon saved without an alpha channel", () => {
    const out = checkWeaponIcon({
      weaponId: "x",
      row: goodIconRow,
      image: { ...goodIcon, hasAlpha: false, channels: 3 },
      iconPx: 128,
    });
    assert.equal(levelOf(out, "no-alpha"), "blocker");
  });

  it("blocks a row that would let the player tint drain the icon's colour", () => {
    const out = checkWeaponIcon({
      weaponId: "x",
      row: { ...goodIconRow, colorMode: undefined },
      image: goodIcon,
      iconPx: 128,
    });
    assert.equal(levelOf(out, "tinted-row"), "blocker");
  });

  it("blocks a manifest row naming a file that is not there", () => {
    const out = checkWeaponIcon({ weaponId: "x", row: goodIconRow, image: undefined, iconPx: 128 });
    assert.equal(levelOf(out, "missing-file"), "blocker");
  });

  it("only warns when there is no row at all, because the glyph fallback is by design", () => {
    const out = checkWeaponIcon({ weaponId: "x", row: undefined, iconPx: 128 });
    assert.equal(levelOf(out, "missing-row"), "warning");
  });

  it("warns about a palette PNG and an off-size icon without blocking either", () => {
    const out = checkWeaponIcon({
      weaponId: "x",
      row: goodIconRow,
      image: { ...goodIcon, width: 64, height: 64, palettized: true },
      iconPx: 128,
    });
    assert.equal(levelOf(out, "palettized"), "warning");
    assert.equal(levelOf(out, "off-size"), "warning");
    assert.ok(!out.some((f) => f.level === "blocker"));
  });

  it("warns past the drift limit and stays quiet just inside it", () => {
    const past = checkWeaponIcon({
      weaponId: "x",
      row: goodIconRow,
      image: goodIcon,
      colorDistance: COLOR_DRIFT_LIMIT + 1,
      iconPx: 128,
    });
    assert.equal(levelOf(past, "color-drift"), "warning");
    const inside = checkWeaponIcon({
      weaponId: "x",
      row: goodIconRow,
      image: goodIcon,
      colorDistance: COLOR_DRIFT_LIMIT,
      iconPx: 128,
    });
    assert.deepEqual(inside, []);
  });
});

describe("checkCarSprite", () => {
  it("passes a greyscale, 32-bit sprite at twice the hull", () => {
    const out = checkCarSprite({
      carId: "x",
      row: goodSpriteRow,
      image: goodSprite,
      expectedWidth: 96,
    });
    assert.deepEqual(out, []);
  });

  it("blocks a sprite saved without an alpha channel", () => {
    const out = checkCarSprite({
      carId: "x",
      row: goodSpriteRow,
      image: { ...goodSprite, hasAlpha: false, channels: 3 },
      expectedWidth: 96,
    });
    assert.equal(levelOf(out, "no-alpha"), "blocker");
  });

  it("warns when a tinted sprite still carries colour", () => {
    const out = checkCarSprite({
      carId: "x",
      row: goodSpriteRow,
      image: { ...goodSprite, maxChroma: GREYSCALE_CHROMA_LIMIT + 1 },
      expectedWidth: 96,
    });
    assert.equal(levelOf(out, "not-greyscale"), "warning");
  });

  it('exempts pre-coloured art, because colorMode "none" opts out of the tint', () => {
    const out = checkCarSprite({
      carId: "x",
      row: { ...goodSpriteRow, colorMode: "none" },
      image: { ...goodSprite, maxChroma: 200 },
      expectedWidth: 96,
    });
    assert.ok(!codes(out).includes("not-greyscale"));
  });

  it("warns when the sprite is no longer twice the hull's long edge", () => {
    const out = checkCarSprite({
      carId: "x",
      row: goodSpriteRow,
      image: { ...goodSprite, width: 48 },
      expectedWidth: 96,
    });
    assert.equal(levelOf(out, "off-width"), "warning");
  });
});

describe("checkManifestShape", () => {
  it("passes a manifest whose rows and files agree", () => {
    const out = checkManifestShape({
      rows: { "car.oval": { file: "cars/oval.png" } },
      files: ["cars/oval.png"],
    });
    assert.deepEqual(out, []);
  });

  it("blocks a row pointing at a file that is gone", () => {
    const out = checkManifestShape({
      rows: { "car.oval": { file: "cars/oval.png" } },
      files: [],
    });
    assert.equal(levelOf(out, "dangling-row"), "blocker");
  });

  it("warns about a file nothing references, which would still ship in the zip", () => {
    const out = checkManifestShape({ rows: {}, files: ["cars/stray.png"] });
    assert.equal(levelOf(out, "orphan-file"), "warning");
  });

  it("blocks a prototype key rather than resolving it", () => {
    // Built with `JSON.parse` on purpose: `__proto__` in an object literal sets the prototype and
    // never becomes an own key, so a literal here would test nothing. This is the shape a hostile
    // or hand-edited manifest.json actually arrives in.
    const rows = JSON.parse('{"__proto__":{"file":"evil.png"}}');
    const out = checkManifestShape({ rows, files: ["evil.png"] });
    assert.equal(levelOf(out, "prototype-key"), "blocker");
  });

  it("warns about a key in a namespace the client never looks up", () => {
    const out = checkManifestShape({
      rows: { "power.boost": { file: "boost.png" } },
      files: ["boost.png"],
    });
    assert.equal(levelOf(out, "unknown-namespace"), "warning");
  });
});

describe("isKnownNamespace", () => {
  it("accepts the namespaces the client resolves", () => {
    assert.ok(isKnownNamespace("car.oval"));
    assert.ok(isKnownNamespace("weapon-icon.shockwave"));
  });

  it("accepts arena keys, whose convention is live before any arena art exists", () => {
    assert.ok(isKnownNamespace("arena.arena-02.floor"));
    assert.ok(isKnownNamespace("arena.common.rubble"));
  });

  it("rejects a key in no namespace, and a malformed arena key", () => {
    assert.ok(!isKnownNamespace("power.boost"));
    assert.ok(!isKnownNamespace("arena..floor"));
  });
});

describe("colour helpers", () => {
  it("parses a six-digit hex and refuses anything else", () => {
    assert.deepEqual(rgbFromHex("#0B3D8A"), [11, 61, 138]);
    assert.equal(rgbFromHex("#abc"), undefined);
    assert.equal(rgbFromHex("not-a-colour"), undefined);
  });

  it("measures zero distance from a colour to itself", () => {
    assert.equal(rgbDistance([11, 61, 138], [11, 61, 138]), 0);
  });

  it("ignores clusters too small to be one of the icon's colours", () => {
    const clusters = [
      { rgb: [255, 255, 255], share: 0.9 },
      { rgb: [11, 61, 138], share: 0.001 },
    ];
    // The exact match is a stray edge blend, so the answer is the distance to the white.
    assert.equal(nearestColorDistance(clusters, [11, 61, 138]) > 0, true);
  });

  it("finds an exact match when it holds a real share of the icon", () => {
    const clusters = [{ rgb: [11, 61, 138], share: 0.5 }];
    assert.equal(nearestColorDistance(clusters, [11, 61, 138]), 0);
  });
});

describe("the art this repo actually ships", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(artDir, "manifest.json"), "utf8"));

  it("has a manifest whose rows and files agree", () => {
    const out = checkManifestShape({
      rows: manifest.sprites ?? {},
      files: artFilesOnDisk(artDir),
    });
    const blockers = out.filter((f) => f.level === "blocker");
    assert.deepEqual(
      blockers.map((f) => f.message),
      [],
    );
  });

  it("draws every chassis sprite correctly — run `npm run check:art` for the detail", async () => {
    const blockers = (await checkCars(manifest)).flatMap((r) =>
      r.findings.filter((f) => f.level === "blocker").map((f) => `${r.id}: ${f.message}`),
    );
    assert.deepEqual(blockers, []);
  });

  it("draws every weapon icon correctly — run `npm run check:art` for the detail", async () => {
    const blockers = (await checkWeapons(manifest)).flatMap((r) =>
      r.findings.filter((f) => f.level === "blocker").map((f) => `${r.id}: ${f.message}`),
    );
    assert.deepEqual(blockers, []);
  });
});
