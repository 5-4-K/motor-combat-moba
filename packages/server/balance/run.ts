/**
 * `npm run balance -- [flags]`.
 *
 * Prints the seed FIRST, before anything runs: a run that turns out interesting is one you will
 * want to replay exactly, and the seed is the whole of that (B36). Then prints the fully resolved
 * config, so the terminal and the report header (`renderHeader` in `report.ts`) always agree on
 * what actually ran.
 *
 * Exit code: 0 for a completed run, no matter what the numbers say — a lopsided balance result is a
 * FINDING, not an error, exactly the rule `playtest/run-all.ts` follows for its probes (a `FINDING`
 * verdict still exits 0; only a crashed probe fails the process). This file exits non-zero in
 * exactly two cases: a refused `--baseline` comparison (a user error worth stopping for, per
 * `checkComparable`) and an actual crash (a bad flag, a filesystem error, a bug in the sim) — never
 * because a chassis is weak.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GameMode } from "@motor-combat-moba/shared";
import { checkComparable, loadBaseline } from "./baseline.js";
import { parseArgs, SKILL_TO_DIFFICULTY, type PlayerSkill } from "./cli.js";
import { botFingerprint, configFingerprint } from "./fingerprint.js";
import { gitCommitShort, writeReport, type RunRecord } from "./report.js";
import { runAll, type RunConfig } from "./runner.js";
import { aggregate } from "./stats.js";
import { createRunDir } from "../src/run-dir.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_ROOT = path.join(HERE, "reports");

/** `pro (hard)` — B42's "the report prints both forms," so a reader never has to hold the mapping
 * table in their head to know which bot actually flew. */
function skillLabel(skill: PlayerSkill): string {
  return `${skill} (${SKILL_TO_DIFFICULTY[skill]})`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  // ---- Seed first, per this file's own header — before the baseline check, before a single match
  // runs, before anything that could fail. ---------------------------------------------------------
  console.log(`seed: ${args.seed}`);

  const modeName = GameMode[args.mode] ?? String(args.mode);
  console.log(
    [
      `shape=${args.shape}`,
      `mode=${modeName}`,
      `skill=${skillLabel(args.skill)}`,
      `matches=${args.matches}${args.shape === "duel" ? " per ordered pair" : ""}`,
      `match-seconds=${args.matchSeconds}`,
      `arena=${args.arenaId}`,
      args.baseline ? `baseline=${args.baseline}` : "baseline=(none)",
      args.out ? `out=${args.out}` : "out=(dated folder)",
    ].join(" · "),
  );

  // A clean `RunConfig` — no CLI-only fields (`skill`, `baseline`, `out`) leak into it, since this
  // is exactly what `run.json` serializes and what a future `--baseline` comparison reads back.
  const config: RunConfig = {
    shape: args.shape,
    matches: args.matches,
    mode: args.mode,
    difficulty: args.difficulty,
    seed: args.seed,
    arenaId: args.arenaId,
    matchSeconds: args.matchSeconds,
  };

  const fingerprints = { config: configFingerprint(), bot: botFingerprint() };
  const gitCommit = gitCommitShort();

  // ---- Baseline check, BEFORE running a single match (per the task: a refused comparison stops
  // the run rather than paying for it). `checkComparable` only reads `.config` and `.fingerprints`
  // off its `current` argument (see baseline.ts) — neither depends on having run any matches — so a
  // minimal stand-in carrying just those two fields, cast to `RunRecord`, is enough to run the check
  // this early. The real, full `RunRecord` built after the run is what actually gets compared for
  // the "Deltas vs baseline" section `writeReport` renders. ---------------------------------------
  let baselineRecord: RunRecord | undefined;
  if (args.baseline) {
    baselineRecord = loadBaseline(args.baseline);
    const precheck = { config, fingerprints } as RunRecord;
    const comparability = checkComparable(precheck, baselineRecord);
    if (!comparability.ok) {
      console.error("\nRefusing to run: this config is not comparable to the baseline.\n");
      for (const reason of comparability.reasons) console.error(`  - ${reason}`);
      console.error(
        "\nA refused baseline comparison is a user error worth stopping for, unlike a lopsided " +
          "result — fix the flags (or drop --baseline) and try again.",
      );
      process.exitCode = 1;
      return;
    }
    for (const reason of comparability.reasons) console.warn(`warning: ${reason}`);
  }

  // ---- Run. Progress prints as matches complete (B44) so a long default run never looks hung — a
  // full-length 180s deathmatch is considerably more expensive than Task 15's ~29ms last-standing /
  // ~100ms capped-deathmatch measurements, and the default 50-match run can take minutes. About 20
  // lines print regardless of how many matches this run has, so a 9x-multiplied duel run is no
  // noisier than an ffa one. --------------------------------------------------------------------
  console.log("");
  const startedAt = new Date();
  const overallStart = Date.now();

  const matchesStart = Date.now();
  const { outcomes, totalMatches } = runAll(config, (i, total) => {
    const step = Math.max(1, Math.round(total / 20));
    if (i === 1 || i === total || i % step === 0) {
      console.log(`  match ${i}/${total}`);
    }
  });
  const matchesElapsedMs = Date.now() - matchesStart;
  const perMatchMs = totalMatches > 0 ? matchesElapsedMs / totalMatches : 0;
  console.log(`${totalMatches} matches in ${(matchesElapsedMs / 1000).toFixed(1)}s (${perMatchMs.toFixed(1)} ms/match)`);

  // ---- Aggregate, assemble the record, write the report. --------------------------------------
  const { cars, weapons, matchups, pace, unattributedPulseDamage } = aggregate(outcomes);
  const durationSeconds = (Date.now() - overallStart) / 1000;

  const record: RunRecord = {
    config,
    fingerprints,
    gitCommit,
    startedAt: startedAt.toISOString(),
    durationSeconds,
    totalMatches,
    cars,
    weapons,
    matchups,
    pace,
    unattributedPulseDamage,
  };

  const outDir = args.out ?? createRunDir(REPORTS_ROOT);
  const files = writeReport(outDir, record, outcomes, baselineRecord);

  console.log(`\nwrote ${files.length} files to ${path.relative(process.cwd(), outDir)}/`);
  for (const file of files) console.log(`  ${path.basename(file)}`);
}

try {
  main();
} catch (err) {
  // The harness itself failed — a bad flag that slipped past parseArgs' own throws, an unreadable
  // baseline file, a bug in the sim. This is the ONLY unconditional non-zero exit path: nothing a
  // balance result itself says (however lopsided) reaches here.
  console.error(`\nbalance run failed: ${(err as Error).message}`);
  process.exitCode = 1;
}
