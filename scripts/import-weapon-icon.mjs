/**
 * Import a generated image as a weapon's HUD icon: trim, fit to a square, and wire the manifest
 * row. The counterpart to `packages/client/public/art/README.md` and the weapon-icon sibling of
 * `scripts/import-art.mjs` — read that file first, this one follows its CLI parsing, manifest
 * read-modify-write, and error reporting on purpose.
 *
 * The one rule that differs from the car pipeline: weapon icons keep their colour. The car
 * importer desaturates because a car's sprite is tinted by the player's colour at runtime: apply
 * that same desaturate-then-tint treatment to an icon and every weapon's icon comes out the same
 * grey blob. So there is deliberately no `.greyscale()` anywhere in this file, and the manifest
 * row below is always written with `colorMode: "none"` — never inferred, never a flag.
 *
 * Pure helpers are exported and unit-tested; the sharp I/O and the CLI are the impure shell.
 */

/** Twice the 64px HUD box, so the icon stays sharp and the deferred dpr work needs no re-import. */
export const ICON_PX = 128;

/** The manifest key namespace for weapon icons. Mirrors `weaponIconKey` in the client's asset-keys. */
export const WEAPON_ICON_KEY_PREFIX = "weapon-icon.";

/**
 * The manifest key for a weapon's HUD icon. This script is plain `.mjs` and cannot import the
 * client's TypeScript, so the prefix is the one thing duplicated between here and
 * `packages/client/src/assets/asset-keys.ts` — the ids themselves are not: both read from shared's
 * `WeaponId`.
 */
export function weaponIconKeyOf(weaponId) {
  return `${WEAPON_ICON_KEY_PREFIX}${weaponId}`;
}

/**
 * The manifest row for an icon. Deliberately NOT the car defaults: `colorMode: "none"` because an
 * icon is not player-tinted (the car importer desaturates for tinting, which would leave an icon a
 * grey blob), and `scale: "fit"` against the square slot box rather than the 48x32 car hull.
 *
 * Any field already present is preserved, so a hand-tuned `origin` survives a re-import — the same
 * contract `mergeManifestEntry` keeps for cars.
 */
export function iconManifestRow(weaponId, existing = {}) {
  return {
    ...existing,
    file: `weapon-icons/${weaponId}.png`,
    colorMode: "none",
    scale: existing.scale ?? "fit",
  };
}

// ---------------------------------------------------------------------------
// CLI shell: the only part that touches the filesystem, sharp, or process.argv.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { CAR_TABLE, isWeaponId, WEAPON_TABLE } from "../packages/shared/dist/index.js";
import { formatManifest } from "./import-art.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artDir = path.join(rootDir, "packages", "client", "public", "art");
const manifestPath = path.join(artDir, "manifest.json");

function parseArgs(argv) {
  let weapon;
  let src;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--weapon") weapon = argv[++i];
    else if (argv[i] === "--src") src = argv[++i];
  }
  return { weapon, src };
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) return { sprites: {} };
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

export async function main(argv = process.argv.slice(2)) {
  const { weapon, src } = parseArgs(argv);
  if (!weapon || !src) {
    throw new Error("usage: node scripts/import-weapon-icon.mjs --weapon <id> --src <path>");
  }
  if (!fs.existsSync(src)) throw new Error(`no such image: ${src}`);
  if (!isWeaponId(weapon)) {
    throw new Error(`unknown weapon "${weapon}". Known: ${Object.keys(WEAPON_TABLE).join(", ")}`);
  }

  const meta = await sharp(src).metadata();

  const outDir = path.join(artDir, "weapon-icons");
  fs.mkdirSync(outDir, { recursive: true });
  const file = `weapon-icons/${weapon}.png`;
  const dest = path.join(artDir, file);

  // trim then contain-fit into a square ICON_PX canvas. No `.greyscale()` here — see the file
  // header: icons keep their colour, unlike car sprites.
  await sharp(src)
    .trim()
    .resize(ICON_PX, ICON_PX, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(dest);

  const manifest = readManifest();
  const key = weaponIconKeyOf(weapon);
  manifest.sprites ??= {};
  manifest.sprites[key] = iconManifestRow(weapon, manifest.sprites[key]);
  // The car importer's formatter, shared rather than re-spelled. Writing this file with a plain
  // `JSON.stringify` reflowed every number pair `formatManifest` folds onto one line, so alternating
  // the two importers churned the whole manifest's formatting on every run.
  fs.writeFileSync(manifestPath, formatManifest(manifest));

  console.log(`source        ${meta.width} x ${meta.height}  (${meta.format}${meta.hasAlpha ? ", alpha" : ", no alpha"})`);
  console.log(`colorMode     none (icons keep their colour, never desaturated)`);
  console.log(`\nwrote         ${path.relative(rootDir, dest)}  ${ICON_PX}x${ICON_PX}`);
  console.log(`manifest      ${key} -> ${file}`);
  // Unlike a car sprite, there is no `?dev=assets` preview for weapon icons — that tool only ever
  // walked `CAR_TABLE`. The only place to judge the fit is the live HUD, which means the icon is
  // only visible at all if some car's loadout actually carries this weapon. `repeater` carries none
  // by design, so "join a match with it equipped" is advice nobody can follow: say so instead.
  const carriers = Object.keys(CAR_TABLE).filter((carId) => CAR_TABLE[carId].weapons.includes(weapon));
  console.log(
    carriers.length > 0
      ? `next          npm run dev, drive ${carriers.join(" / ")}, check the HUD slot bar`
      : `next          no car carries "${weapon}", so no HUD slot shows it — add it to a CAR_TABLE loadout to judge the fit`,
  );
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1]);
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
