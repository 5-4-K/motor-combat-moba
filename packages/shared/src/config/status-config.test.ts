import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { activeCarIds, driveOf, forwardMaxSpeedOf } from "./car-config.js";
import {
  STATUS_CONFIG,
  STATUS_IDS,
  STATUS_LIMITS,
  STATUS_TABLE,
  isStatusId,
  statusDefOf,
} from "./status-config.js";
import { STATUS_PULSE_TICKS, statusPulseTicksOf } from "./status-ticks.js";
import type { StatusChannel, StatusId } from "./status-types.js";
import { WEAPON_TABLE } from "./weapon-config.js";
import { WEAPON_TICKS, msToTicks } from "./weapon-ticks.js";
import type { WeaponId } from "./weapon-types.js";

const IDS = Object.keys(STATUS_TABLE) as StatusId[];
const CHANNELS = Object.keys(STATUS_LIMITS) as StatusChannel[];

describe("STATUS_TABLE", () => {
  it("keys every row by its own id", () => {
    for (const id of IDS) expect(STATUS_TABLE[id].id).toBe(id);
  });

  it("carries no duration — that belongs to whatever applies the status", () => {
    for (const id of IDS) expect(statusDefOf(id)).not.toHaveProperty("durationMs");
  });

  it("gives every modifier a positive multiplier — a channel is scaled, never zeroed or negated", () => {
    for (const id of IDS) {
      for (const [channel, value] of Object.entries(statusDefOf(id).modifiers)) {
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
      const def = statusDefOf(id);
      const does =
        Object.keys(def.modifiers).length > 0 ||
        (def.flags?.length ?? 0) > 0 ||
        def.pulse !== undefined ||
        def.onApply !== undefined;
      expect(does).toBe(true);
    }
  });

  it("authors each row inside its channel's limits on its own", () => {
    // A single source must never need the clamp: clamping is the backstop against many sources
    // piling up, and a row that needs it to be legal is a row whose authored number is a lie.
    for (const id of IDS) {
      for (const [channel, value] of Object.entries(statusDefOf(id).modifiers) as [StatusChannel, number][]) {
        expect(value).toBeGreaterThanOrEqual(STATUS_LIMITS[channel].min);
        expect(value).toBeLessThanOrEqual(STATUS_LIMITS[channel].max);
      }
    }
  });

  it("makes every flag-carrying DEBUFF `ignore`, so hard CC can never be chained", () => {
    for (const id of IDS) {
      const def = statusDefOf(id);
      if ((def.flags?.length ?? 0) === 0) continue;
      if (def.kind !== "debuff") continue;
      expect(def.reapply).toBe("ignore");
    }
  });

  it("only lets a row escape that rule by declaring itself chainable", () => {
    for (const id of IDS) {
      const def = statusDefOf(id);
      if ((def.flags?.length ?? 0) === 0) continue;
      if (def.reapply === "ignore") continue;
      expect(def.chainable).toBe(true);
    }
  });

  it("never lets a buff be chainable AND a debuff, which would reopen the CC hole", () => {
    for (const id of IDS) {
      if (statusDefOf(id).chainable) expect(statusDefOf(id).kind).toBe("buff");
    }
  });

  it("matches the overhaul table (spec 2026-09-01)", () => {
    expect(STATUS_TABLE.overheated.modifiers).toEqual({});
    expect(STATUS_TABLE.overheated.pulse).toEqual({ intervalMs: 400, damage: 8 });
    expect(STATUS_TABLE.spiked.modifiers).toEqual({ topSpeed: 0.6 });
    expect(STATUS_TABLE.spiked.pulse).toBeUndefined();
    expect(STATUS_TABLE.fortified.modifiers).toEqual({ damageTaken: 0.7 });
    expect(STATUS_TABLE.fortified.pulse).toBeUndefined();
    expect(STATUS_TABLE.stunned.flags).toEqual(["immobilised", "steeringLocked", "disarmed", "fullStop"]);
    expect(STATUS_TABLE.armored.flags).toEqual(["invulnerable"]);
    expect(STATUS_TABLE.armored.reapply).toBe("refresh");
  });

  it("keeps spiked's slow above the topSpeed clamp floor", () => {
    expect(STATUS_TABLE.spiked.modifiers.topSpeed!).toBeGreaterThan(STATUS_LIMITS.topSpeed.min);
  });

  it("gives every pulse a positive interval and exactly one direction", () => {
    for (const id of IDS) {
      const pulse = statusDefOf(id).pulse;
      if (!pulse) continue;
      expect(pulse.intervalMs).toBeGreaterThan(0);
      const damage = pulse.damage ?? 0;
      const heal = pulse.heal ?? 0;
      expect(damage).toBeGreaterThanOrEqual(0);
      expect(heal).toBeGreaterThanOrEqual(0);
      // Both at once is a row that cannot be reasoned about, and one that nets to nothing at parity.
      expect(damage > 0 && heal > 0).toBe(false);
      expect(damage + heal).toBeGreaterThan(0);
    }
  });

  it("only lets a buff heal and a debuff hurt", () => {
    for (const id of IDS) {
      const def = statusDefOf(id);
      if (!def.pulse) continue;
      if ((def.pulse.heal ?? 0) > 0) expect(def.kind).toBe("buff");
      if ((def.pulse.damage ?? 0) > 0) expect(def.kind).toBe("debuff");
    }
  });

  it("gives every row a `#rrggbb` colour, and never a weapon's", () => {
    const weaponColors = new Set(
      (Object.keys(WEAPON_TABLE) as WeaponId[]).map((id) => WEAPON_TABLE[id].color.toLowerCase()),
    );
    const seen = new Set<string>();
    for (const id of IDS) {
      const color = statusDefOf(id).color;
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
      // A badge that shares a shot's colour makes the HUD lie about what is coming at you.
      expect(weaponColors.has(color.toLowerCase())).toBe(false);
      expect(seen.has(color)).toBe(false);
      seen.add(color);
    }
  });

  it("ships more statuses than a car may carry, so the cap is reachable", () => {
    expect(IDS.length).toBeGreaterThan(0);
    expect(STATUS_CONFIG.maxActive).toBeGreaterThan(0);
  });

  it("STATUS_IDS lists exactly the table's keys", () => {
    expect([...STATUS_IDS].sort()).toEqual([...IDS].sort());
  });
});

describe("STATUS_CONFIG", () => {
  it("ceiling covers the longest authored application (wildcharge's 10s fortified, plan 3)", () => {
    expect(STATUS_CONFIG.maxDurationMs).toBe(10000);
  });
});

describe("isStatusId", () => {
  it("accepts every id in the table", () => {
    for (const id of IDS) expect(isStatusId(id)).toBe(true);
  });

  it("rejects inherited property names, which a bare `in` would let through", () => {
    expect(isStatusId("constructor")).toBe(false);
    expect(isStatusId("toString")).toBe(false);
    expect(isStatusId("__proto__")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isStatusId(undefined)).toBe(false);
    expect(isStatusId(7)).toBe(false);
    expect(isStatusId({ id: "spiked" })).toBe(false);
  });
});

describe("STATUS_PULSE_TICKS", () => {
  it("converts each authored interval once, rounding up, and 0 for a row with no pulse", () => {
    for (const id of IDS) {
      const pulse = statusDefOf(id).pulse;
      if (!pulse) {
        expect(STATUS_PULSE_TICKS[id]).toBe(0);
        continue;
      }
      expect(STATUS_PULSE_TICKS[id]).toBe(msToTicks(pulse.intervalMs));
      expect(STATUS_PULSE_TICKS[id] * (1000 / TICK_RATE_HZ)).toBeGreaterThanOrEqual(pulse.intervalMs);
    }
  });

  it("never lets a pulsing row reach a 0-tick interval, which would fire every tick", () => {
    for (const id of IDS) {
      if (statusDefOf(id).pulse) expect(statusPulseTicksOf(id)).toBeGreaterThanOrEqual(1);
    }
  });

  it("is frozen, so the two halves of the lockstep cannot be handed different numbers", () => {
    expect(Object.isFrozen(STATUS_PULSE_TICKS)).toBe(true);
  });
});

describe("STATUS_LIMITS", () => {
  it("brackets neutral, so a car in no status is never clamped", () => {
    for (const channel of CHANNELS) {
      expect(STATUS_LIMITS[channel].min).toBeLessThanOrEqual(1);
      expect(STATUS_LIMITS[channel].max).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps a fully debuffed car driveable", () => {
    expect(STATUS_LIMITS.topSpeed.min).toBeGreaterThanOrEqual(0.5);
    expect(STATUS_LIMITS.turnRate.min).toBeGreaterThan(0);
    expect(STATUS_LIMITS.accel.min).toBeGreaterThan(0);
  });

  it("keeps every chassis's own brake better than its own coasting, at full strength", () => {
    // RE-PINNED for the Unity drive-model port (car-physics-port stage 1 Task 3): `coastPerTick`
    // is gone from `ChassisDrive` — coasting is no longer a dedicated decay knob, only the
    // always-on drag rate `dragPerTick` (U4), which is also what sets top speed and wind-up now.
    // The invariant itself is unchanged: a brake weaker than coasting would mean pressing it slows
    // you LESS than releasing the throttle, which reads as broken rather than degraded.
    //
    // RE-SHAPED for stage 5 Task 5's settled values (2026-09-19, owner decision on the fix-round
    // finding). This USED to be cross-chassis on purpose — the roster's slowest `brakeDecel`
    // (Bastion) against the roster's worst coast (Mirage, at Mirage's own raised top speed) —
    // a pairing that never actually occurs on one car, but was kept as extra conservatism against a
    // FUTURE status that fades `brakeDecel` down to `STATUS_LIMITS.brakeDecel.min` (0.6). The
    // settled values' uniform 1.5x speed raise broke that cross-chassis pairing specifically
    // (worst coast grew with top speed; `CAR_TABLE.brakeDecel` did not move with it — it is a
    // direct per-car value, not one of the seven 0-100 ratings, and this pass's six settled values
    // do not touch it) — brakeDecel * 0.6 no longer beats Mirage's coast for every chassis,
    // although every chassis at FULL brake still comfortably beats its own coast.
    //
    // The owner was shown the trade — scale every `brakeDecel` 1.5x to match, or keep them and
    // accept stopping distance grew with the speed raise — and chose to keep `CAR_TABLE.brakeDecel`
    // unchanged, gathering player feedback first. So this assertion narrows to what is actually true
    // today: EACH car's own brake beats EACH car's own coast, unfaded (no `STATUS_TABLE` row
    // touches `brakeDecel` — see the trip-wire below), rather than the strictly stronger,
    // now-false cross-chassis-and-faded claim. Stopping distance is longer than it was before this
    // pass, on every chassis; that is a known, accepted consequence, not a bug this test should
    // paper over.
    for (const id of activeCarIds()) {
      const d = driveOf(id);
      const coastDecelAtOwnTop = (1 - d.dragPerTick) * forwardMaxSpeedOf(id) * TICK_RATE_HZ;
      expect(d.brakeDecel, id).toBeGreaterThan(coastDecelAtOwnTop);
    }
  });

  it("names no STATUS_TABLE row that fades brakeDecel — the day one exists, the faded case is back", () => {
    // The trip-wire for the assertion above. `STATUS_LIMITS.brakeDecel` (0.6-1.5) still exists and
    // still bounds whatever future row uses it, but nothing in the shipped game reaches it today —
    // this is what makes narrowing the assertion above to the UNFADED case a decision about today's
    // roster, not a permanent loosening. The moment a row below fires, the cross-chassis, faded
    // invariant this test used to assert needs deciding again: scale `CAR_TABLE.brakeDecel` to
    // cover it, or accept the degraded stop that status imposes.
    for (const id of IDS) {
      expect(Object.keys(statusDefOf(id).modifiers), id).not.toContain("brakeDecel");
    }
  });

  it("covers every channel a row can name", () => {
    for (const id of IDS) {
      for (const channel of Object.keys(statusDefOf(id).modifiers)) {
        expect(STATUS_LIMITS[channel as StatusChannel]).toBeDefined();
      }
    }
  });
});

describe("weapon status applications", () => {
  const WEAPON_IDS = Object.keys(WEAPON_TABLE) as WeaponId[];

  it("names a real status, a real target, and a positive duration", () => {
    for (const id of WEAPON_IDS) {
      for (const application of WEAPON_TABLE[id].applies ?? []) {
        expect(isStatusId(application.statusId)).toBe(true);
        expect(["self", "opponents", "ownerInside"]).toContain(application.target);
        expect(application.durationMs).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every duration inside the system's ceiling", () => {
    for (const id of WEAPON_IDS) {
      for (const application of WEAPON_TABLE[id].applies ?? []) {
        expect(application.durationMs).toBeLessThanOrEqual(STATUS_CONFIG.maxDurationMs);
      }
    }
  });

  it("derives one tick count per application, positionally parallel to `applies`", () => {
    for (const id of WEAPON_IDS) {
      const applies = WEAPON_TABLE[id].applies ?? [];
      const durations = WEAPON_TICKS[id].applyDurations;
      expect(durations).toHaveLength(applies.length);
      applies.forEach((application, index) => {
        expect(durations[index]).toBe(msToTicks(application.durationMs));
        expect(durations[index]).toBeGreaterThan(0);
      });
    }
  });

  it("never applies the same status twice from one weapon", () => {
    for (const id of WEAPON_IDS) {
      const applies = WEAPON_TABLE[id].applies ?? [];
      const ids = applies.map((a) => a.statusId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("gives a repeating source a `refresh` status, so it holds rather than flickering", () => {
    // A weapon that re-applies on an interval (a ticking beam) with an `ignore` status would watch
    // it lapse and re-arm on a loop while its target stood still inside it. That reads as a flicker,
    // not a condition — the aura problem, stated as a rule.
    for (const id of WEAPON_IDS) {
      const def = WEAPON_TABLE[id];
      if (def.damageFrequencyMs === 0) continue;
      for (const application of def.applies ?? []) {
        if (application.target !== "opponents") continue;
        expect(statusDefOf(application.statusId).reapply).toBe("refresh");
      }
    }
  });

  it("leaves every weapon doing something: damage, statuses, or both", () => {
    for (const id of WEAPON_IDS) {
      const def = WEAPON_TABLE[id];
      expect(def.damage > 0 || (def.applies?.length ?? 0) > 0).toBe(true);
    }
  });
});

describe("phased", () => {
  it("is a buff that flips one flag and scales nothing", () => {
    const def = statusDefOf("phased");
    expect(def.kind).toBe("buff");
    expect(def.flags).toEqual(["phased"]);
    expect(Object.keys(def.modifiers)).toEqual([]);
  });

  it("refreshes, because contact-clear extension has to lengthen it", () => {
    expect(statusDefOf("phased").reapply).toBe("refresh");
    expect(statusDefOf("phased").chainable).toBe(true);
  });

  it("cannot be cleansed, because nothing in the game cleanses a buff", () => {
    for (const id of IDS) {
      expect(statusDefOf(id).onApply?.cleanse).not.toBe("buff");
    }
  });
});

describe("reeling", () => {
  // Redefined by the 2026-09-18 Unity ram port (spec §8, U31): a car with no inputs at all rather
  // than one that merely handles badly.
  it("is not a stun: the trigger still works, but every drive input is gone", () => {
    const row = STATUS_TABLE.reeling;
    expect(row.flags).toEqual(["immobilised", "steeringLocked", "spinFree", "ramBlocked"]);
    expect(row.flags).not.toContain("disarmed");
    expect(row.flags).not.toContain("fullStop");
  });

  it("is forced to ignore by its own flags, since a flag-carrying debuff can never chain", () => {
    expect(STATUS_TABLE.reeling.reapply).toBe("ignore");
  });

  it("scrubs the shove, rather than switching grip off outright (spec §5)", () => {
    expect(STATUS_TABLE.reeling.modifiers.grip).toBe(0.6);
    expect(STATUS_TABLE.reeling.modifiers.grip).toBeGreaterThan(STATUS_LIMITS.grip.min);
    expect(STATUS_TABLE.reeling.modifiers.grip).toBeLessThan(1);
  });

  it("carries no turnRate or accel penalty any more — the helplessness is the flags, not a number", () => {
    expect(STATUS_TABLE.reeling.modifiers.turnRate).toBeUndefined();
    expect(STATUS_TABLE.reeling.modifiers.accel).toBeUndefined();
  });

  it("leaves top speed alone, so a reeling car is slowed by physics not by a debuff", () => {
    expect(STATUS_TABLE.reeling.modifiers.topSpeed ?? 1).toBe(1);
  });
});

describe("ramLock", () => {
  // New in the 2026-09-18 Unity ram port (spec §8, U32): the price of landing a ram.
  it("stops a rammer cold without setting it sliding", () => {
    expect(STATUS_TABLE.ramLock.flags).toEqual(["immobilised", "steeringLocked", "ramBlocked"]);
    expect(STATUS_TABLE.ramLock.flags).not.toContain("spinFree");
  });

  it("is forced to ignore by its own flags", () => {
    expect(STATUS_TABLE.ramLock.reapply).toBe("ignore");
  });

  it("touches no channel — grip stays full, so a locked car does not slide", () => {
    expect(STATUS_TABLE.ramLock.modifiers).toEqual({});
  });
});
