import { describe, expect, it } from "vitest";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import { newAimErrorState, signedDelta, stepAimError } from "./aim.js";

describe("signedDelta", () => {
  it("takes the short way around the seam", () => {
    expect(signedDelta(3.0, -3.0)).toBeCloseTo(0.2832, 3);
    expect(signedDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe("stepAimError", () => {
  it("holds its offset between resamples, so error drifts rather than jitters", () => {
    const rng = makeRng(5);
    const profile = BOT_PROFILES.easy; // driftTicks 20
    let state = stepAimError(newAimErrorState(), 0, profile, rng);
    const first = state.offsetRad;
    for (let tick = 1; tick < 20; tick++) state = stepAimError(state, tick, profile, rng);
    expect(state.offsetRad).toBe(first);
    state = stepAimError(state, 20, profile, rng);
    expect(state.offsetRad).not.toBe(first);
  });

  it("keeps a tighter tier's error smaller on average", () => {
    const spread = (sigmaTier: "easy" | "hard") => {
      const rng = makeRng(11);
      let state = newAimErrorState();
      let total = 0;
      for (let i = 0; i < 400; i++) {
        state = stepAimError(state, i * 40, BOT_PROFILES[sigmaTier], rng);
        total += Math.abs(state.offsetRad);
      }
      return total / 400;
    };
    expect(spread("hard")).toBeLessThan(spread("easy"));
  });
});
