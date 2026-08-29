import { describe, expect, it } from "vitest";
import { ARENA_01 } from "../arena/arena-01.js";
import { hpOf } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { CarId } from "../config/types.js";
import { WEAPON_TABLE } from "../config/weapon-config.js";
import { MS_PER_TICK } from "../constants.js";
import {
  aimAngleFor,
  runCombat,
  type CombatInput,
  type CombatPlayer,
  type CombatResult,
  type CombatWorld,
} from "./combat.js";
import { carHullOf } from "./context.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import { weaponDamageOf } from "./damage.js";
import { newFireState } from "./weapons/fire.js";
import type { WeaponInstance } from "./weapons/instances.js";
import { muzzleOf, newLockState } from "./weapons/lock.js";
import { stepSim } from "./step.js";
import type { SimBody } from "./step.js";
import type { InputMessage } from "../net/input.js";

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
  const carId = over.carId ?? "rectangle";
  return {
    sessionId,
    x: 400,
    y: OPEN_Y,
    angle: 0,
    team: 0,
    carId,
    hp: hpOf("rectangle"),
    alive: true,
    inRoster: true,
    fireMask: 0,
    fireState: newFireState(carId as CarId | "", 1),
    lock: newLockState(),
    statuses: [],
    ...over,
  };
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
      carId: "rectangle",
      hp: hpOf("rectangle"),
      alive: true,
      inRoster: true,
      fireMask: 0,
      fireState: newFireState("rectangle", 1),
      lock: newLockState(),
      statuses: [],
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
    expect(result.instances[0]!.weaponId).toBe("fireball");
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
        ...newFireState("rectangle", 1),
        pending: { weaponId: "fireball", slot: 0, shotsLeft: 2, nextShotTick: 100 },
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
    // No beam weapon ships in WEAPON_TABLE yet, so this hand-builds instances directly rather than
    // going through `spawnInstances` — `runCombat`'s ownership gate reads only `instance.attached`
    // and `instance.ownerSessionId`, not the weapon's own `kind`, so this still exercises the real
    // code path.
    const attachedBeam: WeaponInstance = {
      id: "beam-1",
      ownerSessionId: "aaa",
      ownerTeam: 0,
      damage: weaponDamageOf("rectangle", "fireball"),
      weaponId: "fireball",
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

  it("still lands the migrated fireball's damage on a car in front", () => {
    const shooter = player({ sessionId: "aaa", x: 300, fireMask: 0b001 });
    // A fresh press spawns its instance at the muzzle and is hit-tested THIS tick, without a tick of
    // travel — so a same-tick hit is necessarily point-blank. `fireball`'s hitbox is a 12-unit-radius
    // circle centred on the shooter's own hull edge, so it reaches 12 units past that edge; 50.5
    // leaves the hulls 2.5 units apart, well inside that reach. Shrinking the hitbox back below 2.5
    // would break this by making the shot miss.
    const target = player({ sessionId: "bbb", x: 300 + 50.5, fireMask: 0 });
    const result = runCombat({
      world: world(),
      players: [shooter, target],
      instances: [],
      instanceSeq: 0,
    });
    const hit = result.players.find((p) => p.sessionId === "bbb")!;
    expect(hit.hp).toBe(hpOf("rectangle") - weaponDamageOf("rectangle", "fireball"));
  });

  it("drives splinter, the table's only multi-stock weapon, through a real tick", () => {
    // Oval carries splinter, so this is now the shipped path rather than a hand-built loadout
    // proving an unreachable weapon. Kept as an explicit fixture anyway: it is the only test that
    // walks the stock mechanic through `runCombat` rather than through `FireState` literals.
    const shooter = player({
      fireMask: 0b001,
      fireState: {
        slots: [{ weaponId: "splinter", stocks: 2, rechargeEndsTick: 0, refireLockUntilTick: 0 }],
        switchLockUntilTick: 0,
        lastFiredSlot: -1,
        pending: null,
        level: 1,
      },
    });
    const result = runCombat({
      world: world(),
      players: [shooter],
      instances: [],
      instanceSeq: 0,
    });
    expect(result.instances.map((i) => i.weaponId)).toEqual(["splinter"]);

    const fired = result.players[0]!.fireState;
    expect(fired.slots[0]!.stocks).toBe(1); // one of two spent
    expect(fired.slots[0]!.rechargeEndsTick).toBe(112); // tick 100 + a 400ms cooldown == 12 ticks
    expect(fired.slots[0]!.refireLockUntilTick).toBe(104); // 130ms refire delay == 4 ticks
    expect(fired.switchLockUntilTick).toBe(100); // splinter's recoveryMs is 0 — a go-to never gates
    expect(fired.lastFiredSlot).toBe(0);
  });

  it("does not mutate the caller's players or instances", () => {
    const fireState = newFireState("rectangle", 1);
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
    damage: weaponDamageOf("rectangle", "fireball"),
    weaponId: "fireball",
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
    ...over,
  });

  it("advances a shot by one tick of travel", () => {
    const result = run({ instances: [flying()] });
    expect(result.instances[0]!.x).toBeCloseTo(400 + WEAPON_TABLE.fireball.speed * DT, 6);
  });

  it("drops a shot that has outlived its range", () => {
    const result = run({ instances: [flying({ distance: WEAPON_TABLE.fireball.range })] });
    expect(result.instances).toHaveLength(0);
  });

  it("drops a shot that flies into an obstacle", () => {
    const box = TEST_BOX;
    const justShort = box.x - WEAPON_TABLE.fireball.speed * DT + 1;
    const result = run({
      world: world({ obstacles: [box] }),
      instances: [flying({ x: justShort, y: box.y + box.h / 2 })],
    });
    expect(result.instances).toHaveLength(0);
  });

  it("drops a shot that leaves the arena", () => {
    const result = run({ instances: [flying({ x: ARENA_01.width - 1 })] });
    expect(result.instances).toHaveLength(0);
  });

  it("drops a shot that steps clean past a wall thinner than one tick of travel", () => {
    // The smear's whole reason for existing on the world test (D8): at 900 u/s a shot covers 30
    // units a tick, so a point sample at the landing position looks straight past anything thinner
    // than that. This box is 4 units thick and sits between the pre-step and post-step positions —
    // the shot is never AT it on any tick, and a point test reports a clean miss.
    const thin = { x: 700, y: 300, w: 4, h: 120 };
    const before = thin.x - 10; // one tick of travel (30 units) lands at 720, past the far face
    const result = run({
      world: world({ obstacles: [thin] }),
      instances: [flying({ x: before, y: thin.y + thin.h / 2 })],
    });
    expect(result.instances).toHaveLength(0);
  });

  it("drops a shot that lands exactly on the arena edge, as a beam clips there", () => {
    // One spelling of one rule: `pointOutsideBounds` is inclusive on every edge, so a projectile on
    // the boundary is out exactly where `wallClipDistance` already stopped a beam.
    const result = run({ instances: [flying({ x: ARENA_01.width - WEAPON_TABLE.fireball.speed * DT })] });
    expect(result.instances).toHaveLength(0);
  });
});

describe("shots landing", () => {
  /** A shot one tick of travel short of the target's centre. */
  function aimedAt(target: CombatPlayer, ownerSessionId: string, ownerTeam: 0 | 1 = 0): WeaponInstance {
    return {
      id: "p1",
      ownerSessionId,
      ownerTeam,
      damage: weaponDamageOf("rectangle", "fireball"),
      weaponId: "fireball",
      kind: "projectile",
      x: target.x - WEAPON_TABLE.fireball.speed * DT,
      y: target.y,
      angle: 0,
      extent: 0,
      spawnTick: 100,
      distance: 0,
      pierceLeft: 0,
      attached: false,
      damageClock: new Map(),
      alive: true,
    };
  }

  it("takes weapon damage off the target and spends the shot", () => {
    const target = player("b", { x: 800 });
    const result = run({
      players: [player("a"), target],
      instances: [aimedAt(target, "a")],
    });
    expect(find(result, "b").hp).toBe(hpOf("rectangle") - weaponDamageOf("rectangle", "fireball"));
    expect(result.instances).toHaveLength(0);
  });

  it("never damages the shooter", () => {
    const shooter = player("a", { x: 800 });
    const result = run({ players: [shooter], instances: [aimedAt(shooter, "a")] });
    expect(find(result, "a").hp).toBe(hpOf("rectangle"));
    expect(result.instances).toHaveLength(1);
  });

  it("passes through a teammate in team mode", () => {
    const target = player("b", { x: 800, team: 0 });
    const result = run({
      world: world({ mode: "team" }),
      players: [player("a", { team: 0 }), target],
      instances: [aimedAt(target, "a")],
    });
    expect(find(result, "b").hp).toBe(hpOf("rectangle"));
    expect(result.instances).toHaveLength(1);
  });

  it("damages an enemy in team mode", () => {
    const target = player("b", { x: 800, team: 1 });
    const result = run({
      world: world({ mode: "team" }),
      players: [player("a", { team: 0 }), target],
      instances: [aimedAt(target, "a")],
    });
    expect(find(result, "b").hp).toBe(hpOf("rectangle") - weaponDamageOf("rectangle", "fireball"));
  });

  it("damages a same-team id in ffa, where teams mean nothing", () => {
    const target = player("b", { x: 800, team: 0 });
    const result = run({
      players: [player("a", { team: 0 }), target],
      instances: [aimedAt(target, "a")],
    });
    expect(find(result, "b").hp).toBe(hpOf("rectangle") - weaponDamageOf("rectangle", "fireball"));
  });

  it("passes through a wreck rather than being spent on it", () => {
    const wreck = player("b", { x: 800, hp: 0, alive: false });
    const result = run({ players: [player("a"), wreck], instances: [aimedAt(wreck, "a")] });
    expect(result.instances).toHaveLength(1);
  });

  it("wrecks a car whose hp reaches zero", () => {
    const target = player("b", { x: 800, hp: weaponDamageOf("rectangle", "fireball") });
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
    const damaged = result.players.filter((p) => p.hp < hpOf("rectangle"));
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
          damage: weaponDamageOf("rectangle", "fireball"),
          weaponId: "fireball",
          kind: "projectile",
          x: box.x + box.w / 2 - WEAPON_TABLE.fireball.speed * DT,
          y: box.y + box.h / 2,
          angle: 0,
          extent: 0,
          spawnTick: 100,
          distance: 0,
          pierceLeft: 0,
          attached: false,
          damageClock: new Map(),
          alive: true,
        },
      ],
    });
    expect(result.instances).toHaveLength(0);
    expect(find(result, "b").hp).toBe(hpOf("rectangle"));
  });

  it("keeps a shot's damage after its owner is wrecked mid-flight", () => {
    // S8: the owner is looked up once, at spawn. A live lookup at hit time would find nothing —
    // the pose snapshot holds living fighters only — and silently fall back to a default chassis.
    const target = player("b", { x: 800 });
    const shooter = player("a", { carId: "oval", alive: false });
    const shot = { ...aimedAt(target, "a"), damage: weaponDamageOf("oval", "fireball") };
    const result = run({ players: [shooter, target], instances: [shot] });
    expect(find(result, "b").hp).toBe(hpOf("rectangle") - weaponDamageOf("oval", "fireball"));
  });
});

describe("chassis attack scales weapon damage through a real tick", () => {
  /** One shot, fired for real, from `carId` into a stationary rectangle. Returns the hp it cost. */
  const damageDealtBy = (carId: "rectangle" | "oval" | "hexagon"): number => {
    // Slot 1 is forced to fireball for every chassis, overriding `carId`'s real loadout: since Task
    // 5 the three chassis no longer share a weapon, so deriving `fireState` from
    // `newFireState(carId, 1)` would fire three DIFFERENT weapons and conflate the weapon's own
    // damage with the attack-rating scaling this test exists to isolate.
    const fireballSlot1 = {
      ...newFireState(carId, 1),
      slots: [{ weaponId: "fireball" as const, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0 }],
    };
    let state = run({
      players: [
        player("a", {
          x: 400,
          y: OPEN_Y,
          angle: 0,
          carId,
          fireMask: 1,
          fireState: fireballSlot1,
        }),
        player("b", { x: 400 + DRIVE_CONFIG.carWidth + 40, y: OPEN_Y }),
      ],
    });
    // The shot leaves the muzzle on tick 100 and covers the ~40 unit gap in about two ticks.
    // Bounded at 110, well inside fireball's 15-tick cooldown, so exactly one shot is measured.
    for (let tick = 101; tick <= 110; tick++) {
      state = run({
        world: world({ tick }),
        players: state.players,
        instances: state.instances,
        instanceSeq: state.instanceSeq,
      });
    }
    return hpOf("rectangle") - find(state, "b").hp;
  };

  it("lands a different number for each chassis firing the identical weapon", () => {
    // Spec test 5: through the real tick, not by calling damageFor. `attack` is invisible in the
    // weapon table, so this is the only place the roster's damage spread is actually observable.
    expect(damageDealtBy("rectangle")).toBe(40);
    expect(damageDealtBy("oval")).toBe(60);
    expect(damageDealtBy("hexagon")).toBe(50);
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
    carId: "rectangle" as const,
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
        player("a", { x: a.x, y: a.y, angle: 0, carId: "oval" }),
        player("b", { x: b.x, y: b.y, angle: bAngle }),
      ],
    };
  }

  it("a car driven into the back of another deals no damage", () => {
    let state = pair(0);
    for (let tick = 0; tick < 20; tick++) state = simTick(state, tick, { a: THROTTLE, b: COAST });
    expect(state.players[0]!.hp).toBe(hpOf("rectangle"));
    expect(state.players[1]!.hp).toBe(hpOf("rectangle"));
  });

  it("a head-on deals no damage to either car", () => {
    let state = pair(Math.PI);
    for (let tick = 0; tick < 20; tick++) state = simTick(state, tick, { a: THROTTLE, b: THROTTLE });
    expect(state.players[0]!.hp).toBe(hpOf("rectangle"));
    expect(state.players[1]!.hp).toBe(hpOf("rectangle"));
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
    const muzzle = muzzleOf({ sessionId: a.sessionId, team: a.team, x: a.x, y: a.y, angle: a.angle });
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
  // directly. `skewer` is Oval's slot 2 and is `usesAimAssist: false` by design rather than by
  // constraint — its range clears `AIM_CONFIG.lockRange`, so the row could have taken assist and
  // deliberately does not.

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
    // "skewer" is usesAimAssist: false and exists in WEAPON_TABLE.
    expect(aimAngleFor(a, "skewer", byId)).toBeNull();
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
    // "fireball" is usesAimAssist: true.
    expect(aimAngleFor(a, "fireball", byId)).toBeCloseTo(expected, 10);
  });
});

it("damages a target with a real attached beam fired from a real loadout, once it has grown to reach", () => {
  // afterburner is Rectangle's slot 3 and the game's first beam. Its cone is 55 degrees out to
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

  expect(result!.instances.map((i) => i.weaponId)).toEqual(["afterburner"]);
  const hit = result!.players.find((p) => p.sessionId === "bbb")!;
  // damageFrequencyMs: 200 is 6 ticks at 30 Hz; this loop only runs 3, so exactly one damage tick
  // can have landed. 26 base * scale(0.8 for Rectangle's attack 30 vs baseline 50) = 20.8, rounds
  // to 21 (weaponDamageOf, damage.ts's `damageFor`).
  expect(hit.hp).toBe(hpOf("rectangle") - weaponDamageOf("rectangle", "afterburner"));
});
