import { describe, expect, it } from "vitest";
import { ARENA_01 } from "../arena/arena-01.js";
import { CAR_TABLE, hpOf } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { CarId } from "../config/types.js";
import { WEAPON_TABLE } from "../config/weapon-config.js";
import { MS_PER_TICK, TICK_RATE_HZ } from "../constants.js";
import {
  aimAngleFor,
  dealDamageTo,
  runCombat,
  startManeuver,
  type CombatInput,
  type CombatPlayer,
  type CombatResult,
  type CombatWorld,
  type StatusRequest,
} from "./combat.js";
import { carHullOf } from "./context.js";
import { ManeuverKind } from "./maneuver.js";
import type { ManeuverWeaponDef, WeaponId } from "../config/weapon-types.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import { applyStatus } from "./status/statuses.js";
import { damageFor, weaponDamageOf } from "./damage.js";
import { newFireState } from "./weapons/fire.js";
import type { WeaponInstance } from "./weapons/instances.js";
import { muzzleOf, newLockState } from "./weapons/lock.js";
import { stepSim } from "./step.js";
import type { SimBody } from "./step.js";
import type { InputMessage } from "../net/input.js";
import { weaponTicksOf } from "../config/weapon-ticks.js";

const DT = MS_PER_TICK / 1000;

/** Open floor in arena-01: no obstacle spans y < 350. */
const OPEN_Y = 150;

/**
 * A box for the obstacle tests to fire at. Authored here rather than borrowed from `ARENA_01`,
 * which ships empty: obstacle collision is still live behaviour that other arenas rely on, and a
 * sim test should not go dark because the arena the game happens to ship was refurnished.
 * Positioned clear of the shooter at the origin end of the arena and of every wall.
 */
const TEST_BOX = { x: 600, y: 300, w: 240, h: 120 };

function world(over: Partial<CombatWorld> = {}): CombatWorld {
  return {
    tick: 100,
    dt: DT,
    mode: "ffa",
    obstacles: [],
    bounds: { width: ARENA_01.width, height: ARENA_01.height },
    ...over,
  };
}

/** Shared by every describe block below except "firing", which shadows this with its own shape. */
function player(sessionId: string, over: Partial<CombatPlayer> = {}): CombatPlayer {
  const carId = over.carId ?? "mirage";
  return {
    sessionId,
    x: 400,
    y: OPEN_Y,
    angle: 0,
    team: 0,
    carId,
    hp: hpOf("mirage"),
    alive: true,
    inRoster: true,
    fireMask: 0,
    fireState: newFireState(carId as CarId | "", 1),
    lock: newLockState(),
    statuses: [],
    maneuver: 0,
    maneuverTicksLeft: 0,
    maneuverAngle: 0,
    maneuverSpeed: 0,
    maneuverWeaponId: "" as const,
    lastDamagerSessionId: "",
    ...over,
  };
}

/** A player at a given pose, for tests that only care about position and heading. */
function playerAt(sessionId: string, x: number, y: number, angle: number): CombatPlayer {
  return player(sessionId, { x, y, angle });
}

function run(over: Partial<CombatInput> = {}): ReturnType<typeof runCombat> {
  return runCombat({
    world: world(),
    players: [],
    instances: [],
    instanceSeq: 0,
    ...over,
  });
}

function find(result: { players: CombatPlayer[] }, sessionId: string): CombatPlayer {
  const found = result.players.find((p) => p.sessionId === sessionId);
  if (!found) throw new Error(`no player ${sessionId}`);
  return found;
}

/**
 * Is the shell instance built by this file's `flying`/`aimedAt` helpers (always id "p1") gone from
 * the result? Since Task 5 (2026-09-02) any of magmablast's own removals also leaves a fresh burst
 * instance behind (spec P13), so `result.instances` is no longer necessarily empty once a hand-built
 * magmablast shell dies. Asserting on the shell's own id, rather than the array's length, keeps
 * these generic shot-removal tests about REMOVAL without re-asserting the detonation behaviour that
 * this file's own "magma blast detonation" describe block already covers.
 */
function shellGone(result: CombatResult): boolean {
  return !result.instances.some((i) => i.id === "p1");
}

describe("firing", () => {
  /**
   * Local, single-argument shape: every case here only needs one shooter with `fireMask` set (or
   * not), so overriding a bag of defaults reads better than threading a positional `sessionId`
   * through every call. Deliberately shadows the file-wide two-argument `player` above, which the
   * other describe blocks still use.
   */
  function player(over: Partial<CombatPlayer> = {}): CombatPlayer {
    return {
      sessionId: "aaa",
      x: 300,
      y: OPEN_Y,
      angle: 0,
      team: 0,
      carId: "mirage",
      hp: hpOf("mirage"),
      alive: true,
      inRoster: true,
      fireMask: 0,
      fireState: newFireState("mirage", 1),
      lock: newLockState(),
      statuses: [],
      maneuver: 0,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
      maneuverWeaponId: "" as const,
      lastDamagerSessionId: "",
      ...over,
    };
  }

  it("spawns one instance at the muzzle when slot 1 is pressed", () => {
    const result = runCombat({
      world: world(),
      players: [player({ fireMask: 0b001 })],
      instances: [],
      instanceSeq: 0,
    });
    expect(result.instances).toHaveLength(1);
    expect(result.instances[0]!.weaponId).toBe("magmablast"); // mirage's real slot 1, since the 2026-09-02 loadout swap
  });

  it("does not fire again inside the cooldown, held or tapped", () => {
    const state: CombatInput = {
      world: world(),
      players: [player({ fireMask: 0b001 })],
      instances: [],
      instanceSeq: 0,
    };
    const first = runCombat(state);
    const second = runCombat({
      world: world({ tick: 101 }),
      players: first.players.map((p) => ({ ...p, fireMask: 0b001 })),
      instances: first.instances,
      instanceSeq: first.instanceSeq,
    });
    expect(second.instances.filter((i) => i.spawnTick === 101)).toHaveLength(0);
  });

  it("fires nothing for a player with no chassis", () => {
    const result = runCombat({
      world: world(),
      players: [player({ carId: "", fireState: newFireState("", 1), fireMask: 0b001 })],
      instances: [],
      instanceSeq: 0,
    });
    expect(result.instances).toEqual([]);
  });

  it("does not fire for a player who is not on the roster", () => {
    const result = runCombat({
      world: world(),
      players: [player({ fireMask: 0b001, inRoster: false })],
      instances: [],
      instanceSeq: 0,
    });
    expect(result.instances).toEqual([]);
  });

  it("cancels a wrecked player's pending burst and kills their attached beams", () => {
    const wrecked = player({
      hp: 0,
      alive: false,
      fireState: {
        ...newFireState("mirage", 1),
        pending: { weaponId: "predator", slot: 0, shotsLeft: 2, nextShotTick: 100 },
      },
    });
    const result = runCombat({
      world: world(),
      players: [wrecked],
      instances: [],
      instanceSeq: 0,
    });
    expect(result.players[0]!.fireState.pending).toBeNull();
    expect(result.instances).toEqual([]);
  });

  it("drops an attached beam owned by a wreck but leaves an unattached instance alone", () => {
    // Hand-built instances rather than going through `spawnInstances`, so the `weaponId` here is a
    // free-standing label rather than a claim about a real chassis's loadout — `runCombat`'s
    // ownership gate reads only `instance.attached` and `instance.ownerSessionId`, not the weapon's
    // own `kind`, so this still exercises the real code path regardless of which id is stamped on.
    const attachedBeam: WeaponInstance = {
      id: "beam-1",
      ownerSessionId: "aaa",
      ownerTeam: 0,
      finalWave: true,
      damage: weaponDamageOf("mirage", "magmablast"),
      weaponId: "magmablast",
      kind: "beam",
      x: 300,
      y: OPEN_Y,
      angle: 0,
      extent: 10,
      spawnTick: 90,
      distance: 0,
      pierceLeft: 0,
      attached: true,
      damageClock: new Map(),
      alive: true,
      muzzleDir: 0,
      homingTargetId: "",
      homingUntilTick: 0,
      expiresAtTick: 0,
    };
    const inFlightShot: WeaponInstance = {
      ...attachedBeam,
      id: "shot-1",
      kind: "projectile",
      attached: false,
      x: 500,
    };
    const result = runCombat({
      world: world(),
      players: [player({ hp: 0, alive: false })],
      instances: [attachedBeam, inFlightShot],
      instanceSeq: 0,
    });
    const ids = result.instances.map((i) => i.id);
    expect(ids).not.toContain("beam-1");
    expect(ids).toContain("shot-1");
  });

  it("lands bullseye's real slot-1 predator on a car in front", () => {
    // Predator moved to Bullseye's slot 1 in the 2026-09-02 loadout swap — carId AND fireState both
    // need the override, since this file's local `player()` hardcodes both to mirage otherwise.
    const shooter = player({
      sessionId: "aaa",
      x: 300,
      carId: "bullseye",
      fireState: newFireState("bullseye", 1),
      fireMask: 0b001,
    });
    // A fresh press spawns its instance at the muzzle and is hit-tested THIS tick, without a tick of
    // travel — so a same-tick hit is necessarily point-blank. `predator`'s hitbox is a capsule whose
    // `radiusAlong` (14) reaches 14 units past the shooter's own hull edge; 50.5 leaves the hulls 2.5
    // units apart, well inside that reach. Shrinking the hitbox back below 2.5 would break this by
    // making the shot miss. The hull itself is the same size for every chassis (`carHullOf` takes no
    // `carId`), so this geometry does not move with the swap.
    const target = player({ sessionId: "bbb", x: 300 + 50.5, fireMask: 0 });
    const result = runCombat({
      world: world(),
      players: [shooter, target],
      instances: [],
      instanceSeq: 0,
    });
    const hit = result.players.find((p) => p.sessionId === "bbb")!;
    expect(hit.hp).toBe(hpOf("mirage") - weaponDamageOf("bullseye", "predator"));
  });

  // A skipped "drives needler, the table's only multi-stock weapon, through a real tick" test lived
  // here since 2026-08-30, when the 2026-08-30 tuning pass removed needler's `stock` block. The
  // 2026-09-01 overhaul then retired the `needler` id itself, so there is no longer even a
  // placeholder row this could point at end-to-end. Deleted rather than kept skipped: `StockDef`
  // keeps its hand-built coverage in `fire.test.ts` ("stocks"/"refire delay"), which is the only
  // coverage it needs while no shipped row banks stocks.

  it("does not mutate the caller's players or instances", () => {
    const fireState = newFireState("mirage", 1);
    const players = [player({ fireMask: 0b001, fireState })];
    const instances: WeaponInstance[] = [];
    runCombat({
      world: world(),
      players,
      instances,
      instanceSeq: 0,
    });
    expect(fireState.pending).toBeNull();
    expect(fireState.slots[0]!.stocks).toBe(1);
    expect(instances).toHaveLength(0);
  });
});

describe("shots in flight", () => {
  const flying = (over: Partial<WeaponInstance> = {}): WeaponInstance => ({
    id: "p1",
    ownerSessionId: "a",
    ownerTeam: 0,
    finalWave: true,
    damage: weaponDamageOf("mirage", "magmablast"),
    weaponId: "magmablast",
    kind: "projectile",
    x: 400,
    y: OPEN_Y,
    angle: 0,
    extent: 0,
    spawnTick: 100,
    distance: 0,
    pierceLeft: 0,
    attached: false,
    damageClock: new Map(),
    alive: true,
    muzzleDir: 0,
    homingTargetId: "",
    homingUntilTick: 0,
    expiresAtTick: 0,
    ...over,
  });

  it("advances a shot by one tick of travel", () => {
    const result = run({ instances: [flying()] });
    expect(result.instances[0]!.x).toBeCloseTo(400 + WEAPON_TABLE.magmablast.speed * DT, 6);
  });

  it("drops a shot that has outlived its range", () => {
    const result = run({ instances: [flying({ distance: WEAPON_TABLE.magmablast.range })] });
    expect(shellGone(result)).toBe(true);
  });

  it("drops a shot that flies into an obstacle", () => {
    const box = TEST_BOX;
    const justShort = box.x - WEAPON_TABLE.magmablast.speed * DT + 1;
    const result = run({
      world: world({ obstacles: [box] }),
      instances: [flying({ x: justShort, y: box.y + box.h / 2 })],
    });
    expect(shellGone(result)).toBe(true);
  });

  it("drops a shot that leaves the arena", () => {
    const result = run({ instances: [flying({ x: ARENA_01.width - 1 })] });
    expect(shellGone(result)).toBe(true);
  });

  it("drops a shot that steps clean past a wall thinner than one tick of travel", () => {
    // The smear's whole reason for existing on the world test (D8): at magmablast's 600 u/s a shot
    // covers 20 units a tick, so a point sample at the landing position looks straight past anything
    // thinner than that. This box is 4 units thick and sits between the pre-step and post-step
    // positions — the shot is never AT it on any tick, and a point test reports a clean miss.
    const thin = { x: 700, y: 300, w: 4, h: 120 };
    const before = thin.x - 10; // one tick of travel (20 units) lands at 710, past the far face
    const result = run({
      world: world({ obstacles: [thin] }),
      instances: [flying({ x: before, y: thin.y + thin.h / 2 })],
    });
    expect(shellGone(result)).toBe(true);
  });

  it("drops a shot that lands exactly on the arena edge, as a beam clips there", () => {
    // One spelling of one rule: `pointOutsideBounds` is inclusive on every edge, so a projectile on
    // the boundary is out exactly where `wallClipDistance` already stopped a beam.
    const result = run({ instances: [flying({ x: ARENA_01.width - WEAPON_TABLE.magmablast.speed * DT })] });
    expect(shellGone(result)).toBe(true);
  });
});

describe("shots landing", () => {
  /** A shot one tick of travel short of the target's centre. */
  function aimedAt(target: CombatPlayer, ownerSessionId: string, ownerTeam: 0 | 1 = 0): WeaponInstance {
    return {
      id: "p1",
      ownerSessionId,
      ownerTeam,
      finalWave: true,
      damage: weaponDamageOf("mirage", "magmablast"),
      weaponId: "magmablast",
      kind: "projectile",
      x: target.x - WEAPON_TABLE.magmablast.speed * DT,
      y: target.y,
      angle: 0,
      extent: 0,
      spawnTick: 100,
      distance: 0,
      pierceLeft: 0,
      attached: false,
      damageClock: new Map(),
      alive: true,
      muzzleDir: 0,
      homingTargetId: "",
      homingUntilTick: 0,
      expiresAtTick: 0,
    };
  }

  it("takes weapon damage off the target and spends the shot", () => {
    const target = player("b", { x: 800 });
    const result = run({
      players: [player("a"), target],
      instances: [aimedAt(target, "a")],
    });
    expect(find(result, "b").hp).toBe(hpOf("mirage") - weaponDamageOf("mirage", "magmablast"));
    expect(shellGone(result)).toBe(true);
  });

  it("never damages the shooter", () => {
    const shooter = player("a", { x: 800 });
    const result = run({ players: [shooter], instances: [aimedAt(shooter, "a")] });
    expect(find(result, "a").hp).toBe(hpOf("mirage"));
    expect(result.instances).toHaveLength(1);
  });

  it("passes through a teammate in team mode", () => {
    const target = player("b", { x: 800, team: 0 });
    const result = run({
      world: world({ mode: "team" }),
      players: [player("a", { team: 0 }), target],
      instances: [aimedAt(target, "a")],
    });
    expect(find(result, "b").hp).toBe(hpOf("mirage"));
    expect(result.instances).toHaveLength(1);
  });

  it("damages an enemy in team mode", () => {
    const target = player("b", { x: 800, team: 1 });
    const result = run({
      world: world({ mode: "team" }),
      players: [player("a", { team: 0 }), target],
      instances: [aimedAt(target, "a")],
    });
    expect(find(result, "b").hp).toBe(hpOf("mirage") - weaponDamageOf("mirage", "magmablast"));
  });

  it("damages a same-team id in ffa, where teams mean nothing", () => {
    const target = player("b", { x: 800, team: 0 });
    const result = run({
      players: [player("a", { team: 0 }), target],
      instances: [aimedAt(target, "a")],
    });
    expect(find(result, "b").hp).toBe(hpOf("mirage") - weaponDamageOf("mirage", "magmablast"));
  });

  it("passes through a wreck rather than being spent on it", () => {
    const wreck = player("b", { x: 800, hp: 0, alive: false });
    const result = run({ players: [player("a"), wreck], instances: [aimedAt(wreck, "a")] });
    expect(result.instances).toHaveLength(1);
  });

  it("wrecks a car whose hp reaches zero", () => {
    const target = player("b", { x: 800, hp: weaponDamageOf("mirage", "magmablast") });
    const result = run({ players: [player("a"), target], instances: [aimedAt(target, "a")] });
    expect(find(result, "b").hp).toBe(0);
    expect(find(result, "b").alive).toBe(false);
  });

  it("spends one shot on one target even when two cars overlap", () => {
    const first = player("b", { x: 800 });
    const second = player("c", { x: 800 });
    const result = run({
      players: [player("a"), first, second],
      instances: [aimedAt(first, "a")],
    });
    const damaged = result.players.filter((p) => p.hp < hpOf("mirage"));
    expect(damaged).toHaveLength(1);
    // Sorted session id order decides which, so the pick is reproducible.
    expect(damaged[0]!.sessionId).toBe("b");
  });

  it("kills a shot on the wall in front of the target rather than through it", () => {
    const box = TEST_BOX;
    const target = player("b", { x: box.x + box.w + 4, y: box.y + box.h / 2 });
    const result = run({
      world: world({ obstacles: [box] }),
      players: [player("a"), target],
      instances: [
        {
          id: "p1",
          ownerSessionId: "a",
          ownerTeam: 0,
          finalWave: true,
          damage: weaponDamageOf("mirage", "magmablast"),
          weaponId: "magmablast",
          kind: "projectile",
          x: box.x + box.w / 2 - WEAPON_TABLE.magmablast.speed * DT,
          y: box.y + box.h / 2,
          angle: 0,
          extent: 0,
          spawnTick: 100,
          distance: 0,
          pierceLeft: 0,
          attached: false,
          damageClock: new Map(),
          alive: true,
          muzzleDir: 0,
          homingTargetId: "",
          homingUntilTick: 0,
          expiresAtTick: 0,
        },
      ],
    });
    expect(shellGone(result)).toBe(true);
    expect(find(result, "b").hp).toBe(hpOf("mirage"));
  });

  it("keeps a shot's damage after its owner is wrecked mid-flight", () => {
    // S8: the owner is looked up once, at spawn. A live lookup at hit time would find nothing —
    // the pose snapshot holds living fighters only — and silently fall back to a default chassis.
    const target = player("b", { x: 800 });
    const shooter = player("a", { carId: "bullseye", alive: false });
    const shot = { ...aimedAt(target, "a"), damage: weaponDamageOf("bullseye", "magmablast") };
    const result = run({ players: [shooter, target], instances: [shot] });
    expect(find(result, "b").hp).toBe(hpOf("mirage") - weaponDamageOf("bullseye", "magmablast"));
  });
});

describe("dealDamageTo", () => {
  it("refuses hp from an invulnerable target but reports the hit", () => {
    const target = playerAt("b", 0, 0, 0);
    const before = target.hp;
    dealDamageTo(target, 40, { ...NEUTRAL_MODIFIERS, invulnerable: true }, "a");
    expect(target.hp).toBe(before);
    // No hp moved, so no kill credit either: an attacker who never scratched an armored car
    // cannot claim its later death (M5-M7 x O7).
    expect(target.lastDamagerSessionId).toBe("");
    dealDamageTo(target, 40, NEUTRAL_MODIFIERS, "a");
    expect(target.hp).toBe(before - 40);
    expect(target.lastDamagerSessionId).toBe("a");
  });

  it("still wrecks a car whose hp reaches zero while invulnerable is off", () => {
    const target = playerAt("b", 0, 0, 0);
    dealDamageTo(target, target.hp, NEUTRAL_MODIFIERS, "a");
    expect(target.hp).toBe(0);
    expect(target.alive).toBe(false);
  });
});

describe("chassis attack scales weapon damage through a real tick", () => {
  /** One shot, fired for real, from `carId` into a stationary mirage. Returns the hp it cost. */
  const damageDealtBy = (carId: "mirage" | "bullseye" | "bastion"): number => {
    // Slot 1 is forced to roadblock for every chassis, overriding `carId`'s real loadout: since
    // Task 5 the three chassis no longer share a weapon, so deriving `fireState` from
    // `newFireState(carId, 1)` would fire three DIFFERENT weapons and conflate the weapon's own
    // damage with the attack-rating scaling this test exists to isolate. `roadblock` stands in for
    // the retired `fireball` here (rule: like-for-like borrow swap) — its own real owner is
    // bastion, but this fixture forces it onto every chassis on purpose. `magmablast` no longer
    // qualifies as of this same task (2026-09-02): its splash would land on "b" a few ticks after
    // contact and add an attack-scaled number of its own, contaminating exactly the measurement
    // this test exists to isolate. `roadblock` has no explosion, no homing and no multi-pellet fan
    // to complicate a single clean hit, and its 6000ms cooldown cannot recharge inside this test's
    // 10-tick window the way magmablast's shorter one once did.
    const roadblockSlot1 = {
      ...newFireState(carId, 1),
      slots: [{ weaponId: "roadblock" as const, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0 }],
    };
    let state = run({
      players: [
        player("a", {
          x: 400,
          y: OPEN_Y,
          angle: 0,
          carId,
          fireMask: 1,
          fireState: roadblockSlot1,
        }),
        player("b", { x: 400 + DRIVE_CONFIG.carWidth + 40, y: OPEN_Y }),
      ],
    });
    // The shot leaves the muzzle on tick 100 and covers the ~40 unit gap in about two ticks.
    // Bounded at 110, well inside roadblock's 180-tick cooldown, so exactly one shot is measured.
    for (let tick = 101; tick <= 110; tick++) {
      state = run({
        world: world({ tick }),
        players: state.players,
        instances: state.instances,
        instanceSeq: state.instanceSeq,
      });
    }
    return hpOf("mirage") - find(state, "b").hp;
  };

  it("lands a different number for each chassis firing the identical weapon", () => {
    // Spec test 5: through the real tick, not by calling damageFor. `attack` is invisible in the
    // weapon table, so this is the only place the roster's damage spread is actually observable.
    // roadblock's base damage is 100, scaled by each chassis's own attack rating.
    expect(damageDealtBy("mirage")).toBe(113);
    expect(damageDealtBy("bullseye")).toBe(105);
    expect(damageDealtBy("bastion")).toBe(92);
  });
});

/**
 * Collision deals no damage. The cars still collide — `resolveWorld` shoves them apart every tick —
 * they just cost each other no hp. Driven through the real `stepSim` rather than hand-placed,
 * because that is the only way to produce the "touching at a gap of zero" state a real crash ends in.
 */
describe("collision deals no damage", () => {
  const OPEN = { width: ARENA_01.width, height: ARENA_01.height };
  const CLEAR = {
    carId: "mirage" as const,
    obstacles: [] as never[],
    bounds: OPEN,
    modifiers: NEUTRAL_MODIFIERS,
  };
  const THROTTLE: InputMessage = { seq: 1, steer: 0, throttle: 1, fireSlots: 0 };
  const COAST: InputMessage = { seq: 1, steer: 0, throttle: 0, fireSlots: 0 };

  function simTick(
    state: { a: SimBody; b: SimBody; players: CombatPlayer[] },
    tick: number,
    inputs: { a: InputMessage; b: InputMessage },
  ) {
    const a = stepSim(state.a, inputs.a, DT, {
      ...CLEAR,
      others: [carHullOf(state.b.x, state.b.y, state.b.angle)],
    });
    const b = stepSim(state.b, inputs.b, DT, {
      ...CLEAR,
      others: [carHullOf(a.x, a.y, a.angle)],
    });
    const result = runCombat({
      world: { tick, dt: DT, mode: "ffa", obstacles: [], bounds: OPEN },
      players: [
        { ...state.players[0]!, x: a.x, y: a.y, angle: a.angle },
        { ...state.players[1]!, x: b.x, y: b.y, angle: b.angle },
      ],
      instances: [],
      instanceSeq: 0,
    });
    return { a, b, players: result.players };
  }

  function pair(bAngle: number) {
    const a: SimBody = {
      x: 800,
      y: 800,
      angle: 0,
      speed: 300,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };
    const b: SimBody = {
      x: 900,
      y: 800,
      angle: bAngle,
      speed: 0,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };
    return {
      a,
      b,
      players: [
        player("a", { x: a.x, y: a.y, angle: 0, carId: "bullseye" }),
        player("b", { x: b.x, y: b.y, angle: bAngle }),
      ],
    };
  }

  it("a car driven into the back of another deals no damage", () => {
    let state = pair(0);
    for (let tick = 0; tick < 20; tick++) state = simTick(state, tick, { a: THROTTLE, b: COAST });
    expect(state.players[0]!.hp).toBe(hpOf("mirage"));
    expect(state.players[1]!.hp).toBe(hpOf("mirage"));
  });

  it("a head-on deals no damage to either car", () => {
    let state = pair(Math.PI);
    for (let tick = 0; tick < 20; tick++) state = simTick(state, tick, { a: THROTTLE, b: THROTTLE });
    expect(state.players[0]!.hp).toBe(hpOf("mirage"));
    expect(state.players[1]!.hp).toBe(hpOf("mirage"));
  });

  it("the cars still collide: contact halts the trailing car rather than letting it pass through", () => {
    let state = pair(0);
    for (let tick = 0; tick < 20; tick++) state = simTick(state, tick, { a: THROTTLE, b: COAST });
    // `resolveWorld` corrects each car against the other's pose independently, so a stationary b is
    // never itself displaced — it is `a`, driving into a car that never moves, that is held at the
    // hull boundary instead of passing through it.
    expect(state.a.x).toBeLessThan(900);
    expect(state.b.x - state.a.x).toBeGreaterThanOrEqual(DRIVE_CONFIG.carWidth - 1);
  });
});

describe("aim assist through a real tick", () => {
  it("acquires a lock without anyone firing", () => {
    // A4: the lock is ambient. The trigger fires; it never targets.
    const result = run({
      players: [
        player("a", { x: 300, y: 300, angle: 0 }),
        player("b", { x: 500, y: 300, angle: Math.PI }),
      ],
    });
    expect(find(result, "a").lock.targetSessionId).toBe("b");
  });

  it("fires at the lock now that the weapon has opted in", () => {
    // Was the zero-balance-change guard through Task 7: with `fireball` opted out, a lock changed
    // nothing about where the shot went. Task 8 flips that switch, so the shot must now leave along
    // the lock direction instead of the car's heading. "b" sits 18 degrees off the nose, well inside
    // the cone, so this fails loudly if the aim angle stops reaching an opted-in weapon.
    const a = player("a", { x: 300, y: 300, angle: 0, fireMask: 1 });
    const b = player("b", { x: 480, y: 360, angle: Math.PI });
    const result = run({ players: [a, b] });
    const shot = result.instances.find((i) => i.ownerSessionId === "a");
    expect(shot).toBeDefined();
    // The same muzzle-to-target math `aimAngleFor` uses, so this asserts the real geometry rather
    // than a hardcoded literal.
    const muzzle = muzzleOf({ x: a.x, y: a.y, angle: a.angle });
    const expectedAngle = Math.atan2(b.y - muzzle.y, b.x - muzzle.x);
    expect(shot!.angle).toBeCloseTo(expectedAngle, 6);
  });

  it("holds no lock for a wrecked owner", () => {
    const result = run({
      players: [
        player("a", { x: 300, y: 300, angle: 0, alive: false, hp: 0 }),
        player("b", { x: 500, y: 300, angle: Math.PI }),
      ],
    });
    expect(find(result, "a").lock.targetSessionId).toBe("");
  });

  it("never locks a wreck", () => {
    const result = run({
      players: [
        player("a", { x: 300, y: 300, angle: 0 }),
        player("b", { x: 500, y: 300, angle: Math.PI, alive: false, hp: 0 }),
      ],
    });
    expect(find(result, "a").lock.targetSessionId).toBe("");
  });
});

describe("aimAngleFor", () => {
  // Direct coverage of both branches of the per-weapon opt-in (A1). Deleting the `usesAimAssist`
  // check entirely still passes most other tests in this file, so these two call `aimAngleFor`
  // directly. `afterburner` is Mirage's slot 3 and holds the "off" branch: it is `usesAimAssist:
  // false` by constraint rather than by taste — an attached beam re-derives its angle from the
  // owner's pose every tick, so a lock would have nothing to decide, and the authoring guard in
  // `weapon-config.test.ts` refuses the combination outright. `skewer` used to hold this branch and
  // took the lock in T17, which is why the row named here moved.

  it("returns null for a weapon with usesAimAssist: false, even with a live lock", () => {
    const a = player("a", {
      x: 0,
      y: 0,
      angle: 0,
      lock: { ...newLockState(), targetSessionId: "b" },
    });
    const b = player("b", { x: 124, y: 100 });
    const byId = new Map([
      ["a", a],
      ["b", b],
    ]);
    // "afterburner" is usesAimAssist: false and exists in WEAPON_TABLE.
    expect(aimAngleFor(a, "afterburner", byId, () => false)).toBeNull();
  });

  it("returns the muzzle-derived bearing to the lock target for a weapon with usesAimAssist: true", () => {
    const a = player("a", {
      x: 0,
      y: 0,
      angle: 0,
      lock: { ...newLockState(), targetSessionId: "b" },
    });
    const b = player("b", { x: 124, y: 100 });
    const byId = new Map([
      ["a", a],
      ["b", b],
    ]);
    // Computed independently of `aimAngleFor`'s own expression, to pin the geometry rather than
    // re-derive it: owner is at (0, 0) facing angle 0, so the muzzle sits `muzzleOffset()` units
    // ahead along that heading. muzzleOffset() == DRIVE_CONFIG.carWidth / 2 == 48 / 2 == 24, so the
    // muzzle is at (24, 0). Target "b" is at (124, 100), so dx = 124 - 24 = 100 and dy = 100 - 0 =
    // 100. atan2(100, 100) = atan(1) = pi/4 radians (45 degrees).
    const expected = Math.PI / 4;
    // "magmablast" is usesAimAssist: true.
    expect(aimAngleFor(a, "magmablast", byId, () => false)).toBeCloseTo(expected, 10);
  });

  it("fires straight ahead when the lock sits beyond the weapon's own aimRangeUnits", () => {
    // Retention can hold a lock out to lockRange + retentionRangeUnits (460), past magmablast's 400.
    const shooter = player("a", { x: 0, y: 0, angle: 0 });
    shooter.lock = { targetSessionId: "b", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const target = player("b", { x: 430, y: 0 });
    const byId = new Map([
      ["a", shooter],
      ["b", target],
    ]);
    expect(aimAngleFor(shooter, "magmablast", byId, () => false)).toBeNull(); // 430 > 400 -> welded to heading
  });

  it("does NOT lead a moving locked target — it aims where the target is (A3)", () => {
    // The assist sets direction, never lead: a crossing target is shot at, not shot ahead of, and
    // carrying the lead stays the player's job. Aiming at a first-order intercept shipped briefly
    // and was reverted.
    const shooter = player("a", { x: 0, y: 0, angle: 0 });
    shooter.lock = { targetSessionId: "b", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const target = player("b", { x: 300, y: 0, angle: Math.PI / 2 }); // crossing at full tilt, +y
    const byId = new Map([
      ["a", shooter],
      ["b", target],
    ]);
    const aimed = aimAngleFor(shooter, "magmablast", byId, () => false)!;
    // Muzzle at x = 24, target dead ahead on the x axis: straight down the +x axis, angle 0.
    expect(aimed).toBeCloseTo(Math.atan2(0, 300 - 24), 10);
  });
});

it("damages a target with a real attached beam fired from a real loadout, once it has grown to reach", () => {
  // afterburner is Mirage's slot 3 and the game's first beam. Its cone is 55 degrees out to
  // 220 units, so a target 100 units directly ahead at angle 0 is inside it once the beam has
  // grown that far. Slot 3 is bit 2. `player` builds its fireState with `newFireState(carId, 1)`,
  // so the slot only exists because Task 5 put three weapons on the chassis — this test is
  // unreachable before that commit.
  //
  // A beam is born at extent 0 (instances.ts's `spawnInstances`) and grows by `speed * dt` per
  // tick — ~36.7 units/tick for afterburner's speed 1100 at 30 Hz — so it cannot damage anyone on
  // its own spawn tick; `runCombat`'s phase order steps an EXISTING instance's extent before new
  // ones are born, precisely so a fresh shot draws at the muzzle rather than a tick's travel
  // beyond it (combat.ts's own module comment). This drives three ticks of `runCombat`, feeding
  // each tick's returned players/instances back in as the next tick's input exactly as `stepSim`
  // does, until the beam's growing extent reaches the target's near edge:
  // muzzle at x = 300 + carWidth/2 = 324; target's near hull edge at x = 400 - carWidth/2 = 376;
  // distance 52. Extent after tick 1 (spawn) is 0; after tick 2, ~36.7 (still short); after tick 3,
  // ~73.3 (past 52) — so the first damage lands on the third call.
  let world_ = world();
  let players: CombatPlayer[] = [
    player("aaa", { x: 300, y: OPEN_Y, angle: 0, fireMask: 0b100 }),
    player("bbb", { x: 400, y: OPEN_Y }),
  ];
  let instances: readonly WeaponInstance[] = [];
  let instanceSeq = 0;
  let result: CombatResult | null = null;

  for (let i = 0; i < 3; i++) {
    result = runCombat({ world: world_, players, instances, instanceSeq });
    // Only the first tick is a press; holding the key does nothing extra here since
    // `cooldownMs: 13000` would reject a second press long before this loop ends.
    players = result.players.map((p) => (p.sessionId === "aaa" ? { ...p, fireMask: 0 } : p));
    instances = result.instances;
    instanceSeq = result.instanceSeq;
    world_ = { ...world_, tick: world_.tick + 1 };
  }

  // `muzzles: [0, 180]` (2026-09-01 overhaul) fires two mirrored cones per press, each its own
  // instance: one out the nose toward "bbb", one out the tail away from everyone. Both still exist —
  // the rear one never reaches a target and never damages anyone.
  expect(result!.instances.map((i) => i.weaponId)).toEqual(["afterburner", "afterburner"]);
  const hit = result!.players.find((p) => p.sessionId === "bbb")!;
  // damageFrequencyMs: 200 is 6 ticks at 30 Hz; this loop only runs 3, so exactly one damage tick
  // can have landed, from the forward cone alone.
  expect(hit.hp).toBe(hpOf("mirage") - weaponDamageOf("mirage", "afterburner"));
});

/**
 * `startManeuver`/`dashAngleFor` take their `ManeuverWeaponDef` as a parameter rather than reading a
 * table row, so this drives them directly against the roster's two REAL maneuver rows —
 * `thunderclap` (Mirage's dash) and `wildcharge` (Bastion's charge), both landed by the 2026-09-01
 * overhaul. Before this pass no `WEAPON_TABLE` row was `kind: "maneuver"`, so these fixtures were
 * synthetic defs spread from `fireball`; that coverage note is now obsolete — see "real-row
 * integration" below for the full `runCombat` path (press -> `beginFire` -> order ->
 * `startManeuver`) exercised end-to-end against these same two rows.
 */
describe("startManeuver", () => {
  const dashDef = WEAPON_TABLE.thunderclap as unknown as ManeuverWeaponDef;
  const chargeDef = WEAPON_TABLE.wildcharge as unknown as ManeuverWeaponDef;

  it("starts a dash toward the lock, distance = aimRangeUnits at def.speed", () => {
    const p = playerAt("a", 0, 0, 0);
    p.lock = { targetSessionId: "b", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const byId = new Map([["a", p], ["b", playerAt("b", 0, 300, 0)]]);
    startManeuver(p, dashDef, byId);
    expect(p.maneuver).toBe(ManeuverKind.DASH);
    expect(p.maneuverAngle).toBeCloseTo(Math.PI / 2); // snapped toward the target, no lead
    expect(p.maneuverSpeed).toBe(1600);
    expect(p.maneuverTicksLeft).toBe(Math.ceil((400 / 1600) * 30)); // 8 ticks
    expect(p.maneuverWeaponId).toBe(dashDef.id);
  });

  it("dashes along the heading with no lock", () => {
    const p = playerAt("a", 0, 0, 1.2);
    startManeuver(p, dashDef, new Map([["a", p]]));
    expect(p.maneuverAngle).toBeCloseTo(1.2);
  });

  it("starts a charge for its authored duration and refuses to stack maneuvers", () => {
    const p = playerAt("a", 0, 0, 0);
    startManeuver(p, chargeDef, new Map([["a", p]]));
    expect(p.maneuver).toBe(ManeuverKind.CHARGE);
    expect(p.maneuverTicksLeft).toBe(300); // msToTicks(10000)
    const before = { ...p };
    startManeuver(p, dashDef, new Map([["a", p]])); // second press mid-charge
    expect(p.maneuver).toBe(before.maneuver);
  });
});

describe("contact hits", () => {
  it("prices a contact hit like a shot: attacker's weapon and attack, target's damageTaken, applies ride it", () => {
    const attacker = player("a", { x: 0, y: 0, angle: 0, carId: "bastion" });
    const target = playerAt("b", 500, 0, 0);
    const result = runCombat({
      world: world(),
      players: [attacker, target],
      instances: [],
      instanceSeq: 0,
      contactHits: [{ attackerSessionId: "a", targetSessionId: "b", weaponId: "thumper" }],
    });
    const hit = find(result, "b");
    expect(hit.hp).toBe(hpOf("mirage") - weaponDamageOf("bastion", "thumper"));
    // thumper applies `spiked` now, not `stunned` — hard CC moved to `roadblock` in the 2026-09-01
    // redistribution (thumper is the bouncing pressure shot that spikes).
    expect(hit.statuses.some((s) => s.statusId === "spiked")).toBe(true);
  });
});

describe("stun interruption (O8)", () => {
  /** A second, uninvolved car — every case here only cares about "a". */
  const other = (): CombatPlayer => player("z", { x: 1200, y: OPEN_Y });

  /** Bullseye at the origin end of the arena, its real loadout (`lance` is slot 3). */
  const bullseyeAt = (sessionId: string, over: Partial<CombatPlayer> = {}): CombatPlayer =>
    player(sessionId, { x: 300, y: OPEN_Y, carId: "bullseye", ...over });

  /** Mirage at the origin end of the arena, its real loadout (`afterburner` is slot 3). */
  const mirageAt = (sessionId: string, over: Partial<CombatPlayer> = {}): CombatPlayer =>
    player(sessionId, { x: 300, y: OPEN_Y, carId: "mirage", ...over });

  const stunRequest = (id: string): StatusRequest[] => [
    { targetSessionId: id, statusId: "stunned", durationTicks: 14, sourceSessionId: "x" },
  ];

  /** A live weapon instance, built from the table's real numbers, owned by `ownerSessionId`. */
  function builtInstance(
    weaponId: WeaponId,
    ownerSessionId: string,
    over: Partial<WeaponInstance> = {},
  ): WeaponInstance {
    const def = WEAPON_TABLE[weaponId];
    return {
      id: `${weaponId}-${ownerSessionId}`,
      ownerSessionId,
      ownerTeam: 0,
      finalWave: true,
      damage: weaponDamageOf("mirage", weaponId),
      weaponId,
      kind: def.kind === "beam" ? "beam" : "projectile",
      x: 300,
      y: OPEN_Y,
      angle: 0,
      extent: 10,
      spawnTick: 90,
      distance: 0,
      pierceLeft: 0,
      attached: def.kind === "beam" ? def.attached : false,
      damageClock: new Map(),
      alive: true,
      muzzleDir: 0,
      homingTargetId: "",
      homingUntilTick: 0,
      expiresAtTick: 0,
      ...over,
    };
  }

  it("cancels a committed wind-up, without refunding the stock", () => {
    // Bullseye presses lance (slot 3, fireMask bit 2 == 4) on tick 100; the stun lands the same
    // tick. Lance's 700ms wind-up means `beginFire` spends the stock and schedules a shot for a
    // LATER tick, so the pending burst is still sitting there for the sweep to cancel.
    const p = bullseyeAt("a", { fireMask: 0b100 });
    const result = runCombat({
      world: world(),
      players: [p, other()],
      instances: [],
      instanceSeq: 0,
      statusRequests: stunRequest("a"),
    });
    const out = find(result, "a");
    expect(out.fireState.pending).toBeNull(); // wind-up cancelled
    expect(out.fireState.slots[2]!.stocks).toBe(0); // the press stayed spent (O14)
  });

  it("kills the stunned car's attached beams and spares detached ones", () => {
    const attached = builtInstance("afterburner", "a"); // a live attached instance owned by "a"
    // No shipped row is a detached beam any more (2026-09-01 overhaul: `lance` became attached and
    // `bulwark` retired), so this forces the instance's own `attached` field to `false` over a real
    // `lance` def — the sweep (`combat.ts`) reads `instance.attached` directly, never re-derives it
    // from `weaponDefOf`, so this still exercises the real branch (rule: def-seam synthetic, per the
    // roster cutover's test-sweep notes).
    const detached = builtInstance("lance", "a", { attached: false });
    const result = runCombat({
      world: world(),
      players: [mirageAt("a"), other()],
      instances: [attached, detached],
      instanceSeq: 2,
      statusRequests: stunRequest("a"),
    });
    const ids = result.instances.map((i) => i.weaponId);
    expect(ids).not.toContain("afterburner");
    expect(ids).toContain("lance"); // a committed detached shot persists
  });

  it("ends the stunned car's maneuver", () => {
    const p = mirageAt("a");
    p.maneuver = ManeuverKind.DASH;
    p.maneuverTicksLeft = 5;
    p.maneuverSpeed = 1600;
    p.maneuverWeaponId = "thunderclap"; // interruptible (no isUnInterruptable on the row)
    const result = runCombat({
      world: world(),
      players: [p, other()],
      instances: [],
      instanceSeq: 0,
      statusRequests: stunRequest("a"),
    });
    expect(find(result, "a").maneuver).toBe(ManeuverKind.NONE);
  });

  it("does not re-sweep a car that was already stunned", () => {
    const p = mirageAt("a");
    p.statuses = applyStatus([], "stunned", 90, 30, "x"); // stunned since tick 90, through tick 120
    p.maneuver = ManeuverKind.CHARGE;
    p.maneuverTicksLeft = 100;
    p.maneuverWeaponId = "thunderclap";
    const result = runCombat({
      world: world(), // tick 100 — still inside the existing stun's window
      players: [p, other()],
      instances: [],
      instanceSeq: 0,
    });
    expect(find(result, "a").maneuver).toBe(ManeuverKind.CHARGE);
  });

  it("a stun does not end wildcharge — the roster's isUnInterruptable exemption (O8)", () => {
    // Bastion presses wildcharge (slot 3, fireMask bit 2 == 4) on tick 100, opening the charge
    // window for real through the fire pipeline.
    const charger = player("a", { x: 300, y: OPEN_Y, carId: "bastion", fireMask: 0b100 });
    let state = runCombat({
      world: world(),
      players: [charger, other()],
      instances: [],
      instanceSeq: 0,
    });
    expect(find(state, "a").maneuver).toBe(ManeuverKind.CHARGE);

    // A second, INTERRUPTIBLE maneuver alongside it (thunderclap has no isUnInterruptable), so a
    // freshly-landing stun on tick 101 proves the sweep still runs in general — it is wildcharge's
    // own row, not some global exemption, that keeps "a" charging.
    const dasher = mirageAt("z", {
      maneuver: ManeuverKind.DASH,
      maneuverTicksLeft: 5,
      maneuverSpeed: 1600,
      maneuverWeaponId: "thunderclap",
    });
    state = runCombat({
      world: world({ tick: 101 }),
      players: [find(state, "a"), dasher],
      instances: [],
      instanceSeq: 0,
      statusRequests: [
        ...stunRequest("a"),
        { targetSessionId: "z", statusId: "stunned", durationTicks: 14, sourceSessionId: "x" },
      ],
    });
    expect(find(state, "a").maneuver).toBe(ManeuverKind.CHARGE); // isUnInterruptable holds
    expect(find(state, "z").maneuver).toBe(ManeuverKind.NONE); // the sweep still ran for "z"
  });
});

/**
 * Real-row integration for Plan 3's maneuver rows (thunderclap, wildcharge) and predator's homing,
 * through the full `runCombat` pipeline rather than through `startManeuver`/`spawnInstances` called
 * directly — the coverage `startManeuver`'s own describe block above used to note as missing until a
 * real maneuver row shipped.
 */
describe("real-row integration (2026-09-01 roster)", () => {
  it("a thunderclap press starts a dash through the real fire pipeline", () => {
    const shooter = player("a", { x: 300, y: OPEN_Y, angle: 0, carId: "mirage", fireMask: 0b010 });
    // 15 degrees off-axis, 300 units out: inside the acquisition cone (20 deg), the lateral cap
    // (300 * sin(15deg) ~= 78 <= 120) and the lock range (400) — a single tick both acquires the
    // lock and fires off it (A2's three-bound region, `lock.ts`).
    const bearing = (15 * Math.PI) / 180;
    const target = player("b", {
      x: shooter.x + 300 * Math.cos(bearing),
      y: shooter.y + 300 * Math.sin(bearing),
      angle: Math.PI,
    });
    const result = runCombat({
      world: world(),
      players: [shooter, target],
      instances: [],
      instanceSeq: 0,
    });
    const out = find(result, "a");
    expect(out.lock.targetSessionId).toBe("b"); // sanity: the lock actually acquired this tick
    expect(out.maneuver).toBe(ManeuverKind.DASH);
    expect(out.maneuverSpeed).toBe(1600);
    expect(out.maneuverTicksLeft).toBe(8); // ceil(aimRangeUnits 400 / speed 1600 * 30)
    expect(out.maneuverWeaponId).toBe("thunderclap");
    expect(out.fireState.slots[1]!.stocks).toBe(0); // the press spent its stock
    const expectedAngle = Math.atan2(target.y - shooter.y, target.x - shooter.x);
    expect(out.maneuverAngle).toBeCloseTo(expectedAngle, 6); // snapped toward the target, no lead
  });

  it("a wildcharge press opens the charge window and self-applies fortified", () => {
    const p = player("a", { x: 300, y: OPEN_Y, carId: "bastion", fireMask: 0b100 }); // slot 3
    const result = runCombat({
      world: world(),
      players: [p],
      instances: [],
      instanceSeq: 0,
    });
    const out = find(result, "a");
    expect(out.maneuver).toBe(ManeuverKind.CHARGE);
    expect(out.maneuverTicksLeft).toBe(300); // msToTicks(10000)
    expect(out.maneuverWeaponId).toBe("wildcharge");
    const fortified = out.statuses.find((s) => s.statusId === "fortified");
    expect(fortified).toBeDefined();
    // O2's early-expiry key: fortified must be traceable back to the car that opened its own window.
    expect(fortified!.sourceSessionId).toBe("a");
  });

  it("homes a proximity-acquired predator toward a moving target across real combat ticks", () => {
    // Predator moved to Bullseye's slot 1 in the 2026-09-02 loadout swap, and is `acquire:
    // "proximity"` (P1): it must NOT pre-commit to a held lock at spawn (regression covered
    // directly in "proximity homing (spec P1-P6)" above — this row previously drove the lock
    // straight into `homingTargetId` for ANY homing weapon, regardless of `acquire`). This test
    // covers the other half through the full `runCombat` pipeline: once proximity acquisition
    // sticks, steering keeps bending toward the target's LIVE pose each tick, not a pose frozen at
    // the moment it committed.
    const shooter = player("a", { x: 300, y: OPEN_Y, angle: 0, carId: "bullseye", fireMask: 0b001 });
    // Off-axis on +y, same geometry as "grabs a car that comes within acquireRadius" above: the
    // muzzle sits at x=324 and the shot closes 30u/tick, so it is not yet within the 200u bubble at
    // spawn (276u away) and commits a few ticks later — proximity, not the lock, does the finding.
    let state = runCombat({
      world: world(),
      players: [shooter, player("b", { x: 600, y: OPEN_Y + 150, angle: Math.PI })],
      instances: [],
      instanceSeq: 0,
    });
    expect(state.instances).toHaveLength(1);
    const spawned = state.instances[0]!;
    expect(spawned.weaponId).toBe("predator");
    expect(spawned.homingTargetId).toBe(""); // no pre-commit at spawn (P1/P7)

    // Step until proximity acquisition sticks. `acquireByProximity` reads the PRE-step pose each
    // tick, so the shot is checked at x=324, 354, ..., 474 before it moves each time — it clears
    // the 200u bubble (sqrt(126^2+150^2) ~= 196u) on the check at x=474, seven ticks after spawn.
    for (let i = 0; i < 6; i++) {
      state = runCombat({
        world: world({ tick: 101 + i }),
        players: state.players.map((p) => (p.sessionId === "a" ? { ...p, fireMask: 0 } : p)),
        instances: state.instances,
        instanceSeq: state.instanceSeq,
      });
    }
    const acquired = state.instances.find((i) => i.weaponId === "predator")!;
    expect(acquired.homingTargetId).toBe("b");
    const angleAtAcquire = acquired.angle;

    // `runCombat` never moves anyone itself, so the target is driven by hand — the minimum bar this
    // test needs to clear is that the shot's own angle bends across two more ticks, tracking the
    // target's LIVE pose each tick rather than the pose it had at the moment it committed.
    for (let i = 0; i < 2; i++) {
      state = runCombat({
        world: world({ tick: 107 + i }),
        players: state.players.map((p) => (p.sessionId === "b" ? { ...p, y: p.y + 60 } : p)),
        instances: state.instances,
        instanceSeq: state.instanceSeq,
      });
    }
    const homed = state.instances.find((i) => i.id === acquired.id);
    expect(homed).toBeDefined();
    // The target only ever moves further +y (never behind, never level), so the shot has to bend
    // toward a strictly LARGER angle to keep tracking it — not just "some" different angle, which a
    // sign error or an inverted turn could also satisfy.
    expect(homed!.angle).toBeGreaterThan(angleAtAcquire);
    // And the bend is bounded by the 300 deg/s clamp (P9) over the two real ticks the shot was
    // actually stepped after acquisition: `turnRateDegPerSec * dt` per tick, times 2.
    const maxTurnPerTick = (WEAPON_TABLE.predator.homing!.turnRateDegPerSec * Math.PI * DT) / 180;
    expect(homed!.angle - angleAtAcquire).toBeLessThanOrEqual(2 * maxTurnPerTick + 1e-9);
  });
});

describe("tremor (the unassigned row): presence effects", () => {
  /**
   * No chassis carries `tremor`, so the real pipeline is reached the way any authored-but-uncarried
   * row is testable: a hand-built fire state whose slot 1 holds it. `beginFire` reads the slot's
   * weapon id, not the loadout, so everything downstream of the press is the production path.
   */
  const tremorState = () => ({
    ...newFireState("mirage", 1),
    slots: [{ weaponId: "tremor" as const, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0 }],
  });

  /** One combat tick at `tick`, threading the previous result's instances and seq. */
  function step(
    tick: number,
    players: CombatPlayer[],
    prev: { instances: WeaponInstance[]; instanceSeq: number },
  ): ReturnType<typeof runCombat> {
    return runCombat({ world: world({ tick }), players, instances: prev.instances, instanceSeq: prev.instanceSeq });
  }

  it("grants fortified only while the owner stands inside their own zone, and stops refreshing on exit", () => {
    // Fire from (300, OPEN_Y) heading +x: the cone's apex sits at the nose (324) and grows +x at
    // 492 u/s — 16.4 units a tick — so the zone is ahead of the car and the owner is NOT inside it
    // at the moment of firing. Holding the buff means driving in.
    const shooter = player("a", { x: 300, fireState: tremorState(), fireMask: 0b001 });
    let result = runCombat({ world: world({ tick: 100 }), players: [shooter], instances: [], instanceSeq: 0 });
    expect(result.instances).toHaveLength(1);
    expect(find(result, "a").statuses.find((s) => s.statusId === "fortified")).toBeUndefined();

    // Parked behind the apex, the zone can grow all it likes: never inside, never fortified.
    let out = find(result, "a");
    out.fireMask = 0;
    result = step(101, [out], result);
    expect(find(result, "a").statuses.find((s) => s.statusId === "fortified")).toBeUndefined();

    // Drive into the zone (hull at 426..474, on the axis) and stay. By tick 112 the extent has
    // long covered the hull, and the application re-fires EVERY covered tick: `fortified` is
    // `refresh`, so its clock always reads <last covered tick> + 9 (msToTicks(300)).
    for (let tick = 102; tick <= 112; tick++) {
      out = find(result, "a");
      out.x = 450;
      out.fireMask = 0;
      result = step(tick, [out], result);
    }
    const held = find(result, "a").statuses.find((s) => s.statusId === "fortified");
    expect(held).toBeDefined();
    expect(held!.sourceSessionId).toBe("a");
    expect(held!.endsTick).toBe(112 + 9); // re-applied on the LAST tick inside — presence, not a one-shot

    // Step back out: the status stops being refreshed — its clock freezes where the last covered
    // tick left it, so it lapses ~0.3 s later instead of holding.
    for (let tick = 113; tick <= 115; tick++) {
      out = find(result, "a");
      out.x = 300;
      out.fireMask = 0;
      result = step(tick, [out], result);
    }
    const leaving = find(result, "a").statuses.find((s) => s.statusId === "fortified");
    expect(leaving!.endsTick).toBe(112 + 9); // unchanged: no re-apply since leaving
  });

  it("ticks 25-base damage into a standing target and holds spiked exactly while they stay", () => {
    // Mirage's 1.13x attack makes each zone tick `round(25 * 1.13)` == 28. The victim parks at
    // x=500 in the beam's path; the zone covers their hull once its extent reaches them, damages on
    // that first covered tick, then re-arms every 12 ticks (msToTicks(400)) — and `spiked` (600 ms
    // == 18 ticks, `refresh`) rides every one of those damage ticks.
    const shooter = player("a", { x: 300, fireState: tremorState(), fireMask: 0b001 });
    const victim = player("b", { x: 500, team: 1 });
    const fullHp = victim.hp;
    let result = runCombat({
      world: world({ tick: 100 }),
      players: [shooter, victim],
      instances: [],
      instanceSeq: 0,
    });

    let firstHitTick = 0;
    for (let tick = 101; tick <= 130 && firstHitTick === 0; tick++) {
      const players = result.players.map((p) => ({ ...p, fireMask: 0 }));
      result = step(tick, players, result);
      if (find(result, "b").hp < fullHp) firstHitTick = tick;
    }
    expect(firstHitTick).toBeGreaterThan(0);
    expect(find(result, "b").hp).toBe(fullHp - 28);
    const spiked = find(result, "b").statuses.find((s) => s.statusId === "spiked");
    expect(spiked).toBeDefined();
    expect(spiked!.endsTick).toBe(firstHitTick + 18);

    // Stay put through the next re-arm: a second 28 lands 12 ticks later and the slow's clock is
    // topped back up — the zone holds its grip for exactly as long as the target stands in it.
    for (let tick = firstHitTick + 1; tick <= firstHitTick + 12; tick++) {
      const players = result.players.map((p) => ({ ...p, fireMask: 0 }));
      result = step(tick, players, result);
    }
    expect(find(result, "b").hp).toBe(fullHp - 56);
    const refreshed = find(result, "b").statuses.find((s) => s.statusId === "spiked");
    expect(refreshed!.endsTick).toBe(firstHitTick + 12 + 18);
  });
});

describe("kill attribution", () => {
  const HP = hpOf("mirage");

  const combatant = (sessionId: string, over: Partial<CombatPlayer> = {}): CombatPlayer => ({
    sessionId,
    x: 400, y: 150, angle: 0,
    team: 0,
    carId: "mirage",
    hp: HP,
    alive: true,
    inRoster: true,
    fireMask: 0,
    fireState: newFireState("mirage", 1),
    lock: newLockState(),
    statuses: [],
    maneuver: 0,
    maneuverTicksLeft: 0,
    maneuverAngle: 0,
    maneuverSpeed: 0,
    maneuverWeaponId: "" as const,
    lastDamagerSessionId: "",
    ...over,
  });

  const worldAt = (tick: number): CombatWorld => ({
    tick,
    dt: 1 / TICK_RATE_HZ,
    mode: "ffa",
    obstacles: [],
    bounds: { width: 1600, height: 900 },
  });

  // Mirrors `combat-bridge.test.ts`'s `liveInstance`, parked on top of the victim so it connects.
  const shotAt = (owner: string, x: number, y: number): WeaponInstance => ({
    id: `${owner}-1`,
    ownerSessionId: owner,
    ownerTeam: 0,
    finalWave: true,
    damage: weaponDamageOf("mirage", "magmablast"),
    weaponId: "magmablast",
    kind: "projectile",
    x, y,
    angle: 0,
    extent: 0,
    spawnTick: 0,
    distance: 0,
    pierceLeft: 0,
    attached: false,
    damageClock: new Map<string, number>(),
    alive: true,
    muzzleDir: 0,
    homingTargetId: "",
    homingUntilTick: 0,
    expiresAtTick: 0,
  });

  it("records the owner of the shot that landed", () => {
    const victim = combatant("b");
    const out = runCombat({
      world: worldAt(1),
      players: [combatant("a"), victim],
      instances: [shotAt("a", victim.x, victim.y)],
      instanceSeq: 1,
    });
    const b = out.players.find((p) => p.sessionId === "b")!;
    expect(b.hp).toBeLessThan(HP);
    expect(b.lastDamagerSessionId).toBe("a");
  });

  it("overwrites, so the LAST damager wins and no ledger is needed", () => {
    const victim = combatant("c", { lastDamagerSessionId: "a" });
    const out = runCombat({
      world: worldAt(1),
      players: [combatant("b"), victim],
      instances: [shotAt("b", victim.x, victim.y)],
      instanceSeq: 1,
    });
    expect(out.players.find((p) => p.sessionId === "c")!.lastDamagerSessionId).toBe("b");
  });

  it("credits a bleed to whoever applied the status, not to the world", () => {
    // Stepped until the pulse fires, so the test does not depend on `overheated`'s authored
    // interval. (`overheated` carries the burn since the 2026-09-01 overhaul; `spiked` is a pure
    // slow now.)
    let victim = combatant("victim", {
      statuses: [{ statusId: "overheated", startTick: 0, endsTick: 300, sourceSessionId: "a" }],
    });
    for (let tick = 1; tick <= 300 && victim.hp === HP; tick++) {
      victim = runCombat({
        world: worldAt(tick),
        players: [victim],
        instances: [],
        instanceSeq: 0,
      }).players[0]!;
    }
    expect(victim.hp).toBeLessThan(HP);
    expect(victim.lastDamagerSessionId).toBe("a");
  });

  it("stays empty for a car nothing has damaged", () => {
    const out = runCombat({
      world: worldAt(1),
      players: [combatant("a"), combatant("b")],
      instances: [],
      instanceSeq: 0,
    });
    expect(out.players.every((p) => p.lastDamagerSessionId === "")).toBe(true);
  });
});

describe("spawn protection: a phased car is not a target", () => {
  // M13's central promise: "a phasing car is not present in the world. Not a collider, not a ram
  // partner, not a weapon target, not an aim-assist lock candidate." Collision and ramming were
  // provisioned by `otherCarHulls` and the ram pair list (M15); combat's half was not, which is
  // what these cases pin. Every one of them passes trivially if the target-side gates are removed,
  // so each asserts a number combat would otherwise have moved.

  /** Live for the whole of `world()`'s tick 100. `""` source: the room grants this, not a weapon. */
  const PHASED = Object.freeze({
    statusId: "phased" as const,
    startTick: 0,
    endsTick: 300,
    sourceSessionId: "",
  });

  /**
   * A shot parked on top of `(x, y)` so it connects on the tick it is fed in, modelled on the
   * kill-attribution block's `shotAt`. `thumper` rather than `magmablast` because it is the roster's
   * projectile that applies an on-hit status (`spiked`, since the 2026-09-01 redistribution), which
   * is the second half of M13's case against `damageTaken: 0` — a shot that still *connects* lands
   * its statuses whatever the number. `pierceLeft` is a field on the instance, not a lookup, so it
   * can be armed here even though `thumper`'s row authors `pierce: 0`.
   */
  const thumperAt = (owner: string, x: number, y: number, pierceLeft = 0): WeaponInstance => ({
    id: `${owner}-1`,
    ownerSessionId: owner,
    ownerTeam: 0,
    finalWave: true,
    damage: weaponDamageOf("mirage", "thumper"),
    weaponId: "thumper",
    kind: "projectile",
    x,
    y,
    angle: 0,
    extent: 0,
    spawnTick: 0,
    distance: 0,
    pierceLeft,
    attached: false,
    damageClock: new Map<string, number>(),
    alive: true,
    muzzleDir: 0,
    homingTargetId: "",
    homingUntilTick: 0,
    expiresAtTick: 0,
  });

  it("takes no damage from a shot that would otherwise land on it", () => {
    const result = run({
      players: [
        player("aaa", { x: 300, y: OPEN_Y }),
        player("bbb", { x: 500, y: OPEN_Y, statuses: [PHASED] }),
      ],
      instances: [thumperAt("aaa", 500, OPEN_Y)],
      instanceSeq: 1,
    });
    const victim = find(result, "bbb");
    expect(victim.hp).toBe(hpOf("mirage"));
    expect(victim.lastDamagerSessionId).toBe("");
  });

  it("is passed through: no pierce spent, and no on-hit status lands", () => {
    const result = run({
      players: [
        player("aaa", { x: 300, y: OPEN_Y }),
        player("bbb", { x: 500, y: OPEN_Y, statuses: [PHASED] }),
      ],
      instances: [thumperAt("aaa", 500, OPEN_Y, 1)],
      instanceSeq: 1,
    });
    // A contact would have spent the pierce; a contact with pierce already at 0 would have killed
    // the shot outright. Neither happened, so the shot never saw the car at all.
    const shot = result.instances.find((i) => i.ownerSessionId === "aaa");
    expect(shot).toBeDefined();
    expect(shot!.pierceLeft).toBe(1);
    expect(find(result, "bbb").statuses.map((s) => s.statusId)).toEqual(["phased"]);
  });

  it("is not acquired as an aim-assist lock target", () => {
    // The mirror of "never locks a wreck" above: a ghost is no more lockable than a hulk.
    const result = run({
      players: [
        player("aaa", { x: 300, y: 300, angle: 0 }),
        player("bbb", { x: 500, y: 300, angle: Math.PI, statuses: [PHASED] }),
      ],
    });
    expect(find(result, "aaa").lock.targetSessionId).toBe("");
  });

  it("stops steering a lock that was already held when it began phasing", () => {
    // Locks survive a tick past the event that invalidates them (`runCombat`'s own comment on the
    // lock phase), so the target guard inside `aimAngleFor` is what stops that one stale tick from
    // curving a shot into an untouchable car.
    const a = player("aaa", {
      x: 0,
      y: 0,
      angle: 0,
      lock: { ...newLockState(), targetSessionId: "bbb" },
    });
    const b = player("bbb", { x: 124, y: 100, statuses: [PHASED] });
    const byId = new Map([
      ["aaa", a],
      ["bbb", b],
    ]);
    const phased = (sessionId: string): boolean => sessionId === "bbb";
    expect(aimAngleFor(a, "magmablast", byId, phased)).toBeNull();
    // Same call with nobody phasing still aims, so this pins the new guard rather than a typo in
    // the lock id: muzzle at (24, 0), target at (124, 100), atan2(100, 100) = pi/4.
    expect(aimAngleFor(a, "magmablast", byId, () => false)).toBeCloseTo(Math.PI / 4, 10);
  });

  it("can still fire while phasing", () => {
    // The trap in the fix, pinned. `phased` MUST NOT be folded into `isFighting`: M23's first
    // termination condition is "the player commits a press", which requires the firing path to run
    // for a phased car. Gating the shooter side would make spawn protection unbreakable by firing
    // and silently change the state machine. Fold it in and this test goes red.
    const result = run({
      players: [player("aaa", { x: 300, y: OPEN_Y, fireMask: 1, statuses: [PHASED] })],
    });
    expect(result.instances.filter((i) => i.ownerSessionId === "aaa").length).toBeGreaterThan(0);
  });
});

describe("wall-piercing projectiles (`piercesWalls`, roadblock's row)", () => {
  const bastionAt = (sessionId: string, over: Partial<CombatPlayer> = {}): CombatPlayer =>
    player(sessionId, { carId: "bastion", fireState: newFireState("bastion", 1), ...over });

  /** Step `ticks` combat ticks forward from `state`, nobody pressing anything further. */
  function settle(state: CombatResult, over: Partial<CombatWorld>, ticks: number): CombatResult {
    for (let i = 1; i <= ticks; i++) {
      state = runCombat({
        world: world({ ...over, tick: 100 + i }),
        players: state.players.map((p) => ({ ...p, fireMask: 0 })),
        instances: state.instances,
        instanceSeq: state.instanceSeq,
      });
    }
    return state;
  }

  it("survives being born with a wingtip past the arena bounds, and still lands downrange", () => {
    // The dud from playtest: the bar reaches 60u to each side, so a car within 60u of a wall firing
    // parallel to it had the shot die in `hitsWorld` on its own spawn tick — press animation and
    // cooldown spent, nothing ever written to the schema. Roadblock is slot 2 on Bastion (0b010).
    let state = runCombat({
      world: world(),
      players: [
        bastionAt("aaa", { x: 200, y: 50, angle: 0, fireMask: 0b010 }),
        player("bbb", { x: 500, y: 50, team: 1 }),
      ],
      instances: [],
      instanceSeq: 0,
    });
    expect(state.instances).toHaveLength(1);
    state = settle(state, {}, 20); // 300u at roadblock's 20u/tick, with slack
    const hit = find(state, "bbb");
    expect(hpOf("mirage") - hit.hp).toBe(weaponDamageOf("bastion", "roadblock"));
  });

  it("passes through an interior wall and lands on the camper behind it — where magmablast dies on it", () => {
    // The design's whole point (anti-wall-camper): the bar crosses level geometry; its damage and
    // its 1 s stun land on the far side. The contrast run pins that this is roadblock's authored
    // `piercesWalls`, not a broken world test — magmablast, with no flag, still dies on the wall.
    const wall = { x: 400, y: 260, w: 60, h: 200 }; // fully covers the firing line at y=360
    const camper = player("bbb", { x: 600, y: 360, team: 1 });

    let pierced = runCombat({
      world: world({ obstacles: [wall] }),
      players: [bastionAt("aaa", { x: 200, y: 360, angle: 0, fireMask: 0b010 }), { ...camper }],
      instances: [],
      instanceSeq: 0,
    });
    pierced = settle(pierced, { obstacles: [wall] }, 25);
    const hit = find(pierced, "bbb");
    expect(hpOf("mirage") - hit.hp).toBe(weaponDamageOf("bastion", "roadblock"));
    expect(hit.statuses.some((s) => s.statusId === "stunned")).toBe(true);

    let blocked = runCombat({
      world: world({ obstacles: [wall] }),
      players: [
        player("aaa", { carId: "bullseye", fireState: newFireState("bullseye", 1), x: 200, y: 360, angle: 0, fireMask: 0b001 }),
        { ...camper },
      ],
      instances: [],
      instanceSeq: 0,
    });
    blocked = settle(blocked, { obstacles: [wall] }, 25);
    expect(find(blocked, "bbb").hp).toBe(hpOf("mirage"));
  });

  it("still dies by its own range clock, walls or no walls", () => {
    // Exempt from the world is not exempt from expiry: the flag must never mint an immortal
    // instance sliding along outside the field. 500u at 20u/tick is 25 ticks; 40 is slack.
    let state = runCombat({
      world: world(),
      players: [bastionAt("aaa", { x: 200, y: 50, angle: 0, fireMask: 0b010 })],
      instances: [],
      instanceSeq: 0,
    });
    expect(state.instances).toHaveLength(1);
    state = settle(state, {}, 40);
    expect(state.instances).toHaveLength(0);
  });
});

describe("proximity homing (spec P1-P6)", () => {
  const LIFETIME_TICKS = weaponTicksOf("predator").projectileLifetime;

  /**
   * Fire bullseye's slot 1 once and step `ticks` times, returning the last result. Predator moved
   * to Bullseye in the 2026-09-02 loadout swap (it was mirage's slot 1 before); the shooter is
   * stationary in every case here, so the acquisition geometry below — muzzle offset, 30 u/tick
   * flight, the 200u acquireRadius bubble — is unaffected by which chassis fires it (`carHullOf`
   * takes no `carId`, and `predator`'s own speed/homing numbers do not change with the swap).
   */
  function fireAndStep(bystanders: CombatPlayer[], ticks: number): CombatResult {
    let world_ = world();
    let players: CombatPlayer[] = [
      player("aaa", { x: 300, y: OPEN_Y, angle: 0, carId: "bullseye", fireMask: 0b001 }),
      ...bystanders,
    ];
    let instances: readonly WeaponInstance[] = [];
    let instanceSeq = 0;
    let result: CombatResult | null = null;
    for (let i = 0; i < ticks; i++) {
      result = runCombat({ world: world_, players, instances, instanceSeq });
      // Press on the first tick only; a held key would just be rejected by the cooldown anyway.
      players = result.players.map((p) => (p.sessionId === "aaa" ? { ...p, fireMask: 0 } : p));
      instances = result.instances;
      instanceSeq = result.instanceSeq;
      world_ = { ...world_, tick: world_.tick + 1 };
    }
    return result!;
  }

  it("does not pre-commit to a held lock at spawn (regression: acquire must gate on 'lock')", () => {
    // Bystander dead ahead at x=700, lateral offset 0: well inside the lock cone (lateralMax 120)
    // and lock range (aimRangeUnits 800), so a lock exists and aim assist succeeds on tick one —
    // this is exactly the shape of shot the old `def.homing && aim !== null` check welded to
    // `player.lock.targetSessionId` at spawn, regardless of `acquire`. The muzzle sits at x=324, so
    // the bystander at x=700 is 376u away on the spawn tick — outside the 200u proximity bubble.
    // A correct proximity weapon must NOT commit here; only `acquire: "lock"` rows may use the lock
    // at spawn, and predator is `acquire: "proximity"`.
    const spawnTick = fireAndStep([player("bbb", { x: 700, y: OPEN_Y })], 1);
    const spawnedShot = spawnTick.instances.find((i) => i.weaponId === "predator");
    expect(spawnedShot).toBeDefined();
    expect(spawnedShot!.homingTargetId).toBe(""); // no pre-commit at spawn despite the live lock
    expect(spawnedShot!.angle).toBeCloseTo(0, 5); // aim assist only set the exit angle (P7), which is 0 dead ahead

    // The same in-cone target is legitimately acquired later, once the shot's own 200u proximity
    // bubble reaches it — the sixth tick or so, same closing math as the off-axis case below.
    const later = fireAndStep([player("bbb", { x: 700, y: OPEN_Y })], 10);
    const shot = later.instances.find((i) => i.weaponId === "predator")!;
    expect(shot.homingTargetId).toBe("bbb");
  });

  it("grabs a car that comes within acquireRadius and bends toward it", () => {
    // Bystander 150u off the line: unlockable (lateralMax is 120), so only proximity can find it.
    // The shot leaves the muzzle at x=324 and covers 30u/tick, so it closes to within 200u of
    // (600, 300) around x=474 — on the sixth tick. Ten ticks leaves room to see the turn.
    const result = fireAndStep([player("bbb", { x: 600, y: OPEN_Y + 150 })], 10);
    const shot = result.instances.find((i) => i.weaponId === "predator");
    expect(shot).toBeDefined();
    expect(shot!.homingTargetId).toBe("bbb");
    // Bystander is at +y, so a shot that acquired turns to a positive angle. It launched at 0.
    expect(shot!.angle).toBeGreaterThan(0.1);
  });

  it("ignores a wreck at the same spot", () => {
    const result = fireAndStep([player("bbb", { x: 600, y: OPEN_Y + 150, alive: false })], 10);
    const shot = result.instances.find((i) => i.weaponId === "predator");
    expect(shot!.homingTargetId).toBe("");
    expect(shot!.angle).toBeCloseTo(0, 5);
  });

  it("never grabs its own shooter, whose hull the muzzle sits on", () => {
    // The shot spawns 24u from the shooter's centre — inside its own 200u bubble from tick one.
    // `canDamage` refusing the owner is the only thing stopping it homing on itself immediately.
    const result = fireAndStep([], 4);
    const shot = result.instances.find((i) => i.weaponId === "predator");
    expect(shot!.homingTargetId).toBe("");
    expect(shot!.angle).toBeCloseTo(0, 5);
  });

  it("never grabs a phased car (spawn protection, M13)", () => {
    // Same spot a live bystander would be grabbed from (see the acquisition test above) — phased
    // is what keeps it out, not distance or side. Live for the whole 10-tick run.
    const phased = [{ statusId: "phased" as const, startTick: 0, endsTick: 10_000, sourceSessionId: "" }];
    const result = fireAndStep([player("bbb", { x: 600, y: OPEN_Y + 150, statuses: phased })], 10);
    const shot = result.instances.find((i) => i.weaponId === "predator");
    expect(shot!.homingTargetId).toBe("");
    expect(shot!.angle).toBeCloseTo(0, 5);
  });

  it("takes the nearer of two eligible cars", () => {
    // Both must be within acquireRadius on the SAME tick the shot first finds either one, with
    // `far` genuinely farther — otherwise a "first eligible in scan order" implementation (`far`
    // sorts before `near` by sessionId, so it is visited first) would pass this test by accident.
    // At the qualifying tick (shot at x=474) `far` is ~197.4u out and `near` is ~195.9u out: both
    // inside the 200u bubble, `far` genuinely farther. One tick earlier (shot at x=444) `far` is
    // ~217.8u out — not yet eligible — so it cannot lock in ahead of `near` merely by arriving
    // first in iteration order.
    const result = fireAndStep(
      [
        player("far", { x: 600, y: OPEN_Y + 152 }),
        player("near", { x: 600, y: OPEN_Y + 150 }),
      ],
      10,
    );
    expect(result.instances.find((i) => i.weaponId === "predator")!.homingTargetId).toBe("near");
  });

  it("never grabs a teammate in team mode (spec P4)", () => {
    // Same spot the FFA acquisition test above grabs a bystander from (x=600, y=OPEN_Y+150) — only
    // `world.mode`/team now differ. `canDamage` refuses same-team targets outright in "team" mode,
    // so a teammate must be exactly as invisible to proximity acquisition as the shooter itself.
    let world_ = world({ mode: "team" });
    let players: CombatPlayer[] = [
      player("aaa", { x: 300, y: OPEN_Y, angle: 0, carId: "bullseye", fireMask: 0b001, team: 0 }),
      player("bbb", { x: 600, y: OPEN_Y + 150, team: 0 }),
    ];
    let instances: readonly WeaponInstance[] = [];
    let instanceSeq = 0;
    let result: CombatResult | null = null;
    for (let i = 0; i < 10; i++) {
      result = runCombat({ world: world_, players, instances, instanceSeq });
      players = result.players.map((p) => (p.sessionId === "aaa" ? { ...p, fireMask: 0 } : p));
      instances = result.instances;
      instanceSeq = result.instanceSeq;
      world_ = { ...world_, tick: world_.tick + 1 };
    }
    const shot = result!.instances.find((i) => i.weaponId === "predator");
    expect(shot!.homingTargetId).toBe("");
    expect(shot!.angle).toBeCloseTo(0, 5);
  });

  it("commits: it does not re-acquire after its target is wrecked (P5)", () => {
    // Acquire first, then wreck the target and keep stepping. The angle must freeze where it was,
    // not swing to the other car.
    let world_ = world();
    let players: CombatPlayer[] = [
      player("aaa", { x: 300, y: OPEN_Y, angle: 0, carId: "bullseye", fireMask: 0b001 }),
      player("bbb", { x: 600, y: OPEN_Y + 150 }),
      player("ccc", { x: 700, y: OPEN_Y - 150 }),
    ];
    let instances: readonly WeaponInstance[] = [];
    let instanceSeq = 0;
    let result: CombatResult | null = null;
    for (let i = 0; i < 8; i++) {
      result = runCombat({ world: world_, players, instances, instanceSeq });
      players = result.players.map((p) => (p.sessionId === "aaa" ? { ...p, fireMask: 0 } : p));
      instances = result.instances;
      instanceSeq = result.instanceSeq;
      world_ = { ...world_, tick: world_.tick + 1 };
    }
    const acquiredAngle = result!.instances.find((i) => i.weaponId === "predator")!.angle;
    expect(acquiredAngle).toBeGreaterThan(0);

    players = players.map((p) => (p.sessionId === "bbb" ? { ...p, alive: false } : p));
    for (let i = 0; i < 3; i++) {
      result = runCombat({ world: world_, players, instances, instanceSeq });
      instances = result.instances;
      instanceSeq = result.instanceSeq;
      world_ = { ...world_, tick: world_.tick + 1 };
    }
    const after = result!.instances.find((i) => i.weaponId === "predator")!;
    expect(after.homingTargetId).toBe("bbb"); // still committed to the dead one
    expect(after.angle).toBeCloseTo(acquiredAngle, 5); // flying straight from where it was
  });

  it("carries a lifetime clock even though it does not bounce (P28a/P30)", () => {
    const result = fireAndStep([], 1);
    const shot = result.instances.find((i) => i.weaponId === "predator")!;
    expect(LIFETIME_TICKS).toBeGreaterThan(0);
    expect(shot.expiresAtTick).toBe(shot.spawnTick + LIFETIME_TICKS);
  });
});

describe("magma blast detonation (spec P13-P21)", () => {
  // Magma Blast moved to Mirage's slot 1 in the 2026-09-02 loadout swap (it was Bullseye's before).
  const MIRAGE_HP = hpOf("mirage");
  const CONTACT = weaponDamageOf("mirage", "magmablast");

  function shooter(over: Partial<CombatPlayer> = {}): CombatPlayer {
    return player("aaa", { carId: "mirage", hp: MIRAGE_HP, fireState: newFireState("mirage", 1), ...over });
  }

  /** Fire mirage's slot 1 from `from` and step `ticks` times. */
  function fire(
    from: Partial<CombatPlayer>,
    others: CombatPlayer[],
    ticks: number,
    obstacles: CombatWorld["obstacles"] = [],
  ): CombatResult {
    let world_ = world({ obstacles });
    let players: CombatPlayer[] = [shooter({ ...from, fireMask: 0b001 }), ...others];
    let instances: readonly WeaponInstance[] = [];
    let instanceSeq = 0;
    let result: CombatResult | null = null;
    for (let i = 0; i < ticks; i++) {
      result = runCombat({ world: world_, players, instances, instanceSeq });
      players = result.players.map((p) => (p.sessionId === "aaa" ? { ...p, fireMask: 0 } : p));
      instances = result.instances;
      instanceSeq = result.instanceSeq;
      world_ = { ...world_, tick: world_.tick + 1 };
    }
    return result!;
  }

  const bursts = (r: CombatResult) => r.instances.filter((i) => i.isExplosion);

  it("costs a directly-hit car contact PLUS splash, and corrodes it (P16)", () => {
    // Muzzle at x=324, shell at 600 u/s = 20 u/tick, target hull's near edge at 400-24=376.
    // Contact around tick 4; one more tick for the burst to resolve.
    const result = fire(
      { x: 300, y: OPEN_Y, angle: 0 },
      [player("bbb", { x: 400, y: OPEN_Y, hp: MIRAGE_HP })],
      7,
    );
    const victim = find(result, "bbb");
    // Strictly MORE than contact alone — that difference is the splash, and it is the whole point.
    expect(victim.hp).toBeLessThan(MIRAGE_HP - CONTACT);
    expect(victim.statuses.some((s) => s.statusId === "corroded")).toBe(true);
  });

  it("spawns exactly one burst per shot, already at full extent (P13a/P15)", () => {
    const result = fire(
      { x: 300, y: OPEN_Y, angle: 0 },
      [player("bbb", { x: 400, y: OPEN_Y, hp: MIRAGE_HP })],
      6,
    );
    expect(bursts(result)).toHaveLength(1);
    // Full size on the tick it forms, not grown into over several. This is what makes the
    // direct-hit test above deterministic rather than a race with the victim driving away.
    expect(bursts(result)[0]!.extent).toBe(WEAPON_TABLE.magmablast.explosion!.radius);
    expect(bursts(result)[0]!.kind).toBe("beam");
    // Pinned exactly: the burst must cost its OWN 15-damage row through the owner's attack rating
    // (17 for mirage), never `weaponDamageOf`'s 57 (the shell's own row). A mutation that swapped
    // in the shell's damage here would otherwise slip past every other assertion in this describe —
    // P16's `toBeLessThan` only needs SOME positive splash, not the right number.
    expect(bursts(result)[0]!.damage).toBe(
      damageFor(CAR_TABLE.mirage.attack, WEAPON_TABLE.magmablast.explosion!.damage),
    );
  });

  it("expires the burst on its OWN clock, not the shell's flight-plus-lifetime (P25b)", () => {
    // A mutation that disabled the explosion-aware branch in `instanceExpired` (falling back to the
    // shell's `flight + lifetime`, 45 ticks) would leave a 1.5s field instead of the authored 150ms
    // `lingerMs` (the ~200ms `explosionLife` above is that plus the one-tick `flight`), and nothing
    // else in this file would catch it: P25a only checks that the burst eventually drains to zero,
    // not on which tick.
    const ticks = weaponTicksOf("magmablast");
    const explosionLife = ticks.explosion!.flight + ticks.explosion!.lifetime;
    // Fire, let the shell land and the burst form (6 ticks, per the test above), then run the burst
    // out past its own short clock — well short of the shell's 45-tick flight+lifetime, so a
    // regression back to that branch is the only way this could still pass.
    const result = fire(
      { x: 300, y: OPEN_Y, angle: 0 },
      [player("bbb", { x: 400, y: OPEN_Y, hp: MIRAGE_HP })],
      6 + explosionLife + 1,
    );
    expect(bursts(result)).toHaveLength(0);
  });

  it("never damages its own shooter, even detonating on its nose (P18)", () => {
    // A wall directly in front of the muzzle: the shell dies almost immediately and the 60u field
    // certainly covers the shooter. `canDamage` refusing the owner is the only thing saving them.
    const result = fire({ x: 300, y: OPEN_Y, angle: 0 }, [], 6, [
      { x: 340, y: OPEN_Y - 100, w: 40, h: 200 },
    ]);
    expect(bursts(result).length).toBeGreaterThan(0);
    expect(find(result, "aaa").hp).toBe(MIRAGE_HP);
  });

  it("detonates at the PRE-step pose on a wall, never inside it (P14)", () => {
    const box = { x: 600, y: OPEN_Y - 100, w: 240, h: 200 };
    const result = fire({ x: 300, y: OPEN_Y, angle: 0 }, [], 20, [box]);
    const burst = bursts(result)[0];
    expect(burst).toBeDefined();
    // The shell crossed into the box on the tick it died; the burst belongs on the near side.
    expect(burst!.x).toBeLessThan(box.x);
  });

  it("reaches a car on the far side of a wall, because a disc has no wall clip (P17)", () => {
    // Thin wall so the far car sits inside the 60u radius of a burst forming on the near face.
    const wall = { x: 600, y: OPEN_Y - 100, w: 20, h: 200 };
    const result = fire(
      { x: 300, y: OPEN_Y, angle: 0 },
      [player("bbb", { x: 650, y: OPEN_Y, hp: MIRAGE_HP })],
      20,
      [wall],
    );
    expect(find(result, "bbb").hp).toBeLessThan(MIRAGE_HP);
  });

  it("detonates at max range with nothing hit at all", () => {
    // No obstacles, no other cars, aimed along open floor, firing from x=100: muzzle at 124, range
    // 900 expires at x=1024 — well inside arena-01's 1280-unit width, so this is a genuine RANGE
    // kill (not a bounds kill; see the separate test below for that one).
    const ticks = weaponTicksOf("magmablast").flight + 3;
    const result = fire({ x: 100, y: OPEN_Y, angle: 0 }, [], ticks);
    expect(bursts(result)).toHaveLength(1);
  });

  it("detonates on leaving the arena, before its own range clock ever runs (P13, bounds kill)", () => {
    // Firing from x=1250 puts the muzzle at 1274, six units short of arena-01's 1280-unit edge — the
    // shell crosses the boundary in `hitsWorld` within a tick or two, nowhere near its 900u range.
    // This is the only test in the file that isolates a BOUNDS removal from a range removal: the
    // "shots in flight" describe covers `hitsWorld` generically, but converting its "leaves the
    // arena" case to `shellGone` (once magmablast started leaving a burst behind) removed the last
    // place a bounds-kill detonation was actually observed.
    const result = fire({ x: 1250, y: OPEN_Y, angle: 0 }, [], 5);
    expect(bursts(result)).toHaveLength(1);
  });

  it("does not spawn another burst when the burst itself expires (P25a)", () => {
    // THE RECURSION GUARD. If the detonation check read weaponDefOf rather than instanceDefOf, the
    // burst would see magmablast's `explosion` on its own expiry and spawn another, every tick,
    // forever. The instance list must drain to empty instead.
    const result = fire(
      { x: 300, y: OPEN_Y, angle: 0 },
      [player("bbb", { x: 400, y: OPEN_Y, hp: MIRAGE_HP })],
      60,
    );
    expect(result.instances).toHaveLength(0);
  });
});
