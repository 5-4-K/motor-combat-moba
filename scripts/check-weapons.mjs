/**
 * Verify every weapon's HUD icon is still something the client can draw.
 *
 * `scripts/import-weapon-icon.mjs` guarantees a correct icon on the way in, but only for art that
 * goes *through* it. An icon repainted in place — Paint.NET, Photoshop, anything — bypasses every
 * guardrail the importer has, and the worst failure is silent: a PNG saved at 24-bit still loads,
 * so the client never falls back to its procedural glyph. It just draws an opaque square in the
 * slot, and nobody finds out until they look at the HUD.
 *
 * Pure helpers are exported and unit-tested; the sharp I/O and the CLI are the impure shell, the
 * same split `import-weapon-icon.mjs` uses.
 */

/**
 * How far a weapon's `WEAPON_TABLE.color` may sit from the nearest colour its icon actually uses,
 * as a plain RGB distance, before this warns about drift.
 *
 * Calibrated against the committed roster rather than picked. As of the 2026-09-01 roster cutover
 * only five weapons carry an icon at all (`predator`, `thunderclap`, `roadblock` and `wildcharge`
 * have none yet, and warn separately as a missing manifest row): pepperbox (0, exact match),
 * thumper (27), afterburner (40) and lance (47) all sit well under this limit. `shockwave` (153) is
 * the one exception, and it is EXPECTED to warn — its icon still depicts the retired three-wave
 * aura and has not been re-imported against the redefined weapon's navy, which the roster cutover's
 * own task history flags as an open owner decision, not a bug in this check. 100 sits
 * above every icon whose colour is arguably the same hue family and below the one that is plainly a
 * different colour from its shot. It is a warning, never a blocker — an icon is allowed more than
 * one colour, and only a person can say whether the pair reads as one weapon.
 */
export const COLOR_DRIFT_LIMIT = 100;

/** Opaque-pixel share a colour must hold to count as one of an icon's colours rather than an edge blend. */
export const COLOR_CLUSTER_MIN_SHARE = 0.03;

/** Findings carry a level so the caller decides what is fatal; only `blocker` fails the suite. */
export function finding(level, code, message) {
  return { level, code, message };
}

/**
 * Every complaint about one weapon's icon, from facts already gathered.
 *
 * `image` is `undefined` when the file is missing, and `row` is `undefined` when the manifest has
 * no entry. Those are different failures: a missing row is the documented fallback to the
 * procedural glyph and merely a warning, while a row pointing at a file that is not there is a
 * manifest that lies.
 */
export function checkWeaponIcon({ weaponId, row, image, colorDistance, iconPx }) {
  const out = [];
  if (!row) {
    out.push(
      finding(
        "warning",
        "missing-row",
        `no manifest row "weapon-icon.${weaponId}" — the HUD falls back to its procedural glyph`,
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
        "no alpha channel — the slot draws an opaque box behind the icon. Re-save as a 32-bit PNG",
      ),
    );
  }
  if (row.colorMode !== "none") {
    out.push(
      finding(
        "blocker",
        "tinted-row",
        `colorMode is ${JSON.stringify(row.colorMode)}, not "none" — the icon would be player-tinted into a grey blob`,
      ),
    );
  }
  if (image.palettized) {
    out.push(
      finding("warning", "palettized", "saved as a palette PNG, which bands the anti-aliased edges"),
    );
  }
  if (image.width !== iconPx || image.height !== iconPx) {
    out.push(
      finding(
        "warning",
        "off-size",
        `${image.width}x${image.height}, not ${iconPx}x${iconPx} — it still fits, but below 2x the HUD box it softens`,
      ),
    );
  }
  if (colorDistance !== undefined && colorDistance > COLOR_DRIFT_LIMIT) {
    out.push(
      finding(
        "warning",
        "color-drift",
        `nothing in the icon is near its WEAPON_TABLE.color (distance ${Math.round(colorDistance)}) — the slot and the shot read as different weapons`,
      ),
    );
  }
  return out;
}

/** RGB triple from a `#rrggbb` string. Returns `undefined` for anything else. */
export function rgbFromHex(hex) {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return undefined;
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Plain RGB distance. Not perceptual, and deliberately so: it only has to separate hues, not rank them. */
export function rgbDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Distance from `target` to the nearest colour the icon actually carries.
 *
 * Ignores anything under `COLOR_CLUSTER_MIN_SHARE` of the opaque pixels, so an anti-aliased rim
 * between two fills cannot masquerade as a colour the icon uses.
 */
export function nearestColorDistance(clusters, target) {
  let best;
  for (const c of clusters) {
    if (c.share < COLOR_CLUSTER_MIN_SHARE) continue;
    const d = rgbDistance(c.rgb, target);
    if (best === undefined || d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------------------
// CLI shell: the only part that touches the filesystem, sharp, or process.argv.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { WEAPON_TABLE } from "../packages/shared/dist/index.js";
import { ICON_PX, weaponIconKeyOf } from "./import-weapon-icon.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artDir = path.join(rootDir, "packages", "client", "public", "art");
const manifestPath = path.join(artDir, "manifest.json");

/** Bucket size when clustering an icon's colours. Coarse on purpose — hues, not shades. */
const COLOR_BUCKET = 24;
/** Alpha at or above which a pixel counts as part of the artwork rather than its edge. */
const OPAQUE_AT = 250;

/** Metadata plus the colour clusters, or `undefined` when the file is not there. */
export async function readIconFacts(file) {
  if (!fs.existsSync(file)) return undefined;
  const meta = await sharp(file).metadata();
  const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const counts = new Map();
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < OPAQUE_AT) continue;
    opaque++;
    const key = [data[i], data[i + 1], data[i + 2]]
      .map((v) => Math.round(v / COLOR_BUCKET) * COLOR_BUCKET)
      .join(",");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const clusters = [...counts.entries()]
    .map(([key, n]) => ({ rgb: key.split(",").map(Number), share: opaque > 0 ? n / opaque : 0 }))
    .sort((a, b) => b.share - a.share);
  return {
    width: meta.width,
    height: meta.height,
    channels: meta.channels,
    hasAlpha: Boolean(meta.hasAlpha),
    palettized: meta.paletteBitDepth !== undefined,
    clusters,
  };
}

/** Every weapon's findings, in `WEAPON_TABLE` order. */
export async function checkWeapons(manifest) {
  const results = [];
  for (const weaponId of Object.keys(WEAPON_TABLE)) {
    const row = manifest.sprites?.[weaponIconKeyOf(weaponId)];
    const image = row ? await readIconFacts(path.join(artDir, row.file)) : undefined;
    const target = rgbFromHex(WEAPON_TABLE[weaponId].color);
    const colorDistance = image && target ? nearestColorDistance(image.clusters, target) : undefined;
    results.push({
      id: weaponId,
      colorDistance,
      findings: checkWeaponIcon({ weaponId, row, image, colorDistance, iconPx: ICON_PX }),
    });
  }
  return results;
}

/** Print one line per weapon plus its findings, and return how many blockers were seen. */
export function reportWeapons(results) {
  let blockers = 0;
  for (const { id, colorDistance, findings } of results) {
    const verdict = findings.some((f) => f.level === "blocker")
      ? "FAIL"
      : findings.length > 0
        ? "warn"
        : "ok";
    const drift = colorDistance === undefined ? "" : `  colour distance ${Math.round(colorDistance)}`;
    console.log(`${verdict.padEnd(5)} ${id.padEnd(12)}${drift}`);
    for (const f of findings) {
      console.log(`        ${f.level}: ${f.message}`);
      if (f.level === "blocker") blockers++;
    }
  }
  return blockers;
}

export async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const results = await checkWeapons(manifest);
  const blockers = reportWeapons(results);
  console.log(
    blockers === 0
      ? `\n${results.length} weapon icons, no blockers`
      : `\n${blockers} blocker(s) — the HUD will draw these wrong`,
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
