import { afterEach, describe, expect, it, vi } from "vitest";
import { GameMode, TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { HumanController, type BotIntent, type BotView } from "../src/bot/index.js";
import { runMatch } from "./match.js";

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
  maxTicks: 30 * 60,
} as const;

describe("runMatch", () => {
  it("runs to a conclusion and names a winner or a draw", () => {
    const out = runMatch(SETUP);
    expect(out.ticks).toBeGreaterThan(0);
    expect(out.ticks).toBeLessThanOrEqual(SETUP.maxTicks);
  });

  it("collects combat events", () => {
    const out = runMatch(SETUP);
    expect(out.events.fired.length).toBeGreaterThan(0);
  });

  it("is deterministic for a seed (B43)", () => {
    const a = runMatch(SETUP);
    const b = runMatch(SETUP);
    expect(b.ticks).toBe(a.ticks);
    expect(b.winnerSessionId).toBe(a.winnerSessionId);
    expect(b.events.damaged.length).toBe(a.events.damaged.length);
  });

  it("produces a byte-identical outcome digest for the same seed (B43)", () => {
    // The cheaper assertion above (ticks/winner/event COUNTS) would still pass if, say, damage
    // amounts or event ordering diverged between the two runs — exactly the gap B43 calls out:
    // "the same seed twice produces an identical stats digest" is a property of the FULL result,
    // not of three or four hand-picked fields. Comparing the whole `MatchOutcome` (seats, every
    // event, every field on every event) is what actually asserts that property.
    const a = runMatch(SETUP);
    const b = runMatch(SETUP);
    const digestA = digest(a);
    const digestB = digest(b);
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
    const a = runMatch(SETUP);
    const b = runMatch({ ...SETUP, seed: 8 });
    expect(digest(b)).not.toBe(digest(a));
    // Non-vacuous: both runs really did simulate a match, so this is not two empty results differing
    // in nothing.
    expect(a.events.fired.length).toBeGreaterThan(0);
    expect(b.events.fired.length).toBeGreaterThan(0);
  });

  it("respawns in deathmatch, so both cars can outlive their first death", () => {
    const out = runMatch({ ...SETUP, mode: GameMode.FFA_DEATHMATCH, maxTicks: 30 * 60 });
    expect(out.seats.every((s) => s.deaths >= 0)).toBe(true);
    // The harness's own match length IS the deathmatch clock (fix round 2, defect 1): the match
    // runs its full 60 s and ends via `deathmatchEnded`'s own clock check, which is a NORMAL
    // conclusion for a timed mode, not the harness's `maxTicks` safety valve — so `hitClock` reads
    // false here, and a real winner/draw comes out of `deathmatchOutcome`'s kills-then-deaths rank.
    expect(out.ticks).toBe(30 * 60);
    expect(out.hitClock).toBe(false);
  });

  it("shortening matchSeconds still lets the deathmatch clock fire, so a winner can appear (fix round 2, defect 1)", () => {
    // Before the fix, `state.matchEndsTick` was pinned to the game's 180 s clock regardless of
    // `setup.maxTicks`, so any shortened run exited the loop before `deathmatchEnded` ever fired —
    // every match came back a draw (`winnerSessionId: ""`), and win rate silently read 0% for
    // exactly the fast-iteration runs the harness exists to support. This is the short-run case
    // that would have caught it: `matchSeconds` well under the game's 180 s default.
    //
    // 30 s, not the 10 s this originally used: since a range-0 weapon like `wildcharge` became
    // pressable at all (2026-09-04 — first the legacy bot's since-deleted `triggerRangeOf`, now the
    // human-like brain's `BRAIN_CONSTANTS.contactTriggerUnits` gate in `bot/brain/firing.ts`),
    // Bastion wears `fortified` for most of a ten-second window and Mirage's first kill lands at
    // ~15 s instead of inside 10 s — a killless window is a legitimate 0-0 draw,
    // which would fail this assertion without the clock defect having returned at all. The kills
    // assertion below states that premise outright so the two cases can never be confused: if a
    // future balance edit empties the window again, THAT line fails and names the reason.
    //
    // `seed: 27`, not 8: the 2026-09-04 lance retune made `weaponValueOf` count a ticking beam's
    // pulses (`bot/brain/firing.ts`), which reordered Mirage's slots and moved this matchup again —
    // seed 8's kill no longer lands inside the 30 s window. Swept seeds 1-40 against the new brain:
    // 27 is the one that stays decisive at both lengths. The seed history below is why this is
    // maintenance rather than a regression; the kills assertion is what tells the two apart.
    //
    // `seed: 8`, not 40: Task 8's host wiring turned view staleness on for real (see the comment on
    // "differs between seeds" above for the full seed history), which moved this hard-tier
    // Mirage/Bastion matchup's dynamics enough that seed 40 stopped landing a kill inside the 30 s
    // window — a legitimate killless window under the new views, not a clock regression, so this
    // test isn't about that case. Seed 8 lands a decisive kill inside the 30 s window and stays
    // decisive at full length (used below), so it exercises the clock-firing property this test
    // actually names without also asserting anything about who should win a fair fight. Verified by
    // actually running both scenarios across a range of seeds, not by inspection: seed 8 is decisive
    // on both.
    const out = runMatch({ ...SETUP, seed: 27, mode: GameMode.FFA_DEATHMATCH, maxTicks: 30 * TICK_RATE_HZ });
    expect(out.seats.some((s) => s.kills > 0)).toBe(true);
    expect(out.winnerSessionId).not.toBe("");
    expect(out.hitClock).toBe(false);
  });

  it("ranks placement by kills then fewest deaths in deathmatch", () => {
    // FIXTURE ROBUSTNESS FIX (final review, finding 8, applied to this test's sibling defect). This
    // used to pin ONE seed and assert it came back `[1, 2]` — which is a claim about that seed
    // being decisive, not about the ranking rule, and it needed a fresh seed after every layer of
    // the brain that moved this matchup (2 -> 11 -> 9 -> 40 -> 8, and the ram/blunder fixes in this
    // very review broke seed 8 in turn). The RULE — more kills places ahead; equal kills, fewer
    // deaths places ahead; equal on both places equal — is checkable on EVERY outcome, decisive or
    // drawn, so it is asserted across a spread of seeds instead of hidden behind one lucky one.
    // Seeds 9 and 10 replace 7 and 8 for the same reason the sibling test above re-seeded: the
    // 2026-09-04 brain change left seeds 1-8 all drawn, so the non-vacuity assertion at the bottom
    // had nothing decisive to stand on. The RULE below is asserted on every outcome either way.
    const outcomes = [1, 2, 3, 4, 5, 6, 9, 10].map((seed) =>
      runMatch({ ...SETUP, seed, mode: GameMode.FFA_DEATHMATCH }));

    for (const out of outcomes) {
      for (const a of out.seats) {
        for (const b of out.seats) {
          if (a.sessionId === b.sessionId) continue;
          const label = `seed run ${a.sessionId} (${a.kills}k/${a.deaths}d) vs ` +
            `${b.sessionId} (${b.kills}k/${b.deaths}d)`;
          if (a.kills !== b.kills) {
            // More kills always places ahead, whatever the deaths say.
            const [ahead, behind] = a.kills > b.kills ? [a, b] : [b, a];
            expect(ahead!.placement, label).toBeLessThan(behind!.placement);
          } else if (a.deaths !== b.deaths) {
            const [ahead, behind] = a.deaths < b.deaths ? [a, b] : [b, a];
            expect(ahead!.placement, label).toBeLessThan(behind!.placement);
          } else {
            // Tied on both counts is one result, not two adjacent ones — and in particular is never
            // broken by seat order, which is chassis order (`competitionRank`'s own doc).
            expect(a.placement, label).toBe(b.placement);
          }
        }
      }
    }

    // Non-vacuity: at least one of those matches actually WAS decisive, so the ordering branches
    // above ran rather than every pair falling into the tie case. This is the part a single seed
    // used to carry on its own, now spread across eight so one behaviour change cannot kill it.
    expect(outcomes.some((out) => new Set(out.seats.map((s) => s.placement)).size > 1)).toBe(true);
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
