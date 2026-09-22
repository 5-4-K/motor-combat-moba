/**
 * Check every art asset the client ships, and the manifest that names them.
 *
 * The umbrella over `scripts/check-cars.mjs` and `scripts/check-weapons.mjs`: this file owns the
 * questions that are about the manifest as a whole rather than about one image — rows pointing at
 * files that are gone, files nothing points at, keys in a namespace the client will never look up.
 *
 * Why any of this exists: `import-art.mjs` and `import-weapon-icon.mjs` guarantee correct art on
 * the way in, but only for art that goes through them. A PNG repainted in place bypasses both, and
 * the worst failure — a save that dropped the alpha channel — still loads, so nothing falls back
 * and nothing complains. See `CLAUDE.md`, "Art is the exception".
 *
 * Blockers fail the suite. Warnings and notes never do: they describe art that will draw, but
 * probably not the way someone intended, and only a person looking at the screen can settle that.
 */

import { arenaIdFromArtKey } from "../packages/shared/dist/index.js";
import { finding } from "./check-weapons.mjs";
import { GREYSCALE_CHROMA_LIMIT } from "./check-cars.mjs";
import { TURRET_KEY_PREFIX } from "./import-art.mjs";

/** Extensions treated as art. Anything else in the tree (READMEs, the manifest) is not an asset. */
export const ART_EXTENSIONS = [".png"];

/**
 * Manifest-wide findings: dangling rows, orphaned files, keys in no known namespace.
 *
 * `keys` is every sprite key in the manifest, `files` every art file found on disk as a path
 * relative to the art directory with forward slashes, and `referenced` the set of files the rows
 * name. Kept pure so the awkward cases — an empty manifest, a key with no file — are unit-testable
 * without a filesystem.
 */
export function checkManifestShape({ rows, files }) {
  const out = [];
  const referenced = new Set();
  for (const [key, row] of Object.entries(rows)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      out.push(
        finding("blocker", "prototype-key", `sprite key ${JSON.stringify(key)} is a prototype key`),
      );
      continue;
    }
    if (typeof row?.file !== "string" || row.file.length === 0) {
      out.push(finding("blocker", "no-file", `sprite key "${key}" has no file`));
      continue;
    }
    referenced.add(row.file);
    if (!files.includes(row.file)) {
      out.push(
        finding("blocker", "dangling-row", `"${key}" names ${row.file}, which is not on disk`),
      );
    }
    if (!isKnownNamespace(key)) {
      out.push(
        finding(
          "warning",
          "unknown-namespace",
          `"${key}" is in no namespace the client looks up — it will never be drawn`,
        ),
      );
    }
  }
  for (const file of files) {
    if (!referenced.has(file)) {
      out.push(
        finding("warning", "orphan-file", `${file} is on disk but no manifest row names it`),
      );
    }
  }
  return out;
}

/**
 * Which class of art a manifest key belongs to, or `undefined` for a key in no namespace the client
 * resolves. Turret art shares the `"cars"` scope with chassis sprites rather than getting its own —
 * a car with no `turret.<id>` row still draws (its resolution order falls to `turret.default`, then
 * a procedural turret, exactly as a car with no `car.<id>` row falls to a procedural silhouette), and
 * both kinds of row carry the same player-tint rule a weapon icon's `colorMode: "none"` does not.
 * Arena keys are included even though no arena art exists yet: the convention is live in
 * `build-release.mjs`'s pruning, so a key landing there early is correct, not a mistake. See
 * `packages/shared/src/arena/art-keys.ts`.
 */
export function namespaceScopeOf(key) {
  if (key.startsWith("car.") || key.startsWith(TURRET_KEY_PREFIX)) return "cars";
  if (key.startsWith("weapon-icon.")) return "weapons";
  if (arenaIdFromArtKey(key) !== undefined) return "arenas";
  return undefined;
}

/** Whether a key sits in a namespace the client resolves at all. */
export function isKnownNamespace(key) {
  return namespaceScopeOf(key) !== undefined;
}

/**
 * Every complaint about one turret sprite, from facts already gathered. Mirrors `checkCarSprite` in
 * `scripts/check-cars.mjs` — a turret is player-tinted the same way a chassis sprite is, so it owes
 * the same alpha and greyscale rules — but is manifest-driven rather than roster-driven: unlike a
 * car, which is expected to eventually carry `car.<id>` art, a chassis owes no `turret.<id>` row at
 * all (the shared `turret.default` is a complete answer on its own), so this is only ever called for
 * a key that already exists in the manifest and never used to manufacture a "missing" warning for
 * every car that simply has not customised its turret.
 */
export function checkTurretSprite({ turretId, row, image }) {
  const out = [];
  if (!image) {
    out.push(finding("blocker", "missing-file", `manifest names ${row.file}, which is not on disk`));
    return out;
  }
  if (!image.hasAlpha || image.channels < 4) {
    out.push(
      finding(
        "blocker",
        "no-alpha",
        "no alpha channel — the turret draws as an opaque rectangle over the car. Re-save as a 32-bit PNG",
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
  return out;
}

// ---------------------------------------------------------------------------
// CLI shell: the only part that touches the filesystem, sharp, or process.argv.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkCars, readSpriteFacts, reportCars } from "./check-cars.mjs";
import { checkWeapons, reportWeapons } from "./check-weapons.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artDir = path.join(rootDir, "packages", "client", "public", "art");
const manifestPath = path.join(artDir, "manifest.json");

/**
 * Every turret row's findings, keyed by the id after `turret.`. Driven off the manifest rather than
 * off `CAR_TABLE`, unlike `checkCars` — see `checkTurretSprite`'s doc comment for why a car with no
 * turret row is not itself a finding.
 */
export async function checkTurrets(manifest) {
  const results = [];
  for (const [key, row] of Object.entries(manifest.sprites ?? {})) {
    if (!key.startsWith(TURRET_KEY_PREFIX)) continue;
    const turretId = key.slice(TURRET_KEY_PREFIX.length);
    const image = await readSpriteFacts(path.join(artDir, row.file));
    results.push({ id: turretId, findings: checkTurretSprite({ turretId, row, image }) });
  }
  return results;
}

/** Print one line per turret plus its findings, and return how many blockers were seen. */
export function reportTurrets(results) {
  let blockers = 0;
  for (const { id, findings } of results) {
    const verdict = findings.some((f) => f.level === "blocker")
      ? "FAIL"
      : findings.length > 0
        ? "warn"
        : "ok";
    console.log(`${verdict.padEnd(5)} turret.${id}`);
    for (const f of findings) {
      console.log(`        ${f.level}: ${f.message}`);
      if (f.level === "blocker") blockers++;
    }
  }
  return blockers;
}

/** Every art file under the art directory, relative to it, with forward slashes. */
export function artFilesOnDisk(dir = artDir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(abs, entry.name), childRel);
      else if (ART_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) out.push(childRel);
    }
  };
  walk(dir, "");
  return out.sort();
}

function countBlockers(findings) {
  return findings.filter((f) => f.level === "blocker").length;
}

export async function main() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (err) {
    console.error(`manifest.json will not parse: ${err.message}`);
    process.exit(1);
  }

  const shape = checkManifestShape({
    rows: manifest.sprites ?? {},
    files: artFilesOnDisk(),
  });

  console.log("MANIFEST");
  if (shape.length === 0) {
    const rows = Object.keys(manifest.sprites ?? {}).length;
    console.log(`ok    ${rows} rows, every file present, nothing orphaned`);
  }
  for (const f of shape) console.log(`      ${f.level}: ${f.message}`);

  console.log("\nCHASSIS SPRITES");
  const carBlockers = reportCars(await checkCars(manifest));

  console.log("\nTURRET SPRITES");
  const turretBlockers = reportTurrets(await checkTurrets(manifest));

  console.log("\nWEAPON ICONS");
  const weaponBlockers = reportWeapons(await checkWeapons(manifest));

  const blockers = countBlockers(shape) + carBlockers + turretBlockers + weaponBlockers;
  console.log(
    blockers === 0
      ? "\nall art checks pass"
      : `\n${blockers} blocker(s) — this art will not draw correctly in game`,
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
