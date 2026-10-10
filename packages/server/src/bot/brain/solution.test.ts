import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_MODE,
  applyOverrides,
  assembleModeConfig,
  installMode,
  modeConfigOf,
  type ModeConfig,
  type ModeTables,
} from "@motor-combat-moba/shared";
import {
  TICK_RATE_HZ, TURRET_TICKS, boundsOf, msToTicks, carHullOf, instanceExpired, resolveInstanceHits,
  spawnInstances, stepInstance, turretPivotOf, weaponDefOf, weaponTicksOf, weapons, wrapAngle,
  type PoseSnapshot, type WeaponId,
} from "@motor-combat-moba/shared";
import type { BotArenaView, BotCarView, BotSlotView } from "../types.js";
import {
  AIM_QUADRATURE, constantVelocityPredictor, solve,
  marchTicksOf, turretTurnTicksOf, type PosePredictor, type SolverShooter,
} from "./solution.js";
import { turretRestored } from "./turret-restored.fixture.js";

beforeEach(() => installMode(turretRestored(modeConfigOf(DEFAULT_GAME_MODE))));

/**
 * The default bundle with `roadblock`'s `turret` removed. The fixed-muzzle cases below test how the
 * solver handles A fixed muzzle, not which shipped rows have one: `roadblock` became a turret row in
 * the 2026-10-08 turret decoupling, and every remaining fixed-muzzle projectile is a multi-pellet fan
 * that would invalidate P48's hand-measured edge. Deleting the field is the only way to drop an
 * optional row field, so the row is otherwise exactly the shipped one.
 */
function withFixedMuzzleRoadblock(): ModeConfig {
  const base = turretRestored(modeConfigOf(DEFAULT_GAME_MODE));
  const tables = structuredClone(base) as ModeTables & { weapons: Record<string, { turret?: unknown }> };
  delete tables.weapons.roadblock!.turret;
  return assembleModeConfig(base.id, tables);
}
// Also installed directly, synchronously, at module scope: fixture constants below (and
// some describe bodies) read config during test COLLECTION, which happens once, before any
// beforeEach hook ever fires.
installMode(turretRestored(modeConfigOf(DEFAULT_GAME_MODE)));

const arena: BotArenaView = { width: 1280, height: 720, obstacles: [] };

function slotFor(weaponId: Parameters<typeof weaponDefOf>[0]): BotSlotView {
  return {
    weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
    range: weaponDefOf(weaponId).range,
  };
}

function shooterAt(x: number, y: number, angle: number): SolverShooter {
  return {
    sessionId: "me", carId: "bullseye", team: 0, x, y, angle, vx: 0, vy: 0,
  };
}

function targetAt(x: number, y: number, angle = Math.PI, speed = 0): BotCarView {
  return {
    sessionId: "them", carId: "mirage", team: 1, x, y, angle,
    // The `speed` ARGUMENT stays a scalar along the heading — that is what every caller below
    // means by it, and keeping it spares them all a rewrite. The car-physics rework made the view
    // itself carry a world velocity, so the conversion happens here, once, instead of at each site.
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    hp: 70, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0,
  };
}

describe("AIM_QUADRATURE", () => {
  it("is a normalised weighting, so hitChance cannot exceed 1", () => {
    const total = AIM_QUADRATURE.reduce((sum, node) => sum + node.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("is symmetric about zero, so a perfectly aimed shot is not biased to one side", () => {
    const shifted = AIM_QUADRATURE.reduce((sum, node) => sum + node.z * node.weight, 0);
    expect(shifted).toBeCloseTo(0, 9);
  });
});

describe("solve — projectile", () => {
  it("is near certain against a stationary target dead ahead with perfect hands", () => {
    const target = targetAt(400, 0);
    const solution = solve({
      shooter: shooterAt(0, 0, 0),
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBeGreaterThan(0.95);
  });

  it("is near zero when a fixed muzzle is pointed 90 degrees away", () => {
    installMode(withFixedMuzzleRoadblock());
    // `roadblock`, not `predator`: predator is a turret row now (TR26), and a turret aims by
    // bearing — see "solve — turret" below for what the same geometry reads there.
    const target = targetAt(400, 0);
    const solution = solve({
      shooter: { ...shooterAt(0, 0, Math.PI / 2), carId: "bastion" },
      slot: slotFor("roadblock"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBeLessThan(0.05);
  });

  it("falls off with distance for the same shaky hands, because the target subtends less", () => {
    const near = targetAt(200, 0);
    const far = targetAt(800, 0);
    const at = (target: BotCarView) => solve({
      shooter: shooterAt(0, 0, 0),
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0.05, tick: 0, arena,
    }).hitChance;
    expect(at(near)).toBeGreaterThan(at(far));
  });

  it("reports 0 beyond the weapon's reach rather than a small number", () => {
    const target = targetAt(3000, 0);
    const solution = solve({
      shooter: shooterAt(0, 0, 0),
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBe(0);
    expect(solution.value).toBe(0);
  });

  it("values a shot per second of gun time, not per press (P14)", () => {
    const target = targetAt(300, 0);
    const common = {
      shooter: shooterAt(0, 0, 0), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    };
    // predator: 30 damage on a 1000 ms cooldown. pepperbox: 45 per pellet on 1800 ms.
    const predator = solve({ ...common, slot: slotFor("predator") });
    expect(predator.value).toBeCloseTo(predator.expectedDamage / 1, 5);
  });
});

describe("solve — pellet fan", () => {
  it("counts more than one pellet's damage on a close target (P10)", () => {
    const target = targetAt(120, 0);
    const solution = solve({
      shooter: shooterAt(0, 0, 0),
      slot: slotFor("pepperbox"), slotIndex: 1,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    // 45 per pellet. A centred close fan puts at least two on the hull.
    expect(solution.expectedDamage).toBeGreaterThan(45);
  });
});

describe("solve — ticking beam", () => {
  it("counts repeated pulses, not one (P10)", () => {
    // Off the origin corner deliberately (unlike every other case in this file): a beam's `extent`
    // is capped by `wallClipDistance`, and `pointOutsideBounds` treats `y <= 0` as already outside
    // the arena (`sim/collide.ts`). At y=0 the cap latches at 0 forever and the beam never reaches
    // the target, which is an artifact of the shooter sitting exactly on the boundary edge — a pose
    // no car ever actually occupies — not a real gap in pulse counting. Projectile-only cases in
    // this file never touch `wallClipDistance`, so they are unaffected and keep y=0.
    const shooter = shooterAt(0, 300, 0);
    const target = targetAt(150, 300);
    const solution = solve({
      shooter,
      slot: slotFor("afterburner"), slotIndex: 2,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    // 49 per pulse; a target parked in the cone takes several.
    expect(solution.expectedDamage).toBeGreaterThan(49);
  });
});

describe("solve — a polygon boundary, not the bare width/height rectangle", () => {
  // A square with ONE corner chamfered off by the line x + y = 500 (same shape `arena-01`'s eight
  // corners use, isolated to one edge so the geometry is easy to hand-check). `BotArenaView` has no
  // `boundary` field — only `boundsOf` output does — so this is built the same way `bot/view.ts`
  // must build the real one: run a `{width, height, boundary}` shape through `boundsOf` once and
  // carry only its `.planes` on the view.
  const chamferedArena: BotArenaView = {
    width: 2000,
    height: 2000,
    obstacles: [],
    planes: boundsOf({
      width: 2000,
      height: 2000,
      boundary: [
        { x: 500, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }, { x: 0, y: 500 },
      ],
    }).planes,
  };
  // The straight line from (700, 700) through the cut corner crosses the chamfer (x + y = 500) at
  // (250, 250) — about 636 units out. The target below sits at (100, 100), about 849 units out: past
  // the chamfer, but still inside the rectangle `0,0 -> 2000,2000` (whose own edge, at (0, 0), is
  // about 990 units out). A solver that reads the polygon stops the beam at the chamfer and the shot
  // never lands; a solver that silently fell back to the bare rectangle would let it through.
  const shooter = shooterAt(700, 700, Math.atan2(-1, -1));
  const target = targetAt(100, 100);

  it("clips a beam at the chamfer instead of letting it reach through the cut corner", () => {
    // Regression target: the marches (`marchProjectile`, `marchBeam`) must build their `Bounds`
    // from `arena.planes` directly, NOT
    // `boundsOf(arena)`. `arena` here is a `BotArenaView`, which has no `boundary` field — feeding
    // it to `boundsOf` always silently returns the bare rectangle, no matter what `planes` the view
    // actually carries, and this shot would then reach straight through the chamfer below.
    const solution = solve({
      shooter,
      slot: slotFor("lance"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena: chamferedArena,
    });
    expect(solution.hitChance).toBe(0);
    expect(solution.expectedDamage).toBe(0);
  });

  it("ground truth: the same shot connects when the arena really is the bare rectangle", () => {
    const rectangleOnly: BotArenaView = { width: 2000, height: 2000, obstacles: [] };
    const solution = solve({
      shooter,
      slot: slotFor("lance"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena: rectangleOnly,
    });
    expect(solution.hitChance).toBeGreaterThan(0.99);
    expect(solution.expectedDamage).toBeGreaterThan(0);
  });
});

describe("solve — maneuver", () => {
  it("gives wildcharge a real solution at contact range, so the bot can press it (P11)", () => {
    const target = targetAt(120, 300);
    const solution = solve({
      shooter: { ...shooterAt(0, 300, 0), carId: "bastion" },
      slot: slotFor("wildcharge"), slotIndex: 2,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBeGreaterThan(0.5);
    expect(solution.expectedDamage).toBeGreaterThan(0);
  });

  it("gives it nothing across the arena", () => {
    const target = targetAt(900, 300);
    const solution = solve({
      shooter: { ...shooterAt(0, 300, 0), carId: "bastion" },
      slot: slotFor("wildcharge"), slotIndex: 2,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBe(0);
  });
});

describe("solve — explosion", () => {
  // CONTROLLER RULING R3: this replaces the brief's original "near miss" test. That test placed
  // the target laterally offset (300, 40) and asserted the splash still landed, on the premise that
  // a shell "detonates beside the target at closest approach" on a near miss. That premise is
  // physically wrong: a projectile's `instanceExpired` is `distance >= def.range`, and magmablast's
  // range is 900 — a shell that misses the target does NOT detonate beside it, it keeps flying to
  // 900 units and detonates there, far away from a target at 300-340 units out. The real, observable
  // consequence of magmablast's explosion (see `splashAt`'s doc comment in solution.ts) is instead
  // that a DIRECT hit deals more than the row's base damage, because the target is standing inside
  // its own 60-unit blast when the shell connects. Do not reinstate the near-miss version.
  it("credits magmablast's own blast on a direct hit (P12)", () => {
    const target = targetAt(300, 300);
    const solution = solve({
      shooter: { ...shooterAt(0, 300, 0), carId: "mirage" },
      slot: slotFor("magmablast"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    // 50 base (packages/shared/src/config/weapon-config.ts): a direct hit also detonates the
    // shell's own 15-damage blast on the same target, standing inside its own 60u radius.
    expect(solution.expectedDamage).toBeGreaterThan(weaponDefOf("magmablast").damage);
  });
});

describe("solve — nose, not bearing", () => {
  it("prices every weapon through the shooter's own aim error, off-nose included", () => {
    installMode(withFixedMuzzleRoadblock());
    // Was "solve — aim assist": `predator` held a live lock used to be steered onto the bearing
    // with sigma forced to 0, so an off-nose shot read as near certain. Nothing steers a shot now,
    // so a shooter aimed off a target 300 units away must read as a likely miss, and the same
    // shooter pointed AT it must read as a likely hit. That pair is the regression guard.
    //
    // A FIXED muzzle (`roadblock`, 0.4 rad off — its 120-unit bar still clips a hull 0.25 rad off at
    // this range). A turret is the one case where the nose genuinely does not matter, and its half
    // of the pair is the second case below.
    const target = targetAt(300, 300);
    const common = {
      slot: slotFor("roadblock"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    };
    const offNose = solve({ shooter: { ...shooterAt(0, 300, 0.4), carId: "bastion" }, ...common });
    const onNose = solve({ shooter: { ...shooterAt(0, 300, 0), carId: "bastion" }, ...common });
    expect(onNose.hitChance).toBeGreaterThan(0.9);
    expect(offNose.hitChance).toBeLessThan(onNose.hitChance);
  });

  it("does not care where the nose points for a turret weapon (TR26)", () => {
    const target = targetAt(300, 300);
    const common = {
      // `basic-attack-bullseye`, not `predator`: `development/main` returned `predator`,
      // `magmablast` and `thumper` to fixed muzzles when the basic attack went off, leaving the nine
      // `basic-attack-*` rows as the table's only `turret` carriers. `solve` reads the ROW, never a
      // fire slot, so `slots().basicAttackEnabled` does not reach it and this still measures the
      // real bearing branch.
      slot: slotFor("basic-attack-bullseye"), slotIndex: 1,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    };
    const offNose = solve({ shooter: shooterAt(0, 300, 0.25), ...common });
    const onNose = solve({ shooter: shooterAt(0, 300, 0), ...common });
    expect(onNose.hitChance).toBeGreaterThan(0.9);
    expect(offNose.hitChance).toBeGreaterThan(0.9);
  });
});

describe("solve — turret (TR26)", () => {
  // A turret that takes time to swing: whether the default mode hides its turret (and so turns it
  // instantly) is that mode's choice, and these cases budget a real turn.
  // The bearings below sit up to 90 degrees off the nose, outside the shipped swing arc
  // (`turret.maxSwingDeg`); an unrestricted arc keeps these about the bearing and lead maths, not
  // the clamp.
  beforeEach(() =>
    installMode(
      applyOverrides(turretRestored(modeConfigOf(DEFAULT_GAME_MODE)), { "turret.visible": true, "turret.maxSwingDeg": 360 }),
    ),
  );

  // Mirage's own BASIC ATTACK, a turret row (`WeaponDef.turret`), so the shot leaves the pivot along
  // a bearing rather than the nose. `magmablast` played this part until `development/main` returned
  // it to a fixed muzzle; the nine `basic-attack-*` rows are the table's only turret carriers now,
  // and `solve` reads the row rather than a fire slot, so the disabled basic-attack SLOT is
  // irrelevant here. Mirage's mount is the hull centre today, but the assertions go through
  // `turretPivotOf` so a moved mount cannot make them pass by coincidence.
  const TURRET_ROW = "basic-attack-mirage" as const;
  const shooter: SolverShooter = { ...shooterAt(300, 100, 0), carId: "mirage" };
  const pivot = turretPivotOf(shooter, shooter.carId);

  it("aims a stationary target 90 degrees off the nose by bearing, from the pivot", () => {
    const target = targetAt(300, 500);
    const solution = solve({
      shooter, slot: slotFor(TURRET_ROW), slotIndex: 1,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBeGreaterThan(0.95);
    expect(solution.turretBearingRad).toBeDefined();
    expect(Math.abs(solution.turretBearingRad! - Math.atan2(500 - pivot.y, 300 - pivot.x)))
      .toBeLessThan(1e-3);
  });

  it("leads a crossing target, budgeting the turret's turn into the time to impact", () => {
    // Crossing left to right at 150 u/s, 400 units off the shooter's left flank.
    const target = targetAt(250, 500, 0, 150);
    const predictor = constantVelocityPredictor(target);
    const solution = solve({
      shooter, slot: slotFor(TURRET_ROW), slotIndex: 1,
      target, targetAt: predictor,
      aimSigmaRad: 0, tick: 0, arena,
    });
    const bearing = solution.turretBearingRad!;
    // It leads: not the bearing to where the target is now.
    expect(Math.abs(bearing - Math.atan2(500 - pivot.y, 250 - pivot.x))).toBeGreaterThan(0.05);
    expect(solution.hitChance).toBeGreaterThan(0.95);

    // A real shot along that bearing, fired once the turret has turned, lands on the hull where the
    // target will be by then.
    const turnTicks = Math.abs(wrapAngle(bearing - (shooter.angle + 0))) / TURRET_TICKS.turnPerTick;
    expect(turnTicks).toBeGreaterThan(1);
    expect(firesAndConnects(TURRET_ROW, shooter, target, predictor, { bearing, delayTicks: turnTicks }))
      .toBe(true);
    // And the turn is not decoration: the same bearing, read against a target that had NOT moved
    // on during the turn, is not the solution. 400 ms late (a literal 12 ticks until the 60 Hz flip,
    // where 12 ticks is only 200 ms and the target has not yet moved off the shot's path).
    expect(firesAndConnects(TURRET_ROW, shooter, target, predictor, { bearing, delayTicks: turnTicks + msToTicks(400) }))
      .toBe(false);
  });

  it("charges no turn when the turret already points along the bearing", () => {
    const target = targetAt(250, 500, 0, 150);
    const common = {
      slot: slotFor(TURRET_ROW), slotIndex: 1,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    };
    const fromNose = solve({ shooter, ...common }).turretBearingRad!;
    const preTurned = solve({ shooter: { ...shooter, turretAngle: fromNose }, ...common }).turretBearingRad!;
    expect(turretTurnTicksOf({ ...shooter, turretAngle: fromNose }, fromNose)).toBe(0);
    // Less time to impact, so less lead: the pre-turned bearing sits closer to the target's current
    // position than the one that had to budget a quarter-turn.
    const now = Math.atan2(500 - pivot.y, 250 - pivot.x);
    expect(Math.abs(preTurned - now)).toBeLessThan(Math.abs(fromNose - now));
  });

  it("budgets no turn at all when the mode hides the turret (it snaps)", () => {
    installMode(applyOverrides(turretRestored(modeConfigOf(DEFAULT_GAME_MODE)), { "turret.visible": false }));
    expect(turretTurnTicksOf({ ...shooter, turretAngle: 0 }, Math.PI / 2)).toBe(0);
  });

  it("never solves a bearing outside the turret's swing arc (TR55)", () => {
    // Dead astern of a car facing +x, with a 180 arc (+-90): the lead is clamped to an arc edge, and
    // the shot that edge fires is judged by the ordinary march — it flies off sideways and misses.
    const target = targetAt(0, 100);
    const solution = solve({
      shooter, slot: slotFor(TURRET_ROW), slotIndex: 1,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena, maxSwingDeg: 180,
    });
    expect(solution.turretBearingRad).toBeDefined();
    expect(Math.abs(wrapAngle(solution.turretBearingRad! - shooter.angle))).toBeLessThanOrEqual(Math.PI / 2 + 1e-12);
    expect(solution.hitChance).toBeLessThan(0.05);
  });

  it("keeps a fixed muzzle bound to the nose, and reports no bearing for it", () => {
    installMode(withFixedMuzzleRoadblock());
    const target = targetAt(300, 400);
    const solution = solve({
      shooter: { ...shooterAt(300, 100, 0), carId: "bastion" },
      slot: slotFor("roadblock"), slotIndex: 2,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBeLessThan(0.05);
    expect(solution.turretBearingRad).toBeUndefined();
  });
});

describe("solver ground truth (P48)", () => {
  // THIS BLOCK IS ABOUT A FIXED MUZZLE, and it flew `predator` until TR26 made predator a turret
  // row. A turret shot is aimed AT the target by bearing, so a lateral sweep against it reads "hit"
  // at every offset on both sides and measures nothing; the heading-bound path is what these two
  // cases exist to hold honest, so they now fly `roadblock` — the roster's one single-pellet
  // fixed-muzzle projectile. The comments below keep predator's measurements as the record of what
  // was found; the turret path's own ground truth is "leads a crossing target" in "solve — turret".
  it("agrees with resolveInstanceHits about whether a fixed-muzzle shot lands", () => {
    installMode(withFixedMuzzleRoadblock());
    // Walk the target across a range of lateral offsets. For each, ask the solver with perfect
    // hands, then fire the real shot through the sim and see whether it connects. The two must
    // agree on every offset -- this is what makes the solver honest about the game rather than
    // merely self-consistent.
    //
    // Off the origin corner deliberately (unlike the "solve — projectile" block above, which keeps
    // y=0 -- see that section for why it's harmless there): this test's own fixture used to sit at
    // y=0 too, which works out fine for a non-bouncing projectile (`pointOutsideBounds` never gets
    // consulted), but it deviated from the y=300 convention the rest of the suite uses for no
    // reason worth re-deriving. y=300 keeps the geometry identical and drops that footnote.
    //
    // The offsets below mix the original coarse sweep (0, 10, ... 60 -- clearly-hits or
    // clearly-misses) with a fine pass across the actual hull boundary: the target's hull is 60x40
    // (half-height 20) and predator's hitbox adds another 6 units of `radiusAcross`, so a shot stops
    // connecting somewhere around offset 26. Sampling every 2 units through that band is what makes
    // a wrong hull, wrong hitbox, or wrong smear direction show up as a flipped verdict instead of
    // being swallowed by two samples that were never close enough to disagree.
    // The fine pass moved 12-22 -> 16-28 with the 2026-09-16 hull growth (48x32 -> 60x40): a 1-unit
    // probe over 15-35 put the last connecting offset at 25 and the first miss at 26, and the old
    // 12-22 pass then sat entirely on the hit side, bracketing the edge only by the coarse 22/30
    // pair.
    //
    // ROADBLOCK (TR26): its bar is 120 units across (`radiusAcross` 60), so the edge sits near
    // 60 + 20 = 80; a 1-unit probe over 60-100 put the last connecting offset at 79. The fine pass
    // brackets it every 2 units, for the same reason predator's did.
    const offsets = [0, 20, 40, 60, 70, 74, 76, 78, 80, 82, 84, 90, 100, 120];
    const shooter: SolverShooter = { ...shooterAt(0, 300, 0), carId: "bastion" };
    for (const offset of offsets) {
      const target = targetAt(400, 300 + offset);
      const claimed = solve({
        shooter,
        slot: slotFor("roadblock"), slotIndex: 0,
        target, targetAt: constantVelocityPredictor(target),
        aimSigmaRad: 0, tick: 0, arena,
      }).hitChance > 0.5;

      const actual = firesAndConnects("roadblock", shooter, target);
      expect(actual, `lateral offset ${offset}`).toBe(claimed);
    }
  });

  // MUTATION NOTE: the offset sweep above cannot, by construction, catch a `smear()` regression in
  // `marchOne`. Predator's capsule is 2*19 = 38 units long and the shot advances 30 units/tick, so
  // consecutive un-smeared frames already overlap by 8 units -- more than the 6-unit tapered nose
  // where a single frame's reach is narrower than its flat midsection. That 8 > 6 margin means the
  // NEXT frame always covers whatever the current one's taper missed, for every offset and every
  // shooter angle, against a stationary target -- verified empirically by sweeping ~80,000
  // (distance, offset) pairs with `smear()` deleted from `marchOne` and finding zero disagreements
  // against `resolveInstanceHits`. A stationary target genuinely cannot expose this weapon's smear.
  //
  // A MOVING target can: the target's own pose isn't smeared (only the projectile's swept path is),
  // so a target crossing the shot's corridor between two ticks can sit exactly in the gap a
  // straight per-tick check would miss while the swept quadrilateral between those two ticks still
  // clips it. This case (speed 125, closing on the shot's line from 45 units out) sits in the
  // middle of a 4-unit-wide band (offset 43-46) where deleting `smear()` flips the verdict from hit
  // to miss -- found by sweeping target speed/heading/offset/distance and picking a comfortably
  // interior point rather than an edge value.
  //
  // ROADBLOCK (TR26): same construction, re-found for the bar. Its sweep also leaves the stationary
  // edge untouched with `smear()` deleted (79 either way), so the moving case is again the one that
  // guards it. Deleting `smear()` flips the verdict across a band of offsets 110-114 at 150 u/s from
  // 100 units out (grid: distance 100-300, offset 30-140 by 2, speed 100-250); 112 is its middle.
  it("still agrees when the target is moving fast enough to cross the shot's corridor between ticks", () => {
    const shooter: SolverShooter = { ...shooterAt(0, 300, 0), carId: "bastion" };
    // Target starts 112 units above the shot's line, driving straight down into it at 150 u/s --
    // angle -90deg is both its facing and its heading, matching `constantVelocityPredictor`'s
    // straight-line assumption.
    const target = targetAt(100, 300 + 112, -Math.PI / 2, 150);
    const claimed = solve({
      shooter,
      slot: slotFor("roadblock"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    }).hitChance > 0.5;

    const actual = firesAndConnects("roadblock", shooter, target, constantVelocityPredictor(target));
    expect(actual).toBe(claimed);
    expect(actual).toBe(true); // this configuration is a genuine hit; smear is what makes it one
  });
});

/**
 * Fire one real press through the sim (`resolveInstanceHits`, the same function `runCombat` calls
 * every tick) and report whether it touches the target's hull. `targetAt` defaults to the target's
 * own constant-velocity line, mirroring what `solve` is handed in every call site above, so a
 * moving target is marched with the identical predicted pose on both sides of the comparison.
 */
function firesAndConnects(
  weaponId: Parameters<typeof weaponDefOf>[0],
  shooter: SolverShooter,
  target: BotCarView,
  targetAt: PosePredictor = constantVelocityPredictor(target),
  // A turret press: the shot leaves along `bearing`, `delayTicks` after the press (the turn).
  turret?: { bearing: number; delayTicks: number },
): boolean {
  const delay = turret?.delayTicks ?? 0;
  const { instances } = spawnInstances(
    {
      weaponId, slot: 0, finalVolley: true, pressId: "truth",
      ...(turret ? { bearing: turret.bearing } : {}),
    },
    {
      sessionId: shooter.sessionId, team: shooter.team, carId: shooter.carId,
      x: shooter.x, y: shooter.y, angle: shooter.angle,
    },
    0, 0,
  );
  const def = weaponDefOf(weaponId);
  if (def.kind !== "projectile") throw new Error("helper handles projectiles only");

  for (const start of instances) {
    let instance = start;
    for (let tick = 1; tick <= 120; tick++) {
      const stepped = stepInstance(instance, {
        dt: 1 / TICK_RATE_HZ, tick,
        obstacles: arena.obstacles,
        bounds: { width: arena.width, height: arena.height },
        ownerPose: { x: shooter.x, y: shooter.y, angle: shooter.angle },
        homingTarget: { x: target.x, y: target.y },
      });
      const pose = targetAt(tick + delay);
      // A snapshot of one car, sorted trivially (a single entry needs no real sort) -- the same
      // shape `runCombat` builds from every living fighter each tick (`sim/combat.ts`).
      const snapshot: PoseSnapshot = [
        { sessionId: target.sessionId, team: target.team, hull: carHullOf(pose.x, pose.y, pose.angle) },
      ];
      // `mode: "ffa"` matches this file's fixtures (`shooter.team` 0, `target.team` 1, and
      // `canDamage` treats any two different ids as damageable in ffa regardless of team) --
      // `tick` starts the damage clock empty, and `pierceLeft`/`isExplosion` bookkeeping this
      // function does more than a boolean hit test needs is simply along for the ride.
      const outcome = resolveInstanceHits(stepped, instance, snapshot, "ffa", tick);
      if (outcome.damaged.length > 0) return true;
      instance = outcome.instance;
      if (instanceExpired(instance, tick)) break;
    }
  }
  return false;
}

describe("solver determinism (P43)", () => {
  it("draws no random numbers at all", () => {
    const target = targetAt(400, 0);
    const throwing = () => {
      throw new Error("the solver must not draw rng (P43)");
    };
    // The solver takes no rng parameter by design; this guards against one being threaded in
    // later, and against a helper reaching for Math.random.
    const original = Math.random;
    Math.random = throwing as unknown as typeof Math.random;
    try {
      expect(() => solve({
        shooter: shooterAt(0, 0, 0),
        slot: slotFor("predator"), slotIndex: 0,
        target, targetAt: constantVelocityPredictor(target),
        aimSigmaRad: 0.05, tick: 0, arena,
      })).not.toThrow();
    } finally {
      Math.random = original;
    }
  });

  it("returns identical results for identical inputs", () => {
    const target = targetAt(400, 25);
    const once = () => solve({
      shooter: shooterAt(0, 0, 0.1),
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0.05, tick: 0, arena,
    });
    expect(once()).toEqual(once());
  });
});

describe("marchTicksOf", () => {
  it("walks every row at least as long as that row can live, under the active mode", () => {
    // The typed 120-tick cap this replaced was 2 s at 60 Hz, under thumper's 2900 ms lifetime.
    for (const id of Object.keys(weapons()) as WeaponId[]) {
      const t = weaponTicksOf(id);
      expect(marchTicksOf(id), id).toBeGreaterThan(t.projectileLifetime);
      expect(marchTicksOf(id), id).toBeGreaterThan(t.flight + t.lifetime);
    }
    expect(marchTicksOf("thumper")).toBeGreaterThan(msToTicks(2900));
  });
});
