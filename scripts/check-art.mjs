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
 * Whether a key sits in a namespace the client resolves. Arena keys are included even though no
 * arena art exists yet: the convention is live in `build-release.mjs`'s pruning, so a key landing
 * there early is correct, not a mistake. See `packages/shared/src/arena/art-keys.ts`.
 */
export function isKnownNamespace(key) {
  return (
    key.startsWith("car.") ||
    key.startsWith("weapon-icon.") ||
    arenaIdFromArtKey(key) !== undefined
  );
}

// ---------------------------------------------------------------------------
// CLI shell: the only part that touches the filesystem, sharp, or process.argv.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkCars, reportCars } from "./check-cars.mjs";
import { checkWeapons, reportWeapons } from "./check-weapons.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artDir = path.join(rootDir, "packages", "client", "public", "art");
const manifestPath = path.join(artDir, "manifest.json");

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

  console.log("\nWEAPON ICONS");
  const weaponBlockers = reportWeapons(await checkWeapons(manifest));

  const blockers = countBlockers(shape) + carBlockers + weaponBlockers;
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
