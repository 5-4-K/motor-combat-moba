/**
 * Inspect a candidate car image and report, as one JSON object, everything needed to decide
 * whether `scripts/import-art.mjs` should run on it and with which flags.
 *
 * This exists so the check is one command instead of an ad-hoc sharp script written fresh each
 * time — and so the numbers it prints are the *same* numbers the importer will produce. The fit
 * maths is imported from the importer rather than reimplemented; a preflight that disagreed with
 * the tool it gates would be worse than no preflight at all.
 *
 * Findings are split by what the caller should do with them:
 *   blockers — the import must not run. Only two things land here: not a PNG, and no alpha channel.
 *   warnings — the import would run and produce something usable-but-questionable. Surface these
 *              and let the human decide; the pipeline's own philosophy is to degrade, not block.
 *   notes    — context that shapes the flags or the report, carrying no judgement.
 *
 * Usage: node .claude/skills/process-car-asset/scripts/preflight.mjs <image> [carId]
 * Exit codes: 0 = no blockers, 1 = blockers present, 2 = could not inspect at all.
 * JSON goes to stdout in every case, so the caller always has something to read.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The documented working size in `public/art/README.md`. Under this, the importer upscales and softens. */
const WORKING_LONG_EDGE = 128;

/** Luminance above which a corner pixel reads as "light background" rather than "part of the car". */
const LIGHT_CORNER_LUMINANCE = 150;

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The skill lives at <repo>/.claude/skills/process-car-asset, so the repo root is three levels up.
const rootDir = path.resolve(skillDir, "..", "..", "..");
const manifestPath = path.join(rootDir, "packages", "client", "public", "art", "manifest.json");

function emit(payload, code) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(code);
}

const [source, carId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!source) {
  emit({ ok: false, blockers: [{ code: "no-source", message: "usage: preflight.mjs <image> [carId]" }] }, 2);
}

// Both of these come from the repo rather than the skill, and both have a specific remedy the
// caller can act on, so failing to load them is reported as structured data rather than a stack
// trace. `shared-not-built` in particular is the single most common way this pipeline surprises
// people: the importer reads the hull from shared's *built* dist, not its source.
let sharp;
let shared;
let importer;
try {
  sharp = (await import("sharp")).default;
} catch {
  emit({ ok: false, blockers: [{ code: "sharp-missing", message: "sharp is not installed. Run `npm install` at the repo root." }] }, 2);
}
try {
  shared = await import(pathToFileURL(path.join(rootDir, "packages", "shared", "dist", "index.js")).href);
  importer = await import(pathToFileURL(path.join(rootDir, "scripts", "import-art.mjs")).href);
} catch (err) {
  emit({
    ok: false,
    blockers: [{
      code: "shared-not-built",
      message: `could not load shared's dist: ${err.message}. Run \`npm run build -w @motor-combat-moba/shared\`.`,
    }],
  }, 2);
}

const { CAR_TABLE, DRIVE_CONFIG, isCarId } = shared;
const { outputSizeFor, describeFit, importWarnings } = importer;

const hull = { width: DRIVE_CONFIG.carWidth, height: DRIVE_CONFIG.carHeight };
const knownCarIds = Object.keys(CAR_TABLE);
const blockers = [];
const warnings = [];
const notes = [];

if (carId !== undefined && !isCarId(carId)) {
  blockers.push({
    code: "unknown-car-id",
    message: `unknown carId "${carId}". Known ids: ${knownCarIds.join(", ")}.`,
  });
}

if (!fs.existsSync(source)) {
  emit({ ok: false, hull, knownCarIds, blockers: [...blockers, { code: "missing-file", message: `no such image: ${source}` }] }, 1);
}

let meta;
try {
  meta = await sharp(source).metadata();
} catch (err) {
  emit({
    ok: false,
    hull,
    knownCarIds,
    blockers: [...blockers, { code: "undecodable", message: `could not decode ${source}: ${err.message}` }],
  }, 1);
}

// --- The two hard gates -----------------------------------------------------------------------
// PNG-only and alpha-required are stricter than the importer itself, which would happily take a
// JPEG and warn. That strictness is deliberate: a car sprite is composited over the arena, so an
// opaque rectangle is not a lesser result, it is a wrong one, and the fix (re-export) belongs
// upstream of this pipeline rather than inside it.

if (meta.format !== "png") {
  blockers.push({
    code: "not-png",
    message: `source is ${meta.format}, not png. Car sprites are composited over the arena and need real transparency — re-export as PNG.`,
  });
}
if (!meta.hasAlpha) {
  blockers.push({
    code: "no-alpha",
    message: "source has no alpha channel — its background is opaque pixels. Re-export as PNG with transparency.",
  });
}

const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const pixels = info.width * info.height;
let transparent = 0;
for (let i = 3; i < data.length; i += 4) if (data[i] === 0) transparent++;
const transparentFraction = transparent / pixels;

const cornerLuminance = [
  [0, 0],
  [info.width - 1, 0],
  [0, info.height - 1],
  [info.width - 1, info.height - 1],
].map(([x, y]) => {
  const i = (y * info.width + x) * 4;
  return { opaque: data[i + 3] !== 0, luminance: 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] };
});
const bakedBackground = cornerLuminance.every((c) => c.opaque && c.luminance > LIGHT_CORNER_LUMINANCE);

// An alpha channel that is entirely opaque satisfies `hasAlpha` while delivering none of what
// alpha is for. It stays a warning rather than a blocker because `--key-background` can genuinely
// rescue it when the car has a continuous dark outline — that is a judgement call, not a rule.
if (meta.hasAlpha && transparent === 0) {
  warnings.push({
    code: "alpha-fully-opaque",
    message: "the alpha channel exists but no pixel is transparent — the background is baked in as real pixels.",
    suggestedFlag: "--key-background",
  });
} else if (bakedBackground) {
  warnings.push({
    code: "opaque-corners",
    message: "all four corners are opaque and light — part of the background may be baked in even though the image has some transparency.",
    suggestedFlag: "--key-background",
  });
}

// Trim on the raw buffer, exactly as the importer does, so `bbox` below is the art the game will
// actually draw rather than the canvas it happened to be exported on.
let bbox = null;
let out = null;
let fit = null;
try {
  const trimmed = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim()
    .toBuffer({ resolveWithObject: true });
  bbox = { width: trimmed.info.width, height: trimmed.info.height };
  out = outputSizeFor(bbox, 4 * Math.max(hull.width, hull.height));
  fit = describeFit(out, hull);
} catch (err) {
  blockers.push({
    code: "empty-after-trim",
    message: `nothing left after trimming transparent margin (${err.message}) — the image looks blank.`,
  });
}

if (bbox) {
  const sourceLongEdge = Math.max(bbox.width, bbox.height);
  if (sourceLongEdge < WORKING_LONG_EDGE) {
    warnings.push({
      code: "small-source",
      message: `art is only ${bbox.width}x${bbox.height} after trim; the importer renders at ${4 * Math.max(hull.width, hull.height)}px on the long edge, so this will be upscaled and soft.`,
    });
  }
  // Delegate to the importer's own warning set rather than recomputing it: two implementations of
  // "does this fill the hull" drift by a percentage point and make the preflight look wrong when it
  // is merely rounding differently. `hasAlpha`/`keyed` are pinned true only to suppress its alpha
  // warning, which is a blocker here and already reported above; anything else it grows, we inherit.
  for (const message of importWarnings({ hasAlpha: true, keyed: true, format: meta.format, source: bbox, hull })) {
    warnings.push({ code: "under-fills-hull", message });
  }
  if (transparentFraction > 0.9) {
    warnings.push({
      code: "mostly-transparent",
      message: `${(transparentFraction * 100).toFixed(1)}% of the source is transparent — check the subject is not a speck on a huge canvas.`,
    });
  }
}

// --- Manifest context -------------------------------------------------------------------------
// Read rather than judged: an existing row is normal (re-importing is the supported way to swap
// art) but the human should know their tuned fields are being preserved and their file replaced.
let manifestEntry = null;
if (carId && isCarId(carId)) {
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { sprites: {} };
  manifestEntry = manifest.sprites?.[`car.${carId}`] ?? null;
  if (manifestEntry) {
    notes.push({
      code: "existing-entry",
      message: `car.${carId} already exists in the manifest (file: ${manifestEntry.file}). Its art will be replaced; hand-tuned fields are preserved.`,
    });
    if (manifestEntry.colorMode === "none") {
      notes.push({
        code: "pre-coloured",
        message: `car.${carId} is marked colorMode "none", so the importer keeps colour without needing --keep-color.`,
      });
    }
  }
}

emit({
  ok: blockers.length === 0,
  source: {
    path: source,
    format: meta.format,
    hasAlpha: Boolean(meta.hasAlpha),
    width: meta.width,
    height: meta.height,
    transparentFraction: Number(transparentFraction.toFixed(4)),
  },
  trimmed: bbox && { ...bbox, aspect: Number((bbox.width / bbox.height).toFixed(2)) },
  output: out,
  inGame: fit && {
    hull,
    drawnWidth: Number(fit.drawnWidth.toFixed(1)),
    drawnHeight: Number(fit.drawnHeight.toFixed(1)),
    hullCoverage: `${((100 * fit.drawnWidth) / hull.width).toFixed(0)}% x ${((100 * fit.drawnHeight) / hull.height).toFixed(0)}%`,
  },
  carId: carId ?? null,
  knownCarIds,
  manifestEntry,
  blockers,
  warnings,
  notes,
}, blockers.length === 0 ? 0 : 1);
