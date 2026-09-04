import { describe, expect, it } from "vitest";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotIntent } from "../types.js";
import { applyHumanize, newHumanizeState } from "./humanize.js";

const drive: BotIntent = { steer: 1, throttle: 1, fireSlots: 1 };

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
    const first = applyHumanize(state, drive, 0, profile, rng, false, true);
    expect(first).not.toEqual(drive);
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
    // blunder kinds invert `steer`, so an easy bot was steering wrong or reversing more often than
    // it was driving. The renewal-process expectation for a window committed to for `blunderTicks`
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
