import { describe, expect, it } from "vitest";
import {
  CAR_TABLE,
  DEFAULT_CAR_ID,
  accelOf,
  driveOf,
  forwardMaxSpeedOf,
  hpOf,
  isCarId,
  massOf,
  reverseAccelOf,
  reverseMaxSpeedOf,
  turnRateAtStopOf,
  turnRateOf,
} from "./car-config.js";
import type { CarId } from "./types.js";
import { COLOR_TABLE } from "./color-config.js";
import { COMBAT_CONFIG } from "./combat-config.js";
import { CAMERA_CONFIG, DRIVE_CONFIG } from "./drive-config.js";
import { FLOW_CONFIG } from "./flow-config.js";
import { NET_CONFIG } from "./net-config.js";
import { WEAPON_TABLE } from "./weapon-config.js";
import { damageFor } from "../sim/damage.js";

describe("CAR_TABLE", () => {
  it("has exactly mirage, bullseye, bastion", () => {
    expect(Object.keys(CAR_TABLE).sort()).toEqual(["bastion", "bullseye", "mirage"]);
  });

  it("matches the locked ratings", () => {
    expect(CAR_TABLE.mirage).toMatchObject({ speed: 88, accel: 85, handling: 50, attack: 63, hp: 48, mass: 48 });
    expect(CAR_TABLE.bullseye).toMatchObject({ speed: 52, accel: 45, handling: 28, attack: 55, hp: 30, mass: 30 });
    expect(CAR_TABLE.bastion).toMatchObject({ speed: 30, accel: 20, handling: 82, attack: 42, hp: 82, mass: 90 });
  });

  it("gives every chassis whole 0-100 ratings on all six axes", () => {
    // The 150-point budget that used to be asserted here was removed on 2026-08-29 so that `mass`
    // could be a free-floating fourth rating. Nothing enforces roster fairness now; see CAR_TABLE.
    // `accel` and `handling` joined the sweep once they became real per-chassis ratings rather than
    // global drive constants: every one of the six feeds a derivation that NaNs on a non-number.
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      const def = CAR_TABLE[id];
      for (const rating of [def.speed, def.accel, def.handling, def.attack, def.hp, def.mass]) {
        expect(Number.isInteger(rating)).toBe(true);
        expect(rating).toBeGreaterThanOrEqual(0);
        expect(rating).toBeLessThanOrEqual(100);
      }
    }
  });

  it("derives actual HP via hpPerRating", () => {
    expect(hpOf("mirage")).toBe(480);
    expect(hpOf("bullseye")).toBe(300);
    expect(hpOf("bastion")).toBe(820);
  });

  it("kills an average chassis with the baseline weapon in 20 seconds", () => {
    // The spec's headline number (S7), which moved from 5.0 to 5.5 when T14 put `fireball`'s
    // cooldown up 500 -> 550 to pay for `shockwave` landing in Mirage's slot 2. The damage was NOT
    // re-solved to hold 5 s: the anchor is 50 per press, and the kill time is what the cooldown
    // makes of it. 50 damage per 550 ms is 91 DPS, and 500 hull HP / 91 is 5.5 s.
    //
    // An "average" chassis is one rating point of each at the baseline: attackBaseline -> 500 hull
    // HP. TTK is reckoned as hullHP / DPS, the sustained-fire figure. This test is deliberately
    // over-coupled: it should go red if hpPerRating, attackBaseline, or fireball.damage drifts.
    //
    // It canNOT pin damagePerAttack: evaluated exactly at the baseline, damageFor's
    // `(attack - attackBaseline)` term is 0, so the scale is identically 1 whatever
    // damagePerAttack holds. damagePerAttack is pinned instead by the off-baseline cells in the
    // "pins damagePerAttack through off-baseline chassis" test below, where the modifier is not 1.
    const averageHp = COMBAT_CONFIG.attackBaseline * COMBAT_CONFIG.hpPerRating;
    const dps =
      (damageFor(COMBAT_CONFIG.attackBaseline, WEAPON_TABLE.fireball.damage) * 1000) /
      WEAPON_TABLE.fireball.cooldownMs;
    expect(averageHp / dps).toBe(20);
  });

  it("pins damagePerAttack through off-baseline chassis", () => {
    // At `attackBaseline` the scale is identically 1, so no baseline assertion can see
    // `damagePerAttack` move. These three cells are all off-baseline in both directions.
    expect(damageFor(63, 50)).toBe(57); // mirage 1.13x
    expect(damageFor(55, 45)).toBe(47); // bullseye 1.05x
    expect(damageFor(42, 60)).toBe(55); // bastion 0.92x
  });

  it("derives forward max speed from the speed rating", () => {
    expect(forwardMaxSpeedOf("mirage")).toBeGreaterThan(forwardMaxSpeedOf("bullseye"));
    expect(forwardMaxSpeedOf("bullseye")).toBeGreaterThan(forwardMaxSpeedOf("bastion"));
  });
});

describe("isCarId", () => {
  it("accepts CAR_TABLE keys and rejects unknown ids", () => {
    expect(isCarId("mirage")).toBe(true);
    expect(isCarId("bullseye")).toBe(true);
    expect(isCarId("bastion")).toBe(true);
    expect(isCarId("triangle")).toBe(false);
    expect(isCarId("")).toBe(false);
    expect(isCarId(1)).toBe(false);
  });

  it("rejects names inherited from Object.prototype", () => {
    // `"constructor" in CAR_TABLE` is true; the own-property check is what keeps it out.
    expect(isCarId("constructor")).toBe(false);
    expect(isCarId("toString")).toBe(false);
    expect(isCarId("hasOwnProperty")).toBe(false);
  });
});

describe("driveOf", () => {
  it("resolves every car's drive numbers from the tables", () => {
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      const d = driveOf(id);
      expect(d.maxSpeed).toBe(forwardMaxSpeedOf(id));
      expect(d.reverseMaxSpeed).toBe(reverseMaxSpeedOf(id));
      expect(d.accel).toBeGreaterThan(0);
      expect(d.reverseAccel).toBeGreaterThan(0);
      expect(d.turnRate).toBeGreaterThan(0);
      expect(d.turnRateAtStop).toBeGreaterThan(0);
    }
  });

  it("returns the same frozen object every call, so the tick allocates nothing", () => {
    expect(driveOf("mirage")).toBe(driveOf("mirage"));
    expect(Object.isFrozen(driveOf("mirage"))).toBe(true);
  });
});

describe("per-car drive ratings", () => {
  it("anchors both scales so rating 50 lands on one global constant apiece", () => {
    // The pivot in T7: `turnRateOf` and `accelOf` are authored so an exactly-average chassis drives
    // like a single global constant would, which is what keeps "rating 50 is average" a reading aid
    // rather than a slogan. A scale edit that moves a pivot fails here, so raising the whole roster
    // is a deliberate two-line change plus this number, never a drift.
    // The accel pivot is still the pre-2026-08-30 global 780. The turn pivot was that era's 4.2
    // until 2026-08-31, when both halves of the turn scale were multiplied by 1.5 — driving, and so
    // aiming, read as too heavy — putting every chassis at 1.5x its old rate and the pivot at 6.3.
    // `toBeCloseTo`, not `toBe`: 3.6 + 50 * 0.054 is 6.300000000000001 in IEEE-754. The anchor is
    // the design intent, not a bit pattern, and no decimal scale reproduces 6.3 exactly.
    const { baseTurnRate, turnRatePerRating, baseAccel, accelPerRating } = DRIVE_CONFIG;
    expect(baseTurnRate + 50 * turnRatePerRating).toBeCloseTo(6.3, 9);
    expect(baseAccel + 50 * accelPerRating).toBeCloseTo(780, 9);
  });

  it("keeps the stopped turn rate at half the moving one, as it shipped", () => {
    expect(DRIVE_CONFIG.stopTurnRatio).toBe(0.5);
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      expect(turnRateAtStopOf(id)).toBeCloseTo(turnRateOf(id) * 0.5, 9);
    }
  });

  it("feeds the derived rates into every chassis's ChassisDrive", () => {
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      const d = driveOf(id);
      expect(d.turnRate).toBeCloseTo(turnRateOf(id), 9);
      expect(d.turnRateAtStop).toBeCloseTo(turnRateAtStopOf(id), 9);
      expect(d.accel).toBeCloseTo(accelOf(id), 9);
      expect(d.reverseAccel).toBeCloseTo(reverseAccelOf(id), 9);
    }
  });

  it("scales every car's reverse speed from its own forward speed by reverseSpeedRatio", () => {
    // The single-car version of this (mirage only) used to live in drive.test.ts as a byproduct of
    // reading the live table inside an otherwise-hermetic GOLDEN_CHASSIS suite. R7: that suite now
    // reads only the frozen fixture, so this per-car sweep is what keeps the actual property —
    // reverse speed tracks EACH chassis's own forward speed, not just mirage's — pinned against the
    // live roster.
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      expect(reverseMaxSpeedOf(id)).toBeCloseTo(forwardMaxSpeedOf(id) * DRIVE_CONFIG.reverseSpeedRatio, 9);
    }
  });
});

describe("COLOR_TABLE", () => {
  it("has 6 unique hex colors", () => {
    expect(COLOR_TABLE).toHaveLength(6);
    const hex = COLOR_TABLE.map((c) => c.hex);
    expect(new Set(hex).size).toBe(6);
    for (const h of hex) expect(h).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe("weapon / combat / drive / flow knobs exist", () => {
  it("combat defaults", () => {
    expect(COMBAT_CONFIG.hpPerRating).toBe(10);
    expect(COMBAT_CONFIG.attackBaseline).toBe(50);
    expect(COMBAT_CONFIG.damagePerAttack).toBe(0.01);
  });
  it("reverse is slower than forward, but not a crawl", () => {
    expect(DRIVE_CONFIG.reverseSpeedRatio).toBe(0.65);
    expect(DRIVE_CONFIG.reverseSpeedRatio).toBeLessThan(1);
  });

  it("brakes harder than it coasts, or the brake button would mean nothing", () => {
    // Ranged, not pinned: the ordering is what matters. A drag above brakeDecel would make holding
    // Down *slower* to stop than releasing the throttle entirely.
    expect(DRIVE_CONFIG.brakeDecel).toBeGreaterThan(DRIVE_CONFIG.drag);
  });

  it("gives reverse its own acceleration rate, at least as quick as forward pickup", () => {
    // Ranged, not pinned: reverseAccel exists to be tuned by feel, so an exact value here would go
    // red on every good change as readily as a bad one. What must hold is that it is a real rate
    // and that splitting it from `accel` bought something — a reverseAccel below `accel` would make
    // backing out slower than the forward curve it was separated from.
    expect(DRIVE_CONFIG.reverseAccelFactor).toBeGreaterThanOrEqual(1);
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      expect(reverseAccelOf(id)).toBeGreaterThanOrEqual(accelOf(id));
    }
  });

  it("keeps stopEpsilon a small positive rest band", () => {
    // Zero would leave a car creeping forever instead of settling, and a band wide enough to reach
    // real driving speeds would freeze the car mid-roll and steer it at turnRateAtStop.
    expect(DRIVE_CONFIG.stopEpsilon).toBeGreaterThan(0);
    expect(DRIVE_CONFIG.stopEpsilon).toBeLessThan(1);
  });
  it("flow timers", () => {
    expect(FLOW_CONFIG.carSelectSeconds).toBe(60);
    expect(FLOW_CONFIG.countdownSeconds).toBe(3);
  });
  it("camera follows softly and pushes the view in", () => {
    // Pinned, not ranged: these are the tuned values, and a camLerp outside (0, 1] either never
    // reaches the car or overshoots it every frame. Zoom 2 would draw the 2x car textures at 1:1;
    // 1 trades sprite sharpness for the widest field of view the range allows. Below 1 the
    // textures shimmer, so a change here is also a change to how sharp every car sprite is.
    expect(CAMERA_CONFIG.camLerp).toBe(0.18);
    expect(CAMERA_CONFIG.zoom).toBe(1);
  });
  it("lets a spectator's free-look camera outrun the fastest car", () => {
    // Ranged, not pinned: what matters is that free roam can get ahead of the action rather than
    // trailing behind whichever car happens to be quickest.
    const fastest = Math.max(
      ...(Object.keys(CAR_TABLE) as CarId[]).map((id) => forwardMaxSpeedOf(id)),
    );
    expect(CAMERA_CONFIG.freeRoamSpeed).toBeGreaterThan(fastest);
  });
  it("names a default chassis that is a real car id", () => {
    expect(isCarId(DEFAULT_CAR_ID)).toBe(true);
  });
  it("keeps reconcileEaseRate inside (0, 1] so corrections converge", () => {
    // The same property CAMERA_CONFIG.camLerp is pinned for, but governing the *car*: at 0 the
    // predicted pose never closes on the authoritative one, and above 1 every correction overshoots
    // and oscillates — at >= 2 it diverges outright. The prediction tests all read this constant
    // back out of NET_CONFIG, so they are structurally incapable of catching a bad value here.
    expect(NET_CONFIG.reconcileEaseRate).toBeGreaterThan(0);
    expect(NET_CONFIG.reconcileEaseRate).toBeLessThanOrEqual(1);
  });
  it("caps how many inputs one player can have applied per tick", () => {
    expect(NET_CONFIG.maxInputsPerTick).toBeTypeOf("number");
    expect(Number.isInteger(NET_CONFIG.maxInputsPerTick)).toBe(true);
    // Below 1 the server would drop every input and no one could move.
    expect(NET_CONFIG.maxInputsPerTick).toBeGreaterThanOrEqual(1);
  });
});

describe("the three types (T5/T6)", () => {
  it("derives the roster's drive profile from its ratings", () => {
    expect(forwardMaxSpeedOf("bullseye")).toBe(414);
    expect(forwardMaxSpeedOf("mirage")).toBe(576);
    expect(forwardMaxSpeedOf("bastion")).toBe(315);

    expect(accelOf("bullseye")).toBeCloseTo(744, 9);
    expect(accelOf("mirage")).toBeCloseTo(1032, 9);
    expect(accelOf("bastion")).toBeCloseTo(564, 9);

    // 1.5x their pre-2026-08-31 rates (3.408 / 4.2 / 5.352): the whole roster was raised together,
    // so the type triangle's agility ordering and spacing are exactly as they were.
    expect(turnRateOf("bullseye")).toBeCloseTo(5.112, 9);
    expect(turnRateOf("mirage")).toBeCloseTo(6.3, 9);
    expect(turnRateOf("bastion")).toBeCloseTo(8.028, 9);

    expect(hpOf("bullseye")).toBe(300);
    expect(hpOf("mirage")).toBe(480);
    expect(hpOf("bastion")).toBe(820);
  });

  it("gives Bastion the tightest turn radius despite being the slowest", () => {
    // T6. Radius is speed / turnRate, so turn RATE and turn RADIUS order the roster differently:
    // Bullseye has the lowest rate but not the widest arc, because Mirage is far faster. Bastion
    // turning inside every other chassis is the mechanical reason "3 beats 2" holds.
    const radius = (id: CarId) => forwardMaxSpeedOf(id) / turnRateOf(id);
    expect(radius("bastion")).toBeLessThan(radius("bullseye"));
    expect(radius("bullseye")).toBeLessThan(radius("mirage"));
    // Two thirds of the 58.9 it was before the 2026-08-31 turn-rate raise. Speed was untouched, so
    // every radius on the roster shrank by exactly the 1.5x the rates grew by.
    expect(radius("bastion")).toBeCloseTo(39.2, 1);
  });

  it("orders the three types on every axis the design names", () => {
    expect(forwardMaxSpeedOf("mirage")).toBeGreaterThan(forwardMaxSpeedOf("bullseye"));
    expect(forwardMaxSpeedOf("bullseye")).toBeGreaterThan(forwardMaxSpeedOf("bastion"));
    expect(accelOf("mirage")).toBeGreaterThan(accelOf("bullseye"));
    expect(accelOf("bullseye")).toBeGreaterThan(accelOf("bastion"));
    expect(turnRateOf("bastion")).toBeGreaterThan(turnRateOf("mirage"));
    expect(turnRateOf("mirage")).toBeGreaterThan(turnRateOf("bullseye"));
    expect(hpOf("bastion")).toBeGreaterThan(hpOf("mirage"));
    expect(hpOf("mirage")).toBeGreaterThan(hpOf("bullseye"));
    expect(massOf("bastion")).toBeGreaterThan(massOf("mirage"));
    expect(massOf("mirage")).toBeGreaterThan(massOf("bullseye"));
  });
});
