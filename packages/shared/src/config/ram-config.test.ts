import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { applyImpulse } from "../sim/impulse.js";
import { resolveRam, type RamCar } from "../sim/ram.js";
import type { SimBody } from "../sim/step.js";
import { CAR_TABLE, forwardMaxSpeedOf, ramAttackOf, ramDefenceOf } from "./car-config.js";
import { RAM_CONFIG, RAM_DECAY, halfLifeToPerTick } from "./ram-config.js";
import type { CarId } from "./types.js";

describe("halfLifeToPerTick", () => {
  it("halves the value after exactly one half-life of ticks", () => {
    const perTick = halfLifeToPerTick(0.5);
    const ticks = 0.5 * TICK_RATE_HZ;
    expect(perTick ** ticks).toBeCloseTo(0.5, 12);
  });

  it("is tick-rate independent: the same wall-clock half-life survives a rate change", () => {
    // Authored in seconds precisely so a future move to 60 Hz does not halve every recovery time.
    expect(halfLifeToPerTick(0.25) ** (0.25 * TICK_RATE_HZ)).toBeCloseTo(0.5, 12);
  });

  it("returns 0 for a non-positive or non-finite half-life rather than NaN", () => {
    expect(halfLifeToPerTick(0)).toBe(0);
    expect(halfLifeToPerTick(-1)).toBe(0);
    expect(halfLifeToPerTick(Number.NaN)).toBe(0);
  });

  it("never returns a multiplier at or above 1, which would make a knock permanent", () => {
    for (const hl of [0.05, 0.15, 0.25, 0.35, 2]) {
      expect(halfLifeToPerTick(hl)).toBeGreaterThan(0);
      expect(halfLifeToPerTick(hl)).toBeLessThan(1);
    }
  });
});

describe("RAM_CONFIG", () => {
  it("pins the authored knobs", () => {
    expect(RAM_CONFIG.contactPad).toBe(1);
    expect(RAM_CONFIG.minApproachSpeed).toBe(0);
    expect(RAM_CONFIG.bonusFront).toBe(0.3);
    expect(RAM_CONFIG.bonusFlank).toBe(1.0);
    expect(RAM_CONFIG.bonusRear).toBe(1.3);
    expect(RAM_CONFIG.knockMaxSpeed).toBe(260);
    // The stage's three MEASURED constants (`globalScale`'s own comment: "MEASURED, NOT DERIVED"),
    // pinned alongside the authored ones above. Nothing else in the suite catches a silent retune of
    // these — `balanceStamp` does not cover `RAM_CONFIG` — and the whole point of measuring them
    // instead of deriving them is that a future edit here should not be able to sail through quietly.
    expect(RAM_CONFIG.defencePushScale).toBe(35);
    expect(RAM_CONFIG.globalScale).toBe(0.4);
    // 10 -> 15 on 2026-09-16 (bigger cars, spec BC7): the hull grew 1.5x, so the maximum lever arm
    // grew 1.5x and `inertiaCoefficient` 2.25x; 1.5 * 1.5 / 2.25 = 1 keeps every ram's spin identical.
    expect(RAM_CONFIG.spinScale).toBe(15);
  });

  it("orders the side bonuses front < flank < rear, which is the whole positional read", () => {
    expect(RAM_CONFIG.bonusFront).toBeLessThan(RAM_CONFIG.bonusFlank);
    expect(RAM_CONFIG.bonusFlank).toBeLessThan(RAM_CONFIG.bonusRear);
  });

  it("derives inertiaCoefficient from the hull, never typed", () => {
    expect(RAM_CONFIG.inertiaCoefficient).toBeCloseTo((72 ** 2 + 48 ** 2) / 12, 9);
  });

  it("keeps the roster's hardest possible ram strictly under spinMaxRate", () => {
    // `spinScale`'s own comment table names this exact case the hardest the roster can produce:
    // Bastion (the roster's highest `ramAttack`/`ramDefence`) flanking a stationary Bullseye (the
    // roster's lowest `ramDefence`, so it absorbs the most) at Bastion's own top speed, hit at the
    // maximum lever arm `contactPointOn` can recover (the hull's half-length, 24 u). At `spinScale`
    // 10 that measured 5.95 rad/s against a 6.0 ceiling — 99% of it, approaching saturation without
    // clipping. The 2026-09-16 speed cut (Bastion 190 -> 135.9 u/s) dropped it to 4.50 rad/s, 75% of
    // the ceiling: `attackerPush` is linear in the attacker's closing speed, so a top-speed cut moves
    // this directly. There is real headroom under `spinMaxRate` again, and `globalScale`/`spinScale`
    // were MEASURED against the old ceiling-hugging case — stage 5's re-pitch inherits a spin budget
    // that is a quarter unspent. This is run through the REAL pipeline (`resolveRam` then
    // `applyImpulse`) rather than re-derived by hand, to also catch a regression in the code path
    // itself, not only in the constants.
    //
    // Geometry: attacker (Bastion) at (36, -45) facing +y, driving straight at its own top speed
    // toward a stationary victim (Bullseye) at the origin facing +x. `contactPointOn` clamps the
    // recovered contact point to the victim's local (36, -24) — x at the hull's half-length, 36 u
    // (the attacker's own x sits exactly on that boundary), y at the half-width, 24 u (since the
    // attacker's y offset of 45 exceeds it) — the same maximal-lever geometry `spinScale`'s table
    // measured. The 2026-09-16 hull resize scaled this geometry 1.5x and moved `spinScale` to 15,
    // which is why the figure did not move.
    //
    // Hand-derived, cross-checked against the pipeline output below (ramAttack/ramDefence: bastion
    // 70/90, bullseye 45/30; RAM_CONFIG: defencePushScale 35, bonusFlank 1.0, globalScale 0.4,
    // inertiaCoefficient (72^2+48^2)/12 = 7488/12):
    //   attackerPush = 70*135.9 + 90*35 = 12663       victimPush = 30*35 = 1050
    //   share = attackerPush/(attackerPush+victimPush) = 12663/13713 ~= 0.92343
    //   impulse.speed = attackerPush * share * bonusFlank * globalScale / ramDefence(bullseye)
    //                 = 12663 * 0.92343 * 1.0 * 0.4 / 30 ~= 155.912 u/s
    //   torque = rx*fy - ry*fx = 36*155.912 - (-24)*0 ~= 5612.83
    //   inertia = ramDefence(bullseye) * inertiaCoefficient = 30 * 7488/12 = 18720
    //   spin = torque/inertia * spinScale = (5612.83/18720) * 15 ~= 4.4975 rad/s
    const attacker: RamCar = {
      sessionId: "a", team: 0, x: 36, y: -45, angle: Math.PI / 2,
      vx: 0, vy: forwardMaxSpeedOf("bastion"), carId: "bastion" as CarId, defenceMult: 1,
    };
    const victim: RamCar = {
      sessionId: "b", team: 0, x: 0, y: 0, angle: 0,
      vx: 0, vy: 0, carId: "bullseye" as CarId, defenceMult: 1,
    };
    const hit = resolveRam(attacker, victim, "ffa")!;
    expect(hit.side).toBe("flank");
    const restingBody: SimBody = {
      x: victim.x, y: victim.y, angle: victim.angle, vx: 0, vy: 0, reverseHold: 0, angVel: 0,
      maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
    };
    const next = applyImpulse(restingBody, ramDefenceOf(victim.carId), hit.impulse);
    expect(Math.abs(next.angVel)).toBeCloseTo(4.4975, 3);
    expect(Math.abs(next.angVel)).toBeLessThan(RAM_CONFIG.spinMaxRate);
  });

  it("bleeds spin faster when countersteering than when coasting", () => {
    expect(RAM_DECAY.counterSteer).toBeLessThan(RAM_DECAY.spin);
  });
});

// Replaces the old "mass rating" block outright. `mass` and `massOf` are deleted (stage 3 Task 4,
// spec R1), so the questions that block asked — is every chassis's rating a whole 0-100 number, and
// does the roster order the way the design says — are asked here of the pair that replaced it. The
// third question it asked ("does `massOf` scale the rating by `massPerRating`") has no successor on
// purpose: the contest reads the ratings unscaled, so there is no derived quantity to pin.
describe("the ram ratings", () => {
  it("gives every chassis whole 0-100 ratings on both ram axes", () => {
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      for (const rating of [ramAttackOf(id), ramDefenceOf(id)]) {
        expect(Number.isInteger(rating)).toBe(true);
        expect(rating).toBeGreaterThanOrEqual(0);
        expect(rating).toBeLessThanOrEqual(100);
      }
    }
  });

  it("orders both axes tank > speedster > skirmisher, as the old single mass rating did", () => {
    expect(ramAttackOf("bastion")).toBeGreaterThan(ramAttackOf("mirage"));
    expect(ramAttackOf("mirage")).toBeGreaterThan(ramAttackOf("bullseye"));
    expect(ramDefenceOf("bastion")).toBeGreaterThan(ramDefenceOf("mirage"));
    expect(ramDefenceOf("mirage")).toBeGreaterThan(ramDefenceOf("bullseye"));
  });

  // The whole reason there are two ratings and not one (spec R1): a chassis's offence and its
  // solidity must be settable apart. Bastion's spread (70/90) is the roster's widest and Bullseye's
  // (45/30) leans the other way, so the pair is doing work no single rating could — if every car
  // ever carried the same number on both, the split would have bought nothing.
  it("does not carry the same number on both axes for every car", () => {
    const ids = Object.keys(CAR_TABLE) as CarId[];
    expect(ids.some((id) => ramAttackOf(id) !== ramDefenceOf(id))).toBe(true);
  });
});
