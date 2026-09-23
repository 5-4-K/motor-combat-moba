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
 * MODE are fatal for the same underlying reason: a duel win rate and an FFA win rate are not the
 * same quantity, no matter how identical the rest of the config is, and since MC41 a mode is not
 * even the same tables — `--mode` picks the `ModeConfig` bundle the matches run on, and two modes
 * are free to diverge table by table. So is DIFFICULTY, and it has to
 * be checked here rather than left to the bot fingerprint: `botFingerprint` hashes `BOT_PROFILES`
 * WHOLE, so every tier hashes to the same value and `--skill=casual` and `--skill=pro` are
 * indistinguishable to it. Which tier flew the matches is a property of the RUN, not of the table,
 * and it changes every number in the report — a pro-flown Bastion win rate and a casual-flown one
 * are two different quantities, exactly like a duel rate and an FFA rate.
 *
 * A differing SEED is not fatal. It is a different sample of the same experiment, which is a
 * legitimate thing to compare; it just is not the PAIRED comparison that makes a one-number edit
 * measurable, so it warns rather than refuses.
 */
import fs from "node:fs";
import path from "node:path";
import { modeLabelOf } from "@motor-combat-moba/shared";
import type { RunRecord } from "./report.js";

export interface ComparabilityResult {
  ok: boolean;
  reasons: string[];
}

/**
 * Whether `current` may be compared against `baseline` at all, and why.
 *
 * `ok: false` means at least one FATAL mismatch was found (config fingerprint, bot fingerprint,
 * shape, mode, or difficulty) — comparing anyway would attribute a change in one of those things to whatever
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
  // Fatal since the mode was only a win condition, and doubly so since MC41 made it pick the
  // CONFIG BUNDLE as well: the two runs now played different win conditions on potentially
  // different tables. The config fingerprint above catches this too (the mode's wire id is part of
  // what it hashes, so two modes never share a fingerprint even while their tables are identical) —
  // this clause stays because that reason reads as "something in the tables moved", which is the
  // wrong thing for a reader to go looking for when all that changed was the flag.
  if (current.config.mode !== baseline.config.mode) {
    fatal = true;
    reasons.push(
      `mode differs (this run: ${modeLabelOf(current.config.mode)}, baseline: ` +
        `${modeLabelOf(baseline.config.mode)}) — not comparable: since MC41 the mode picks the ` +
        `config bundle the matches ran on as well as the win condition they ended by`,
    );
  }
  // NOT covered by the bot fingerprint, which hashes `BOT_PROFILES` whole and so gives every tier
  // the same hash — see this module's header. Without this clause `--baseline` compared a `--skill=pro`
  // run against a `--skill=casual` one and reported `ok: true`.
  if (current.config.difficulty !== baseline.config.difficulty) {
    fatal = true;
    reasons.push(
      `difficulty differs (this run: ${current.config.difficulty}, baseline: ` +
        `${baseline.config.difficulty}) — a different tier flew the matches, so every number in the ` +
        `Deltas table would be a bot-skill difference wearing a balance change's clothes`,
    );
  }

  // NOT covered by the config fingerprint either, and for a subtler reason than `difficulty` above:
  // the fingerprint hashes the mode's car table whole, so it DOES move when a chassis is added or
  // its `isActive` flips — but it does not move when the same table is run twice under different
  // flags. `--include-inactive` changes which rows took a seat, not which rows exist, so two runs
  // over identical config can measure a three-car game and a seven-car game and hash identically.
  if (current.config.includeInactive !== baseline.config.includeInactive) {
    fatal = true;
    reasons.push(
      `--include-inactive differs (this run: ${current.config.includeInactive}, baseline: ` +
        `${baseline.config.includeInactive}) — the two runs seated different rosters, so every win ` +
        `rate in the Deltas table would be a roster change wearing a balance change's clothes`,
    );
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
