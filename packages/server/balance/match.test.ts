import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { GameMode, TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { HumanController, type BotIntent, type BotView } from "../src/bot/index.js";
import { rankDeathmatch, runMatch, type MatchOutcome } from "./match.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

/**
 * A stable digest of any JSON-safe value: recursively sort object keys, then `JSON.stringify` —
 * the same technique `fingerprint.ts`'s `stableStringify` uses, kept local here rather than
 * imported so this test file does not reach into that module's internals for a one-off. Two
 * `MatchOutcome`s that digest identically are identical in every field, not just the three or four
 * a hand-picked assertion happens to name (B43: "the same seed twice produces an identical stats
 * digest" — this is that property, applied at the single-match level).
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = sortKeysDeep(source[key]);
    return sorted;
  }
  return value;
}

function digest(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

const SETUP = {
  seats: [
    { sessionId: "a", carId: "mirage", team: 0 },
    { sessionId: "b", carId: "bastion", team: 0 },
  ],
  mode: GameMode.FFA_LAST_STANDING,
  arenaId: "arena-01",
  difficulty: "hard",
  seed: 1,
  maxTicks: 30 * TICK_RATE_HZ,
} as const;

describe("rankDeathmatch", () => {
  const p = (sessionId: string, kills: number, deaths: number) => ({ sessionId, kills, deaths });
  const asObject = (ranks: Map<string, number>) => Object.fromEntries(ranks);

  it("ranks more kills ahead, whatever the deaths say", () => {
    expect(asObject(rankDeathmatch([p("a", 2, 1), p("b", 1, 0)]))).toEqual({ a: 1, b: 2 });
  });

  it("breaks equal kills by fewer deaths", () => {
    expect(asObject(rankDeathmatch([p("a", 1, 2), p("b", 1, 1)]))).toEqual({ b: 1, a: 2 });
  });

  it("places a tie on both counts equally", () => {
    expect(asObject(rankDeathmatch([p("a", 0, 0), p("b", 0, 0)]))).toEqual({ a: 1, b: 1 });
  });

  it("never lets seat order break a tie (fix round 3, defect 1)", () => {
    for (const players of [
      [p("a", 2, 1), p("b", 1, 0)],
      [p("a", 1, 2), p("b", 1, 1)],
      [p("a", 0, 0), p("b", 0, 0)],
    ]) {
      expect(asObject(rankDeathmatch([...players].reverse()))).toEqual(asObject(rankDeathmatch(players)));
    }
  });

  it("uses competition ranking: a shared place skips the next", () => {
    expect(asObject(rankDeathmatch([p("a", 2, 0), p("b", 1, 0), p("c", 1, 0), p("d", 0, 0)])))
      .toEqual({ a: 1, b: 2, c: 2, d: 4 });
  });
});

describe("runMatch", () => {
  // One finished `runMatch(SETUP)`, shared by every test that only reads a result. `beforeAll` runs
  // before the file's `beforeEach`, so it installs the mode itself.
  let base: MatchOutcome;
  beforeAll(() => {
    installMode(modeConfigOf(DEFAULT_GAME_MODE));
    base = runMatch(SETUP);
  });

  it("runs to a conclusion and names a winner or a draw", () => {
    expect(base.ticks).toBeGreaterThan(0);
    expect(base.ticks).toBeLessThanOrEqual(SETUP.maxTicks);
  });

  it("collects combat events", () => {
    expect(base.events.fired.length).toBeGreaterThan(0);
  });

  it("produces a byte-identical outcome digest for the same seed (B43)", () => {
    // "The same seed twice produces an identical stats digest" is a property of the FULL result,
    // not of three or four hand-picked fields: comparing the whole `MatchOutcome` (ticks, winner,
    // seats, every event, every field on every event) is what actually asserts it.
    const again = runMatch(SETUP);
    const digestA = digest(base);
    const digestB = digest(again);
    expect(digestA.length).toBeGreaterThan(0); // sanity: the digest isn't vacuously comparing "{}"
    expect(digestB).toBe(digestA);
  });

  it("differs between seeds", () => {
    // FIXTURE ROBUSTNESS FIX (final review, finding 8). This used to assert `b.ticks !== a.ticks`,
    // which is a much narrower claim than the one the test's name makes and one this matchup kept
    // failing to satisfy: it held only while exactly one of the two seeds ended early, so every
    // layer of the brain that moved this hard-tier Mirage/Bastion pair's dynamics needed a fresh
    // seed to restore it. Six reseeds in one plan (2 -> 11 -> 9 -> 40 -> 8, plus 1 for the sibling
    // fixture), each one a real behaviour change landing on a knife-edge assertion rather than a
    // regression — and a future change that makes BOTH seeds run the full clock would fail this for
    // a reason that has nothing to do with seeding.
    //
    // The honest property is that two seeds produce two DIFFERENT MATCHES, and the whole-outcome
    // digest already defined above says that directly: spawn assignment, every bot's rng stream and
    // therefore every shot, hit and death all key off the seed. Two matches that agreed in every
    // field of every event would be the actual bug this test is for, and no reseed can paper over
    // it — a match that runs its full clock still differs from another in who shot what, and when.
    const a = base;
    const b = runMatch({ ...SETUP, seed: 8 });
    expect(digest(b)).not.toBe(digest(a));
    // Non-vacuous: both runs really did simulate a match, so this is not two empty results differing
    // in nothing.
    expect(a.events.fired.length).toBeGreaterThan(0);
    expect(b.events.fired.length).toBeGreaterThan(0);
  });

  it("a shortened deathmatch ends on its own clock, not the harness's cap or a death (fix round 2, defect 1)", () => {
    // The defect: `state.matchEndsTick` stayed pinned to the game's 180 s clock, so a shorter run
    // exited on `maxTicks` before `deathmatchEnded` fired and every match came back a draw. The
    // harness's match length IS the deathmatch clock, so the match ends via `deathmatchEnded`'s own
    // clock check — a NORMAL conclusion for a timed mode, so `hitClock` reads false.
    const matchTicks = 30 * TICK_RATE_HZ;
    const out = runMatch({ ...SETUP, mode: GameMode.FFA_DEATHMATCH, maxTicks: matchTicks });
    expect(out.hitClock).toBe(false);
    expect(Math.abs(out.ticks - matchTicks)).toBeLessThanOrEqual(1);
    // And a death does not end it: this match has one (the scenario's precondition — without it
    // the line below would prove nothing), and the match still runs to the clock, where
    // last-standing would have concluded on that death.
    expect(out.seats.reduce((sum, seat) => sum + seat.deaths, 0)).toBeGreaterThan(0);
  });

  it("ties on kills/deaths place equally in deathmatch, regardless of seat order (fix round 3, defect 1)", () => {
    // One tick is nowhere near enough time for either bot to land a hit, so both seats finish
    // 0 kills / 0 deaths -- a genuine tie. Before the fix, `placementsFor` broke ties with a stable
    // sort over `setup.seats`, so the FIRST-listed seat always won the tie (1, 2) purely from table
    // position -- and seat order is chassis order (`ffaSeats` in runner.ts), so that bug would read
    // as a per-chassis "Mean placement" signal that was actually measuring nothing but the roster's
    // listing order. Running the same tie forwards and reversed catches that regression directly.
    const setup = { ...SETUP, mode: GameMode.FFA_DEATHMATCH, maxTicks: 1 } as const;
    const forward = runMatch(setup);
    const reversed = runMatch({ ...setup, seats: [...setup.seats].reverse() });

    for (const out of [forward, reversed]) {
      expect(out.seats.every((s) => s.kills === 0 && s.deaths === 0)).toBe(true);
      expect(out.seats.map((s) => s.placement)).toEqual([1, 1]);
    }
  });

  describe("observedFires (B18)", () => {
    afterEach(() => vi.restoreAllMocks());

    it("carries the PREVIOUS tick's fires into the next tick's view, for another car", () => {
      // Spies on the real `HumanController.decide` — the exact instance method `match.ts` calls —
      // recording every `BotView` it is handed while still running the real decision underneath, so
      // the match plays out exactly as `runMatch` would on its own. This is the only seam available
      // to observe a `BotView` from outside `match.ts`, which builds and discards one per bot per
      // tick without ever returning it.
      const original = HumanController.prototype.decide;
      const seenViews: BotView[] = [];
      vi.spyOn(HumanController.prototype, "decide").mockImplementation(
        function (this: HumanController, view: BotView): BotIntent {
          seenViews.push(view);
          return original.call(this, view);
        },
      );

      const out = runMatch(SETUP);
      expect(out.events.fired.length).toBeGreaterThan(0); // hard bots at close range fire readily

      const withFires = seenViews.filter((v) => v.observedFires.length > 0);
      expect(withFires.length).toBeGreaterThan(0);

      for (const view of withFires) {
        for (const fire of view.observedFires) {
          // The honest model (B18): a shot is seen the tick AFTER it happens, never the same tick.
          expect(fire.tick).toBe(view.tick - 1);
          // And it is a REAL fire this match actually recorded, not a fabricated one.
          expect(out.events.fired).toContainEqual(fire);
        }
      }
    });

    it("is empty on the very first tick — nothing has fired yet to observe", () => {
      const original = HumanController.prototype.decide;
      const seenViews: BotView[] = [];
      vi.spyOn(HumanController.prototype, "decide").mockImplementation(
        function (this: HumanController, view: BotView): BotIntent {
          seenViews.push(view);
          return original.call(this, view);
        },
      );

      runMatch(SETUP);
      const firstTickViews = seenViews.filter((v) => v.tick === 1);
      expect(firstTickViews.length).toBeGreaterThan(0);
      for (const view of firstTickViews) expect(view.observedFires).toEqual([]);
    });
  });
});
