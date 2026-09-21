import { describe, expect, it } from "vitest";
import { TURRET_TICKS } from "../../config/turret-config.js";
import { weaponTicksOf } from "../../config/weapon-ticks.js";
import { beginFire, newFireState, releaseShots, tickRecharge, type FireState } from "./fire.js";
import {
  carHasTurretWeapon,
  clampBearingToSwing,
  clampToSwing,
  turnTurret,
  turretPivotOf,
  wrapAngle,
} from "./turret.js";

describe("wrapAngle", () => {
  it("maps into (-pi, pi]", () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapAngle((-5 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12);
  });
});

describe("turretPivotOf (TR6)", () => {
  it("is the car centre for the shipped zero mount", () => {
    expect(turretPivotOf({ x: 100, y: 50, angle: 1.2 }, "mirage")).toEqual({ x: 100, y: 50 });
  });

  it("rotates a non-zero mount with the car", () => {
    const p = turretPivotOf({ x: 0, y: 0, angle: Math.PI / 2 }, "mirage", { x: 10, y: 0 });
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(10, 9);
  });
});

const step = TURRET_TICKS.turnPerTick;
function mirage(): FireState {
  return newFireState("mirage", 1);
}

describe("beginFire captures a bearing for a turret weapon (TR12)", () => {
  it("freezes the wire bearing and waits for the turret", () => {
    const s = beginFire("a", mirage(), 1 << 1, 10, 1.0, 0);
    expect(s.pending?.bearing).toBe(1.0);
    expect(s.pending?.aligned).toBe(false);
    expect(s.pending?.nextShotTick).toBe(Number.POSITIVE_INFINITY);
    expect(s.slots[1]!.stocks).toBe(0); // a press is still a commitment
  });

  it("falls back to where the turret already points when no aim came in", () => {
    const s = beginFire("a", { ...mirage(), turretAngle: 0.5 }, 1 << 1, 10, null, 1.0);
    expect(s.pending?.bearing).toBeCloseTo(1.5, 12);
  });

  it("leaves a fixed-muzzle weapon exactly as before", () => {
    const s = beginFire("a", mirage(), 1 << 3, 10, 1.0, 0);
    expect(s.pending?.bearing ?? null).toBeNull();
    expect(s.pending?.aligned ?? true).toBe(true);
    expect(s.pending?.nextShotTick).toBe(10 + weaponTicksOf("afterburner").startUp);
  });
});

describe("turnTurret (TR13-TR14)", () => {
  it("fires on the press tick when the turret already points at the bearing", () => {
    let s = beginFire("a", mirage(), 1 << 1, 10, 0, 0);
    s = turnTurret(s, 0, 10);
    expect(s.pending?.aligned).toBe(true);
    expect(s.pending?.nextShotTick).toBe(10 + weaponTicksOf("magmablast").startUp);
    expect(releaseShots(s, 10).orders).toHaveLength(1);
  });

  it("turns at most one step per tick, then counts the wind-up from alignment", () => {
    const target = step * 3.5;
    let s = beginFire("a", mirage(), 1 << 1, 0, target, 0);
    for (let t = 0; t < 3; t++) {
      s = turnTurret(s, 0, t);
      expect(s.turretAngle).toBeCloseTo(step * (t + 1), 12);
      expect(s.pending?.aligned).toBe(false);
      expect(releaseShots(s, t).orders).toHaveLength(0);
    }
    s = turnTurret(s, 0, 3);
    expect(s.turretAngle).toBeCloseTo(target, 12);
    expect(s.pending?.aligned).toBe(true);
    expect(s.pending?.nextShotTick).toBe(3 + weaponTicksOf("magmablast").startUp);
  });

  it("takes the short way across +-pi", () => {
    let s: FireState = { ...mirage(), turretAngle: Math.PI - step / 2 };
    s = beginFire("a", s, 1 << 1, 0, -Math.PI + step / 2, 0);
    s = turnTurret(s, 0, 0);
    expect(s.pending?.aligned).toBe(true);
    expect(s.turretAngle).toBeCloseTo(-Math.PI + step / 2, 9);
  });

  it("aims at a WORLD bearing, so a car that turned changes the relative target", () => {
    let s = beginFire("a", mirage(), 1 << 1, 0, 1.0, 0);
    s = turnTurret(s, 1.0, 0);
    expect(s.turretAngle).toBeCloseTo(0, 12);
    expect(s.pending?.aligned).toBe(true);
  });

  it("keeps tracking the bearing after alignment while the car turns", () => {
    let s = beginFire("a", mirage(), 1 << 1, 0, 0, 0);
    s = turnTurret(s, 0, 0);
    s = { ...s, pending: { ...s.pending!, nextShotTick: 99 } }; // pretend a long wind-up
    s = turnTurret(s, step / 2, 1);
    expect(s.turretAngle).toBeCloseTo(-step / 2, 12);
    expect(s.pending?.nextShotTick).toBe(99); // alignment is decided once
  });

  it("holds the car-relative angle when nothing is pending (D2)", () => {
    const s: FireState = { ...mirage(), turretAngle: 0.7 };
    expect(turnTurret(s, 2.0, 5)).toBe(s);
  });

  it("ignores a fixed-muzzle press", () => {
    const s = beginFire("a", { ...mirage(), turretAngle: 0.7 }, 1 << 3, 5, 1.0, 0);
    expect(turnTurret(s, 0, 5).turretAngle).toBe(0.7);
  });

  it("does not start a stock recharge while the turret turns (TR16)", () => {
    let s = beginFire("a", mirage(), 1 << 1, 0, Math.PI, 0);
    s = tickRecharge(s, 1);
    expect(s.slots[1]!.rechargeEndsTick).toBe(0);
  });
});

describe("releaseShots carries the bearing (TR9)", () => {
  it("copies the frozen bearing onto the order", () => {
    let s = beginFire("a", mirage(), 1 << 1, 0, 0.25, 0.25);
    s = turnTurret(s, 0.25, 0);
    expect(releaseShots(s, 0).orders[0]!.bearing).toBe(0.25);
  });
});

describe("carHasTurretWeapon (TR53)", () => {
  it("is false when nothing fireable carries a turret", () => {
    // mirage's kit minus its turret weapon (magmablast); basic attack disabled so index 0 doesn't count.
    expect(carHasTurretWeapon(["basic-attack-mirage", "thunderclap", "afterburner"], false)).toBe(
      false,
    );
  });

  it("is true when the basic attack carries a turret and is enabled", () => {
    expect(carHasTurretWeapon(["basic-attack-mirage", "thunderclap", "afterburner"], true)).toBe(
      true,
    );
  });

  it("is false when the basic attack is disabled and the kit carries no turret weapon", () => {
    expect(carHasTurretWeapon(["basic-attack-mirage", "thunderclap", "afterburner"], false)).toBe(
      false,
    );
  });

  it("ignores a turret weapon sitting past this build's fire-slot count", () => {
    // Index 4 is past `maxFireSlots` (4, i.e. slots 0-3) at the shipped N=3 — bullseye's turret
    // weapon (predator) parked one slot too far out never counts.
    expect(
      carHasTurretWeapon(["basic-attack-bullseye", "pepperbox", "lance", "wildcharge", "predator"], false),
    ).toBe(false);
  });

  it("is true for a turret ability within this build's slots", () => {
    expect(carHasTurretWeapon(["basic-attack-bullseye", "predator", "pepperbox", "lance"], false)).toBe(
      true,
    );
  });

  it("defaults the basic-attack flag to BASIC_ATTACK_CONFIG.enabled", () => {
    // Shipped `true` today (TR46) — the basic attack's own turret carries every car.
    expect(carHasTurretWeapon(["basic-attack-mirage", "thunderclap", "afterburner"])).toBe(true);
  });

  it("ignores an unknown or empty weapon id rather than throwing", () => {
    expect(() => carHasTurretWeapon(["", "not-a-real-weapon"], true)).not.toThrow();
    expect(carHasTurretWeapon(["", "not-a-real-weapon"], true)).toBe(false);
  });
});

describe("the turret swing limit (TR55)", () => {
  const HALF_PI = Math.PI / 2;

  it("clampToSwing is the identity at 360", () => {
    for (const a of [0, 1, -2.5, Math.PI, -Math.PI + 1e-9]) expect(clampToSwing(a, 360)).toBe(a);
  });

  it("clampToSwing holds a 180 arc to +-90 degrees", () => {
    expect(clampToSwing(0.3, 180)).toBe(0.3);
    expect(clampToSwing(2.5, 180)).toBeCloseTo(HALF_PI, 12);
    expect(clampToSwing(-3, 180)).toBeCloseTo(-HALF_PI, 12);
  });

  it("clampBearingToSwing leaves the bearing untouched at 360, and clamps relative to the car below", () => {
    expect(clampBearingToSwing(7.5, 1, 360)).toBe(7.5);
    // Car faces +x; aiming nearly straight behind is pushed to the nearer arc edge.
    expect(clampBearingToSwing(Math.PI - 0.1, 0, 180)).toBeCloseTo(HALF_PI, 12);
    expect(clampBearingToSwing(-Math.PI + 0.1, 0, 180)).toBeCloseTo(-HALF_PI, 12);
    // Relative to a turned car: heading 1 rad, aim 1 + 2 rad -> 1 + pi/2.
    expect(clampBearingToSwing(3, 1, 180)).toBeCloseTo(1 + HALF_PI, 12);
  });

  it("beginFire clamps an out-of-arc bearing to the arc edge at press time", () => {
    const s = beginFire("a", mirage(), 1 << 1, 10, Math.PI - 0.2, 0, 180);
    expect(s.pending?.bearing).toBeCloseTo(HALF_PI, 12);
  });

  it("beginFire keeps an in-arc bearing exactly, and every bearing at 360", () => {
    expect(beginFire("a", mirage(), 1 << 1, 10, 0.4, 0, 180).pending?.bearing).toBe(0.4);
    expect(beginFire("a", mirage(), 1 << 1, 10, Math.PI - 0.2, 0, 360).pending?.bearing).toBe(Math.PI - 0.2);
  });

  it("turnTurret takes the long way when the short way crosses the back", () => {
    // From +100 deg to -100 deg: the short arc (160 deg) runs through the back (180), which a 240
    // arc (+-120) forbids, so the turret sweeps the long way (200 deg) forward through 0 instead.
    const from = (100 * Math.PI) / 180;
    const to = (-100 * Math.PI) / 180;
    const limited = beginFire("a", { ...mirage(), turretAngle: from }, 1 << 1, 0, to, 0, 240);
    expect(turnTurret(limited, 0, 0, step, 240).turretAngle).toBeCloseTo(from - step, 12);
    // At 360 the same press takes the short way, through the back.
    const free = beginFire("a", { ...mirage(), turretAngle: from }, 1 << 1, 0, to, 0, 360);
    expect(turnTurret(free, 0, 0, step, 360).turretAngle).toBeCloseTo(from + step, 12);
  });

  it("turnTurret sweeps edge to edge through the front at 180", () => {
    // +90 to -90 is a dead heat, and the unrestricted wrap resolves it through the back (+pi).
    const limited = beginFire("a", { ...mirage(), turretAngle: HALF_PI }, 1 << 1, 0, -HALF_PI, 0, 180);
    expect(turnTurret(limited, 0, 0, step, 180).turretAngle).toBeCloseTo(HALF_PI - step, 12);
  });

  it("turnTurret never leaves the arc on its way round", () => {
    let s: FireState = { ...mirage(), turretAngle: HALF_PI - 0.01 };
    s = beginFire("a", s, 1 << 1, 0, -HALF_PI + 0.01, 0, 180);
    for (let t = 0; t < 200 && s.pending?.aligned === false; t++) {
      s = turnTurret(s, 0, t, step, 180);
      expect(Math.abs(s.turretAngle)).toBeLessThanOrEqual(HALF_PI + 1e-12);
    }
    expect(s.pending?.aligned).toBe(true);
  });

  it("turnTurret targets the clamped angle once the car has turned the bearing out of the arc", () => {
    // Pressed dead ahead; the car then turns 2 rad, which puts the frozen bearing behind it.
    let s = beginFire("a", mirage(), 1 << 1, 0, 0, 0, 180);
    for (let t = 0; t < 100; t++) s = turnTurret(s, 2, t, step, 180);
    expect(s.turretAngle).toBeCloseTo(-HALF_PI, 12);
  });
});
