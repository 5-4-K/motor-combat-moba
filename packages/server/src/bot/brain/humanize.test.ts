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
      out.push(applyHumanize(state, drive, tick, profile, rng, false));
    }
    expect(out.every((i) => i.steer === 0 && i.throttle === 0)).toBe(true);
  });

  it("emits the intent decided reactionDelayTicks ago", () => {
    const state = newHumanizeState();
    const rng = makeRng(1);
    const profile = { ...BOT_PROFILES.hard, blunderChance: 0, idleFidgetChance: 0 };
    for (let tick = 0; tick < 4; tick++) {
      applyHumanize(state, drive, tick, profile, rng, false);
    }
    const out = applyHumanize(state, { steer: -1, throttle: -1, fireSlots: 0 }, 4, profile, rng, false);
    expect(out).toEqual(drive);
  });

  it("never blunders at blunderChance 0", () => {
    const state = newHumanizeState();
    const rng = makeRng(7);
    const profile = { ...BOT_PROFILES.hard, blunderChance: 0, idleFidgetChance: 0, reactionDelayTicks: 0 };
    for (let tick = 0; tick < 200; tick++) {
      expect(applyHumanize(state, drive, tick, profile, rng, false)).toEqual(drive);
    }
  });

  it("blunders sometimes at a high blunder chance, and commits for a window", () => {
    const state = newHumanizeState();
    const rng = makeRng(7);
    const profile = { ...BOT_PROFILES.easy, blunderChance: 1, blunderTicks: 10, idleFidgetChance: 0, reactionDelayTicks: 0 };
    const first = applyHumanize(state, drive, 0, profile, rng, false);
    expect(first).not.toEqual(drive);
    expect(state.blunderUntilTick).toBe(10);
  });

  it("fidgets only when idle", () => {
    const state = newHumanizeState();
    const rng = makeRng(9);
    const profile = { ...BOT_PROFILES.easy, blunderChance: 0, idleFidgetChance: 1, reactionDelayTicks: 0 };
    const still: BotIntent = { steer: 0, throttle: 0, fireSlots: 0 };
    expect(applyHumanize(state, still, 0, profile, rng, true).steer).not.toBe(0);
    expect(applyHumanize(state, still, 1, profile, rng, false).steer).toBe(0);
  });

  it("is deterministic for a seed", () => {
    const run = () => {
      const state = newHumanizeState();
      const rng = makeRng(4);
      const out = [];
      for (let tick = 0; tick < 60; tick++) {
        out.push(applyHumanize(state, drive, tick, BOT_PROFILES.easy, rng, tick % 3 === 0));
      }
      return JSON.stringify(out);
    };
    expect(run()).toBe(run());
  });
});
