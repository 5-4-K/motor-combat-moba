import { describe, expect, it } from "vitest";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotIntent } from "../types.js";
import { applyBlunder, applyHumanize, BLUNDERS, newHumanizeState } from "./humanize.js";

const drive: BotIntent = { steer: 1, throttle: 1, fireSlots: 1 };

/**
 * An intent every blunder kind can visibly change: it is already turning, already REVERSING (so
 * `late-brake`'s `throttle: 1` is a real change rather than a no-op) and already firing (so
 * `hold-fire` is too). `drive` above deliberately is not — it holds `throttle: 1` — and a blunder
 * test written against it can only ever assert two of the three kinds.
 */
const backingUp: BotIntent = { steer: 1, throttle: -1, fireSlots: 1 };

/** A plausible alternative line, in the shape `PlanResult.runnerUp` hands over. */
const runnerUp = { steer: -1, throttle: 0 } as const;

describe("applyHumanize", () => {
  it("coasts until the delay line has filled", () => {
    const state = newHumanizeState();
    const rng = makeRng(1);
    const profile = BOT_PROFILES.hard; // reactionDelayTicks 4
    const out = [];
    for (let tick = 0; tick < 4; tick++) {
      out.push(applyHumanize(state, drive, tick, profile, rng, false, true));
    }
    expect(out.every((i) => i.steer === 0 && i.throttle === 0)).toBe(true);
  });

  it("emits the intent decided reactionDelayTicks ago", () => {
    const state = newHumanizeState();
    const rng = makeRng(1);
    const profile = { ...BOT_PROFILES.hard, blunderChance: 0, idleFidgetChance: 0 };
    for (let tick = 0; tick < 4; tick++) {
      applyHumanize(state, drive, tick, profile, rng, false, true);
    }
    const out = applyHumanize(state, { steer: -1, throttle: -1, fireSlots: 0 }, 4, profile, rng, false, true);
    expect(out).toEqual(drive);
  });

  it("never blunders at blunderChance 0", () => {
    const state = newHumanizeState();
    const rng = makeRng(7);
    const profile = { ...BOT_PROFILES.hard, blunderChance: 0, idleFidgetChance: 0, reactionDelayTicks: 0 };
    for (let tick = 0; tick < 200; tick++) {
      expect(applyHumanize(state, drive, tick, profile, rng, false, true)).toEqual(drive);
    }
  });

  it("blunders sometimes at a high blunder chance, and commits for a window", () => {
    const state = newHumanizeState();
    const rng = makeRng(7);
    const profile = { ...BOT_PROFILES.easy, blunderChance: 1, blunderTicks: 10, idleFidgetChance: 0, reactionDelayTicks: 0 };
    // `backingUp`, not `drive`: since P41 reshaped the kinds, `late-brake` is a no-op against an
    // intent that already reads `throttle: 1`, so asserting on `drive` would make this test's
    // outcome depend on which kind the seed happens to draw.
    const first = applyHumanize(state, backingUp, 0, profile, rng, false, true, runnerUp);
    expect(first).not.toEqual(backingUp);
    expect(state.blunderUntilTick).toBe(10);
  });

  it("fidgets only when idle", () => {
    const state = newHumanizeState();
    const rng = makeRng(9);
    const profile = { ...BOT_PROFILES.easy, blunderChance: 0, idleFidgetChance: 1, reactionDelayTicks: 0 };
    const still: BotIntent = { steer: 0, throttle: 0, fireSlots: 0 };
    expect(applyHumanize(state, still, 0, profile, rng, true, true).steer).not.toBe(0);
    expect(applyHumanize(state, still, 1, profile, rng, false, true).steer).toBe(0);
  });

  it("draws its three numbers on every tick, decision window or not (H21)", () => {
    // The gate is on what the blunder roll may DO, never on whether it is drawn: a draw that
    // happened only on recompute ticks would make the stream depend on the cadence, and a seeded
    // replay would stop reproducing the moment a profile's `recomputeTicks` moved.
    const count = (decisionWindow: boolean) => {
      let calls = 0;
      const inner = makeRng(5);
      const rng = () => { calls++; return inner(); };
      applyHumanize(newHumanizeState(), drive, 0, BOT_PROFILES.easy, rng, false, decisionWindow);
      return calls;
    };
    expect(count(true)).toBe(3);
    expect(count(false)).toBe(3);
  });

  it("holds the blunder duty cycle near blunderChance per DECISION WINDOW, not per tick (H41)", () => {
    // The rate, not just the 0-and-1 extremes. `blunderChance` is documented on `BotProfile` as a
    // probability *per decision window*; rolling it every tick multiplied it by the cadence and put
    // easy inside a blunder 57.9% of its ticks, medium 34.5% and hard 13.2% — and two of the four
    // blunder kinds THEN IN PLACE inverted `steer`, so an easy bot was steering wrong or reversing
    // more often than it was driving. (P41 has since replaced those kinds outright — see
    // `applyBlunder` — but the duty cycle this pins is a property of the ROLL, not of the kinds, and
    // is unchanged by that.) The renewal-process expectation for a window committed to for `blunderTicks`
    // and rolled once every `recomputeTicks` is
    //     blunderTicks / (blunderTicks + recomputeTicks / blunderChance)
    // which is 9.1% / 7.7% / 7.0% for easy / medium / hard — the ~9%/8%/7% the tier table was
    // authored against. A 2-point band is wide enough for sampling noise over 200k ticks and the
    // sub-cadence alignment delay after a window expires, and far too tight to survive a return to
    // per-tick rolling (which lands 4x to 6x above it).
    const TICKS = 200_000;
    const duty = (tier: "easy" | "medium" | "hard") => {
      const profile = BOT_PROFILES[tier];
      const state = newHumanizeState();
      const rng = makeRng(99);
      let blundering = 0;
      for (let tick = 0; tick < TICKS; tick++) {
        applyHumanize(state, drive, tick, profile, rng, false, tick % profile.recomputeTicks === 0);
        if (state.blunderKind !== undefined) blundering++;
      }
      return (blundering / TICKS) * 100;
    };
    const expected = (tier: "easy" | "medium" | "hard") => {
      const p = BOT_PROFILES[tier];
      return (p.blunderTicks / (p.blunderTicks + p.recomputeTicks / p.blunderChance)) * 100;
    };

    for (const tier of ["easy", "medium", "hard"] as const) {
      expect(duty(tier)).toBeGreaterThan(expected(tier) - 2);
      expect(duty(tier)).toBeLessThan(expected(tier) + 2);
    }
    // And the ladder still reads: a casual is wrong more often than a pro.
    expect(duty("easy")).toBeGreaterThan(duty("hard"));
  });

  // --- P41 / R-B1: blunders are mistakes, not spasms -------------------------------------------
  describe("blunders (P41)", () => {
    it("a blundering bot commits to a plausible alternative, not an inverted steer", () => {
      // "second-best" must actually differ from the chosen action, and must be a real action.
      const out = applyBlunder(
        { steer: 1, throttle: 1, fireSlots: 1 },
        "second-best",
        { steer: -1, throttle: 0 },
      );
      expect(out.steer).toBe(-1);
      expect(out.throttle).toBe(0);
    });

    it("keeps the rest of the intent when it takes the runner-up line", () => {
      // The runner-up is a DRIVE action — steer and throttle. It says nothing about the trigger, so
      // taking the second-best line must not silently hold fire as well.
      const out = applyBlunder(backingUp, "second-best", runnerUp);
      expect(out.fireSlots).toBe(backingUp.fireSlots);
    });

    it("degrades to a real kind rather than throwing when there is no runner-up", () => {
      // Reachable only before a bot's first decision window has run (`controller.ts` writes
      // `lastPlan` inside `plan()`); after that `plan` always names a runner-up, because the nine
      // entries of `ALL_ACTIONS` are distinct by construction.
      const out = applyBlunder(backingUp, "second-best", undefined);
      expect(out).not.toEqual(backingUp);
      expect(out.throttle).toBe(1);
    });

    it("EVERY kind is observable in the emitted intent (R-B1)", () => {
      // THE ASSERTION THE BRIEF'S FOURTH KIND WOULD HAVE FAILED. `marginal-shot` was specified as
      // `return intent` — an unconditionally invisible blunder — so a quarter of every tier's
      // blunders would have done nothing at all and `blunderChance` would have been silently
      // weakened by a quarter with no test able to tell. Anything added to `BLUNDERS` must change
      // an intent that is turning, reversing and firing.
      for (const kind of BLUNDERS) {
        expect(applyBlunder(backingUp, kind, runnerUp)).not.toEqual(backingUp);
      }
    });

    it("emits a different intent stream than a bot that never blunders", () => {
      // The same assertion again, end to end through `applyHumanize` rather than against
      // `applyBlunder` directly: an invisible kind is invisible HERE, which is the only place it
      // matters. Reaction delay off so the two streams line up tick for tick.
      const stream = (blunderChance: number): string => {
        const state = newHumanizeState();
        const rng = makeRng(11);
        const profile = {
          ...BOT_PROFILES.easy, blunderChance, blunderTicks: 10,
          idleFidgetChance: 0, reactionDelayTicks: 0,
        };
        const out: BotIntent[] = [];
        for (let tick = 0; tick < 200; tick++) {
          out.push(applyHumanize(
            state, backingUp, tick, profile, rng, false,
            tick % profile.recomputeTicks === 0, runnerUp,
          ));
        }
        return JSON.stringify(out);
      };
      expect(stream(1)).not.toBe(stream(0));
    });

    it("still draws exactly three numbers with a runner-up in hand (H21)", () => {
      // The runner-up is threaded state, not a draw. Whether one is available may not move the
      // stream, or a seeded replay would stop reproducing the moment a plan named a different
      // alternative.
      const count = (rider: typeof runnerUp | undefined) => {
        let calls = 0;
        const inner = makeRng(5);
        const rng = () => { calls++; return inner(); };
        applyHumanize(newHumanizeState(), drive, 0, BOT_PROFILES.easy, rng, false, true, rider);
        return calls;
      };
      expect(count(runnerUp)).toBe(3);
      expect(count(undefined)).toBe(3);
    });
  });

  it("is deterministic for a seed", () => {
    const run = () => {
      const state = newHumanizeState();
      const rng = makeRng(4);
      const out = [];
      for (let tick = 0; tick < 60; tick++) {
        out.push(applyHumanize(state, drive, tick, BOT_PROFILES.easy, rng, tick % 3 === 0, true));
      }
      return JSON.stringify(out);
    };
    expect(run()).toBe(run());
  });
});
