import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_MODE, applyOverrides, boundsOf, installMode, modeConfigOf, weaponDefOf, type WeaponId,
} from "@motor-combat-moba/shared";
import { makeRng } from "../rng.js";
import type { BotArenaView, BotCarView, BotSlotView } from "../types.js";
import { physicsPredictor } from "./predict.js";
import { constantVelocityPredictor, solve, type PosePredictor, type SolverShooter } from "./solution.js";

/**
 * THE SOLVER'S PINNED ANSWERS. Every row below records, to the last bit, what `solve()` returned on
 * `development/main` at `a673df66` (bot brain 7.1.0) for one fixture. They exist so the solver can be
 * made CHEAPER without being made DIFFERENT: an optimisation that moves any of these numbers has
 * changed a decision somewhere, and owes a `BOT_BRAIN_VERSION` bump and a re-measured balance
 * baseline rather than a quiet merge.
 *
 * `toBe`, not `toBeCloseTo`: the memoisation and broad-phase cuts the solver carries are exact
 * (they only ever skip work whose result is already known), so the pins hold bit for bit. A row
 * that legitimately changes (a weapon retune, a hull change, a new quadrature) is re-pinned by
 * running this file and copying the printed values — the failure message carries them.
 *
 * The pepperbox rows are the point: four muzzles x three pellets x five quadrature nodes is sixty
 * marches a press, most of them pointing nowhere near the target, and it was 1.47 ms a call.
 */

const RECT: BotArenaView = { width: 1280, height: 720, obstacles: [] };

/** A pillar between the lanes, and a chamfered corner — the pieces of a real arena the march reads. */
const CLUTTERED: BotArenaView = {
  width: 1280,
  height: 720,
  obstacles: [{ x: 540, y: 300, w: 60, h: 120 }],
  planes: boundsOf({
    width: 1280,
    height: 720,
    boundary: [
      { x: 200, y: 0 }, { x: 1280, y: 0 }, { x: 1280, y: 720 }, { x: 0, y: 720 }, { x: 0, y: 200 },
    ],
  }).planes,
};

function slotFor(weaponId: WeaponId): BotSlotView {
  return { weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0, range: weaponDefOf(weaponId).range };
}

function shooterAt(carId: SolverShooter["carId"], x: number, y: number, angle: number, turretAngle?: number): SolverShooter {
  return { sessionId: "me", carId, team: 0, x, y, angle, vx: 0, vy: 0, ...(turretAngle === undefined ? {} : { turretAngle }) };
}

function targetAt(x: number, y: number, angle = Math.PI, speed = 0): BotCarView {
  return {
    sessionId: "them", carId: "mirage", team: 1, x, y, angle,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    hp: 70, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0,
  };
}

interface Pin {
  name: string;
  weaponId: WeaponId;
  shooter: SolverShooter;
  target: BotCarView;
  /** Absent: the target's own constant-velocity line. */
  predictor?: (target: BotCarView) => PosePredictor;
  aimSigmaRad: number;
  arena?: BotArenaView;
  maxSwingDeg?: number;
  /** Mode overrides installed for this row only. */
  overrides?: Record<string, unknown>;
  expect: { hitChance: number; expectedDamage: number; turretBearingRad?: number };
}

/** The controller's real predictor, seeded, so the frozen-past-the-horizon clamp is exercised too. */
const physics = (angVel: number, seed: number) => (target: BotCarView) =>
  physicsPredictor(target, angVel, 180, 0.1, makeRng(seed));

const PINS: Pin[] = [
  // --- pepperbox: the multi-pellet fan this file exists for ---------------------------------------
  {
    name: "pepperbox point blank dead ahead, perfect hands",
    weaponId: "pepperbox", shooter: shooterAt("bullseye", 0, 300, 0), target: targetAt(120, 300),
    aimSigmaRad: 0, expect: { hitChance: 1, expectedDamage: 141 },
  },
  {
    name: "pepperbox mid range, slightly off nose, shaky hands",
    weaponId: "pepperbox", shooter: shooterAt("bullseye", 100, 300, 0.1), target: targetAt(400, 340),
    aimSigmaRad: 0.05, expect: { hitChance: 1, expectedDamage: 81.25465011403605 },
  },
  {
    name: "pepperbox near the edge of reach",
    weaponId: "pepperbox", shooter: shooterAt("bullseye", 100, 300, 0), target: targetAt(680, 310),
    aimSigmaRad: 0.05, expect: { hitChance: 1, expectedDamage: 47 },
  },
  {
    name: "pepperbox against a target crossing the fan",
    weaponId: "pepperbox", shooter: shooterAt("bullseye", 100, 300, 0), target: targetAt(350, 420, -Math.PI / 2, 150),
    aimSigmaRad: 0.03, expect: { hitChance: 0.03079088343532217, expectedDamage: 1.447171521460142 },
  },
  {
    name: "pepperbox target dead astern (the 180 muzzle is the one that lands)",
    weaponId: "pepperbox", shooter: shooterAt("bullseye", 500, 300, 0), target: targetAt(300, 300),
    aimSigmaRad: 0.05, expect: { hitChance: 1, expectedDamage: 115.50930022807209 },
  },
  {
    name: "pepperbox target off the right flank (the 90 muzzle)",
    weaponId: "pepperbox", shooter: shooterAt("bullseye", 500, 300, 0), target: targetAt(500, 450),
    aimSigmaRad: 0, expect: { hitChance: 1, expectedDamage: 141 },
  },
  {
    name: "pepperbox through a cluttered arena with a pillar in the lane",
    weaponId: "pepperbox", shooter: shooterAt("bullseye", 400, 360, 0), target: targetAt(700, 380),
    aimSigmaRad: 0.05, arena: CLUTTERED, expect: { hitChance: 0.9692091165646779, expectedDamage: 79.8074785925759 },
  },
  {
    name: "pepperbox with the controller's own physics predictor on a turning target",
    weaponId: "pepperbox", shooter: shooterAt("bullseye", 200, 360, 0.2), target: targetAt(420, 400, 2.5, 120),
    predictor: physics(0.8, 3), aimSigmaRad: 0.05, expect: { hitChance: 1, expectedDamage: 126.80747859257592 },
  },
  {
    name: "pepperbox way off target: every pellet misses",
    weaponId: "pepperbox", shooter: shooterAt("bullseye", 200, 300, 0.7), target: targetAt(600, 300),
    aimSigmaRad: 0.05, expect: { hitChance: 0, expectedDamage: 0 },
  },
  // --- single-shot rows, one per march path ---------------------------------------------------------
  {
    name: "predator (homing turret shot) on a crossing target",
    weaponId: "predator", shooter: shooterAt("bullseye", 100, 300, 0), target: targetAt(500, 380, -Math.PI / 2, 100),
    aimSigmaRad: 0.05,
    expect: { hitChance: 0.9384182331293557, expectedDamage: 30.029383460139382, turretBearingRad: 0.09504220362468638 },
  },
  {
    name: "roadblock (shipped turret row) off the nose",
    weaponId: "roadblock", shooter: shooterAt("bastion", 100, 300, 0.3), target: targetAt(400, 300),
    aimSigmaRad: 0.05, expect: { hitChance: 1, expectedDamage: 92, turretBearingRad: 0 },
  },
  {
    name: "thumper bouncing off the long wall",
    weaponId: "thumper", shooter: shooterAt("bastion", 300, 300, -0.6), target: targetAt(700, 200),
    aimSigmaRad: 0.05, expect: { hitChance: 0.9384182331293557, expectedDamage: 51.61300282211457, turretBearingRad: -0.24497866312686412 },
  },
  {
    name: "magmablast direct hit with its own blast",
    weaponId: "magmablast", shooter: shooterAt("mirage", 100, 300, 0), target: targetAt(400, 310),
    aimSigmaRad: 0.05,
    expect: { hitChance: 0.9692091165646779, expectedDamage: 69.7830563926568, turretBearingRad: 0.033320995878247196 },
  },
  {
    name: "magmablast with perfect hands, hull off the nose (a turret row aims by bearing)",
    weaponId: "magmablast", shooter: shooterAt("mirage", 100, 300, 0.25), target: targetAt(400, 310),
    aimSigmaRad: 0, expect: { hitChance: 1, expectedDamage: 72, turretBearingRad: 0.03332099587824719 },
  },
  {
    name: "lance pulses on a parked target",
    weaponId: "lance", shooter: shooterAt("bullseye", 100, 300, 0), target: targetAt(500, 320),
    aimSigmaRad: 0.05, expect: { hitChance: 0.9692091165646779, expectedDamage: 174.45764098164202 },
  },
  {
    name: "afterburner clipped by the pillar",
    weaponId: "afterburner", shooter: shooterAt("mirage", 400, 360, 0), target: targetAt(700, 360),
    aimSigmaRad: 0.05, arena: CLUTTERED, expect: { hitChance: 0, expectedDamage: 0 },
  },
  {
    name: "fury-horn on a target the other side of the chamfer",
    weaponId: "fury-horn", shooter: shooterAt("taurus", 400, 400, Math.atan2(-1, -1)), target: targetAt(120, 120),
    aimSigmaRad: 0.05, arena: CLUTTERED, expect: { hitChance: 1, expectedDamage: 51, turretBearingRad: -2.356194490192345 },
  },
  {
    name: "wildcharge at contact range",
    weaponId: "wildcharge", shooter: shooterAt("taurus", 100, 300, 0.1), target: targetAt(210, 310, Math.PI, 40),
    aimSigmaRad: 0.1, expect: { hitChance: 1, expectedDamage: 255 },
  },
  {
    name: "basic-attack turret with a real swing and a half-turned barrel",
    weaponId: "basic-attack-mirage", shooter: shooterAt("mirage", 300, 100, 0, 0.6), target: targetAt(250, 500, 0, 150),
    aimSigmaRad: 0.05, maxSwingDeg: 360, overrides: { "turret.visible": true, "turret.maxSwingDeg": 360 },
    expect: { hitChance: 0.9384182331293557, expectedDamage: 10.322600564422913, turretBearingRad: 1.5033199212832784 },
  },
  {
    name: "basic-attack turret clamped to its arc edge",
    weaponId: "basic-attack-bullseye", shooter: shooterAt("bullseye", 300, 100, 0), target: targetAt(0, 100),
    aimSigmaRad: 0.05, maxSwingDeg: 180, overrides: { "turret.visible": true },
    expect: { hitChance: 0, expectedDamage: 0, turretBearingRad: 1.5707963267948966 },
  },
];

function solvePin(pin: Pin) {
  const predictor = pin.predictor ?? constantVelocityPredictor;
  return solve({
    shooter: pin.shooter, slot: slotFor(pin.weaponId), slotIndex: 0,
    target: pin.target, targetAt: predictor(pin.target),
    aimSigmaRad: pin.aimSigmaRad, tick: 0, arena: pin.arena ?? RECT,
    ...(pin.maxSwingDeg === undefined ? {} : { maxSwingDeg: pin.maxSwingDeg }),
  });
}

describe("solver pins (decision-neutral optimisation guard)", () => {
  beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

  for (const pin of PINS) {
    it(pin.name, () => {
      if (pin.overrides) installMode(applyOverrides(modeConfigOf(DEFAULT_GAME_MODE), pin.overrides));
      const got = solvePin(pin);
      const printed = `{ hitChance: ${got.hitChance}, expectedDamage: ${got.expectedDamage}`
        + (got.turretBearingRad === undefined ? " }" : `, turretBearingRad: ${got.turretBearingRad} }`);
      expect(got.hitChance, `re-pin as ${printed}`).toBe(pin.expect.hitChance);
      expect(got.expectedDamage, `re-pin as ${printed}`).toBe(pin.expect.expectedDamage);
      expect(got.turretBearingRad, `re-pin as ${printed}`).toBe(pin.expect.turretBearingRad);
    });
  }

  it("covers every shipped weapon kind and every march path", () => {
    const kinds = new Set(PINS.map((pin) => weaponDefOf(pin.weaponId).kind));
    expect([...kinds].sort()).toEqual(["beam", "maneuver", "projectile"]);
    const ids = new Set(PINS.map((pin) => pin.weaponId));
    for (const id of ["pepperbox", "predator", "thumper", "magmablast", "lance"] as WeaponId[]) expect(ids).toContain(id);
    expect(PINS.filter((pin) => pin.weaponId === "pepperbox").length).toBeGreaterThanOrEqual(8);
  });
});
