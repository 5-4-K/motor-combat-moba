/**
 * Verify every chassis sprite is still something the client can draw and tint.
 *
 * The weapon-icon sibling of this file is `scripts/check-weapons.mjs`; read its header for why
 * these checks exist at all. Cars carry one rule icons do not: a car sprite **is** player-tinted,
 * so it has to stay desaturated. Residual colour under a tint multiplies into mud, which is why
 * `scripts/import-art.mjs` greyscales on the way in — and why art repainted in place, or imported
 * with `--keep-color` by mistake, is worth catching here.
 *
 * Pure helpers are exported and unit-tested; the sharp I/O and the CLI are the impure shell.
 */

import { finding } from "./check-weapons.mjs";

/**
 * Chroma (max channel minus min) a sprite may reach before this calls it colour rather than grey.
 *
 * The three committed sprites measure exactly 0, so anything above the odd stray pixel is real
 * colour that arrived some way other than the importer. 12 leaves room for a stray blend without
 * letting a genuinely tinted panel through.
 */
export const GREYSCALE_CHROMA_LIMIT = 12;

/**
 * Every complaint about one chassis sprite, from facts already gathered.
 *
 * A sprite declaring `colorMode: "none"` opts out of tinting, so the greyscale rule does not apply
 * to it — that is the documented escape hatch for pre-coloured art, not a violation.
 */
export function checkCarSprite({ carId, row, image, expectedWidth }) {
  const out = [];
  if (!row) {
    out.push(
      finding(
        "warning",
        "missing-row",
        `no manifest row "car.${carId}" — the arena falls back to its procedural silhouette`,
      ),
    );
    return out;
  }
  if (!image) {
    out.push(finding("blocker", "missing-file", `manifest names ${row.file}, which is not on disk`));
    return out;
  }
  if (!image.hasAlpha || image.channels < 4) {
    out.push(
      finding(
        "blocker",
        "no-alpha",
        "no alpha channel — the car draws as an opaque rectangle over the floor. Re-save as a 32-bit PNG",
      ),
    );
  }
  if (image.palettized) {
    out.push(
      finding("warning", "palettized", "saved as a palette PNG, which bands the anti-aliased edges"),
    );
  }
  if (row.colorMode !== "none" && image.maxChroma > GREYSCALE_CHROMA_LIMIT) {
    out.push(
      finding(
        "warning",
        "not-greyscale",
        `carries colour (max chroma ${image.maxChroma}) but is player-tinted — the tint will muddy it. Re-import without --keep-color, or set colorMode "none"`,
      ),
    );
  }
  if (image.width !== expectedWidth) {
    out.push(
      finding(
        "warning",
        "off-width",
        `${image.width}px wide, not ${expectedWidth} — below 2x the hull the sprite shimmers as the car moves`,
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI shell: the only part that touches the filesystem, sharp, or process.argv.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { CAR_TABLE, DRIVE_CONFIG } from "../packages/shared/dist/index.js";
import { CAR_KEY_PREFIX, describeFit, SUPERSAMPLE } from "./import-art.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artDir = path.join(rootDir, "packages", "client", "public", "art");
const manifestPath = path.join(artDir, "manifest.json");

/** Alpha at or above which a pixel counts as part of the artwork rather than its edge. */
const OPAQUE_AT = 250;

/** The width `import-art.mjs` writes: twice the hull's long edge. */
export const expectedSpriteWidth = () => SUPERSAMPLE * DRIVE_CONFIG.carWidth;

/** Metadata plus the most saturated opaque pixel, or `undefined` when the file is not there. */
export async function readSpriteFacts(file) {
  if (!fs.existsSync(file)) return undefined;
  const meta = await sharp(file).metadata();
  const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let maxChroma = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < OPAQUE_AT) continue;
    const chroma =
      Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    if (chroma > maxChroma) maxChroma = chroma;
  }
  return {
    width: meta.width,
    height: meta.height,
    channels: meta.channels,
    hasAlpha: Boolean(meta.hasAlpha),
    palettized: meta.paletteBitDepth !== undefined,
    maxChroma,
  };
}

/** Every chassis's findings, in `CAR_TABLE` order. */
export async function checkCars(manifest) {
  const hull = { width: DRIVE_CONFIG.carWidth, height: DRIVE_CONFIG.carHeight };
  const results = [];
  for (const carId of Object.keys(CAR_TABLE)) {
    const row = manifest.sprites?.[`${CAR_KEY_PREFIX}${carId}`];
    const image = row ? await readSpriteFacts(path.join(artDir, row.file)) : undefined;
    results.push({
      id: carId,
      fit: image ? describeFit({ width: image.width, height: image.height }, hull) : undefined,
      findings: checkCarSprite({ carId, row, image, expectedWidth: expectedSpriteWidth() }),
    });
  }
  return results;
}

/** Print one line per chassis plus its findings, and return how many blockers were seen. */
export function reportCars(results) {
  let blockers = 0;
  for (const { id, fit, findings } of results) {
    const verdict = findings.some((f) => f.level === "blocker")
      ? "FAIL"
      : findings.length > 0
        ? "warn"
        : "ok";
    const drawn = fit
      ? `  fills ${Math.round((fit.drawnWidth / DRIVE_CONFIG.carWidth) * 100)}% x ${Math.round((fit.drawnHeight / DRIVE_CONFIG.carHeight) * 100)}% of the hull`
      : "";
    console.log(`${verdict.padEnd(5)} ${id.padEnd(12)}${drawn}`);
    for (const f of findings) {
      console.log(`        ${f.level}: ${f.message}`);
      if (f.level === "blocker") blockers++;
    }
  }
  return blockers;
}

export async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const results = await checkCars(manifest);
  const blockers = reportCars(results);
  console.log(
    blockers === 0
      ? `\n${results.length} chassis sprites, no blockers`
      : `\n${blockers} blocker(s) — the arena will draw these wrong`,
  );
  if (blockers > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1]);
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
