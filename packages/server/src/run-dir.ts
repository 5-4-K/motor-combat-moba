/**
 * Dated run-folder scheme shared by every headless harness that writes reports into a
 * `<yyyy-MM-dd-NN>/` folder under its own root: `playtest/` today, `balance/` after Task 15.
 *
 * One implementation, parameterized by `root`, rather than a copy per harness — a copy would
 * drift, and the drift would show up as reports scattered across folders, which is exactly the
 * bug the scan-not-counter design below avoids in the first place.
 */
import fs from "node:fs";
import path from "node:path";

/** Local calendar date as `yyyy-MM-dd`. Local, not UTC: the folder names a person's day. */
function today(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Create the next run folder for today under `root`: `<root>/2026-08-29-01`, then `-02`, and so on.
 *
 * The number is derived by scanning what is already on disk rather than held in a counter file,
 * so deleting old reports never makes a new run collide with a name that is still there.
 *
 * `suffix` appends what the run MEASURED to the name — today the mode slug, so a folder reads
 * `2026-09-23-01-deathmatch` (MC41). Two runs a week apart are otherwise indistinguishable from
 * their names alone, which is the whole reason the mode is in the folder and not only in the
 * report. The scan is deliberately suffix-BLIND: a suffixed folder still counts toward today's
 * highest `NN`, so a brawl run and a deathmatch run on one day are `-01` and `-02` rather than two
 * folders both claiming `-01`.
 */
export function createRunDir(root: string, suffix?: string): string {
  fs.mkdirSync(root, { recursive: true });
  const date = today();
  const pattern = new RegExp(`^${date}-(\\d+)(?:-.*)?$`);
  let highest = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const match = pattern.exec(entry.name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  const stem = `${date}-${String(highest + 1).padStart(2, "0")}`;
  const dir = path.join(root, suffix ? `${stem}-${suffix}` : stem);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The folder this run should write into: the shared one named by `envVar`, or a fresh one of its
 * own under `root`.
 *
 * A multi-probe run (e.g. `run-all.ts`) creates the shared folder once and passes it down through
 * `envVar` so every probe in that run lands in the same place; a probe run on its own creates its
 * own folder instead.
 */
export function resolveRunDir(root: string, envVar: string, suffix?: string): string {
  const shared = process.env[envVar];
  if (shared) {
    fs.mkdirSync(shared, { recursive: true });
    return shared;
  }
  return createRunDir(root, suffix);
}
