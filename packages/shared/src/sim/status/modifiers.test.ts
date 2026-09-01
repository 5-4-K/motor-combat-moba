import { describe, expect, it } from "vitest";
import { STATUS_LIMITS, STATUS_TABLE, statusDefOf } from "../../config/status-config.js";
import type { StatusChannel, StatusId } from "../../config/status-types.js";
import { applyStatus, newStatusState, type ActiveStatus } from "./statuses.js";
import { modifiersOf, NEUTRAL_MODIFIERS } from "./modifiers.js";

const CHANNELS = Object.keys(STATUS_LIMITS) as StatusChannel[];

function live(statusId: StatusId): ActiveStatus {
  return { statusId, startTick: 0, endsTick: 1000, sourceSessionId: "" };
}

describe("NEUTRAL_MODIFIERS", () => {
  it("is exactly 1 on every channel and false on every flag", () => {
    for (const channel of CHANNELS) expect(NEUTRAL_MODIFIERS[channel]).toBe(1);
    expect(NEUTRAL_MODIFIERS.immobilised).toBe(false);
    expect(NEUTRAL_MODIFIERS.steeringLocked).toBe(false);
    expect(NEUTRAL_MODIFIERS.disarmed).toBe(false);
    expect(NEUTRAL_MODIFIERS.fullStop).toBe(false);
    expect(NEUTRAL_MODIFIERS.invulnerable).toBe(false);
  });

  it("is what a car in no status gets", () => {
    expect(modifiersOf([], 0)).toEqual(NEUTRAL_MODIFIERS);
  });

  it("is frozen — it is shared by most cars on most ticks and must never be written to", () => {
    expect(Object.isFrozen(NEUTRAL_MODIFIERS)).toBe(true);
  });

  it("is not handed out as a reference a caller could mutate", () => {
    expect(modifiersOf([], 0)).not.toBe(NEUTRAL_MODIFIERS);
  });
});

describe("modifiersOf", () => {
  it("applies a row's authored multiplier to its own channels and nothing else", () => {
    const mods = modifiersOf([live("spiked")], 0);
    expect(mods.topSpeed).toBeCloseTo(STATUS_TABLE.spiked.modifiers.topSpeed, 10);
    expect(mods.turnRate).toBe(1);
    expect(mods.damageDealt).toBe(1);
  });

  it("can never see one status twice, because `applyStatus` cannot produce a duplicate", () => {
    // The reason `modifiersOf` needs no de-duplication of its own: a status is one instance at one
    // strength, and re-application only moves the clock.
    let state = newStatusState();
    for (let i = 0; i < 5; i++) state = applyStatus(state, "spiked", i, 500);
    expect(state).toHaveLength(1);
    expect(modifiersOf(state, 0).topSpeed).toBeCloseTo(STATUS_TABLE.spiked.modifiers.topSpeed, 10);
  });

  it("multiplies across DIFFERENT statuses touching one channel — the only stacking there is", () => {
    // Since the 2026-09-01 overhaul, `damageTaken` is the only channel two rows still share:
    // `corroded` (worse) and `fortified` (better).
    const both = modifiersOf([live("corroded"), live("fortified")], 0);
    const expected = STATUS_TABLE.corroded.modifiers.damageTaken * STATUS_TABLE.fortified.modifiers.damageTaken;
    expect(both.damageTaken).toBeCloseTo(expected, 10);
  });

  it("stacks multiplicatively rather than additively", () => {
    // A +30% debuff and a -30% buff on the same channel do not cancel to neutral: their product is
    // 1.3 * 0.7 = 0.91, not the 1.0 naive addition of the deltas would give — multiplying a pair of
    // equal-and-opposite percentage changes always lands below neutral (AM-GM).
    const worse = STATUS_TABLE.corroded.modifiers.damageTaken;
    const better = STATUS_TABLE.fortified.modifiers.damageTaken;
    const additive = 1 - ((1 - worse) + (1 - better));
    const combined = modifiersOf([live("corroded"), live("fortified")], 0).damageTaken;
    expect(combined).toBeCloseTo(worse * better, 10);
    expect(combined).toBeLessThan(additive);
  });

  it("does not depend on the order statuses are listed in", () => {
    const forwards = modifiersOf([live("spiked"), live("corroded"), live("fortified")], 0);
    const backwards = modifiersOf([live("fortified"), live("corroded"), live("spiked")], 0);
    expect(forwards).toEqual(backwards);
  });

  it("ORs every flag across sources", () => {
    const stunned = modifiersOf([live("stunned")], 0);
    expect(stunned.immobilised).toBe(true);
    expect(stunned.steeringLocked).toBe(true);
    expect(stunned.disarmed).toBe(true);
    // Total stop (O6): `fullStop` rides the same row now.
    expect(stunned.fullStop).toBe(true);
    expect(modifiersOf([live("stunned"), live("spiked")], 0).immobilised).toBe(true);
    expect(modifiersOf([live("spiked")], 0).immobilised).toBe(false);
    // Stun does not make you invulnerable — that flag is `armored`'s alone.
    expect(stunned.invulnerable).toBe(false);

    const armored = modifiersOf([live("armored")], 0);
    expect(armored.invulnerable).toBe(true);
    expect(armored.fullStop).toBe(false);
    expect(armored.immobilised).toBe(false);
  });

  it("skips an expired row rather than trusting the list — the patch-stale client guard", () => {
    const lapsing: ActiveStatus = { statusId: "spiked", startTick: 0, endsTick: 50, sourceSessionId: "" };
    expect(modifiersOf([lapsing], 49).topSpeed).toBeLessThan(1);
    expect(modifiersOf([lapsing], 50)).toEqual(NEUTRAL_MODIFIERS);
    expect(modifiersOf([lapsing], 51)).toEqual(NEUTRAL_MODIFIERS);
  });

  it("clamps every channel into STATUS_LIMITS however many sources pile on", () => {
    const everything = (Object.keys(STATUS_TABLE) as StatusId[]).map(live);
    const mods = modifiersOf(everything, 0);
    for (const channel of CHANNELS) {
      expect(mods[channel]).toBeGreaterThanOrEqual(STATUS_LIMITS[channel].min);
      expect(mods[channel]).toBeLessThanOrEqual(STATUS_LIMITS[channel].max);
    }
  });

  it("leaves a car driveable, steerable and armed at the worst every debuff can do at once", () => {
    // The guarantee `STATUS_LIMITS` exists for. `stunned` is excluded because it is hard CC by
    // design and says so; this is about the gradual debuffs never adding up to the same thing.
    const gradual = (Object.keys(STATUS_TABLE) as StatusId[])
      .filter((id) => statusDefOf(id).kind === "debuff" && (statusDefOf(id).flags ?? []).length === 0)
      .map(live);
    const mods = modifiersOf(gradual, 0);
    expect(mods.topSpeed).toBeGreaterThanOrEqual(0.5);
    expect(mods.turnRate).toBeGreaterThan(0);
    expect(mods.immobilised).toBe(false);
    expect(mods.disarmed).toBe(false);
  });

  it("reads the same answer whether a status was applied or hand-built", () => {
    const applied = applyStatus(newStatusState(), "spiked", 0, 500);
    expect(modifiersOf(applied, 0).topSpeed).toBeCloseTo(modifiersOf([live("spiked")], 0).topSpeed, 10);
  });
});
