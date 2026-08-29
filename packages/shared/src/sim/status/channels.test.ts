import { describe, expect, it } from "vitest";
import { forwardMaxSpeedOf, reverseMaxSpeedOf } from "../../config/car-config.js";
import { DRIVE_CONFIG } from "../../config/drive-config.js";
import { STATUS_TABLE } from "../../config/status-config.js";
import type { CarId } from "../../config/types.js";
import { scaleTicks, weaponTicksOf } from "../../config/weapon-ticks.js";
import { MS_PER_TICK } from "../../constants.js";
import type { InputMessage } from "../../net/input.js";
import { applyHeal, scaleDamage } from "../damage.js";
import { stepDrive } from "../drive.js";
import { resolveRam, type RamCar } from "../ram.js";
import type { SimBody } from "../step.js";
import { newFireState, releaseShots, tickRecharge } from "../weapons/fire.js";
import { spawnInstances } from "../weapons/instances.js";
import { NEUTRAL_MODIFIERS, type Modifiers } from "./modifiers.js";

/**
 * Every channel and flag, proved to reach the sim call site it names.
 *
 * `modifiers.test.ts` pins how a status list becomes a set of multipliers; this file pins that each
 * of those multipliers is actually read by the thing it is supposed to scale. Between them, "does
 * this channel do anything" is answerable without running the game.
 */

const DT = MS_PER_TICK / 1000;
const CAR: CarId = "mirage";

function body(over: Partial<SimBody> = {}): SimBody {
  return {
    x: 0,
    y: 0,
    angle: 0,
    speed: 0,
    reverseHold: 0,
    angVel: 0,
    shoveX: 0,
    shoveY: 0,
    authority: 1,
    ...over,
  };
}

function input(steer: -1 | 0 | 1, throttle: -1 | 0 | 1): InputMessage {
  return { seq: 0, steer, throttle, fireSlots: 0 };
}

function mods(over: Partial<Modifiers>): Modifiers {
  return { ...NEUTRAL_MODIFIERS, ...over };
}

describe("topSpeed reaches the drive cap", () => {
  it("caps forward speed at the scaled maximum", () => {
    let out = body();
    for (let i = 0; i < 200; i++) out = stepDrive(out, input(0, 1), DT, CAR, mods({ topSpeed: 0.5 }));
    expect(out.speed).toBeCloseTo(forwardMaxSpeedOf(CAR) * 0.5, 6);
  });

  it("caps reverse too, so backing away is not the way out of a slow", () => {
    let out = body({ speed: -10, reverseHold: DRIVE_CONFIG.reverseHoldTicks });
    for (let i = 0; i < 200; i++) out = stepDrive(out, input(0, -1), DT, CAR, mods({ topSpeed: 0.5 }));
    expect(out.speed).toBeCloseTo(-reverseMaxSpeedOf(CAR) * 0.5, 6);
  });

  it("clamps a car already above the new cap the moment it asks for throttle", () => {
    const fast = body({ speed: forwardMaxSpeedOf(CAR) });
    expect(stepDrive(fast, input(0, 1), DT, CAR, mods({ topSpeed: 0.5 })).speed).toBeCloseTo(
      forwardMaxSpeedOf(CAR) * 0.5,
      6,
    );
  });

  it("lets a car above the cap coast down through drag rather than snapping", () => {
    const fast = body({ speed: forwardMaxSpeedOf(CAR) });
    expect(stepDrive(fast, input(0, 0), DT, CAR, mods({ topSpeed: 0.5 })).speed).toBeCloseTo(
      forwardMaxSpeedOf(CAR) - DRIVE_CONFIG.drag * DT,
      6,
    );
  });
});

describe("accel reaches the engine, and never the brakes or drag", () => {
  it("scales one tick of forward acceleration", () => {
    expect(stepDrive(body(), input(0, 1), DT, CAR, mods({ accel: 0.5 })).speed).toBeCloseTo(
      DRIVE_CONFIG.accel * 0.5 * DT,
      9,
    );
  });

  it("leaves drag alone — a car with no input must always slow down", () => {
    const rolling = body({ speed: 100 });
    const debuffed = stepDrive(rolling, input(0, 0), DT, CAR, mods({ accel: 0.4, brakeDecel: 0.6 }));
    const plain = stepDrive(rolling, input(0, 0), DT, CAR, NEUTRAL_MODIFIERS);
    expect(debuffed.speed).toBeCloseTo(plain.speed, 9);
  });
});

describe("brakeDecel reaches the brake", () => {
  it("fades braking while rolling forward", () => {
    const rolling = body({ speed: 300 });
    const faded = stepDrive(rolling, input(0, -1), DT, CAR, mods({ brakeDecel: 0.6 }));
    const plain = stepDrive(rolling, input(0, -1), DT, CAR, NEUTRAL_MODIFIERS);
    expect(faded.speed).toBeGreaterThan(plain.speed);
    expect(faded.speed).toBeCloseTo(300 - DRIVE_CONFIG.brakeDecel * 0.6 * DT, 9);
  });

  it("fades the brake that arrests a reversing car too", () => {
    const reversing = body({ speed: -200 });
    const faded = stepDrive(reversing, input(0, 1), DT, CAR, mods({ brakeDecel: 0.6 }));
    expect(faded.speed).toBeCloseTo(-200 + DRIVE_CONFIG.brakeDecel * 0.6 * DT, 9);
  });

  it("still beats coasting at the worst fade the limits allow", () => {
    const rolling = body({ speed: 300 });
    const braked = stepDrive(rolling, input(0, -1), DT, CAR, mods({ brakeDecel: 0.6 }));
    const coasting = stepDrive(rolling, input(0, 0), DT, CAR, NEUTRAL_MODIFIERS);
    expect(braked.speed).toBeLessThan(coasting.speed);
  });
});

describe("turnRate reaches steering, in both directions", () => {
  it("scales the steering term down", () => {
    const rolling = body({ speed: 200 });
    const half = stepDrive(rolling, input(1, 0), DT, CAR, mods({ turnRate: 0.5 }));
    const full = stepDrive(rolling, input(1, 0), DT, CAR, NEUTRAL_MODIFIERS);
    expect(half.angle).toBeCloseTo(full.angle * 0.5, 9);
  });

  it("scales the steering term up too — the channel is bidirectional", () => {
    const rolling = body({ speed: 200 });
    const sharper = stepDrive(rolling, input(1, 0), DT, CAR, mods({ turnRate: 1.55 }));
    const plain = stepDrive(rolling, input(1, 0), DT, CAR, NEUTRAL_MODIFIERS);
    expect(sharper.angle).toBeCloseTo(plain.angle * 1.55, 9);
  });

  it("keeps `overheated` on the widening side, because binary steering makes a raise a buff", () => {
    // `InputMessage.steer` is `-1 | 0 | 1`, so there is no fine control for a twitchy car to lose:
    // a higher turnRate is a tighter radius AND more countersteer authority out of a ram. This
    // guards the row from being flipped back to the > 1 it shipped with.
    expect(STATUS_TABLE.overheated.modifiers.turnRate).toBeLessThan(1);
  });

  it("multiplies with authority, so a sluggish car mid-ram is both", () => {
    const rolling = body({ speed: 200, authority: 0.5 });
    const both = stepDrive(rolling, input(1, 0), DT, CAR, mods({ turnRate: 0.5 }));
    const full = stepDrive(body({ speed: 200 }), input(1, 0), DT, CAR, NEUTRAL_MODIFIERS);
    expect(both.angle).toBeCloseTo(full.angle * 0.25, 9);
  });

  it("does not touch injected spin — that is the ram's term, not the driver's", () => {
    const spun = body({ speed: 200, angVel: 2 });
    expect(stepDrive(spun, input(0, 0), DT, CAR, mods({ turnRate: 0.5 })).angle).toBeCloseTo(2 * DT, 9);
  });
});

describe("the three flags", () => {
  it("`immobilised` refuses throttle but leaves the car coasting, steering and braking", () => {
    expect(stepDrive(body(), input(0, 1), DT, CAR, mods({ immobilised: true })).speed).toBe(0);

    const rolling = body({ speed: 200 });
    const out = stepDrive(rolling, input(1, 1), DT, CAR, mods({ immobilised: true }));
    // Still steering, and slowing through drag rather than snapping to rest.
    expect(out.angle).not.toBe(rolling.angle);
    expect(out.speed).toBeLessThan(200);
    expect(out.speed).toBeGreaterThan(0);
  });

  it("`steeringLocked` kills the driver's steering but never the injected spin", () => {
    const rolling = body({ speed: 200, angVel: 2 });
    const out = stepDrive(rolling, input(1, 0), DT, CAR, mods({ steeringLocked: true }));
    // Exactly the spin's contribution, with nothing from the held steer input.
    expect(out.angle).toBeCloseTo(2 * DT, 9);
  });

  it("`steeringLocked` also stops a driver countersteering out of a spin", () => {
    const spinning = body({ speed: 200, angVel: 2 });
    const locked = stepDrive(spinning, input(-1, 0), DT, CAR, mods({ steeringLocked: true }));
    const free = stepDrive(spinning, input(-1, 0), DT, CAR, NEUTRAL_MODIFIERS);
    // A free driver fighting the spin decays it faster; a locked one cannot.
    expect(locked.angVel).toBeGreaterThan(free.angVel);
  });

  it("a stunned car keeps its ram knock resolving", () => {
    const stunned = mods({ immobilised: true, steeringLocked: true, disarmed: true });
    const knocked = body({ speed: 200, angVel: 2, shoveX: 120 });
    const out = stepDrive(knocked, input(0, 1), DT, CAR, stunned);
    expect(Math.abs(out.angVel)).toBeLessThan(2);
    expect(Math.abs(out.shoveX)).toBeLessThan(120);
    expect(out.x).not.toBe(knocked.x);
  });
});

describe("damageDealt reaches the shot, frozen at spawn", () => {
  const owner = { sessionId: "a", team: 0 as const, carId: CAR, x: 0, y: 0, angle: 0 };

  it("scales the instance's damage", () => {
    const plain = spawnInstances({ weaponId: "fireball", slot: 0 }, owner, 0, 0).instances[0]!;
    const buffed = spawnInstances({ weaponId: "fireball", slot: 0 }, owner, 0, 0, null, 1.25).instances[0]!;
    expect(buffed.damage).toBe(scaleDamage(plain.damage, 1.25));
    expect(buffed.damage).toBeGreaterThan(plain.damage);
  });

  it("rounds to a whole number, so a piercing shot costs every car the same", () => {
    const shot = spawnInstances({ weaponId: "fireball", slot: 0 }, owner, 0, 0, null, 1.13).instances[0]!;
    expect(Number.isInteger(shot.damage)).toBe(true);
  });
});

describe("damageTaken is applied at impact", () => {
  it("scales an incoming amount", () => {
    expect(scaleDamage(20, STATUS_TABLE.corroded.modifiers.damageTaken)).toBe(26);
    expect(scaleDamage(20, STATUS_TABLE.fortified.modifiers.damageTaken)).toBe(14);
  });

  it("never heals, whatever a bad multiplier says", () => {
    expect(scaleDamage(20, -5)).toBe(20);
    expect(scaleDamage(20, Number.NaN)).toBe(20);
    expect(scaleDamage(20, 0)).toBe(0);
  });
});

describe("applyHeal is the only way hp goes up", () => {
  it("restores hp up to the cap and no further", () => {
    expect(applyHeal(100, 30, 500)).toBe(130);
    expect(applyHeal(480, 30, 500)).toBe(500);
    expect(applyHeal(500, 30, 500)).toBe(500);
  });

  it("never revives a wreck", () => {
    expect(applyHeal(0, 200, 500)).toBe(0);
  });

  it("ignores a non-positive amount rather than dealing damage", () => {
    expect(applyHeal(100, 0, 500)).toBe(100);
    expect(applyHeal(100, -50, 500)).toBe(100);
  });
});

describe("weaponCooldown reaches the three refire clocks and no others", () => {
  it("shortens a recharge", () => {
    const state = newFireState(CAR, 1);
    const spent = { ...state, slots: state.slots.map((s) => ({ ...s, stocks: 0 })) };
    const hasted = tickRecharge(spent, 0, 0.5);
    const plain = tickRecharge(spent, 0, 1);
    expect(hasted.slots[0]!.rechargeEndsTick).toBe(scaleTicks(weaponTicksOf("fireball").cooldown, 0.5));
    expect(hasted.slots[0]!.rechargeEndsTick).toBeLessThan(plain.slots[0]!.rechargeEndsTick);
  });

  it("shortens the switch lock a release sets", () => {
    const state = newFireState("bullseye", 1);
    const pending = {
      ...state,
      pending: { weaponId: "skewer" as const, slot: 1, shotsLeft: 1, nextShotTick: 0 },
    };
    expect(releaseShots(pending, 0, 0.5).state.switchLockUntilTick).toBe(
      scaleTicks(weaponTicksOf("skewer").recovery, 0.5),
    );
  });

  it("leaves a zero clock at zero — a debuff cannot invent a recovery a weapon does not have", () => {
    expect(scaleTicks(0, 3)).toBe(0);
  });

  it("never rounds a live clock down to zero, and leaves an infinite one infinite", () => {
    expect(scaleTicks(1, 0.01)).toBe(1);
    expect(scaleTicks(Number.POSITIVE_INFINITY, 0.5)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("ramMass reaches the ram, both as attacker and as victim", () => {
  function car(over: Partial<RamCar> = {}): RamCar {
    return { sessionId: "a", team: 0, x: 0, y: 0, angle: 0, speed: 0, carId: CAR, massMult: 1, ...over };
  }

  it("makes a buffed attacker hit harder", () => {
    const victim = car({ sessionId: "b", x: 47 });
    expect(resolveRam(car({ speed: 400, massMult: 1.5 }), victim, "ffa")!.severity).toBeGreaterThan(
      resolveRam(car({ speed: 400 }), victim, "ffa")!.severity,
    );
  });

  it("makes a buffed victim harder to shove", () => {
    const attacker = car({ speed: 400 });
    const plain = resolveRam(attacker, car({ sessionId: "b", x: 47 }), "ffa")!;
    const heavy = resolveRam(attacker, car({ sessionId: "b", x: 47, massMult: 1.5 }), "ffa")!;
    expect(Math.hypot(heavy.knock.shoveX, heavy.knock.shoveY)).toBeLessThan(
      Math.hypot(plain.knock.shoveX, plain.knock.shoveY),
    );
  });

  it("is one channel doing both, so a mass buff can never be a pure upside", () => {
    expect(STATUS_TABLE.fortified.modifiers.ramMass).toBeGreaterThan(1);
  });
});
