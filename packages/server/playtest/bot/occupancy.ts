/**
 * Situation occupancy of a real match (the final review's measurement, kept as a bot-report probe): one
 * 60 s, seed 7, hard Mirage-vs-Bullseye deathmatch duel on arena-01 through `balance/match.ts`'s
 * `runMatch`, with `HumanController.prototype.decide` wrapped to tally `debug()` per bot. A second
 * block runs the review's six-bot easy FFA on both tile arenas, the scene where 7.1.0's contact-only
 * `unpin` regressed easy (7.1.1, C2).
 *
 * It catches what the per-module tests cannot: a bot that parks while reloading (C1), shuttles
 * forward and back at a wall (C2), or never lands a ram (I2). One seed, so read the numbers as a
 * symptom check rather than a statistic.
 *
 * Measured (mirage / bullseye; 7.0.0 -> 7.1.0):
 *
 * - `unpin` share 29.3 / 28.2 % -> 8.4 / 6.8 %; entries 36 / 33 -> 6 / 2; re-entries within
 *   30 ticks of leaving 26 / 24 -> 2 / 1.
 * - `fight` 2.7 / 3.9 % -> 37.9 / 51.7 %; `close` 4.7 / 5.1 % -> 0 / 0 %.
 * - reverse share 56.0 / 53.7 % -> 55.3 / 45.6 %. Most of what is left is the orbit weave's nose-on
 *   back-out (BB24), half of every weave by design, now that `fight` is where the bot spends its
 *   time; then `evade` and `unpin`.
 * - stationary while hittable 5.1 / 4.4 % -> 6.8 / 8.5 %: in-band lift-off under a `nose` goal
 *   (`punish`, `fight`) by design, and reversing into a wall the bot cannot see behind it.
 * - rams landed 0 / 0 -> 0 / 0 in this duel.
 *
 * The bounds: `unpin` share under 10 % and quick re-entries at most twice the measured worst (the fix
 * wave's ceilings, tightened where twice the measurement is lower). Reverse and stationary shares
 * did not reach the fix wave's 30 % and 5 % ceilings; they are held at their measured worst plus
 * a margin as regression guards, and the gap is recorded in the 7.1.0 fix-wave report.
 *
 * These were `src/bot/brain/occupancy.test.ts` until 2026-10-10 (TS11–TS14): what one seed happens
 * to do is calibration, so a breached bound now reads `FINDING` here rather than failing the build.
 */
import { GameMode, ManeuverKind, TICK_RATE_HZ, hasStatus, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { runMatch } from "../../balance/match.js";
import type { BotIntent, BotView, SituationId } from "../../src/bot/types.js";
import { HumanController } from "../../src/bot/brain/controller.js";
import { ALL_SITUATIONS } from "../../src/bot/brain/situation.js";
import { VERDICT } from "../common/reporter.js";

/**
 * Below this speed a car with a hittable target counts as parked. A HOLD maneuver (`lance` holds the
 * car still while its beam is held) is the weapon stopping the car, not the bot, so it is excluded.
 */
const STATIONARY_SPEED = 15;
/** An `unpin` entered within this many ticks of leaving the last one is a bounce. */
const QUICK_REENTRY_TICKS = 30;

/** Duel bounds, per seat (see the header). Shares are percent of alive ticks. */
const DUEL_UNPIN_SHARE_BELOW = 10;
const DUEL_QUICK_REENTRIES_AT_MOST = 4;
/** Regression guards, not targets: see the header. */
const DUEL_STATIONARY_SHARE_BELOW = 10;
const DUEL_REVERSE_SHARE_BELOW = 60;

/**
 * Six-bot easy FFA bounds, summed over every seat. Measured (arena-01 / arena-02; 7.1.0 -> 7.1.1):
 * share 16.1 / 30.9 % -> 13.2 / 9.6 %, quick re-entries 9 / 9 -> 5 / 1. The bounds sit between the
 * two: either 7.1.0 arena fails them.
 */
const FFA_UNPIN_SHARE_BELOW = 16;
const FFA_QUICK_REENTRIES_AT_MOST = 8;

type Report = (probe: string, verdict: string, detail: string) => void;

interface Tally {
  alive: number;
  situations: Record<SituationId, number>;
  reverse: number;
  stationaryHittable: number;
  unpinEntries: number;
  unpinQuickReentries: number;
  ramsLanded: number;
  lastSituation: SituationId | undefined;
  unpinLeftTick: number | undefined;
  hadRamLock: boolean;
}

function newTally(): Tally {
  return {
    alive: 0,
    situations: Object.fromEntries(ALL_SITUATIONS.map((s) => [s, 0])) as Record<SituationId, number>,
    reverse: 0, stationaryHittable: 0, unpinEntries: 0, unpinQuickReentries: 0, ramsLanded: 0,
    lastSituation: undefined, unpinLeftTick: undefined, hadRamLock: false,
  };
}

/** The duel the header describes: hard Mirage vs Bullseye, arena-01, seed 7, 60 s. */
const DUEL: Parameters<typeof runMatch>[0] = {
  seats: [
    { sessionId: "mirage", carId: "mirage", team: 0 },
    { sessionId: "bullseye", carId: "bullseye", team: 1 },
  ],
  mode: GameMode.FFA_DEATHMATCH,
  arenaId: "arena-01",
  difficulty: "hard",
  seed: 7,
  maxTicks: 60 * TICK_RATE_HZ,
};

/**
 * The six-bot FFA of the 7.1.0 final review (seed 7, 60 s): two each of the type triangle, every
 * seat on team 0 as the balance harness seats an FFA, at the given tier and arena.
 */
function sixBotFfa(difficulty: "easy" | "medium" | "hard", arenaId: string): Parameters<typeof runMatch>[0] {
  const chassis = ["mirage", "bullseye", "bastion"] as const;
  return {
    seats: chassis.flatMap((carId) => [0, 1].map((i) => ({ sessionId: `${carId}-${i}`, carId, team: 0 as const }))),
    mode: GameMode.FFA_DEATHMATCH,
    arenaId,
    difficulty,
    seed: 7,
    maxTicks: 60 * TICK_RATE_HZ,
  };
}

/**
 * Run `setup` with `HumanController.prototype.decide` wrapped to tally each bot's `debug()`. The
 * wrapper is installed by hand (no vitest here) and always restored, so a throw cannot leave the
 * prototype patched for the next module.
 */
function measure(setup: Parameters<typeof runMatch>[0]): Map<string, Tally> {
  const tallies = new Map<string, Tally>();
  const original = HumanController.prototype.decide;
  HumanController.prototype.decide = function (this: HumanController, view: BotView): BotIntent {
    const out = original.call(this, view);
    const self = view.self;
    const t = tallies.get(self.sessionId) ?? newTally();
    tallies.set(self.sessionId, t);
    // A ram lands on the attacker as `ramLock` (the victim takes `reeling`).
    const ramLock = hasStatus(self.statuses, "ramLock", view.tick);
    if (ramLock && !t.hadRamLock) t.ramsLanded += 1;
    t.hadRamLock = ramLock;
    if (!self.alive) { t.lastSituation = undefined; return out; }
    const d = this.debug()!;
    t.alive += 1;
    t.situations[d.situation] += 1;
    if (d.throttle === -1) t.reverse += 1;
    if (d.targetSessionId !== undefined && d.situation !== "recover" && self.maneuver !== ManeuverKind.HOLD && Math.hypot(self.vx, self.vy) < STATIONARY_SPEED) {
      t.stationaryHittable += 1;
    }
    if (d.situation === "unpin" && t.lastSituation !== "unpin") {
      t.unpinEntries += 1;
      if (t.unpinLeftTick !== undefined && view.tick - t.unpinLeftTick <= QUICK_REENTRY_TICKS) t.unpinQuickReentries += 1;
    }
    if (d.situation !== "unpin" && t.lastSituation === "unpin") t.unpinLeftTick = view.tick;
    t.lastSituation = d.situation;
    return out;
  };
  try {
    runMatch(setup);
  } finally {
    HumanController.prototype.decide = original;
  }
  return tallies;
}

const pct = (n: number, of: number) => (of > 0 ? (100 * n) / of : 0);

function tallyLines(tallies: Map<string, Tally>): string[] {
  return [...tallies].map(([id, t]) =>
    `${id}: alive ${t.alive} ticks · ` +
    ALL_SITUATIONS.map((s) => `${s} ${pct(t.situations[s], t.alive).toFixed(1)}%`).join(", ") +
    ` · reverse ${pct(t.reverse, t.alive).toFixed(1)}%` +
    ` · stationary-hittable ${pct(t.stationaryHittable, t.alive).toFixed(1)}%` +
    ` · unpin entries ${t.unpinEntries}, quick re-entries ${t.unpinQuickReentries}` +
    ` · rams landed ${t.ramsLanded}`);
}

/** Alive-tick-weighted `unpin` share and the summed quick re-entries across every seat. */
function unpinSummary(tallies: Map<string, Tally>): { share: number; quickReentries: number } {
  let unpin = 0, alive = 0, quickReentries = 0;
  for (const t of tallies.values()) {
    unpin += t.situations.unpin;
    alive += t.alive;
    quickReentries += t.unpinQuickReentries;
  }
  return { share: pct(unpin, alive), quickReentries };
}

function verdictOf(breaches: readonly string[]): string {
  return breaches.length === 0 ? VERDICT.OK : VERDICT.FINDING;
}

function breachLines(breaches: readonly string[]): string[] {
  return breaches.length === 0 ? ["every bound holds"] : breaches.map((b) => `BREACH: ${b}`);
}

function duel(report: Report): void {
  installMode(modeConfigOf(GameMode.FFA_DEATHMATCH));
  const tallies = measure(DUEL);
  const breaches: string[] = [];
  if (tallies.size !== 2) breaches.push(`seats tallied ${tallies.size}, expected 2`);
  for (const [id, t] of tallies) {
    const unpin = pct(t.situations.unpin, t.alive);
    const stationary = pct(t.stationaryHittable, t.alive);
    const reverse = pct(t.reverse, t.alive);
    if (!(t.alive > 0)) breaches.push(`${id}: alive ticks ${t.alive}, expected > 0`);
    if (!(unpin < DUEL_UNPIN_SHARE_BELOW)) breaches.push(`${id}: unpin share ${unpin.toFixed(1)} %, bound < ${DUEL_UNPIN_SHARE_BELOW} %`);
    if (!(t.unpinQuickReentries <= DUEL_QUICK_REENTRIES_AT_MOST)) {
      breaches.push(`${id}: quick re-entries ${t.unpinQuickReentries}, bound <= ${DUEL_QUICK_REENTRIES_AT_MOST}`);
    }
    if (!(stationary < DUEL_STATIONARY_SHARE_BELOW)) {
      breaches.push(`${id}: stationary-while-hittable ${stationary.toFixed(1)} %, bound < ${DUEL_STATIONARY_SHARE_BELOW} %`);
    }
    if (!(reverse < DUEL_REVERSE_SHARE_BELOW)) breaches.push(`${id}: reverse share ${reverse.toFixed(1)} %, bound < ${DUEL_REVERSE_SHARE_BELOW} %`);
  }
  report(
    "does not park, shuttle at walls or moonwalk (hard Mirage vs Bullseye, arena-01, seed 7, 60 s)",
    verdictOf(breaches),
    [...tallyLines(tallies), ...breachLines(breaches)].join("\n"),
  );
}

function easyFfa(report: Report, arenaId: string): void {
  installMode(modeConfigOf(GameMode.FFA_DEATHMATCH));
  const tallies = measure(sixBotFfa("easy", arenaId));
  const { share, quickReentries } = unpinSummary(tallies);
  const breaches: string[] = [];
  if (tallies.size !== 6) breaches.push(`seats tallied ${tallies.size}, expected 6`);
  if (!(share < FFA_UNPIN_SHARE_BELOW)) breaches.push(`unpin share ${share.toFixed(1)} %, bound < ${FFA_UNPIN_SHARE_BELOW} %`);
  if (!(quickReentries <= FFA_QUICK_REENTRIES_AT_MOST)) {
    breaches.push(`quick re-entries ${quickReentries}, bound <= ${FFA_QUICK_REENTRIES_AT_MOST}`);
  }
  report(
    `does not reach unpin before its reactive wall layer on ${arenaId} (easy six-bot FFA, seed 7, 60 s; C2, BB33, 7.1.1)`,
    verdictOf(breaches),
    [
      `${arenaId}: easy unpin share ${share.toFixed(1)} %, quick re-entries ${quickReentries}`,
      ...tallyLines(tallies),
      ...breachLines(breaches),
    ].join("\n"),
  );
}

export function run(report: Report): void {
  duel(report);
  for (const arenaId of ["arena-01", "arena-02"]) easyFfa(report, arenaId);
}
