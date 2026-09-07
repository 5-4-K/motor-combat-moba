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
    // `seed: 65`, not 21: the 2026-09-05 situation-play brain (waitOut on corpses, S10 aim-reach,
    // evade as a situation rather than a blend) moved this matchup again — seed 21 is now a
    // legitimate 0-0 in 30 s. Swept 1-80: 23, 27, and 65 still land a kill inside the window.
    //
    // `seed: 21`, not 27: the 2026-09-04 tactical-intelligence pass replaced stances with goals
    // (hunt is last-known, dodge is a deflection, kit roles drive setupCc/dump), which moved this
    // hard-tier Mirage/Bastion matchup again — seed 27's kill no longer lands inside the 30 s
    // window. Swept seeds 1-60 against the new brain: 21 (and 22) stay decisive at both 30 s and
    // 60 s. The seed history below is why this is maintenance rather than a regression; the kills
    // assertion is what tells the two apart.
    //
    // `seed: 27`, not 8: the 2026-09-04 lance retune made `weaponValueOf` count a ticking beam's
    // pulses (`bot/brain/firing.ts`), which reordered Mirage's slots and moved this matchup again —
    // seed 8's kill no longer lands inside the 30 s window.
    //
    // `seed: 8`, not 40: Task 8's host wiring turned view staleness on for real (see the comment on
    // "differs between seeds" above for the full seed history), which moved this hard-tier
    // Mirage/Bastion matchup's dynamics enough that seed 40 stopped landing a kill inside the 30 s
    // window — a legitimate killless window under the new views, not a clock regression, so this
    // test isn't about that case.
    //
    // Checked, not reseeded, on 2026-09-06: stage 1 of the vector-drive rework (the heavy-car pass —
    // `baseMaxSpeed`/`speedPerRating`/`baseAccel`/`accelPerRating` all cut, per-car `coastHalfLifeSeconds`
    // and `brakeDecel` added) was swept against seed 65 both ways: red against the pre-pass drive
    // numbers (no kill lands in the 30 s window), green after landing them, unchanged. Recorded here
    // so the next reader knows this was verified rather than merely untouched by the pass.
    //
    // `seed: 15`, not 65: stage 2 (contact and impulse) landed later the same day -- walls deflect
    // instead of damping, restitution 0.35 -> 0.15 (Task 1), and car-car separation splits by mass
    // instead of each side taking the full push (Task 2). Together these moved enough ram/positioning
    // outcomes that seed 65 is now a 0-0 draw in the 30 s window. Swept 1-100 against the new contact
    // physics: 15, 26, 28, 48, 49, 53, 78, 87 and 98 land a kill inside it.
    //
    // `seed: 26`, not 15: stage 2 Tasks 3-4 (the same day) routed ram AND slam through the new
    // `Impulse`/`applyImpulse` and gave the ATTACKER an equal-and-opposite `reactionOf` reaction it
    // never had before (Newton's third law) -- a heavy chassis now recoils off what it rams instead
    // of continuing untouched. That moved ram/positioning dynamics again: seed 15's kill no longer
    // lands inside the 30 s window under the new reaction physics. Re-swept the already-known-good
    // candidates from the sweep above against the new build: 26, 78, 87 and 98 still land a kill
    // inside it; 15, 28, 48, 49 and 53 do not.
    //
    // `seed: 87`, not 26: stage 3 Task 2 (car-physics rework) replaced the ram model outright — a
    // contest between both cars' `ramAttack`/`ramDefence` push, computed independently for each side
    // (spec R7), rather than the severity-graded one-way push plus `reactionOf`'s equal-and-opposite
    // reaction. That is a different function shape, not a retune of the same one, so it moved this
    // matchup's dynamics again: seed 26's kill no longer lands inside the 30 s window. Swept 1-120
    // against the new contest: 22, 24, 48, 53, 64, 76, 79, 87 and 98 land a decisive kill inside it
    // (65 also lands a kill for both sides and draws, so it is excluded here); 87 carries forward
    // from the previous known-good set.
    //
    // `seed: 98`, not 87: stage 3 Task 4 (the same rework) set the two constants the contest had
    // been running with placeholders for -- `RAM_CONFIG.globalScale` 1 -> 0.4 and `spinScale`
    // 100 -> 10, both measured through the composed `serverTick` -> `contactTick` order -- and
    // widened the pre-collision cache to a full velocity vector (`TickResult.approachVelocities`),
    // so a car carrying lateral velocity into a contact now brings it to the contest instead of
    // having it dropped. Every ram in a match therefore lands with a different magnitude and a
    // different injected spin, and seed 87's kill no longer lands inside the 30 s window. Re-swept
    // 1-120 against the measured constants: 15, 22, 28, 29, 39, 48, 49, 53, 64, 65, 67, 79, 98, 101,
    // 105, 106 and 110 land a decisive kill inside it. **98 is the one seed present in every
    // known-good set this test has ever had**, which is why it is the pick over any of the fresh
    // ones -- a seed that has survived four different ram models is the least likely to need
    // replacing again next stage.
    //
    // `seed: 22`, not 98: stage 3b Task 3 (this rework) gives a ram victim the new `reeling` status
    // -- turnRate and accel both driven to `STATUS_LIMITS`'s floor for `RAM_TICKS.uncontrol`,
    // scaled down on a re-ram by the same per-victim falloff stack that already scaled the impulse
    // -- so a car that lands the first hit now gets a real window where its target cannot fight
    // back cleanly. That is exactly the "ramming finally feels different" outcome this task exists
    // to ship, and it moved this matchup's dynamics again: seed 98 is now a legitimate 0-0 draw in
    // the 30 s window (`reeling` cuts both cars' aim enough that neither exchange lands a kill
    // before the clock runs out). Re-swept 1-150 against the new status: 10, 22, 23, 26, 49, 53, 66,
    // 75, 79, 80, 81, 87, 94, 101, 105, 106, 111, 118, 127, 129, 138 and 147 land a decisive kill
    // inside it. 22 is picked over the others because it is also present in both of the two most
    // recent known-good sets above (stage 3 Tasks 2 and 4) -- the same "survived more than one ram
    // model" reasoning that picked 98 last time, just applied to the next-most-durable candidate now
    // that 98 itself is gone.
    //
    // `seed: 79`, not 22: stage 4 (this rework) moved the hard slam off `SLAM_CONFIG` and onto
    // `wildcharge`'s own declared `ImpulseDef` -- a slam now applies `reeling` for the def's
    // `uncontrolMs`, where it previously applied no control loss at all, and a victim slammed and
    // rammed on the same tick now takes both impulses instead of only the slam. The bot does press
    // `wildcharge`, so a landed slam's new 1400 ms `reeling` window and the extra impulse both change
    // this seeded matchup's dynamics, and seed 22 is now a legitimate 0-0 draw in the 30 s window.
    // Swept 1-150 against the stage 4 build: 79 still lands a decisive kill inside it. 79 is picked
    // over the other survivors because it is present in the stage-3-Task-2, stage-3-Task-4 AND
    // stage-3b known-good sets -- decisive across four consecutive ram models, the same durability
    // rule that picked 98 and then 22 before it.
    const out = runMatch({ ...SETUP, seed: 79, mode: GameMode.FFA_DEATHMATCH, maxTicks: 30 * TICK_RATE_HZ });
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
    //
    // 2026-09-05 situation-play: seeds 1-10 are all 0-0 draws in 60 s under the new brain. Swept
    // 1-80; 42, 44, 45, 53, 61, 63, 65, 68 are decisive. Keep two draws in the spread so the tie
    // branch still runs.
    //
    // REPINNED for stage 2 Task 1 (2026-09-06): walls deflecting instead of damping, plus the lower
    // restitution, changed enough ram/positioning outcomes that seeds 42, 44, 45, 53, 65 and 68 (all
    // decisive above) are now 0-0 draws too. Swept 1-80 again under the new contact physics: 15, 16,
    // 26, 39, 48 and 79 are decisive. The RULE itself is untouched — only which seeds happen to
    // produce a kill moved, exactly as it did in the 2026-09-04 and 2026-09-05 re-seeds above.
    const outcomes = [1, 2, 15, 16, 26, 39, 48, 79].map((seed) =>
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
