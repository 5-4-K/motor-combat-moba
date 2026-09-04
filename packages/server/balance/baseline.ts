/**
 * Paired-baseline comparison (B36, B37).
 *
 * Every run is seeded (`RunConfig.seed`), so the SAME seed replays identically: run seed 7, change
 * one weapon number, run seed 7 again, and the difference between the two reports is CAUSED by the
 * edit rather than sampled around it. That is what turns a noisy 100-match experiment into a clean
 * A/B (B36) — but only if the two runs actually measured the same game with the same pilot.
 *
 * `checkComparable` is the guard on that assumption. A differing CONFIG or BOT fingerprint is
 * fatal: the two runs measured different games, and a delta between them would attribute a bot
 * improvement to a weapon nerf (the exact mistake B37 exists to prevent) — or the reverse. Shape and
 * mode are fatal for the same underlying reason: a duel win rate and an FFA win rate are not the
 * same quantity, no matter how identical the rest of the config is.
 *
 * A differing SEED is not fatal. It is a different sample of the same experiment, which is a
 * legitimate thing to compare; it just is not the PAIRED comparison that makes a one-number edit
 * measurable, so it warns rather than refuses.
 */
import fs from "node:fs";
import path from "node:path";
import type { RunRecord } from "./report.js";

export interface ComparabilityResult {
  ok: boolean;
  reasons: string[];
}

/**
 * Whether `current` may be compared against `baseline` at all, and why.
 *
 * `ok: false` means at least one FATAL mismatch was found (config fingerprint, bot fingerprint,
 * shape, or mode) — comparing anyway would attribute a change in one of those things to whatever
 * number the caller is actually looking at. `ok: true` with `reasons` non-empty means the runs are
 * comparable but not a perfectly paired sample (today, only a differing seed does this) — the
 * caller should still show the reasons, just not refuse.
 *
 * `reasons` always says WHICH thing changed, with both values, so a caller does not have to go
 * diff two `run.json` files by hand to find out.
 */
export function checkComparable(current: RunRecord, baseline: RunRecord): ComparabilityResult {
  const reasons: string[] = [];
  let fatal = false;

  if (current.fingerprints.config !== baseline.fingerprints.config) {
    fatal = true;
    reasons.push(
      `config fingerprint differs (this run: ${current.fingerprints.config}, baseline: ` +
        `${baseline.fingerprints.config}) — the two runs measured different games (see ` +
        `fingerprint.ts's header comment for the full list of what this covers)`,
    );
  }
  if (current.fingerprints.bot !== baseline.fingerprints.bot) {
    fatal = true;
    reasons.push(
      `bot fingerprint differs (this run: ${current.fingerprints.bot}, baseline: ` +
        `${baseline.fingerprints.bot}) — the two runs used different pilots (BOT_PROFILES or ` +
        `BOT_BRAIN_VERSION changed between them), so any delta could be a bot change, not a ` +
        `balance change`,
    );
  }
  if (current.config.shape !== baseline.config.shape) {
    fatal = true;
    reasons.push(
      `shape differs (this run: ${current.config.shape}, baseline: ${baseline.config.shape}) — a ` +
        `duel win rate and an FFA win rate are not the same quantity`,
    );
  }
  if (current.config.mode !== baseline.config.mode) {
    fatal = true;
    reasons.push(`mode differs (this run: ${current.config.mode}, baseline: ${baseline.config.mode})`);
  }

  // Not fatal — see the module doc. Still reported, so a caller reading only `reasons` (not `ok`)
  // learns the comparison is a different sample rather than assuming it is a clean paired A/B.
  if (current.config.seed !== baseline.config.seed) {
    reasons.push(
      `seed differs (this run: ${current.config.seed}, baseline: ${baseline.config.seed}) — this is ` +
        `a different sample of the same experiment, not the paired comparison a single-seed A/B needs`,
    );
  }

  return { ok: !fatal, reasons };
}

/**
 * Read a previous run's `run.json` back into a `RunRecord`.
 *
 * Fails loudly and specifically rather than letting `JSON.parse` throw its own generic error: a
 * missing directory (typo'd path) and a truncated file (a run that crashed mid-write) are both
 * things a caller needs to know the PATH for, not just "Unexpected end of JSON input".
 */
export function loadBaseline(dir: string): RunRecord {
  const file = path.join(dir, "run.json");

  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(
      `loadBaseline: could not read ${file} (${(err as Error).message}) — pass the directory of a ` +
        `previous, completed balance run`,
    );
  }

  try {
    return JSON.parse(raw) as RunRecord;
  } catch (err) {
    throw new Error(
      `loadBaseline: ${file} is not valid JSON (${(err as Error).message}) — the run that wrote it ` +
        `may not have finished`,
    );
  }
}
