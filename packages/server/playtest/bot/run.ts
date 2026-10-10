/**
 * `npm run bot:report`: what the bot brain does in fixed scenes and real seeded matches, written as
 * one Markdown report into `playtest/reports/<yyyy-MM-dd-NN>-bot/bot.md`.
 *
 * These are calibration checks — what a particular seed or tier happens to do — moved out of the
 * test suite (TS11–TS14): a miss reads `FINDING` here and never fails a build. Invariants about the
 * bot (determinism, BB63) stay tests. Not part of `run-all.ts`: it is the bot's report, not a sim
 * probe, and it takes about 20 s.
 *
 * Each scenario module runs inside its own `try/catch`, so one that throws becomes a `FINDING`
 * row and the others still report. The exit code is always 0.
 */
import { REPORTS_ROOT, Reporter, VERDICT, createRunDirIn } from "../common/reporter.js";
import * as occupancy from "./occupancy.js";
import * as placement from "./placement.js";
import * as tiers from "./tiers.js";

const dir = createRunDirIn(REPORTS_ROOT, "bot");
// `Reporter` writes into `PLAYTEST_RUN_DIR` when set — the same hand-down `run-all.ts` uses.
process.env.PLAYTEST_RUN_DIR = dir;

const reporter = new Reporter(
  "bot",
  "Bot calibration: situation occupancy in real matches, tier characterisation and reported symptoms in fixed scenes, deathmatch placement over a seed spread. Each module installs the mode it measures (occupancy: Deathmatch; tiers and placement: the default mode).",
);
const report = (probe: string, verdict: string, detail: string) => reporter.report(probe, verdict, detail);

const MODULES = [
  ["occupancy", occupancy.run],
  ["tiers", tiers.run],
  ["placement", placement.run],
] as const;

for (const [name, run] of MODULES) {
  try {
    run(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? `\n${err.stack}` : "";
    report(name, VERDICT.FINDING, "threw: " + message + stack);
  }
}

reporter.finish();
process.exitCode = 0;
