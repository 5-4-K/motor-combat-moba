import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import {
  EFFECT_CONFIG,
  EFFECT_IDS,
  EFFECT_LIMITS,
  EFFECT_TABLE,
  effectDefOf,
  isEffectId,
} from "./effect-config.js";
import { EFFECT_TICKS, effectTicksOf } from "./effect-ticks.js";
import type { EffectChannel, EffectId } from "./effect-types.js";
import { msToTicks } from "./weapon-ticks.js";

const IDS = Object.keys(EFFECT_TABLE) as EffectId[];
const CHANNELS = Object.keys(EFFECT_LIMITS) as EffectChannel[];

describe("EFFECT_TABLE", () => {
  it("keys every row by its own id", () => {
    for (const id of IDS) expect(EFFECT_TABLE[id].id).toBe(id);
  });

  it("gives every row a positive duration a player can actually perceive", () => {
    for (const id of IDS) {
      expect(EFFECT_TABLE[id].durationMs).toBeGreaterThan(0);
      // Under a few ticks an effect lands and lapses inside one patch and reads as nothing at all.
      expect(effectTicksOf(id)).toBeGreaterThan(2);
    }
  });

  it("keeps durations inside the window that makes an effect a window", () => {
    for (const id of IDS) {
      // Long enough to outlive the moment that applied it; short enough to expire inside one
      // engagement. See the design note on `EFFECT_TABLE`.
      expect(EFFECT_TABLE[id].durationMs).toBeGreaterThanOrEqual(1000);
      expect(EFFECT_TABLE[id].durationMs).toBeLessThanOrEqual(8000);
    }
  });

  it("only lets a `stack` row carry more than one stack, and never past the cap", () => {
    for (const id of IDS) {
      const def = EFFECT_TABLE[id];
      if (def.stacking !== "stack") expect(def.maxStacks).toBe(1);
      expect(def.maxStacks).toBeGreaterThanOrEqual(1);
      expect(def.maxStacks).toBeLessThanOrEqual(EFFECT_CONFIG.maxStacksCap);
    }
  });

  it("gives every modifier a positive multiplier — a channel is scaled, never zeroed or negated", () => {
    for (const id of IDS) {
      for (const [channel, value] of Object.entries(EFFECT_TABLE[id].modifiers)) {
        expect(CHANNELS).toContain(channel);
        expect(value).toBeGreaterThan(0);
        expect(Number.isFinite(value)).toBe(true);
        // A row that multiplies by exactly 1 is a row that does nothing.
        expect(value).not.toBe(1);
      }
    }
  });

  it("gives every row something to do", () => {
    for (const id of IDS) {
      const def = EFFECT_TABLE[id];
      const does = Object.keys(def.modifiers).length > 0 || (def.flags?.length ?? 0) > 0;
      expect(does).toBe(true);
    }
  });

  it("authors each row so one application lands inside its channel's limits on its own", () => {
    // A single source must never be clamped: clamping is the backstop against many sources piling
    // up, and a row that needs it to be legal is a row whose authored number is a lie.
    for (const id of IDS) {
      const def = EFFECT_TABLE[id];
      for (const [channel, per] of Object.entries(def.modifiers) as [EffectChannel, number][]) {
        const atMax = per ** def.maxStacks;
        expect(atMax).toBeGreaterThanOrEqual(EFFECT_LIMITS[channel].min);
        expect(atMax).toBeLessThanOrEqual(EFFECT_LIMITS[channel].max);
      }
    }
  });

  it("gives every row a `#rrggbb` colour", () => {
    for (const id of IDS) expect(EFFECT_TABLE[id].color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("keeps the roster inside the per-car cap, so the cap is reachable but not routinely hit", () => {
    expect(IDS.length).toBeGreaterThan(EFFECT_CONFIG.maxActive);
  });

  it("uses `ignore` for anything that flips a flag — a flag with no gradient must not be chainable", () => {
    for (const id of IDS) {
      const def = EFFECT_TABLE[id];
      if ((def.flags?.length ?? 0) > 0) expect(def.stacking).toBe("ignore");
    }
  });

  it("ships no row using `immobilised` — see the design note in effect-config.ts", () => {
    for (const id of IDS) expect(EFFECT_TABLE[id].flags ?? []).not.toContain("immobilised");
  });

  it("EFFECT_IDS lists exactly the table's keys", () => {
    expect([...EFFECT_IDS].sort()).toEqual([...IDS].sort());
  });
});

describe("isEffectId", () => {
  it("accepts every id in the table", () => {
    for (const id of IDS) expect(isEffectId(id)).toBe(true);
  });

  it("rejects inherited property names, which a bare `in` would let through", () => {
    expect(isEffectId("constructor")).toBe(false);
    expect(isEffectId("toString")).toBe(false);
    expect(isEffectId("__proto__")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isEffectId(undefined)).toBe(false);
    expect(isEffectId(7)).toBe(false);
    expect(isEffectId({ id: "overdrive" })).toBe(false);
  });
});

describe("EFFECT_TICKS", () => {
  it("converts each authored duration once, rounding up", () => {
    for (const id of IDS) {
      expect(EFFECT_TICKS[id]).toBe(msToTicks(EFFECT_TABLE[id].durationMs));
      expect(EFFECT_TICKS[id] * (1000 / TICK_RATE_HZ)).toBeGreaterThanOrEqual(
        EFFECT_TABLE[id].durationMs,
      );
    }
  });

  it("is frozen, so the two halves of the lockstep cannot be handed different numbers", () => {
    expect(Object.isFrozen(EFFECT_TICKS)).toBe(true);
  });
});

describe("EFFECT_LIMITS", () => {
  it("brackets neutral, so a car with no effects is never clamped", () => {
    for (const channel of CHANNELS) {
      expect(EFFECT_LIMITS[channel].min).toBeLessThanOrEqual(1);
      expect(EFFECT_LIMITS[channel].max).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps a fully debuffed car driveable", () => {
    expect(EFFECT_LIMITS.topSpeed.min).toBeGreaterThanOrEqual(0.5);
    expect(EFFECT_LIMITS.turnRate.min).toBeGreaterThan(0);
    expect(EFFECT_LIMITS.accel.min).toBeGreaterThan(0);
  });

  it("covers every channel a row can name", () => {
    for (const id of IDS) {
      for (const channel of Object.keys(EFFECT_TABLE[id].modifiers)) {
        expect(EFFECT_LIMITS[channel as EffectChannel]).toBeDefined();
      }
    }
  });
});

describe("effectDefOf", () => {
  it("returns the table's own row", () => {
    expect(effectDefOf("overdrive")).toBe(EFFECT_TABLE.overdrive);
  });
});
