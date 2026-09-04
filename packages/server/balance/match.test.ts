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
    const a = runMatch(SETUP);
    // `seed: 11`, not 2: Task 5's movement layer (context-steering blend, orbit, wall push, dodge)
    // changed this hard-tier Mirage/Bastion matchup's dynamics enough that seed 2 now also runs the
    // full `maxTicks` (1800) under `FFA_LAST_STANDING`, same as seed 1 — a legitimate tie between two
    // draws, not proof the seeds behave identically. Seed 11 reliably ends early with a decisive
    // winner (657 ticks, `a`), so it is the one that actually exercises "two seeds differ".
    const b = runMatch({ ...SETUP, seed: 11 });
    // Spawn assignment is seeded, so two seeds place the cars differently.
    expect(b.ticks).not.toBe(a.ticks);
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
    // 30 s, not the 10 s this originally used: since `triggerRangeOf` (2026-09-04) let a bot press
    // `wildcharge` at all, Bastion wears `fortified` for most of a ten-second window and Mirage's
    // first kill lands at ~15 s instead of inside 10 s — a killless window is a legitimate 0-0 draw,
    // which would fail this assertion without the clock defect having returned at all. The kills
    // assertion below states that premise outright so the two cases can never be confused: if a
    // future balance edit empties the window again, THAT line fails and names the reason.
    //
    // `seed: 9`, not `SETUP`'s seed 1: Task 4's firing layer (`chooseSlot`, `preferredRangeOf`)
    // made this hard-tier Mirage/Bastion matchup trade almost perfectly evenly under seed 1 — same
    // kill and death counts at every window checked from 30 s out to 180 s, a legitimate repeated
    // tie rather than a clock regression, so `winnerSessionId` came back `""` for a reason this test
    // isn't about. Seed 2 was the fix for that, then seed 11 after Task 5's movement layer
    // (context-steering: orbit, wall push, dodge-as-a-desire) moved this matchup's dynamics again —
    // but Task 6's stance/target-selection layer (scored stances, a commitment window, target
    // politics) moved it a third time, and seed 11 ties under this mode too. Seed 9 lands a decisive
    // kill (`kills: [0, 1]`) inside the 30 s window and stays decisive at full length (used below),
    // so it exercises the clock-firing property this test actually names without also asserting
    // anything about who should win a fair fight. Verified by actually running both scenarios below
    // across a range of seeds, not by inspection: seed 9 is decisive on both.
    const out = runMatch({ ...SETUP, seed: 9, mode: GameMode.FFA_DEATHMATCH, maxTicks: 30 * TICK_RATE_HZ });
    expect(out.seats.some((s) => s.kills > 0)).toBe(true);
    expect(out.winnerSessionId).not.toBe("");
    expect(out.hitClock).toBe(false);
  });

  it("ranks placement by kills then fewest deaths in deathmatch", () => {
    // `seed: 9` for the same reason as the test above: seed 1 trades evenly under Task 4's firing
    // layer, seed 2 stopped being decisive once Task 5's movement layer (context-steering: orbit,
    // wall push, dodge) moved this matchup's dynamics again, and seed 11 — Task 5's fix — stopped
    // being decisive once Task 6's stance/target-selection layer moved it a third time, all a
    // legitimate tie (`placement` [1, 1]) rather than what this test is checking. Seed 9 reliably
    // produces a decisive kills/deaths split.
    const out = runMatch({ ...SETUP, seed: 9, mode: GameMode.FFA_DEATHMATCH });
    expect(out.seats.map((s) => s.placement).sort()).toEqual([1, 2]);
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
