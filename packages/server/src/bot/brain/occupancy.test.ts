import { afterEach, describe, expect, it, vi } from "vitest";
import { GameMode, ManeuverKind, TICK_RATE_HZ, hasStatus, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { runMatch } from "../../../balance/match.js";
import type { BotIntent, BotView, SituationId } from "../types.js";
import { HumanController } from "./controller.js";
import { ALL_SITUATIONS } from "./situation.js";

/**
 * Situation occupancy of a real match (the final review's measurement, kept as a slow test): one
 * 60 s, seed 7, hard Mirage-vs-Bullseye deathmatch duel on arena-01 through `balance/match.ts`'s
 * `runMatch`, with `HumanController.prototype.decide` wrapped to tally `debug()` per bot.
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
 */

/**
 * Below this speed a car with a hittable target counts as parked. A HOLD maneuver (`lance` holds the
 * car still while its beam is held) is the weapon stopping the car, not the bot, so it is excluded.
 */
const STATIONARY_SPEED = 15;
/** An `unpin` entered within this many ticks of leaving the last one is a bounce. */
const QUICK_REENTRY_TICKS = 30;

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

function measure(): Map<string, Tally> {
  const tallies = new Map<string, Tally>();
  const original = HumanController.prototype.decide;
  const spy = vi.spyOn(HumanController.prototype, "decide").mockImplementation(function (this: HumanController, view: BotView): BotIntent {
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
  });
  try {
    runMatch({
      seats: [
        { sessionId: "mirage", carId: "mirage", team: 0 },
        { sessionId: "bullseye", carId: "bullseye", team: 1 },
      ],
      mode: GameMode.FFA_DEATHMATCH,
      arenaId: "arena-01",
      difficulty: "hard",
      seed: 7,
      maxTicks: 60 * TICK_RATE_HZ,
    });
  } finally {
    spy.mockRestore();
  }
  return tallies;
}

const pct = (n: number, of: number) => (of > 0 ? (100 * n) / of : 0);

describe("situation occupancy, hard Mirage vs Bullseye, arena-01, seed 7, 60 s", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not park, shuttle at walls or moonwalk", () => {
    installMode(modeConfigOf(GameMode.FFA_DEATHMATCH));
    const tallies = measure();
    const rows: Record<string, Record<string, string | number>> = {};
    for (const [id, t] of tallies) {
      rows[id] = {
        aliveTicks: t.alive,
        ...Object.fromEntries(ALL_SITUATIONS.map((s) => [s, `${pct(t.situations[s], t.alive).toFixed(1)}%`])),
        reverse: `${pct(t.reverse, t.alive).toFixed(1)}%`,
        stationaryHittable: `${pct(t.stationaryHittable, t.alive).toFixed(1)}%`,
        unpinEntries: t.unpinEntries,
        unpinQuickReentries: t.unpinQuickReentries,
        ramsLanded: t.ramsLanded,
      };
    }
    console.table(rows);

    expect(tallies.size).toBe(2);
    for (const t of tallies.values()) {
      expect(t.alive).toBeGreaterThan(0);
      expect(pct(t.situations.unpin, t.alive)).toBeLessThan(10);
      expect(t.unpinQuickReentries).toBeLessThanOrEqual(4);
      // Regression guards, not targets: see the header.
      expect(pct(t.stationaryHittable, t.alive)).toBeLessThan(10);
      expect(pct(t.reverse, t.alive)).toBeLessThan(60);
    }
  });
});
