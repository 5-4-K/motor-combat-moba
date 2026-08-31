import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { DRIVE_CONFIG } from "./drive-config.js";
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

  it("makes every flag-carrying row `ignore`, so hard CC can never be chained", () => {
    for (const id of IDS) {
      if ((statusDefOf(id).flags?.length ?? 0) > 0) expect(statusDefOf(id).reapply).toBe("ignore");
    }
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

  it("keeps the brake pedal better than lifting off, however faded it gets", () => {
    // The floor is not a free choice: a brake weaker than drag would mean pressing it slows you LESS
    // than releasing the throttle, which reads as broken rather than degraded. Checked against the
    // live drive numbers so a `drag` re-tune cannot silently invalidate it.
    expect(DRIVE_CONFIG.brakeDecel * STATUS_LIMITS.brakeDecel.min).toBeGreaterThan(DRIVE_CONFIG.drag);
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
        expect(["self", "opponents"]).toContain(application.target);
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
