/**
 * Run every offline probe into ONE dated report folder.
 *
 * `lan.ts` is deliberately not in this list: it needs a server already listening, and a runner that
 * silently skipped it when the port was closed would be worse than one that never claimed to run it.
 * Run it yourself — see `playtest/README.md`.
 *
 * Each probe is spawned as its own process rather than imported. Probes are top-level scripts that
 * execute on import, and several of them mutate module-level tables through the sim; separate
 * processes mean one probe can never leave state behind that changes the next one's numbers.
 *
 * As of Task 14 the six probes above live under `common/` — they measure the game regardless of
 * which mode is installed. `--scope=<common|mode|all>` (default `all`) picks which set runs:
 * `common` is exactly the six below; `mode` is every `.ts` file (excluding `.test.ts`) in
 * `modes/<family>/`, where the family comes from `FAMILY_OF[mode]` (`./common/mode.ts`) — brawl and
 * team share `last-standing`, so a probe written once for that family covers both; `all` is both
 * sets together. A `mode` scope with no folder, or an empty one, is not an error — it prints
 * "no mode probes for <family>" and exits 0, since Task 14 ships the flag before any mode-specific
 * probe exists to run under it.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { modeLabelOf, modeSlug } from "@motor-combat-moba/shared";
import { FAMILY_OF, PLAYTEST_MODE_ENV, parseScope, resolvePlaytestModeOrExit } from "./common/mode.js";
import { createRunDir } from "./common/reporter.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** In run order. Cheapest first, so a broken harness fails fast. */
const COMMON_PROBES = ["collision", "ram", "geometry", "weapons", "weapons2", "prediction"] as const;

interface ProbeSpec {
  /** Also the report's base filename (`${name}.md`), matching each probe's own `Reporter` name. */
  name: string;
  file: string;
}

function commonProbes(): ProbeSpec[] {
  return COMMON_PROBES.map((name) => ({ name, file: path.join(HERE, "common", `${name}.ts`) }));
}

/** Every `.ts` file (excluding `.test.ts`) in `playtest/modes/<family>/`, or `[]` if that folder
 * does not exist or is empty. Sorted so the run order does not depend on directory listing order. */
function modeProbes(family: string): ProbeSpec[] {
  const dir = path.join(HERE, "modes", family);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort()
    .map((f) => ({ name: f.replace(/\.ts$/, ""), file: path.join(dir, f) }));
}

let scope: ReturnType<typeof parseScope>;
try {
  scope = parseScope();
} catch (err) {
  console.error(`playtest failed: ${(err as Error).message}`);
  process.exit(2);
}

/**
 * `npm run playtest -- --mode=<id|name>` (MC41). Resolved ONCE here, before anything runs, and
 * pushed down to every spawned probe through `PLAYTEST_MODE_ENV` — the same shape `PLAYTEST_RUN_DIR`
 * uses — so every probe measures the same bundle and the folder they share is named after it. An
 * unknown mode stops the run before a single probe is spawned, rather than each probe quietly
 * measuring the default.
 */
const mode = resolvePlaytestModeOrExit();
const family = FAMILY_OF[mode];

const PROBES: ProbeSpec[] =
  scope === "common"
    ? commonProbes()
    : scope === "mode"
      ? modeProbes(family)
      : [...commonProbes(), ...modeProbes(family)];

if (scope === "mode" && PROBES.length === 0) {
  console.log(`no mode probes for ${family}`);
  process.exit(0);
}

const runDir = createRunDir();
console.log(`playtest run -> ${path.relative(process.cwd(), runDir)}`);
console.log(`mode: ${modeLabelOf(mode)} · scope: ${scope}\n`);

const started = Date.now();
const results: { probe: string; ok: boolean; seconds: number }[] = [];

for (const probe of PROBES) {
  const at = Date.now();
  console.log(`${"=".repeat(78)}\n  ${probe.name}\n${"=".repeat(78)}`);
  const run = spawnSync(process.execPath, ["--import", "tsx", probe.file], {
    stdio: "inherit",
    env: { ...process.env, PLAYTEST_RUN_DIR: runDir, [PLAYTEST_MODE_ENV]: modeSlug(mode) },
  });
  const seconds = (Date.now() - at) / 1000;
  results.push({ probe: probe.name, ok: run.status === 0, seconds });
  if (run.status !== 0) console.error(`\n!! ${probe.name} exited with status ${run.status}\n`);
}

/* -------------------------------------------------------------------------- summary.md */
const totalSeconds = (Date.now() - started) / 1000;

/**
 * Pull each probe's verdict table out of the Markdown it just wrote, so the summary is built from
 * what actually landed on disk rather than from a second in-memory tally that could disagree with it.
 */
function verdictRows(probe: string): string[] {
  const file = path.join(runDir, `${probe}.md`);
  if (!fs.existsSync(file)) return [`| ${probe} | (no report written) | — |`];
  const rows: string[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = /^\| (.+?) \| (.+?) \|$/.exec(line.trim());
    if (!match || match[1] === "Verdict" || match[1]?.startsWith("-")) continue;
    rows.push(`| ${probe} | ${match[1]} | ${match[2]} |`);
  }
  return rows;
}

const allRows = PROBES.flatMap((p) => verdictRows(p.name));
const findings = allRows.filter((r) => r.includes("| FINDING |"));
const failedProbes = results.filter((r) => !r.ok).map((r) => r.probe);

/**
 * The one line a reader takes away without opening the file. It used to be
 * `${findings.length} FINDING(s) across ${allRows.length} probes` unconditionally — a probe that
 * crashed before writing a report contributes a "(no report written)" row that matches no verdict
 * pattern, so a run where every probe crashed printed "0 FINDING(s) across 6 probes", reading as a
 * clean sweep. A crashed probe measured NOTHING; it must never be reported alongside a real
 * "0 findings" the same way a probe that actually ran and found nothing is. If anything failed,
 * this line leads with that and never states a finding count as though the run were clean.
 */
const headline =
  failedProbes.length > 0
    ? `**${failedProbes.length} of ${PROBES.length} probe(s) CRASHED** (${failedProbes.join(", ")}) — ` +
      `measured NOTHING for ${failedProbes.length === 1 ? "it" : "them"}. ` +
      `${findings.length} finding(s) from the ${PROBES.length - failedProbes.length} probe(s) that ` +
      `actually completed.`
    : `**${findings.length} FINDING${findings.length === 1 ? "" : "s"}** across ${allRows.length} probes.`;

const summary = [
  "# Playtest run",
  "",
  `${new Date().toISOString()} · ${PROBES.length} probes · ${totalSeconds.toFixed(1)}s · ` +
    `mode ${modeLabelOf(mode)} · scope ${scope}`,
  "",
  headline,
  "",
  "## Probes run",
  "",
  "| Probe file | Status | Seconds |",
  "|---|---|---|",
  ...results.map((r) => `| ${r.probe} | ${r.ok ? "completed" : "FAILED"} | ${r.seconds.toFixed(1)} |`),
  "",
  "## All verdicts",
  "",
  "| File | Verdict | Probe |",
  "|---|---|---|",
  ...allRows,
  "",
].join("\n");

fs.writeFileSync(path.join(runDir, "summary.md"), summary, "utf8");

console.log(`\n${"=".repeat(78)}`);
for (const r of results) {
  console.log(`${r.ok ? "completed" : "FAILED  "}  ${r.probe.padEnd(12)} ${r.seconds.toFixed(1)}s`);
}
if (failedProbes.length > 0) {
  console.log(
    `\n${failedProbes.length} of ${PROBES.length} probe(s) CRASHED (${failedProbes.join(", ")}) — ` +
      `this is NOT a clean run. ${findings.length} finding(s) from the probes that did complete, ` +
      `in ${totalSeconds.toFixed(1)}s.`,
  );
} else {
  console.log(
    `\n${findings.length} FINDING(s) across ${allRows.length} probes in ${totalSeconds.toFixed(1)}s.`,
  );
}
console.log(`reports in ${path.relative(process.cwd(), runDir)}/ (summary.md first)`);

// A probe that crashed is a broken harness and must not look like a clean run. A FINDING is not a
// failure — the whole point is to surface them — so only a non-zero child exit fails this process.
process.exit(results.every((r) => r.ok) ? 0 : 1);
