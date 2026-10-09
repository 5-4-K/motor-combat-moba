import { describe, expect, it } from "vitest";
import { RESOLVED_BOT_PROFILES } from "../../config/bot-profiles.js";
import { applyHumanize, newHumanizeState } from "./humanize.js";

describe("applyHumanize is the delay line (BB48)", () => {
  it("emits coast until the line fills, then each intent reactionDelayTicks late", () => {
    const hard = RESOLVED_BOT_PROFILES.hard;
    const state = newHumanizeState();
    const intent = (steer: -1 | 0 | 1) => ({ steer, throttle: 1 as const, fireSlots: 0 });
    const out = [];
    for (let i = 1; i <= hard.reactionDelayTicks + 2; i++) out.push(applyHumanize(state, intent(1), hard));
    expect(out.slice(0, hard.reactionDelayTicks).every((o) => o.steer === 0 && o.throttle === 0)).toBe(true);
    expect(out[hard.reactionDelayTicks]).toEqual(intent(1));
  });
  it("passes through with no delay", () => {
    const state = newHumanizeState();
    const profile = { ...RESOLVED_BOT_PROFILES.hard, reactionDelayTicks: 0 };
    expect(applyHumanize(state, { steer: -1, throttle: -1, fireSlots: 2 }, profile)).toEqual({ steer: -1, throttle: -1, fireSlots: 2 });
  });
});
