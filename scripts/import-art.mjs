/**
 * Import a generated image into the client art folder: trim, downscale, desaturate, and wire the
 * manifest row. The counterpart to `packages/client/public/art/README.md` — that file explains what
 * the manifest fields mean, this one gets an image into shape to use them.
 *
 * Pure helpers are exported and unit-tested; the sharp I/O and the CLI are the impure shell.
 */

/** Below this fraction of the hull on either axis, the drawing visibly under-fills its hitbox. */
const MIN_HULL_COVERAGE = 0.8;

/** Luminance above which a pixel counts as background for `--key-background`. */
const LIGHT_THRESHOLD = 150;

/**
 * Clear the background of an opaque source by flooding inward from the four corners, stopping at
 * anything dark. The rescue path for art that arrived without alpha — a JPEG, or a render with a
 * checkerboard baked in as literal pixels.
 *
 * It only works when the subject has a continuous dark outline for the flood to stop against, which
 * is why it is opt-in rather than the default: on art without one, the fill walks straight through
 * a light panel and eats the vehicle. Fixing the export to a real PNG is always the better answer.
 *
 * Mutates `rgba` in place — the name says so because these buffers are large enough that copying
 * one per import would be the most expensive thing this script does. Returns the pixels cleared.
 */
export function keyBackgroundInPlace(rgba, { width, height, lightThreshold = LIGHT_THRESHOLD }) {
  const seen = new Uint8Array(width * height);
  const stack = [];

  const consider = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const k = y * width + x;
    if (seen[k]) return;
    const i = k * 4;
    const transparent = rgba[i + 3] === 0;
    const luminance = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    if (!transparent && luminance <= lightThreshold) return;
    seen[k] = 1;
    stack.push(k);
  };

  consider(0, 0);
  consider(width - 1, 0);
  consider(0, height - 1);
  consider(width - 1, height - 1);

  let cleared = 0;
  while (stack.length > 0) {
    const k = stack.pop();
    if (rgba[k * 4 + 3] !== 0) {
      rgba[k * 4 + 3] = 0;
      cleared++;
    }
    const x = k % width;
    const y = (k - x) / width;
    consider(x + 1, y);
    consider(x - 1, y);
    consider(x, y + 1);
    consider(x, y - 1);
  }
  return cleared;
}

/**
 * Scale a trimmed source so its longer edge lands on `longEdge`, preserving aspect. The short edge
 * is clamped to at least 1: a wildly wide source would otherwise round to a zero-height image,
 * which sharp rejects and which would read as a corrupt import rather than a bad source.
 */
export function outputSizeFor(bbox, longEdge) {
  const scale = longEdge / Math.max(bbox.width, bbox.height);
  return {
    width: Math.max(1, Math.round(bbox.width * scale)),
    height: Math.max(1, Math.round(bbox.height * scale)),
  };
}

/**
 * What the client will actually draw for a texture of this size, mirroring `resolveScale` in
 * `packages/client/src/assets/sprite-fit.ts` for the `"fit"` (contain) case. Reported at import
 * time so a source whose proportions fight the hull is visible before it reaches the game.
 */
export function describeFit(size, hull) {
  const scale = Math.min(hull.width / size.width, hull.height / size.height);
  return {
    scale,
    drawnWidth: size.width * scale,
    drawnHeight: size.height * scale,
  };
}

/**
 * Set a sprite's `file` while preserving every field alongside it. Re-importing a car must not
 * discard a `rotationOffset` or `origin` that was tuned by eye in `?dev=assets` — that tuning is
 * the expensive part, and the image is the cheap part.
 */
export function mergeManifestEntry(manifest, key, file) {
  const sprites = manifest?.sprites ?? {};
  return {
    ...manifest,
    sprites: { ...sprites, [key]: { ...sprites[key], file } },
  };
}

/**
 * Serialise the manifest the way a human would write it. `JSON.stringify` with an indent explodes
 * `origin` across three lines, and this is a file people hand-edit to tune `rotationOffset` and
 * friends — so number pairs are folded back onto one line. Structure and content are untouched.
 */
export function formatManifest(manifest) {
  const text = JSON.stringify(manifest, null, 2).replace(
    /\[\s+(-?[\d.eE+]+),\s+(-?[\d.eE+]+)\s+\]/g,
    "[$1, $2]",
  );
  return `${text}\n`;
}

/**
 * Problems worth naming that do not stop the import. Nothing here is fatal by design: the pipeline
 * degrades rather than blocks, so a questionable source still lands and is judged in `?dev=assets`.
 */
export function importWarnings({ hasAlpha, format, source, hull, keyed = false }) {
  const warnings = [];
  if (!hasAlpha && !keyed) {
    warnings.push(
      `${format} source has no alpha channel — its background is opaque pixels, not transparency. ` +
        `Re-export as PNG, or re-run with --key-background to flood-fill it out.`,
    );
  }
  const fit = describeFit(source, hull);
  const coverW = fit.drawnWidth / hull.width;
  const coverH = fit.drawnHeight / hull.height;
  if (coverW < MIN_HULL_COVERAGE || coverH < MIN_HULL_COVERAGE) {
    warnings.push(
      `art covers ${(coverW * 100).toFixed(0)}% x ${(coverH * 100).toFixed(0)}% of the ` +
        `${hull.width}x${hull.height} hull — it will look smaller than its hitbox. ` +
        `Regenerate closer to ${(hull.width / hull.height).toFixed(2)}:1.`,
    );
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// CLI shell: the only part that touches the filesystem, sharp, or process.argv.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { CAR_TABLE, DRIVE_CONFIG, isCarId } from "../packages/shared/dist/index.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artDir = path.join(rootDir, "packages", "client", "public", "art");
const manifestPath = path.join(artDir, "manifest.json");

/**
 * The manifest key namespace for cars. Mirrors `carSpriteKey` in
 * `packages/client/src/assets/asset-keys.ts` — this script is plain `.mjs` and cannot import the
 * client's TypeScript, so the prefix is the one thing duplicated. The ids themselves are not:
 * `isCarId` and `CAR_TABLE` come from shared, which owns them.
 */
export const CAR_KEY_PREFIX = "car.";

/**
 * Write the texture at twice the hull's long edge. The GPU minifies with plain bilinear filtering
 * (Phaser only builds mipmaps for power-of-two textures, and none are requested), which samples a
 * 2x2 texel block per screen pixel — so anything drawn below ~1:2 skips texels and shimmers as the
 * car moves. 2x keeps every zoom from 1.0 to 2.0 within that clean range, and sharp does the real
 * averaging here, offline, from the full-size source. Stays inside the 256px ceiling that
 * `public/art/README.md` documents.
 */
export const SUPERSAMPLE = 2;

function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const [source, carId] = argv.filter((a) => !a.startsWith("--"));
  return {
    source,
    carId,
    keepColor: flags.has("--keep-color"),
    keyBackground: flags.has("--key-background"),
  };
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) return { sprites: {} };
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

export async function main(argv = process.argv.slice(2)) {
  const { source, carId, keepColor, keyBackground } = parseArgs(argv);
  if (!source || !carId) {
    throw new Error(
      "usage: node scripts/import-art.mjs <image> <carId> [--keep-color] [--key-background]",
    );
  }
  if (!fs.existsSync(source)) throw new Error(`no such image: ${source}`);
  if (!isCarId(carId)) {
    throw new Error(`unknown carId "${carId}". Known: ${Object.keys(CAR_TABLE).join(", ")}`);
  }

  const hull = { width: DRIVE_CONFIG.carWidth, height: DRIVE_CONFIG.carHeight };
  const meta = await sharp(source).metadata();

  // Decode once to raw RGBA so the background key can run before anything else measures the art.
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (keyBackground) {
    const cleared = keyBackgroundInPlace(data, { width: info.width, height: info.height });
    console.log(`keyed         ${((100 * cleared) / (info.width * info.height)).toFixed(1)}% of the image cleared to transparent`);
  }

  const raw = { raw: { width: info.width, height: info.height, channels: 4 } };
  const trimmed = await sharp(data, raw).trim().toBuffer({ resolveWithObject: true });
  const bbox = { width: trimmed.info.width, height: trimmed.info.height };
  const out = outputSizeFor(bbox, SUPERSAMPLE * Math.max(hull.width, hull.height));

  const manifest = readManifest();
  const key = `${CAR_KEY_PREFIX}${carId}`;
  const preColoured = manifest.sprites?.[key]?.colorMode === "none";
  const greyscale = !keepColor && !preColoured;

  const file = `cars/${carId}.png`;
  const dest = path.join(artDir, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let pipeline = sharp(trimmed.data, {
    raw: { width: bbox.width, height: bbox.height, channels: 4 },
  }).resize(out.width, out.height, { fit: "fill" });
  if (greyscale) pipeline = pipeline.greyscale();
  await pipeline.png().toFile(dest);

  const fit = describeFit(out, hull);
  console.log(`source        ${meta.width} x ${meta.height}  (${meta.format}${meta.hasAlpha ? ", alpha" : ", no alpha"})`);
  console.log(`art           ${bbox.width} x ${bbox.height}   aspect ${(bbox.width / bbox.height).toFixed(2)}`);
  console.log(`in-game       drawn ${fit.drawnWidth.toFixed(1)} x ${fit.drawnHeight.toFixed(1)} inside the ${hull.width}x${hull.height} hull  (${((100 * fit.drawnWidth) / hull.width).toFixed(0)}% x ${((100 * fit.drawnHeight) / hull.height).toFixed(0)}%)`);
  console.log(`greyscale     ${greyscale ? "yes" : `no (${keepColor ? "--keep-color" : 'colorMode "none"'})`}`);

  for (const warning of importWarnings({
    hasAlpha: Boolean(meta.hasAlpha),
    format: meta.format,
    source: bbox,
    keyed: keyBackground,
    hull,
  })) {
    console.log(`\n! ${warning}`);
  }

  const next = mergeManifestEntry(manifest, key, file);
  fs.writeFileSync(manifestPath, formatManifest(next));
  console.log(`\nwrote         ${path.relative(rootDir, dest)}  ${out.width}x${out.height}`);
  console.log(`manifest      ${key} -> ${file}`);
  console.log(`next          npm run dev, then http://localhost:5173/?dev=assets`);
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1]);
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
