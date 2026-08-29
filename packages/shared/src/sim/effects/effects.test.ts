import { describe, expect, it } from "vitest";
import { EFFECT_CONFIG, EFFECT_IDS, EFFECT_TABLE, effectDefOf } from "../../config/effect-config.js";
import { effectTicksOf } from "../../config/effect-ticks.js";
import type { EffectId } from "../../config/effect-types.js";
import {
  applyEffect,
  clearEffects,
  expireEffects,
  hasEffect,
  modifiersFromRows,
  newEffectState,
  remainingTicks,
  toActiveEffects,
  type ActiveEffect,
} from "./effects.js";

const REFRESHING: EffectId = "overdrive";
const STACKING: EffectId = "tarred";
const IGNORING: EffectId = "jammed";

describe("applyEffect", () => {
  it("starts an effect that runs for the row's authored duration in ticks", () => {
    const after = applyEffect(newEffectState(), REFRESHING, 100);
    expect(after).toHaveLength(1);
    expect(after[0]!.effectId).toBe(REFRESHING);
    expect(after[0]!.stacks).toBe(1);
    expect(after[0]!.endsTick).toBe(100 + effectTicksOf(REFRESHING));
  });

  it("never mutates the list it is given", () => {
    const before = newEffectState();
    applyEffect(before, REFRESHING, 0);
    expect(before).toHaveLength(0);
  });

  it("records the source, and `` for the world itself", () => {
    expect(applyEffect(newEffectState(), REFRESHING, 0, "shooter")[0]!.sourceSessionId).toBe("shooter");
    expect(applyEffect(newEffectState(), REFRESHING, 0)[0]!.sourceSessionId).toBe("");
  });

  it("`refresh` restarts the clock and leaves the magnitude alone", () => {
    const first = applyEffect(newEffectState(), REFRESHING, 0);
    const second = applyEffect(first, REFRESHING, 10);
    expect(second).toHaveLength(1);
    expect(second[0]!.stacks).toBe(1);
    expect(second[0]!.endsTick).toBe(10 + effectTicksOf(REFRESHING));
  });

  it("`stack` restarts the clock AND climbs, capped at the row's maxStacks", () => {
    const max = effectDefOf(STACKING).maxStacks;
    let state = newEffectState();
    for (let i = 0; i < max + 3; i++) state = applyEffect(state, STACKING, i);
    expect(state).toHaveLength(1);
    expect(state[0]!.stacks).toBe(max);
  });

  it("`ignore` refuses to re-apply while running — not even the clock moves", () => {
    const first = applyEffect(newEffectState(), IGNORING, 0);
    const again = applyEffect(first, IGNORING, 5);
    expect(again[0]!.endsTick).toBe(first[0]!.endsTick);
  });

  it("`ignore` re-arms once its own clock has run out", () => {
    const first = applyEffect(newEffectState(), IGNORING, 0);
    const end = first[0]!.endsTick;
    const again = applyEffect(first, IGNORING, end);
    expect(again[0]!.endsTick).toBe(end + effectTicksOf(IGNORING));
  });

  it("caps the number of live effects, and drops the NEW id rather than evicting a running one", () => {
    const ids = EFFECT_IDS.slice(0, EFFECT_CONFIG.maxActive + 1);
    expect(ids.length).toBeGreaterThan(EFFECT_CONFIG.maxActive);

    let state = newEffectState();
    for (const id of ids) state = applyEffect(state, id, 0);

    expect(state).toHaveLength(EFFECT_CONFIG.maxActive);
    // The first `maxActive` survive; the one that arrived at the cap is the one that was dropped.
    for (const id of ids.slice(0, EFFECT_CONFIG.maxActive)) {
      expect(hasEffect(state, id, 0)).toBe(true);
    }
    expect(hasEffect(state, ids[EFFECT_CONFIG.maxActive]!, 0)).toBe(false);
  });

  it("an expired row of the same id does not block its own re-application at the cap", () => {
    const ids = EFFECT_IDS.slice(0, EFFECT_CONFIG.maxActive);
    let state = newEffectState();
    for (const id of ids) state = applyEffect(state, id, 0);

    // Long past every row's duration: nothing is live, so re-applying any of them must work.
    const late = 10_000;
    const again = applyEffect(state, ids[0]!, late);
    expect(hasEffect(again, ids[0]!, late)).toBe(true);
  });

  it("keeps the list sorted by effectId, whatever order effects arrived in", () => {
    const forwards = ["tarred", "overdrive", "primed"] as EffectId[];
    const backwards = [...forwards].reverse();
    const a = forwards.reduce((s, id) => applyEffect(s, id, 0), newEffectState());
    const b = backwards.reduce((s, id) => applyEffect(s, id, 0), newEffectState());
    expect(a.map((e) => e.effectId)).toEqual(b.map((e) => e.effectId));
    expect(a.map((e) => e.effectId)).toEqual([...forwards].sort());
  });
});

describe("expireEffects", () => {
  it("keeps an effect through the tick before its endsTick and drops it ON that tick", () => {
    const state = applyEffect(newEffectState(), REFRESHING, 0);
    const end = state[0]!.endsTick;
    expect(expireEffects(state, end - 1)).toHaveLength(1);
    expect(expireEffects(state, end)).toHaveLength(0);
  });

  it("returns the same array reference when nothing expired, so a no-op writes no patch", () => {
    const state = applyEffect(newEffectState(), REFRESHING, 0);
    expect(expireEffects(state, 1)).toBe(state);
    expect(expireEffects(newEffectState(), 1)).toHaveLength(0);
  });

  it("drops only what has lapsed", () => {
    let state = applyEffect(newEffectState(), IGNORING, 0);
    state = applyEffect(state, REFRESHING, 0);
    const shortEnd = state.find((e) => e.effectId === IGNORING)!.endsTick;
    const after = expireEffects(state, shortEnd);
    expect(after.map((e) => e.effectId)).toEqual([REFRESHING]);
  });
});

describe("clearEffects and remainingTicks", () => {
  it("clearEffects leaves nothing", () => {
    expect(clearEffects()).toHaveLength(0);
  });

  it("remainingTicks counts down to 0 and never below", () => {
    const effect = applyEffect(newEffectState(), REFRESHING, 0)[0]!;
    expect(remainingTicks(effect, 0)).toBe(effect.endsTick);
    expect(remainingTicks(effect, effect.endsTick)).toBe(0);
    expect(remainingTicks(effect, effect.endsTick + 50)).toBe(0);
  });
});

describe("toActiveEffects", () => {
  it("drops an unrecognised id rather than defaulting it", () => {
    expect(toActiveEffects([{ effectId: "not-a-real-effect", endsTick: 99, stacks: 1 }])).toEqual([]);
    // The prototype-chain hole `isEffectId` exists to close.
    expect(toActiveEffects([{ effectId: "constructor", endsTick: 99, stacks: 1 }])).toEqual([]);
  });

  it("clamps stacks into the row's own range, so the wire cannot buy a stack the table refuses", () => {
    const [over] = toActiveEffects([{ effectId: STACKING, endsTick: 99, stacks: 250 }]);
    expect(over!.stacks).toBe(effectDefOf(STACKING).maxStacks);
    const [under] = toActiveEffects([{ effectId: STACKING, endsTick: 99, stacks: 0 }]);
    expect(under!.stacks).toBe(1);
    const [nonsense] = toActiveEffects([{ effectId: STACKING, endsTick: 99, stacks: Number.NaN }]);
    expect(nonsense!.stacks).toBe(1);
  });

  it("drops a row with a non-finite endsTick", () => {
    expect(toActiveEffects([{ effectId: REFRESHING, endsTick: Number.NaN, stacks: 1 }])).toEqual([]);
  });

  it("defaults a missing source to the world", () => {
    expect(toActiveEffects([{ effectId: REFRESHING, endsTick: 9, stacks: 1 }])[0]!.sourceSessionId).toBe("");
  });
});

describe("modifiersFromRows", () => {
  it("is the wire path to the same answer modifiersOf gives", () => {
    const live: ActiveEffect[] = [
      { effectId: REFRESHING, endsTick: 100, stacks: 1, sourceSessionId: "" },
    ];
    const mods = modifiersFromRows(live, 0);
    expect(mods.topSpeed).toBeCloseTo(EFFECT_TABLE.overdrive.modifiers.topSpeed, 10);
  });

  it("is neutral for rows the client cannot make sense of", () => {
    const mods = modifiersFromRows([{ effectId: "gibberish", endsTick: 100, stacks: 1 }], 0);
    expect(mods.topSpeed).toBe(1);
  });
});
