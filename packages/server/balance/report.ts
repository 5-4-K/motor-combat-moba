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
import { GameMode } from "@motor-combat-moba/shared";
import { BOT_PROFILES, type BotProfile } from "../src/config/bot-profiles.js";
import type { RunConfig } from "./runner.js";
import type { CarStats, Interval, MatchupCell, PaceStats, WeaponStats } from "./stats.js";
import { wilson } from "./stats.js";

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
    "First use (s)",
  ];
  const rows = record.weapons.map((w) => [
    w.weaponId,
    w.carId,
    String(w.presses),
    formatInterval(w.hitRate),
    fmt1(w.damage),
    ...(anyDerived ? [w.derivedDamage > 0 ? fmt1(w.derivedDamage) : "–"] : []),
    String(w.kills),
    fmt1(w.damagePerPress),
    formatPct(w.kitDamageShare) + " of kit",
    fmt1(w.pressesPerMinute),
    w.meanFirstUseSeconds === null ? "never" : fmt1(w.meanFirstUseSeconds),
  ]);
  const derivedNote = anyDerived
    ? "\n\n`Derived` damage is credited by INFERENCE through a status pulse — today only " +
      "`overheated`, which `afterburner` applies — rather than measured directly off a damage " +
      "event. It is included in `Damage` above, not additional to it."
    : "";
  return ["## Per-weapon", "", mdTable(headers, rows) + derivedNote].join("\n");
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
    fmt1(m.meanWinnerHp),
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

  return [
    "## Pace",
    "",
    mdTable(
      ["Mean match length (s)", "Mean time to first blood (s)", "Kills / minute", "Hit the clock"],
      [[
        fmt1(pace.meanMatchSeconds),
        pace.meanFirstBloodSeconds === null ? "no kills recorded" : fmt1(pace.meanFirstBloodSeconds),
        fmt1(pace.killsPerMinute),
        formatInterval(clockInterval),
      ]],
    ),
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
  if (record.config.shape === "duel") sections.push(renderMatchupMatrix(record));
  sections.push(renderPace(record));
  if (baseline) sections.push(renderDeltas(record, baseline));
  return sections.join("\n\n") + "\n";
}

// ---- CSVs -----------------------------------------------------------------------------------
// `RunRecord` carries `aggregate()`'s OUTPUT — one row per car and one row per weapon for the
// whole run, not one row per match — so that is what these two files hold: an aggregated summary
// per car and per weapon, the same rows `summary.md`'s tables render, in a form a spreadsheet can
// load. (`RunRecord` has no per-match outcomes to expand into a true one-row-per-match CSV; only
// the CLI driving `runAll` sees those, and Task 19 does not own the CLI.)

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvRow(fields: readonly (string | number)[]): string {
  return fields.map((f) => csvEscape(String(f))).join(",");
}

function writeCarsCsv(file: string, cars: readonly CarStats[]): void {
  const header = csvRow([
    "carId", "matches", "wins", "winRate", "winRateLow", "winRateHigh", "meanPlacement",
    "kills", "deaths", "damageDealt", "damageTaken", "meanAliveSeconds", "phasedFraction",
  ]);
  const rows = cars.map((c) =>
    csvRow([
      c.carId, c.matches, c.wins, c.winRate.rate, c.winRate.low, c.winRate.high, c.meanPlacement,
      c.kills, c.deaths, c.damageDealt, c.damageTaken, c.meanAliveSeconds, c.phasedFraction,
    ]),
  );
  fs.writeFileSync(file, [header, ...rows].join("\n") + "\n", "utf8");
}

function writeWeaponsCsv(file: string, weapons: readonly WeaponStats[]): void {
  const header = csvRow([
    "weaponId", "carId", "presses", "connectingPresses", "hitRate", "hitRateLow", "hitRateHigh",
    "damage", "derivedDamage", "kills", "damagePerPress", "kitDamageShare", "pressesPerMinute",
    "meanFirstUseSeconds",
  ]);
  const rows = weapons.map((w) =>
    csvRow([
      w.weaponId, w.carId, w.presses, w.connectingPresses, w.hitRate.rate, w.hitRate.low, w.hitRate.high,
      w.damage, w.derivedDamage, w.kills, w.damagePerPress, w.kitDamageShare, w.pressesPerMinute,
      w.meanFirstUseSeconds ?? "",
    ]),
  );
  fs.writeFileSync(file, [header, ...rows].join("\n") + "\n", "utf8");
}

/**
 * Write `summary.md`, `matches.csv`, `weapons.csv` and `run.json` into `dir` (typically a folder
 * `createRunDir` just made) and return the four file paths written.
 *
 * `baseline`, when given, adds a "Deltas vs baseline" section to `summary.md` — but loading a
 * baseline off disk and refusing an invalid comparison (mismatched fingerprints) is Task 20's job,
 * not this function's: `writeReport` renders whatever `RunRecord` it is handed, unconditionally.
 */
export function writeReport(dir: string, record: RunRecord, baseline?: RunRecord): string[] {
  fs.mkdirSync(dir, { recursive: true });

  const summaryFile = path.join(dir, "summary.md");
  const matchesFile = path.join(dir, "matches.csv");
  const weaponsFile = path.join(dir, "weapons.csv");
  const runJsonFile = path.join(dir, "run.json");

  fs.writeFileSync(summaryFile, renderSummaryMarkdown(record, baseline), "utf8");
  writeCarsCsv(matchesFile, record.cars);
  writeWeaponsCsv(weaponsFile, record.weapons);
  fs.writeFileSync(runJsonFile, JSON.stringify(record, null, 2) + "\n", "utf8");

  return [summaryFile, matchesFile, weaponsFile, runJsonFile];
}
