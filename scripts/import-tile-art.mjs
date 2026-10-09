/**
 * Import an image as one tile art id (spec tile arenas, §5.1, TA21; tile cells TC30): resize to exactly
 * TILE_PX x TILE_PX — no trim, tiles are full-bleed — write it under arenas/common/, and wire the
 * manifest row. `spike-teeth` is the edge overlay: author it for the tile's TOP edge, transparent
 * elsewhere, with the points on the edge and nothing past it. Follows import-weapon-icon.mjs's CLI
 * and manifest handling.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { formatManifest } from "./import-art.mjs";

/** Twice the 40 u tile, so a tile is sharp at the bake's 2 px per unit (TA4). */
export const TILE_PX = 80;

/** Art is named by look, not by tile (TC29): any lowercase kebab-case id may be imported (TC30). */
export function isTileArtId(id) {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id);
}

export function tileArtKeyOf(artId) {
  return `arena.common.tile.${artId}`;
}

/** Any field already present survives a re-import, the contract the other importers keep. */
export function tileManifestRow(artId, existing = {}) {
  return { ...existing, file: `arenas/common/tile-${artId}.png`, colorMode: "none" };
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artDir = path.join(rootDir, "packages", "client", "public", "art");
const manifestPath = path.join(artDir, "manifest.json");

function parseArgs(argv) {
  let art;
  let src;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--art") art = argv[++i];
    else if (argv[i] === "--src") src = argv[++i];
  }
  return { art, src };
}

export async function main(argv = process.argv.slice(2)) {
  const { art, src } = parseArgs(argv);
  if (!art || !src) throw new Error("usage: node scripts/import-tile-art.mjs --art <id> --src <path>");
  if (!isTileArtId(art)) {
    throw new Error(`bad art id "${art}": use lowercase letters, digits and single hyphens, e.g. metal-plate`);
  }
  if (!fs.existsSync(src)) throw new Error(`no such image: ${src}`);

  const meta = await sharp(src).metadata();
  const row = tileManifestRow(art);
  const dest = path.join(artDir, row.file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await sharp(src).resize(TILE_PX, TILE_PX, { fit: "fill" }).png().toFile(dest);

  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : { sprites: {} };
  const key = tileArtKeyOf(art);
  manifest.sprites ??= {};
  manifest.sprites[key] = tileManifestRow(art, manifest.sprites[key]);
  fs.writeFileSync(manifestPath, formatManifest(manifest));

  console.log(`source        ${meta.width} x ${meta.height}  (${meta.format}${meta.hasAlpha ? ", alpha" : ", no alpha"})`);
  console.log(`wrote         ${path.relative(rootDir, dest)}  ${TILE_PX}x${TILE_PX}`);
  console.log(`manifest      ${key} -> ${row.file}`);
  console.log("next          npm run dev and play arena-01 — the floor is baked from tile art at load");
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1]);
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
