import { describe, expect, it } from "vitest";
import { forwardMaxSpeedOf, reverseMaxSpeedOf } from "../../config/car-config.js";
import { DRIVE_CONFIG } from "../../config/drive-config.js";
import { EFFECT_TABLE } from "../../config/effect-config.js";
import type { CarId } from "../../config/types.js";
import { scaleTicks, weaponTicksOf } from "../../config/weapon-ticks.js";
import { MS_PER_TICK } from "../../constants.js";
import type { InputMessage } from "../../net/input.js";
import { scaleDamage } from "../damage.js";
import { stepDrive } from "../drive.js";
import { resolveRam, type RamCar } from "../ram.js";
import type { SimBody } from "../step.js";
import { newFireState, releaseShots, tickRecharge } from "../weapons/fire.js";
import { spawnInstances } from "../weapons/instances.js";
import { modifiersOf, NEUTRAL_MODIFIERS, type Modifiers } from "./modifiers.js";
import type { ActiveEffect } from "./effects.js";

/**
 * Every channel, proved to reach the sim call site it names.
 *
 * `modifiers.test.ts` pins how a list of effects becomes a set of multipliers; this file pins that
 * each of those multipliers is actually read by the thing it is supposed to scale. Between them,
 * "does this channel do anything" is answerable without running the game.
 */

const DT = MS_PER_TICK / 1000;
const CAR: CarId = "rectangle";

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

function live(effectId: keyof typeof EFFECT_TABLE): ActiveEffect[] {
  return [{ effectId, endsTick: 1000, stacks: 1, sourceSessionId: "" }];
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
    const out = stepDrive(fast, input(0, 1), DT, CAR, mods({ topSpeed: 0.5 }));
    expect(out.speed).toBeCloseTo(forwardMaxSpeedOf(CAR) * 0.5, 6);
  });

  it("lets a car above the cap coast down through drag rather than snapping", () => {
    const fast = body({ speed: forwardMaxSpeedOf(CAR) });
    const out = stepDrive(fast, input(0, 0), DT, CAR, mods({ topSpeed: 0.5 }));
    expect(out.speed).toBeCloseTo(forwardMaxSpeedOf(CAR) - DRIVE_CONFIG.drag * DT, 6);
  });
});

describe("accel reaches the engine, and never the brakes", () => {
  it("scales one tick of forward acceleration", () => {
    const out = stepDrive(body(), input(0, 1), DT, CAR, mods({ accel: 0.5 }));
    expect(out.speed).toBeCloseTo(DRIVE_CONFIG.accel * 0.5 * DT, 9);
  });

  it("leaves braking alone — a debuff never takes the brakes away", () => {
    const rolling = body({ speed: 200 });
    const braked = stepDrive(rolling, input(0, -1), DT, CAR, mods({ accel: 0.4, topSpeed: 0.5 }));
    const plain = stepDrive(rolling, input(0, -1), DT, CAR, NEUTRAL_MODIFIERS);
    expect(braked.speed).toBeCloseTo(plain.speed, 9);
  });

  it("leaves drag alone", () => {
    const rolling = body({ speed: 100 });
    const debuffed = stepDrive(rolling, input(0, 0), DT, CAR, mods({ accel: 0.4 }));
    const plain = stepDrive(rolling, input(0, 0), DT, CAR, NEUTRAL_MODIFIERS);
    expect(debuffed.speed).toBeCloseTo(plain.speed, 9);
  });
});

describe("turnRate reaches steering, alongside authority rather than instead of it", () => {
  it("scales the steering term", () => {
    const rolling = body({ speed: 200 });
    const half = stepDrive(rolling, input(1, 0), DT, CAR, mods({ turnRate: 0.5 }));
    const full = stepDrive(rolling, input(1, 0), DT, CAR, NEUTRAL_MODIFIERS);
    expect(half.angle).toBeCloseTo(full.angle * 0.5, 9);
  });

  it("multiplies with authority, so a rattled car mid-ram is both", () => {
    const rolling = body({ speed: 200, authority: 0.5 });
    const both = stepDrive(rolling, input(1, 0), DT, CAR, mods({ turnRate: 0.5 }));
    const full = stepDrive(body({ speed: 200 }), input(1, 0), DT, CAR, NEUTRAL_MODIFIERS);
    expect(both.angle).toBeCloseTo(full.angle * 0.25, 9);
  });

  it("does not touch injected spin — that is the ram's term, not the driver's", () => {
    const spun = body({ speed: 200, angVel: 2 });
    const out = stepDrive(spun, input(0, 0), DT, CAR, mods({ turnRate: 0.5 }));
    expect(out.angle).toBeCloseTo(2 * DT, 9);
  });
});

describe("immobilised zeroes the throttle and nothing else", () => {
  it("refuses to accelerate", () => {
    const out = stepDrive(body(), input(0, 1), DT, CAR, mods({ immobilised: true }));
    expect(out.speed).toBe(0);
  });

  it("still steers, and still lets a standing knock resolve", () => {
    const knocked = body({ speed: 200, angVel: 2, shoveX: 100 });
    const out = stepDrive(knocked, input(1, 0), DT, CAR, mods({ immobilised: true }));
    expect(out.angle).not.toBe(knocked.angle);
    expect(Math.abs(out.angVel)).toBeLessThan(Math.abs(knocked.angVel));
    expect(Math.abs(out.shoveX)).toBeLessThan(knocked.shoveX);
  });
});

describe("damageDealt reaches the shot, frozen at spawn", () => {
  const owner = { sessionId: "a", team: 0 as const, carId: CAR, x: 0, y: 0, angle: 0 };

  it("scales the instance's damage", () => {
    const plain = spawnInstances({ weaponId: "fireball", slot: 0 }, owner, 0, 0).instances[0]!;
    const buffed = spawnInstances({ weaponId: "fireball", slot: 0 }, owner, 0, 0, null, 1.25)
      .instances[0]!;
    expect(buffed.damage).toBe(scaleDamage(plain.damage, 1.25));
    expect(buffed.damage).toBeGreaterThan(plain.damage);
  });

  it("rounds to a whole number, so a piercing shot costs every car the same", () => {
    const shot = spawnInstances({ weaponId: "fireball", slot: 0 }, owner, 0, 0, null, 1.13)
      .instances[0]!;
    expect(Number.isInteger(shot.damage)).toBe(true);
  });
});

describe("damageTaken is applied at impact", () => {
  it("scales an incoming amount", () => {
    expect(scaleDamage(20, EFFECT_TABLE.exposed.modifiers.damageTaken)).toBe(26);
    expect(scaleDamage(20, EFFECT_TABLE.hardened.modifiers.damageTaken)).toBe(15);
  });

  it("never heals, whatever a bad multiplier says", () => {
    expect(scaleDamage(20, -5)).toBe(20);
    expect(scaleDamage(20, Number.NaN)).toBe(20);
    expect(scaleDamage(20, 0)).toBe(0);
  });
});

describe("weaponCooldown reaches the three refire clocks and no others", () => {
  const WEAPON = "fireball" as const;

  it("shortens a recharge", () => {
    const state = newFireState(CAR, 1);
    const spent = { ...state, slots: state.slots.map((s) => ({ ...s, stocks: 0 })) };
    const hasted = tickRecharge(spent, 0, 0.5);
    const plain = tickRecharge(spent, 0, 1);
    expect(hasted.slots[0]!.rechargeEndsTick).toBe(scaleTicks(weaponTicksOf(WEAPON).cooldown, 0.5));
    expect(hasted.slots[0]!.rechargeEndsTick).toBeLessThan(plain.slots[0]!.rechargeEndsTick);
  });

  it("shortens the switch lock a release sets", () => {
    // Oval's `skewer` carries a real recovery, so the scaled value is observable.
    const state = newFireState("oval", 1);
    const pending = {
      ...state,
      pending: { weaponId: "skewer" as const, slot: 1, shotsLeft: 1, nextShotTick: 0 },
    };
    const hasted = releaseShots(pending, 0, 0.5).state;
    expect(hasted.switchLockUntilTick).toBe(scaleTicks(weaponTicksOf("skewer").recovery, 0.5));
  });

  it("leaves a zero clock at zero — a debuff cannot invent a recovery a weapon does not have", () => {
    expect(scaleTicks(0, 3)).toBe(0);
  });

  it("never rounds a live clock down to zero", () => {
    expect(scaleTicks(1, 0.01)).toBe(1);
  });

  it("leaves an infinite clock infinite", () => {
    expect(scaleTicks(Number.POSITIVE_INFINITY, 0.5)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("ramMass reaches the ram, both as attacker and as victim", () => {
  function car(over: Partial<RamCar> = {}): RamCar {
    return { sessionId: "a", team: 0, x: 0, y: 0, angle: 0, speed: 0, carId: CAR, massMult: 1, ...over };
  }

  it("makes a buffed attacker hit harder", () => {
    const victim = car({ sessionId: "b", x: 47 });
    const plain = resolveRam(car({ speed: 400 }), victim, "ffa")!;
    const heavy = resolveRam(car({ speed: 400, massMult: 1.5 }), victim, "ffa")!;
    expect(heavy.severity).toBeGreaterThan(plain.severity);
  });

  it("makes a buffed victim harder to shove", () => {
    const attacker = car({ speed: 400 });
    const plain = resolveRam(attacker, car({ sessionId: "b", x: 47 }), "ffa")!;
    const heavy = resolveRam(attacker, car({ sessionId: "b", x: 47, massMult: 1.5 }), "ffa")!;
    expect(Math.hypot(heavy.knock.shoveX, heavy.knock.shoveY)).toBeLessThan(
      Math.hypot(plain.knock.shoveX, plain.knock.shoveY),
    );
  });

  it("is the same one channel doing both, so a mass buff can never be a pure upside", () => {
    expect(EFFECT_TABLE.hardened.modifiers.ramMass).toBeGreaterThan(1);
    expect(modifiersOf(live("hardened"), 0).ramMass).toBeGreaterThan(1);
  });
});
