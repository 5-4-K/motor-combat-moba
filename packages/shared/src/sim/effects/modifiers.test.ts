import { describe, expect, it } from "vitest";
import { EFFECT_LIMITS, EFFECT_TABLE, effectDefOf } from "../../config/effect-config.js";
import type { EffectChannel, EffectId } from "../../config/effect-types.js";
import { applyEffect, newEffectState, type ActiveEffect } from "./effects.js";
import { modifiersOf, NEUTRAL_MODIFIERS } from "./modifiers.js";

const CHANNELS = Object.keys(EFFECT_LIMITS) as EffectChannel[];

function live(effectId: EffectId, stacks = 1): ActiveEffect {
  return { effectId, endsTick: 1000, stacks, sourceSessionId: "" };
}

describe("NEUTRAL_MODIFIERS", () => {
  it("is exactly 1 on every channel and false on every flag", () => {
    for (const channel of CHANNELS) expect(NEUTRAL_MODIFIERS[channel]).toBe(1);
    expect(NEUTRAL_MODIFIERS.disarmed).toBe(false);
    expect(NEUTRAL_MODIFIERS.immobilised).toBe(false);
  });

  it("is what a car carrying nothing gets", () => {
    expect(modifiersOf([], 0)).toEqual(NEUTRAL_MODIFIERS);
  });

  it("is frozen — it is shared by most cars on most ticks and must never be written to", () => {
    expect(Object.isFrozen(NEUTRAL_MODIFIERS)).toBe(true);
  });

  it("is not handed out as a reference a caller could mutate", () => {
    const mods = modifiersOf([], 0);
    expect(mods).not.toBe(NEUTRAL_MODIFIERS);
  });
});

describe("modifiersOf", () => {
  it("applies a row's authored multiplier to its own channels and nothing else", () => {
    const mods = modifiersOf([live("overdrive")], 0);
    expect(mods.topSpeed).toBeCloseTo(EFFECT_TABLE.overdrive.modifiers.topSpeed, 10);
    expect(mods.accel).toBeCloseTo(EFFECT_TABLE.overdrive.modifiers.accel, 10);
    expect(mods.turnRate).toBe(1);
    expect(mods.damageDealt).toBe(1);
  });

  it("compounds one row's multiplier once per stack", () => {
    const per = EFFECT_TABLE.tarred.modifiers.topSpeed;
    expect(modifiersOf([live("tarred", 2)], 0).topSpeed).toBeCloseTo(per ** 2, 10);
  });

  it("multiplies across sources, so two effects on one channel compose", () => {
    const both = modifiersOf([live("overdrive"), live("tarred")], 0);
    const expected = EFFECT_TABLE.overdrive.modifiers.topSpeed * EFFECT_TABLE.tarred.modifiers.topSpeed;
    expect(both.topSpeed).toBeCloseTo(expected, 10);
  });

  it("does not depend on the order effects are listed in", () => {
    const forwards = modifiersOf([live("overdrive"), live("tarred"), live("hardened")], 0);
    const backwards = modifiersOf([live("hardened"), live("tarred"), live("overdrive")], 0);
    expect(forwards).toEqual(backwards);
  });

  it("ORs flags across sources", () => {
    expect(modifiersOf([live("jammed")], 0).disarmed).toBe(true);
    expect(modifiersOf([live("jammed"), live("overdrive")], 0).disarmed).toBe(true);
    expect(modifiersOf([live("overdrive")], 0).disarmed).toBe(false);
  });

  it("skips an expired row rather than trusting the list — the patch-stale client guard", () => {
    const lapsing: ActiveEffect = { effectId: "tarred", endsTick: 50, stacks: 1, sourceSessionId: "" };
    expect(modifiersOf([lapsing], 49).topSpeed).toBeLessThan(1);
    expect(modifiersOf([lapsing], 50)).toEqual(NEUTRAL_MODIFIERS);
    expect(modifiersOf([lapsing], 51)).toEqual(NEUTRAL_MODIFIERS);
  });

  it("clamps every channel into EFFECT_LIMITS however many sources pile on", () => {
    // Stacks far past anything the table can produce, on every channel at once, both directions.
    const piled: ActiveEffect[] = (Object.keys(EFFECT_TABLE) as EffectId[]).map((id) => ({
      effectId: id,
      endsTick: 1000,
      stacks: 99,
      sourceSessionId: "",
    }));
    const mods = modifiersOf(piled, 0);
    for (const channel of CHANNELS) {
      expect(mods[channel]).toBeGreaterThanOrEqual(EFFECT_LIMITS[channel].min);
      expect(mods[channel]).toBeLessThanOrEqual(EFFECT_LIMITS[channel].max);
    }
  });

  it("leaves a car driveable and armed at the worst the debuff rows can do", () => {
    // The guarantee `EFFECT_LIMITS` exists for: a focus-fired car keeps half its speed and steers.
    const everyDebuff: ActiveEffect[] = (Object.keys(EFFECT_TABLE) as EffectId[])
      .filter((id) => effectDefOf(id).kind === "debuff")
      .map((id) => ({ effectId: id, endsTick: 1000, stacks: 99, sourceSessionId: "" }));
    const mods = modifiersOf(everyDebuff, 0);
    expect(mods.topSpeed).toBeGreaterThanOrEqual(EFFECT_LIMITS.topSpeed.min);
    expect(mods.turnRate).toBeGreaterThanOrEqual(EFFECT_LIMITS.turnRate.min);
    expect(mods.topSpeed).toBeGreaterThanOrEqual(0.5);
  });

  it("reads the same answer whether an effect was applied or hand-built", () => {
    const applied = applyEffect(newEffectState(), "overdrive", 0);
    expect(modifiersOf(applied, 0).topSpeed).toBeCloseTo(modifiersOf([live("overdrive")], 0).topSpeed, 10);
  });
});
