import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  artFilesOnDisk,
  checkManifestShape,
  checkTurretSprite,
  isKnownNamespace,
  namespaceScopeOf,
} from "./check-art.mjs";
import { checkCars, checkCarSprite, GREYSCALE_CHROMA_LIMIT } from "./check-cars.mjs";
import { carriageLabel, carRoster, everyMode, modeNameOf, weaponRoster } from "./mode-rosters.mjs";
import {
  checkWeaponIcon,
  checkWeapons,
  COLOR_DRIFT_LIMIT,
  nearestColorDistance,
  rgbDistance,
  rgbFromHex,
} from "./check-weapons.mjs";
import { MODE_TABLE, modeConfigOf } from "../packages/shared/dist/index.js";

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
      rows: { "car.bullseye": { file: "cars/bullseye.png" } },
      files: ["cars/bullseye.png"],
    });
    assert.deepEqual(out, []);
  });

  it("blocks a row pointing at a file that is gone", () => {
    const out = checkManifestShape({
      rows: { "car.bullseye": { file: "cars/bullseye.png" } },
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
    assert.ok(isKnownNamespace("car.bullseye"));
    assert.ok(isKnownNamespace("weapon-icon.magmablast"));
  });

  it("accepts turret keys, in the same scope as chassis sprites", () => {
    assert.ok(isKnownNamespace("turret.default"));
    assert.ok(isKnownNamespace("turret.mirage"));
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

describe("namespaceScopeOf", () => {
  it("puts a turret row in the same scope as a car row: cars", () => {
    assert.equal(namespaceScopeOf("turret.default"), "cars");
    assert.equal(namespaceScopeOf("turret.mirage"), "cars");
    assert.equal(namespaceScopeOf("car.mirage"), "cars");
  });

  it("puts a weapon icon in its own scope, and an unknown key in none", () => {
    assert.equal(namespaceScopeOf("weapon-icon.thumper"), "weapons");
    assert.equal(namespaceScopeOf("power.boost"), undefined);
  });
});

describe("checkTurretSprite", () => {
  it("passes a greyscale, 32-bit turret image", () => {
    const out = checkTurretSprite({ turretId: "default", row: goodSpriteRow, image: goodSprite });
    assert.deepEqual(out, []);
  });

  it("blocks a turret row naming a file that is not on disk", () => {
    const out = checkTurretSprite({ turretId: "default", row: goodSpriteRow, image: undefined });
    assert.equal(levelOf(out, "missing-file"), "blocker");
  });

  it("blocks a turret image saved without an alpha channel", () => {
    const out = checkTurretSprite({
      turretId: "default",
      row: goodSpriteRow,
      image: { ...goodSprite, hasAlpha: false, channels: 3 },
    });
    assert.equal(levelOf(out, "no-alpha"), "blocker");
  });

  it("warns when a tinted turret still carries colour", () => {
    const out = checkTurretSprite({
      turretId: "default",
      row: goodSpriteRow,
      image: { ...goodSprite, maxChroma: GREYSCALE_CHROMA_LIMIT + 1 },
    });
    assert.equal(levelOf(out, "not-greyscale"), "warning");
  });

  it('exempts pre-coloured art, because colorMode "none" opts out of the tint', () => {
    const out = checkTurretSprite({
      turretId: "default",
      row: { ...goodSpriteRow, colorMode: "none" },
      image: { ...goodSprite, maxChroma: 200 },
    });
    assert.ok(!codes(out).includes("not-greyscale"));
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

/**
 * The union sweep (MC5). Both shipped modes are byte-identical today — neither's `config.ts`
 * overrides these tables, so both resolve to the same base — so there is no divergence here to
 * assert on, and a test claiming "mode 2's roster differs from mode 0's" could only ever pass by
 * accident. What is asserted is the PLUMBING:
 * that the sweep asked the mode bundles at all rather than one table, and that a partial carriage
 * is what produces the `(mode: ...)` marker.
 *
 * Every expectation is built from `MODE_TABLE` rather than from `everyMode()`, which is the thing
 * under test: asserting a sweep against its own idea of how many modes there are would still pass
 * if it forgot all but one of them.
 */
describe("mode-rosters: the union of every mode's carried rows (MC5)", () => {
  const ALL_MODES = Object.keys(MODE_TABLE)
    .map((key) => Number(key))
    .sort((a, b) => a - b);

  it("knows about every mode in the registry", () => {
    assert.deepEqual(everyMode(), ALL_MODES);
  });

  it("sweeps the union of every mode's car and weapon ids, not one table's", () => {
    const carUnion = new Set(ALL_MODES.flatMap((m) => Object.keys(modeConfigOf(m).cars)));
    const weaponUnion = new Set(ALL_MODES.flatMap((m) => Object.keys(modeConfigOf(m).weapons)));
    assert.deepEqual(new Set(carRoster().map((r) => r.id)), carUnion);
    assert.deepEqual(new Set(weaponRoster().map((r) => r.id)), weaponUnion);
  });

  it("records which modes publish a chassis and which carry a weapon", () => {
    const cars = new Map(carRoster().map((r) => [r.id, r.publishedIn]));
    assert.deepEqual(cars.get("mirage"), ALL_MODES); // shipped, so published everywhere
    assert.deepEqual(cars.get("taurus"), []); // a prototype no mode publishes
    const weapons = new Map(weaponRoster().map((r) => [r.id, r.carriedIn]));
    assert.deepEqual(weapons.get("predator"), ALL_MODES);
    assert.deepEqual(weapons.get("basic-attack-taurus"), ALL_MODES); // a basic attack counts
    assert.deepEqual(weapons.get("tremor"), []); // authored, carried by nobody, still swept
  });

  it("marks only a row the modes disagree about", () => {
    const all = ALL_MODES;
    assert.equal(carriageLabel(all, "(inactive)"), "");
    assert.equal(carriageLabel([], "(inactive)"), "(inactive)");
    assert.equal(carriageLabel([]), "");
    assert.equal(carriageLabel([all[0]]), `(mode: ${modeNameOf(all[0])})`);
  });

  it("carries the carriage through checkCars and checkWeapons to the report", async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(artDir, "manifest.json"), "utf8"));
    const cars = await checkCars(manifest);
    assert.deepEqual(
      cars.map((r) => [r.id, r.publishedIn]),
      carRoster().map((r) => [r.id, r.publishedIn]),
    );
    const weapons = await checkWeapons(manifest);
    assert.deepEqual(
      weapons.map((r) => [r.id, r.carriedIn]),
      weaponRoster().map((r) => [r.id, r.carriedIn]),
    );
  });
});
