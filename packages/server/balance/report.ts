/**
 * Turns one run's `aggregate()` output into the artifact a human actually reads and acts on:
 * `summary.md`, `matches.csv`, `weapons.csv` and `run.json` in a run folder (B38).
 *
 * The reader of `summary.md` is about to change weapon and chassis numbers in a live game based on
 * what it says. The single most likely way this harness does harm is by presenting noise as a
 * finding, so this file's job is as much to convey UNCERTAINTY as to convey values:
 *
 * - **Every rate a Wilson interval was actually computed for prints inline as `41.3% (32.1-50.9)`,
 *   never bare** (B35). At the fixed 2/2/2 FFA composition the null win rate is exactly 33.3%, and
 *   over 100 matches that interval is roughly +/-9 points wide — a chassis reading 38% is not, on
 *   its own, evidence of anything.
 * - **The report states its own limitations in its body, not by linking elsewhere** (B40). A
 *   caveat that lives only in a design document is a caveat nobody reads at the moment they are
 *   reading a number.
 * - **The mirror noise floor comes before the matchup matrix.** The three same-chassis matchups
 *   MUST converge on 50% — identical chassis, identical kit, identical pilot — so a reader checks
 *   the rig's own noise floor before trusting anything measured with it (B26a).
 *
 * `writeReport` is the only export most callers need; `RunRecord` is what `run.json` round-trips
 * and what Task 20's baseline guard reads back.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GameMode, winRuleOf, type CarId, type WeaponId } from "@motor-combat-moba/shared";
import { BOT_PROFILES, type BotProfile } from "../src/config/bot-profiles.js";
import { deriveSeed } from "../src/bot/rng.js";
import type { MatchOutcome } from "./match.js";
import type { RunConfig } from "./runner.js";
import type { CarStats, Interval, MatchupCell, PaceStats, UnattributedPulseDamageRow, WeaponStats } from "./stats.js";
import { aggregate, wilson } from "./stats.js";

export interface RunRecord {
  config: RunConfig;
  fingerprints: { config: string; bot: string };
  gitCommit: string;
  startedAt: string;
  durationSeconds: number;
  totalMatches: number;
  cars: CarStats[];
  weapons: WeaponStats[];
  matchups: MatchupCell[];
  pace: PaceStats;
  unattributedPulseDamage: UnattributedPulseDamageRow[];
}

/**
 * `git rev-parse --short HEAD`, run from `cwd` (default: this file's own checkout). Degrades to
 * `"unknown"` on any failure — a missing `.git`, a detached worktree quirk, `git` not on `PATH` —
 * rather than throwing, because a report that could not be written is worse than one missing a
 * single provenance field. `writeReport` notes the degraded case in the header itself, since a
 * silent "unknown" would read as if the caller simply forgot to fill the field in.
 */
export function gitCommitShort(cwd: string = process.cwd()): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

// ---- number/rate formatting -------------------------------------------------------------------

function pct1(fraction: number): string {
  return (fraction * 100).toFixed(1);
}

/** `41.3% (32.1-50.9)` — an en dash inside the parens, one decimal place throughout. This is the
 * ONLY way a Wilson-bracketed rate may appear in this report; a bare `formatPct` below is reserved
 * for ratios `aggregate()` did not compute an interval for (see the module doc). */
function formatInterval(i: Interval): string {
  return `${pct1(i.rate)}% (${pct1(i.low)}–${pct1(i.high)})`;
}

/** A plain percentage for a ratio that is not a Wilson-bracketed rate (e.g. a damage share) — the
 * label beside it always says what it is a share OF, so it is never mistaken for a tested rate. */
function formatPct(fraction: number): string {
  return `${pct1(fraction)}%`;
}

function fmt1(n: number): string {
  return n.toFixed(1);
}

function mdTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
  return lines.join("\n");
}

/** The `BotProfile` row's six fields, printed verbatim (field name = value) so an old report stays
 * interpretable without cross-referencing `bot-profiles.ts` for what a number even was (B39). */
function formatBotProfile(profile: BotProfile): string {
  const entries = Object.entries(profile) as [keyof BotProfile, number][];
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

// ---- sections -----------------------------------------------------------------------------------

function renderHeader(record: RunRecord): string {
  const modeName = GameMode[record.config.mode] ?? `mode ${record.config.mode}`;
  const commitLine =
    record.gitCommit === "unknown"
      ? "**Git commit:** unknown (`git rev-parse` failed or was unavailable in this environment)"
      : `**Git commit:** \`${record.gitCommit}\``;
  const profile = BOT_PROFILES[record.config.difficulty];

  return [
    "# Balance report",
    "",
    `**Seed:** ${record.config.seed} · **Shape:** ${record.config.shape} · **Mode:** ${modeName} (${record.config.mode}) · **Arena:** ${record.config.arenaId}`,
    "",
    `**N:** ${record.totalMatches} matches (config: ${record.config.matches} per ${record.config.shape === "duel" ? "ordered pair" : "run"}, ${record.config.matchSeconds}s cap each) · **Difficulty:** ${record.config.difficulty}`,
    "",
    commitLine,
    "",
    `**Started:** ${record.startedAt} · **Duration:** ${fmt1(record.durationSeconds)}s wall-clock`,
    "",
    `**Config fingerprint:** \`${record.fingerprints.config}\` · **Bot fingerprint:** \`${record.fingerprints.bot}\``,
    "",
    `**Bot profile (\`${record.config.difficulty}\`), verbatim:** ${formatBotProfile(profile)}`,
  ].join("\n");
}

function renderLimitations(): string {
  // B45's list verbatim, plus B2's pilot caveat and B23's profile tension, all in prose here —
  // never only a link to the design doc, per B40. Read this before trusting any number below.
  return [
    "## Limitations",
    "",
    "Read every table below against this list before treating any of it as a tuning signal.",
    "",
    "- **Bot skill is a model of skill, not skill.** Every number in this report compares chassis " +
      "under one fixed, scripted pilot. \"Amateurs find Bastion weak\" is a claim about our bot, " +
      "not about amateurs, until a human confirms it.",
    "- **The current pilot is a fixed-standoff chaser.** It holds a fixed standoff distance " +
      "(70u on `hard`) and closes or backs off from there, which systematically understates a " +
      "chassis whose game is range (Bullseye: `predator` reaches 1800u, `lance` 1200u) and " +
      "overstates one whose game is contact (Bastion). Run #1 validates the rig. Verdicts start " +
      "when a real bot session lands.",
    "- **The `easy`/`medium` bot profiles were retuned for a pleasant new-player experience, not " +
      "faithful skill simulation.** The two goals usually agree — a beginner who over-commits is " +
      "also easy to beat — but they can pull apart, and this report cannot tell you which case a " +
      "given number is in.",
    "- **No network.** No latency, no packet loss, no client-side prediction error. A LAN match " +
      "has all three; this harness has none of them.",
    "- **One arena.** Only the arena named in the header, unless a future run says otherwise — " +
      "arena geometry is itself a balance input this report does not vary.",
    "- **No lobby, no team play.** `GameMode.TEAM` is out of scope for this harness.",
    "- **Bot targeting drives kill distribution.** Who the bot chooses to shoot is a bot-tuning " +
      "decision, not a chassis property, and it will move every per-car number here again when " +
      "the bot improves.",
    "- **`corroded` contributes damage without ever dealing any, and no attribution scheme untangles " +
      "it (B5).** Its row is a pure amplifier (`modifiers: { damageTaken: 1.3 }`), applied only by " +
      "`magmablast`'s explosion, so it never hits anyone itself — it makes whatever hits the " +
      "carrier next land 30% harder, and that harder hit is credited entirely to whichever weapon " +
      "landed it, including another player's. `magmablast`'s real contribution to a match therefore " +
      "includes damage booked to other weapons' rows above; a per-weapon damage table is blind to " +
      "amplifiers by construction, not by an oversight this report could fix.",
  ].join("\n");
}

function renderMirrors(record: RunRecord): string {
  const mirrors = record.matchups.filter((m) => m.attacker === m.defender);
  const rows = mirrors.map((m) => [
    m.attacker,
    formatInterval(m.winRate),
    String(m.winRate.n),
  ]);
  return [
    "## Mirror noise floor",
    "",
    "Each of these three matchups pits a chassis against itself: identical chassis, identical kit, " +
      "identical pilot on both sides. Every one of them MUST converge on 50% — there is no game-side " +
      "reason for it to land anywhere else. **A mirror reading far from 50% is not a fact about the " +
      "game; it is proof the rig itself carries a positional bias** (spawn seat, resolution order, " +
      "which seat is treated as \"attacker\") large enough to invalidate every other cell in the " +
      "matchup matrix below. Check these before trusting anything past this section.",
    "",
    mdTable(["Chassis mirror", "Win rate", "n"], rows),
  ].join("\n");
}

function renderCarTable(record: RunRecord): string {
  const rows = record.cars.map((c) => [
    c.carId,
    String(c.matches),
    formatInterval(c.winRate),
    fmt1(c.meanPlacement),
    String(c.kills),
    String(c.deaths),
    fmt1(c.damageDealt),
    fmt1(c.damageTaken),
    fmt1(c.meanAliveSeconds),
    formatPct(c.phasedFraction) + " of alive time",
  ]);
  return [
    "## Per-car",
    "",
    mdTable(
      ["Car", "Matches", "Win rate", "Mean placement", "Kills", "Deaths", "Dmg dealt", "Dmg taken", "Mean alive (s)", "Phased"],
      rows,
    ),
  ].join("\n");
}

function renderWeaponTable(record: RunRecord): string {
  const anyDerived = record.weapons.some((w) => w.derivedDamage > 0);
  const headers = [
    "Weapon",
    "Car",
    "Presses",
    "Hit rate",
    "Damage",
    ...(anyDerived ? ["Derived"] : []),
    "Kills",
    "Dmg/press",
    "Kit share",
    "Presses/min",
    "First use (s, n)",
  ];
  const rows = record.weapons.map((w) => [
    w.weaponId,
    w.carId,
    String(w.presses),
    // A weapon with `presses === 0` was never fired at all, not fired-and-always-missed — printing
    // `0.0% (0.0-0.0)` there reads as measured inaccuracy when the truth is no measurement exists
    // (there is no press to have connected or missed). `–` says "no data" the same way the `Derived`
    // column already does below for a weapon with no derived damage.
    w.presses === 0 ? "–" : formatInterval(w.hitRate),
    fmt1(w.damage),
    ...(anyDerived ? [w.derivedDamage > 0 ? fmt1(w.derivedDamage) : "–"] : []),
    String(w.kills),
    // Same reasoning as the hit-rate cell above: `damagePerPress` is a ratio over `presses`, and a
    // zero denominator means no rate exists to show, not a rate of zero.
    w.presses === 0 ? "–" : fmt1(w.damagePerPress),
    formatPct(w.kitDamageShare) + " of kit",
    fmt1(w.pressesPerMinute),
    // The mean alone can't tell "fired once in fifty matches" apart from "fired in every match" —
    // both would print as one bare number. `(n=…)` carries the sample size right next to it, out
    // of `firstUseMatches`, so a reader does not have to cross-reference `Presses` to tell a
    // stable habit apart from one lucky press.
    w.meanFirstUseSeconds === null ? "never" : `${fmt1(w.meanFirstUseSeconds)} (n=${w.firstUseMatches})`,
  ]);
  const derivedNote = anyDerived
    ? "\n\n`Derived` damage is credited by INFERENCE through a status pulse — today only " +
      "`overheated`, which `afterburner` applies — rather than measured directly off a damage " +
      "event. It is included in `Damage` above, not additional to it."
    : "";
  // B28a: the note belongs beside `Hit rate`, where the distortion actually bites, not buried in the
  // Limitations section a reader may have already skimmed past.
  const phasedNote =
    "\n\n**`Hit rate` above is distorted by spawn protection.** A shot at a spawn-protected " +
    "(`phased`) car produces no damage event at all — `runCombat` drops a phased car from the hit " +
    "snapshot entirely — so that press reads as a MISS. This inflates every weapon's miss rate " +
    "(depresses `Hit rate`) in proportion to how much of the match cars spent phased; see the " +
    "per-car `Phased` column above to size it for this run. The harness cannot know whether a press " +
    "was aimed at a real target or a departed ghost, so it cannot honestly reclassify those presses — " +
    "sizing the distortion is the most it can do (B28a). **`last-standing` mode has no phasing at " +
    "all**, making it the cleaner shape to run when hit-rate accuracy is the question.";
  return ["## Per-weapon", "", mdTable(headers, rows) + derivedNote + phasedNote].join("\n");
}

/**
 * "Unattributed pulse damage" (B5a) — only rendered when non-empty. Latent today (`overheated` is
 * the only damaging pulse and has exactly one applier, `afterburner`), so a real run's table is
 * normally empty and this section is simply absent rather than printed always-empty; the moment a
 * second weapon applies a damaging status, its pulse damage lands here instead of vanishing from
 * every other table in the report.
 */
function renderUnattributedPulseDamage(record: RunRecord): string {
  const rows = record.unattributedPulseDamage.map((u) => [u.statusId, fmt1(u.damage)]);
  return [
    "## Unattributed pulse damage",
    "",
    "Two or more weapons can apply each status below (or, in principle, none of them target " +
      "opponents at all), so a point of its pulse damage cannot be honestly credited to one of " +
      "them (B5a) — refusing to guess and dropping it would be worse than banking it here. This " +
      "damage is NOT included in any weapon's `Damage` column above.",
    "",
    mdTable(["Status", "Damage"], rows),
  ].join("\n");
}

function renderMatchupMatrix(record: RunRecord): string {
  const carIds = [...new Set(record.matchups.map((m) => m.attacker))];
  const cellOf = (attacker: string, defender: string): MatchupCell | undefined =>
    record.matchups.find((m) => m.attacker === attacker && m.defender === defender);

  const winRateRows = carIds.map((attacker) => [
    attacker,
    ...carIds.map((defender) => {
      const cell = cellOf(attacker, defender);
      return cell ? formatInterval(cell.winRate) : "–";
    }),
  ]);

  const detailRows = record.matchups.map((m) => [
    m.attacker,
    m.defender,
    formatInterval(m.winRate),
    fmt1(m.meanTicks),
    // `null` means every match for this pair drew — no winner, so no hp to average. Same `–`
    // treatment as a zero-press weapon's hit rate above: printing `fmt1(0)` here would read as a
    // measured "0.0 hp remaining" for a matchup that was never actually won.
    m.meanWinnerHp === null ? "–" : fmt1(m.meanWinnerHp),
  ]);

  return [
    "## Matchup matrix",
    "",
    "Win rate, attacker (row) vs defender (column). Every ordered pair, mirrors included — this is " +
      "the same 3x3 the mirror section above draws its three diagonal cells from.",
    "",
    mdTable(["Attacker \\ Defender", ...carIds], winRateRows),
    "",
    "Mean duel length and mean winner hp remaining, per ordered pair — the difference between a " +
      "duel that was walked and one that was barely edged out, which a win rate alone cannot show " +
      "(a drawn pair contributes no winner-hp sample, so that column can read lower `n` than the " +
      "win-rate column).",
    "",
    mdTable(["Attacker", "Defender", "Win rate", "Mean duel (ticks)", "Mean winner hp"], detailRows),
  ].join("\n");
}

function renderPace(record: RunRecord): string {
  const { pace, totalMatches } = record;
  // `clockFraction` is a genuine proportion (matches that hit the harness's clock, out of all
  // matches) even though `PaceStats` stores it as a bare number rather than an `Interval` — the
  // successes/trials are reconstructible from data this record already carries, so a Wilson
  // interval is computed here rather than printing the fraction bare (per this file's own header).
  const clockSuccesses = Math.round(pace.clockFraction * totalMatches);
  const clockInterval = wilson(clockSuccesses, totalMatches);

  // "Hit the clock" is `MatchOutcome.hitClock` (see its doc comment in match.ts) — the last-standing
  // SAFETY VALVE signal: `livingSides` never dropped to one side, a genuine stalemate. It stays
  // meaningful only there. In Deathmatch this harness's own match length IS `matchEndsTick`
  // (`state.matchEndsTick = setup.maxTicks` in `runMatch`), so `deathmatchEnded`'s clock branch and
  // the loop's own cap fire on the exact same tick, every match — `hitClock` reads false BY
  // CONSTRUCTION, not because no deathmatch run ever ran long. Printing a 0.0% interval there would
  // read as a measured absence of stalemates; there is nothing to measure, so the column is marked
  // n/a for that mode instead of printing a number that cannot move.
  const clockCell =
    winRuleOf(record.config.mode) === "deathmatch"
      ? "n/a (deathmatch's clock is this harness's own match length — see summary below)"
      : formatInterval(clockInterval);

  return [
    "## Pace",
    "",
    mdTable(
      ["Mean match length (s)", "Mean time to first blood (s)", "Kills / minute", "Hit the clock"],
      [[
        fmt1(pace.meanMatchSeconds),
        pace.meanFirstBloodSeconds === null ? "no kills recorded" : fmt1(pace.meanFirstBloodSeconds),
        fmt1(pace.killsPerMinute),
        clockCell,
      ]],
    ),
    "",
    winRuleOf(record.config.mode) === "deathmatch"
      ? "`Hit the clock` is n/a here: Deathmatch is timed, and this harness's match length IS " +
        "`matchEndsTick`, so every Deathmatch match ends via the clock by construction — the column " +
        "would read 0.0% every run, which is not a finding about any match, only about how this " +
        "mode's clock is wired. It stays meaningful for `last-standing`, where it flags a genuine " +
        "stalemate (`livingSides` never dropped to one side within the cap)."
      : "`Hit the clock` is `last-standing`'s safety-valve signal: the fraction of matches where " +
        "`livingSides` never dropped to one side within `--match-seconds`, a genuine stalemate worth " +
        "investigating on its own.",
  ].join("\n");
}

function renderDeltas(record: RunRecord, baseline: RunRecord): string {
  const baselineByCarId = new Map(baseline.cars.map((c) => [c.carId, c]));
  const rows = record.cars.map((c) => {
    const base = baselineByCarId.get(c.carId);
    const deltaPoints = base ? (c.winRate.rate - base.winRate.rate) * 100 : null;
    return [
      c.carId,
      formatInterval(c.winRate),
      base ? formatInterval(base.winRate) : "not in baseline",
      deltaPoints === null ? "–" : `${deltaPoints >= 0 ? "+" : ""}${fmt1(deltaPoints)} pts`,
    ];
  });
  return [
    "## Deltas vs baseline",
    "",
    `Baseline run: config fingerprint \`${baseline.fingerprints.config}\`, bot fingerprint \`${baseline.fingerprints.bot}\`, ` +
      `git commit \`${baseline.gitCommit}\`, ${baseline.totalMatches} matches. Win-rate deltas are ` +
      "point estimates only — a point difference smaller than either run's own interval width is " +
      "not, by itself, evidence the edit did anything (checking that is Task 20's job, not this " +
      "table's).",
    "",
    mdTable(["Car", "This run", "Baseline", "Delta"], rows),
  ].join("\n");
}

function renderSummaryMarkdown(record: RunRecord, baseline?: RunRecord): string {
  const sections = [renderHeader(record), renderLimitations()];
  if (record.config.shape === "duel") sections.push(renderMirrors(record));
  sections.push(renderCarTable(record), renderWeaponTable(record));
  if (record.unattributedPulseDamage.length > 0) sections.push(renderUnattributedPulseDamage(record));
  if (record.config.shape === "duel") sections.push(renderMatchupMatrix(record));
  sections.push(renderPace(record));
  if (baseline) sections.push(renderDeltas(record, baseline));
  return sections.join("\n\n") + "\n";
}

// ---- CSVs -----------------------------------------------------------------------------------
// One row per CAR PER MATCH (`matches.csv`) and one row per WEAPON PER MATCH (`weapons.csv`) —
// deliberately NOT the aggregated per-car/per-weapon summary `summary.md`'s tables already show in
// prettier form (Task 20 B38). A mean has no distribution behind it: a chassis that either
// dominates or gets crushed, never in between, reads identically to a genuinely balanced one on a
// mean alone. The CSV is what lets a reader compute their own aggregations, look at the spread
// rather than the average, and find the one outlier match a summary table would smooth away.
//
// `run.json` stays the aggregated `RunRecord` it always was (that file is the baseline-comparison
// record, Task 20 — bloating it with every raw match would make every future `loadBaseline` slower
// for no reader of it). The raw `MatchOutcome[]` a run produced has to reach this file some other
// way, so `writeReport` takes it as its own parameter rather than folding it into `RunRecord`.

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvRow(fields: readonly (string | number)[]): string {
  return fields.map((f) => csvEscape(String(f))).join(",");
}

interface MatchCsvRow {
  matchIndex: number;
  seed: number;
  shape: string;
  mode: string;
  carId: CarId;
  sessionId: string;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  aliveTicks: number;
  phasedTicks: number;
  placement: number;
  won: boolean;
  hpAtEnd: number;
  matchTicks: number;
}

/**
 * One row per SEAT (not per distinct chassis — a mirror match fills two seats with the same
 * chassis, and both lives are independent data points) in every outcome, in run order.
 *
 * `matchIndex` is the outcome's position in `outcomes` — the same index `runAll` used to derive
 * that match's seed (`deriveSeed(config.seed, "match", i)`), recomputed here identically so a reader
 * can tell which seed produced a given row without `runAll` having had to hand it back separately.
 *
 * Damage dealt/taken is summed straight off `DamagedEvent.attackerSessionId`/`victimSessionId` —
 * unlike `aggregate()`'s per-CAR damage (which pools a mirror's two seats into one number by
 * design), a per-match, per-SEAT row needs the two seats kept apart, and `DamagedEvent` already
 * carries session ids precisely so this split is possible without re-deriving it.
 */
function buildMatchRows(record: RunRecord, outcomes: readonly MatchOutcome[]): MatchCsvRow[] {
  const modeName = GameMode[record.config.mode] ?? String(record.config.mode);
  const rows: MatchCsvRow[] = [];

  outcomes.forEach((outcome, matchIndex) => {
    const seed = deriveSeed(record.config.seed, "match", matchIndex);

    const dealtBySession = new Map<string, number>();
    const takenBySession = new Map<string, number>();
    for (const event of outcome.events.damaged) {
      if (event.attackerSessionId !== "") {
        dealtBySession.set(
          event.attackerSessionId,
          (dealtBySession.get(event.attackerSessionId) ?? 0) + event.amount,
        );
      }
      takenBySession.set(event.victimSessionId, (takenBySession.get(event.victimSessionId) ?? 0) + event.amount);
    }

    for (const seat of outcome.seats) {
      rows.push({
        matchIndex,
        seed,
        shape: record.config.shape,
        mode: modeName,
        carId: seat.carId,
        sessionId: seat.sessionId,
        kills: seat.kills,
        deaths: seat.deaths,
        damageDealt: dealtBySession.get(seat.sessionId) ?? 0,
        damageTaken: takenBySession.get(seat.sessionId) ?? 0,
        aliveTicks: seat.aliveTicks,
        phasedTicks: seat.phasedTicks,
        placement: seat.placement,
        won: outcome.winnerSessionId !== "" && seat.sessionId === outcome.winnerSessionId,
        hpAtEnd: seat.hp,
        matchTicks: outcome.ticks,
      });
    }
  });

  return rows;
}

function writeMatchesCsv(file: string, rows: readonly MatchCsvRow[]): void {
  const header = csvRow([
    "matchIndex", "seed", "shape", "mode", "carId", "sessionId", "kills", "deaths",
    "damageDealt", "damageTaken", "aliveTicks", "phasedTicks", "placement", "won", "hpAtEnd", "matchTicks",
  ]);
  const lines = rows.map((r) =>
    csvRow([
      r.matchIndex, r.seed, r.shape, r.mode, r.carId, r.sessionId, r.kills, r.deaths,
      r.damageDealt, r.damageTaken, r.aliveTicks, r.phasedTicks, r.placement, r.won ? 1 : 0,
      r.hpAtEnd, r.matchTicks,
    ]),
  );
  fs.writeFileSync(file, [header, ...lines].join("\n") + "\n", "utf8");
}

interface WeaponMatchCsvRow {
  matchIndex: number;
  carId: CarId;
  weaponId: WeaponId;
  presses: number;
  connectingPresses: number;
  damage: number;
  derivedDamage: number;
  kills: number;
}

/**
 * One row per weapon PER MATCH, for every weapon belonging to a chassis that actually played that
 * match. Built by running `aggregate()` — the SAME function that produces the run-wide `weapons`
 * table — on a single-element `[outcome]` array per match, per the task brief's "reuse aggregate on
 * a single-element array rather than writing a second aggregation path": one code path computes
 * both the whole-run numbers and each match's numbers, so they cannot drift apart.
 *
 * `aggregate()` seeds a row for EVERY chassis's EVERY weapon regardless of what any one match's
 * events mention (B31, so a never-pressed weapon stays visible run-wide) — but per match, a chassis
 * that did not even play should not get a phantom "0 presses" row for a weapon it never had the
 * chance to fire this match. Filtering to `carIdsInMatch` here is what keeps a duel's off-roster
 * chassis (the one of three NOT in this pairing) out of that match's rows, while a genuinely
 * zero-press weapon on a car that DID play still shows up, exactly like the run-wide table does.
 */
function buildWeaponMatchRows(outcomes: readonly MatchOutcome[]): WeaponMatchCsvRow[] {
  const rows: WeaponMatchCsvRow[] = [];

  outcomes.forEach((outcome, matchIndex) => {
    const carIdsInMatch = new Set(outcome.seats.map((seat) => seat.carId));
    const { weapons } = aggregate([outcome]);
    for (const w of weapons) {
      if (!carIdsInMatch.has(w.carId)) continue;
      rows.push({
        matchIndex,
        carId: w.carId,
        weaponId: w.weaponId,
        presses: w.presses,
        connectingPresses: w.connectingPresses,
        damage: w.damage,
        derivedDamage: w.derivedDamage,
        kills: w.kills,
      });
    }
  });

  return rows;
}

function writeWeaponsCsv(file: string, rows: readonly WeaponMatchCsvRow[]): void {
  const header = csvRow([
    "matchIndex", "carId", "weaponId", "presses", "connectingPresses", "damage", "derivedDamage", "kills",
  ]);
  const lines = rows.map((r) =>
    csvRow([r.matchIndex, r.carId, r.weaponId, r.presses, r.connectingPresses, r.damage, r.derivedDamage, r.kills]),
  );
  fs.writeFileSync(file, [header, ...lines].join("\n") + "\n", "utf8");
}

/**
 * Write `summary.md`, `matches.csv`, `weapons.csv` and `run.json` into `dir` (typically a folder
 * `createRunDir` just made) and return the four file paths written.
 *
 * `outcomes` is the raw per-match data `runAll` produced — needed to build the per-match CSVs, but
 * deliberately NOT part of `RunRecord`/`run.json` (see the CSV section header above). Pass the same
 * array `runAll` returned; an empty array is legal (a caller that only cares about `summary.md`,
 * such as a test) and just produces header-only CSVs — required rather than defaulted, so a real
 * caller cannot forget it and get silently empty CSVs.
 *
 * `baseline`, when given, adds a "Deltas vs baseline" section to `summary.md` — but loading a
 * baseline off disk and refusing an invalid comparison (mismatched fingerprints) is Task 20's job,
 * not this function's: `writeReport` renders whatever `RunRecord` it is handed, unconditionally.
 */
export function writeReport(
  dir: string,
  record: RunRecord,
  outcomes: readonly MatchOutcome[],
  baseline?: RunRecord,
): string[] {
  fs.mkdirSync(dir, { recursive: true });

  const summaryFile = path.join(dir, "summary.md");
  const matchesFile = path.join(dir, "matches.csv");
  const weaponsFile = path.join(dir, "weapons.csv");
  const runJsonFile = path.join(dir, "run.json");

  fs.writeFileSync(summaryFile, renderSummaryMarkdown(record, baseline), "utf8");
  writeMatchesCsv(matchesFile, buildMatchRows(record, outcomes));
  writeWeaponsCsv(weaponsFile, buildWeaponMatchRows(outcomes));
  fs.writeFileSync(runJsonFile, JSON.stringify(record, null, 2) + "\n", "utf8");

  return [summaryFile, matchesFile, weaponsFile, runJsonFile];
}
