import { describe, expect, it } from "vitest";
import {
  BOT_PROFILES,
  botInput,
  pulsedFireSlots,
  shouldRecomputeIntent,
  triggerRangeOf,
  type BotPose,
  type BotProfile,
} from "./input.js";

const HARD: BotProfile = BOT_PROFILES.hard;

describe("botInput", () => {
  it("fires all masked slots at a target dead ahead and in range", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const target: BotPose = { x: 100, y: 0, angle: 0 };
    const result = botInput(1, self, target, [120, 120, 120], HARD);
    expect(result).toEqual({ seq: 1, steer: 0, throttle: 1, fireSlots: 0b111 });
  });

  it("turns toward a target behind it and holds fire", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const target: BotPose = { x: -100, y: 0, angle: 0 };
    const result = botInput(2, self, target, [60, 60, 60], HARD);
    expect(result.steer).not.toBe(0);
    expect(result.fireSlots).toBe(0);
  });

  it("backs off when inside the standoff distance", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const target: BotPose = { x: 50, y: 0, angle: 0 };
    const result = botInput(3, self, target, [60], HARD);
    expect(result.throttle).toBe(-1);
  });

  it("coasts with a null target — everything zero", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const result = botInput(4, self, null, [60, 60, 60], HARD);
    expect(result).toEqual({ seq: 4, steer: 0, throttle: 0, fireSlots: 0 });
  });

  it("steers the short way across the +-pi seam", () => {
    // self.angle is just under +pi; the target sits just across the seam on the negative side,
    // 0.5 rad away the short way (turn positive/right), not ~5.78 rad the long way around.
    const selfAngle = Math.PI - 0.14;
    const bearing = selfAngle + 0.5 - 2 * Math.PI;
    const self: BotPose = { x: 0, y: 0, angle: selfAngle };
    const target: BotPose = {
      x: 100 * Math.cos(bearing),
      y: 100 * Math.sin(bearing),
      angle: 0,
    };
    const result = botInput(5, self, target, [], HARD);
    expect(result.steer).toBe(1);
  });

  it("only fires slots whose range covers the target, inside the fire cone", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const target: BotPose = { x: 50, y: 0, angle: 0 };
    const result = botInput(6, self, target, [40, 60, 40], HARD);
    expect(result.fireSlots).toBe(0b010);
  });

  it("holds fire outside the fire cone even with a slot in range", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    // Just outside fireConeRad (0.35) but inside aimToleranceRad-derived steer deadzone territory.
    const bearing = 0.4;
    const target: BotPose = {
      x: 50 * Math.cos(bearing),
      y: 50 * Math.sin(bearing),
      angle: 0,
    };
    const result = botInput(7, self, target, [60], HARD);
    expect(result.fireSlots).toBe(0);
  });
});

describe("BOT_PROFILES (PG27)", () => {
  it("is frozen, table and rows alike", () => {
    expect(Object.isFrozen(BOT_PROFILES)).toBe(true);
    for (const profile of Object.values(BOT_PROFILES)) expect(Object.isFrozen(profile)).toBe(true);
  });

  it("pins the easy profile (PR18 — retuned for players, not the developer)", () => {
    expect(BOT_PROFILES.easy).toEqual({
      standoffUnits: 200,
      deadbandUnits: 70,
      reactionTicks: 9,
      aimToleranceRad: 0.6,
      fireConeRad: 0.68,
      firePeriodTicks: 14,
      // B19's two latency knobs are machinery-only in this work — every tier stays a no-op (0)
      // until the bot session sets real values.
      viewStalenessTicks: 0,
      reactionDelayTicks: 0,
    });
  });

  it("pins the medium profile (PR18)", () => {
    expect(BOT_PROFILES.medium).toEqual({
      standoffUnits: 130,
      deadbandUnits: 35,
      reactionTicks: 4,
      aimToleranceRad: 0.45,
      fireConeRad: 0.52,
      firePeriodTicks: 7,
      viewStalenessTicks: 0,
      reactionDelayTicks: 0,
    });
  });

  it("hard is EXACTLY the bot that shipped — the whole point of the difficulty split", () => {
    // These six numbers are the pre-split `BOT_CONFIG` plus `PlaygroundRoom`'s own
    // `OPPONENT_FIRE_PERIOD`. Pinned by value, not by comment: "the current one should be hard" has
    // to stay true through every later retune of easy and medium. B19 added the two latency knobs
    // below this work; `hard` stays frozen at 0/0 (a no-op) for both, same as the other two tiers —
    // only the ORIGINAL six numbers are what "frozen" ever meant.
    expect(BOT_PROFILES.hard).toEqual({
      standoffUnits: 70,
      deadbandUnits: 0,
      reactionTicks: 1,
      aimToleranceRad: 0.3,
      fireConeRad: 0.35,
      firePeriodTicks: 2,
      viewStalenessTicks: 0,
      reactionDelayTicks: 0,
    });
  });

  it("keeps aimToleranceRad below fireConeRad on every profile", () => {
    // The tolerance is the deadzone the bot STOPS STEERING inside; the cone is the gate it must be
    // inside TO FIRE. A profile with tolerance >= cone lets the bot settle at a heading it is happy
    // with but can never shoot from — an easy bot that never fires.
    for (const [name, profile] of Object.entries(BOT_PROFILES)) {
      expect(profile.aimToleranceRad, name).toBeLessThan(profile.fireConeRad);
    }
  });

  it("orders the pressure knobs monotonically from easy to hard", () => {
    const { easy, medium, hard } = BOT_PROFILES;
    expect(easy.standoffUnits).toBeGreaterThan(medium.standoffUnits);
    expect(medium.standoffUnits).toBeGreaterThan(hard.standoffUnits);
    expect(easy.deadbandUnits).toBeGreaterThan(medium.deadbandUnits);
    expect(medium.deadbandUnits).toBeGreaterThan(hard.deadbandUnits);
    expect(easy.reactionTicks).toBeGreaterThan(medium.reactionTicks);
    expect(medium.reactionTicks).toBeGreaterThan(hard.reactionTicks);
    expect(easy.firePeriodTicks).toBeGreaterThan(medium.firePeriodTicks);
    expect(medium.firePeriodTicks).toBeGreaterThan(hard.firePeriodTicks);
  });

  it("orders the tiers monotonically on every pressure lever (PR18)", () => {
    const { easy, medium, hard } = BOT_PROFILES;
    // Closer, quicker, tighter, faster-firing as difficulty rises.
    expect(easy.standoffUnits).toBeGreaterThan(medium.standoffUnits);
    expect(medium.standoffUnits).toBeGreaterThan(hard.standoffUnits);
    expect(easy.reactionTicks).toBeGreaterThan(medium.reactionTicks);
    expect(medium.reactionTicks).toBeGreaterThan(hard.reactionTicks);
    expect(easy.firePeriodTicks).toBeGreaterThan(medium.firePeriodTicks);
    expect(medium.firePeriodTicks).toBeGreaterThan(hard.firePeriodTicks);
    expect(easy.aimToleranceRad).toBeGreaterThan(medium.aimToleranceRad);
    expect(medium.aimToleranceRad).toBeGreaterThan(hard.aimToleranceRad);
  });
});

describe("botInput — the coast deadband (PG28)", () => {
  it("coasts inside the deadband where hard would charge or reverse", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    // 170 units out: inside easy's 200 +- 70 band ([130, 270]), outside medium's 130 +- 35 band
    // ([95, 165]). (Distance adjusted for PR18 retune.)
    const target: BotPose = { x: 170, y: 0, angle: 0 };
    expect(botInput(1, self, target, [60], BOT_PROFILES.easy).throttle).toBe(0);
    expect(botInput(1, self, target, [60], BOT_PROFILES.medium).throttle).toBe(1);
  });

  it("still closes when well outside the band, and backs off when well inside it", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    expect(botInput(2, self, { x: 400, y: 0, angle: 0 }, [60], BOT_PROFILES.easy).throttle).toBe(1);
    expect(botInput(3, self, { x: 20, y: 0, angle: 0 }, [60], BOT_PROFILES.easy).throttle).toBe(-1);
  });

  it("collapses to the old charge-or-reverse expression at deadbandUnits 0", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    // Exactly at hard's standoff: the old code's `distance > standoff ? 1 : -1` reverses here, and
    // a zero-width band must not turn that into a coast.
    expect(botInput(4, self, { x: 70, y: 0, angle: 0 }, [60], HARD).throttle).toBe(-1);
    expect(botInput(5, self, { x: 71, y: 0, angle: 0 }, [60], HARD).throttle).toBe(1);
  });
});

describe("shouldRecomputeIntent (PG29)", () => {
  it("recomputes every tick at reactionTicks 1 — hard is unchanged", () => {
    for (const tick of [0, 1, 2, 3, 97]) {
      expect(shouldRecomputeIntent(tick, 1, true)).toBe(true);
    }
  });

  it("recomputes on the cadence and holds in between", () => {
    expect(shouldRecomputeIntent(9, 3, true)).toBe(true);
    expect(shouldRecomputeIntent(10, 3, true)).toBe(false);
    expect(shouldRecomputeIntent(11, 3, true)).toBe(false);
    expect(shouldRecomputeIntent(12, 3, true)).toBe(true);
  });

  it("recomputes regardless of cadence when there is nothing held", () => {
    // A cleared hold — a setup change, the bot toggled off and back on, a dead target — must not
    // wait out the rest of the interval enqueueing an intent that no longer exists.
    expect(shouldRecomputeIntent(10, 3, false)).toBe(true);
    expect(shouldRecomputeIntent(11, 6, false)).toBe(true);
  });

  it("never divides by zero on a malformed cadence", () => {
    expect(shouldRecomputeIntent(10, 0, true)).toBe(true);
    expect(shouldRecomputeIntent(10, -1, true)).toBe(true);
  });
});

describe("pulsedFireSlots (PG29)", () => {
  it("passes the mask through on a pulse tick and zeroes it otherwise", () => {
    expect(pulsedFireSlots(4, 2, 0b101)).toBe(0b101);
    expect(pulsedFireSlots(5, 2, 0b101)).toBe(0);
  });

  it("pulses a tenth as often on easy as hard", () => {
    expect(pulsedFireSlots(10, 10, 0b1)).toBe(0b1);
    for (const tick of [11, 12, 13, 19]) expect(pulsedFireSlots(tick, 10, 0b1)).toBe(0);
    expect(pulsedFireSlots(20, 10, 0b1)).toBe(0b1);
  });

  it("never divides by zero on a malformed cadence", () => {
    expect(pulsedFireSlots(7, 0, 0b11)).toBe(0b11);
  });
});

describe("botInput — a weapon with no range of its own", () => {
  // `wildcharge` authors `range: 0` because a charge dashes nowhere, and the fire gate below used
  // to read that as "unreachable": `distance < 0` is false for every distance, so the roster's one
  // range-0 row could never be pressed by a bot at all. It is now gated on the distance the bot
  // itself chooses to fight at.
  it("fires when the target is inside the profile's standoff band", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const target: BotPose = { x: 60, y: 0, angle: 0 };
    expect(botInput(1, self, target, [0], HARD).fireSlots).toBe(0b1);
  });

  it("holds fire when the target is beyond that band", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const target: BotPose = { x: 400, y: 0, angle: 0 };
    expect(botInput(2, self, target, [0], HARD).fireSlots).toBe(0);
  });

  it("still obeys the fire cone", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    // Bearing 0.4 rad — outside hard's 0.35 fireConeRad, well inside its 70u trigger distance.
    const bearing = 0.4;
    const target: BotPose = {
      x: 50 * Math.cos(bearing),
      y: 50 * Math.sin(bearing),
      angle: 0,
    };
    expect(botInput(3, self, target, [0], HARD).fireSlots).toBe(0);
  });

  it("leaves slots that do have a range gated on that range", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const target: BotPose = { x: 50, y: 0, angle: 0 };
    // Slot 0 out of its own 40u reach, slot 1 range-0 and inside hard's 70u band, slot 2 out again
    // — the mixed kit Bastion actually carries, and the regression guard for the other eight rows.
    expect(botInput(4, self, target, [40, 0, 40], HARD).fireSlots).toBe(0b010);
  });
});

describe("triggerRangeOf", () => {
  it("passes a real range straight through", () => {
    expect(triggerRangeOf(1800, HARD)).toBe(1800);
    expect(triggerRangeOf(220, BOT_PROFILES.easy)).toBe(220);
  });

  it("falls back to the standoff band, per tier", () => {
    // Pinned by value so a `BOT_PROFILES` retune cannot move a weapon's trigger distance silently:
    // standoffUnits + deadbandUnits, the outer edge of the band each tier holds.
    expect(triggerRangeOf(0, BOT_PROFILES.hard)).toBe(70);
    expect(triggerRangeOf(0, BOT_PROFILES.medium)).toBe(165);
    expect(triggerRangeOf(0, BOT_PROFILES.easy)).toBe(270);
  });
});
