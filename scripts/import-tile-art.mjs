/**
 * Import an image as one tile type's art (spec tile arenas, §5.1, TA21): resize to exactly
 * TILE_PX x TILE_PX — no trim, tiles are full-bleed — write it under arenas/common/, and wire the
 * manifest row. `spike-teeth` is the edge overlay: author it for the tile's TOP edge, transparent
 * elsewhere, with the points on the edge and nothing past it. Follows import-weapon-icon.mjs's CLI
 * and manifest handling.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { TILE_DEFS } from "../packages/shared/dist/index.js";
import { formatManifest } from "./import-art.mjs";

/** Twice the 40 u tile, so a tile is sharp at the bake's 2 px per unit (TA4). */
export const TILE_PX = 80;

/** Every art id a tile definition names: its default art and its overlay (tile cells TC14, TC6). */
export const TILE_ART_IDS = [
  ...new Set(Object.values(TILE_DEFS).flatMap((t) => [t.defaultArt, t.overlay?.art].filter((a) => a !== undefined))),
];

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
  let tile;
  let src;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tile") tile = argv[++i];
    else if (argv[i] === "--src") src = argv[++i];
  }
  return { tile, src };
}

export async function main(argv = process.argv.slice(2)) {
  const { tile, src } = parseArgs(argv);
  if (!tile || !src) throw new Error("usage: node scripts/import-tile-art.mjs --tile <id> --src <path>");
  if (!TILE_ART_IDS.includes(tile)) {
    throw new Error(`unknown tile art "${tile}". Known: ${TILE_ART_IDS.join(", ")}`);
  }
  if (!fs.existsSync(src)) throw new Error(`no such image: ${src}`);

  const meta = await sharp(src).metadata();
  const row = tileManifestRow(tile);
  const dest = path.join(artDir, row.file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await sharp(src).resize(TILE_PX, TILE_PX, { fit: "fill" }).png().toFile(dest);

  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : { sprites: {} };
  const key = tileArtKeyOf(tile);
  manifest.sprites ??= {};
  manifest.sprites[key] = tileManifestRow(tile, manifest.sprites[key]);
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
