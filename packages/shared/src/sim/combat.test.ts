import { describe, expect, it } from "vitest";
import { ARENA_01 } from "../arena/arena-01.js";
import { CAR_TABLE, hpOf } from "../config/car-config.js";
import { COMBAT_CONFIG } from "../config/combat-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { WEAPON_CONFIG } from "../config/weapon-config.js";
import { MS_PER_TICK } from "../constants.js";
import {
  fireCooldownTicks,
  muzzleOffset,
  runCombat,
  type CombatInput,
  type CombatPlayer,
  type CombatWorld,
} from "./combat.js";
import type { Proj } from "./projectiles.js";
import { carHullOf } from "./context.js";
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
    weaponCooldown: 0,
    inRoster: true,
    fired: false,
    ...over,
  };
}

function run(over: Partial<CombatInput> = {}): ReturnType<typeof runCombat> {
  return runCombat({
    world: world(),
    players: [],
    projectiles: [],
    ramCooldowns: new Map(),
    projectileSeq: 0,
    ...over,
  });
}

function find(result: { players: CombatPlayer[] }, sessionId: string): CombatPlayer {
  const found = result.players.find((p) => p.sessionId === sessionId);
  if (!found) throw new Error(`no player ${sessionId}`);
  return found;
}

describe("firing", () => {
  it("spawns one shot at the muzzle, on the car's facing", () => {
    const result = run({ players: [player("a", { fired: true, x: 400, y: OPEN_Y, angle: 0 })] });
    expect(result.projectiles).toHaveLength(1);
    const shot = result.projectiles[0]!;
    expect(shot.x).toBeCloseTo(400 + muzzleOffset(), 6);
    expect(shot.y).toBeCloseTo(OPEN_Y, 6);
    expect(shot.angle).toBe(0);
    expect(shot.speed).toBe(WEAPON_CONFIG.projectileSpeed);
    expect(shot.ownerSessionId).toBe("a");
    expect(shot.spawnTick).toBe(100);
  });

  it("puts the shooter on cooldown", () => {
    const result = run({ players: [player("a", { fired: true })] });
    expect(find(result, "a").weaponCooldown).toBe(fireCooldownTicks());
  });

  it("gates the rate: holding fire yields one shot per cooldown, not one per tick", () => {
    let players: CombatPlayer[] = [player("a", { fired: true })];
    let projectiles: Proj[] = [];
    let seq = 0;
    let shotsFired = 0;

    for (let tick = 100; tick < 100 + fireCooldownTicks() * 3; tick++) {
      const before = projectiles.length;
      const result = runCombat({
        world: world({ tick }),
        players,
        // Only the firing behaviour is under test; shots in flight are dropped each tick so the
        // count below is "spawned this tick" rather than "still alive".
        projectiles: [],
        ramCooldowns: new Map(),
        projectileSeq: seq,
      });
      players = result.players.map((p) => ({ ...p, fired: true }));
      projectiles = result.projectiles;
      seq = result.projectileSeq;
      if (projectiles.length > before) shotsFired++;
    }

    expect(shotsFired).toBe(3);
  });

  it("gives every shot a distinct id", () => {
    const first = run({ players: [player("a", { fired: true })], projectileSeq: 0 });
    const second = run({
      players: [player("a", { fired: true })],
      projectileSeq: first.projectileSeq,
    });
    expect(second.projectiles[0]!.id).not.toBe(first.projectiles[0]!.id);
    expect(second.projectileSeq).toBe(2);
  });

  it("does not fire for a wreck", () => {
    const result = run({ players: [player("a", { fired: true, alive: false, hp: 0 })] });
    expect(result.projectiles).toHaveLength(0);
  });

  it("does not fire for a player who is not on the roster", () => {
    const result = run({ players: [player("a", { fired: true, inRoster: false })] });
    expect(result.projectiles).toHaveLength(0);
  });

  it("does not fire before the reveal, when there is no chassis yet", () => {
    const result = run({ players: [player("a", { fired: true, carId: "" })] });
    expect(result.projectiles).toHaveLength(0);
  });

  it("counts down an existing cooldown without firing", () => {
    const result = run({ players: [player("a", { fired: true, weaponCooldown: 5 })] });
    expect(result.projectiles).toHaveLength(0);
    expect(find(result, "a").weaponCooldown).toBe(4);
  });

  it("never drives the cooldown below zero", () => {
    const result = run({ players: [player("a", { weaponCooldown: 0 })] });
    expect(find(result, "a").weaponCooldown).toBe(0);
  });

  it("does not mutate the caller's players or projectiles", () => {
    const players = [player("a", { fired: true })];
    const projectiles: Proj[] = [];
    run({ players, projectiles });
    expect(players[0]!.weaponCooldown).toBe(0);
    expect(projectiles).toHaveLength(0);
  });
});

describe("shots in flight", () => {
  const flying = (over: Partial<Proj> = {}): Proj => ({
    id: "p1",
    ownerSessionId: "a",
    x: 400,
    y: OPEN_Y,
    angle: 0,
    speed: WEAPON_CONFIG.projectileSpeed,
    spawnTick: 100,
    alive: true,
    ...over,
  });

  it("advances a shot by one tick of travel", () => {
    const result = run({ projectiles: [flying()] });
    expect(result.projectiles[0]!.x).toBeCloseTo(400 + WEAPON_CONFIG.projectileSpeed * DT, 6);
  });

  it("drops a shot that has outlived its lifetime", () => {
    const result = run({
      world: world({ tick: 100 + WEAPON_CONFIG.lifetimeTicks }),
      projectiles: [flying({ spawnTick: 100 })],
    });
    expect(result.projectiles).toHaveLength(0);
  });

  it("drops a shot that flies into an obstacle", () => {
    const box = TEST_BOX;
    const justShort = box.x - WEAPON_CONFIG.projectileSpeed * DT + 1;
    const result = run({
      world: world({ obstacles: [box] }),
      projectiles: [flying({ x: justShort, y: box.y + box.h / 2 })],
    });
    expect(result.projectiles).toHaveLength(0);
  });

  it("drops a shot that leaves the arena", () => {
    const result = run({ projectiles: [flying({ x: ARENA_01.width - 1 })] });
    expect(result.projectiles).toHaveLength(0);
  });
});

describe("shots landing", () => {
  /** A shot one tick of travel short of the target's centre. */
  function aimedAt(target: CombatPlayer, ownerSessionId: string): Proj {
    return {
      id: "p1",
      ownerSessionId,
      x: target.x - WEAPON_CONFIG.projectileSpeed * DT,
      y: target.y,
      angle: 0,
      speed: WEAPON_CONFIG.projectileSpeed,
      spawnTick: 100,
      alive: true,
    };
  }

  it("takes weapon damage off the target and spends the shot", () => {
    const target = player("b", { x: 800 });
    const result = run({
      players: [player("a"), target],
      projectiles: [aimedAt(target, "a")],
    });
    expect(find(result, "b").hp).toBe(hpOf("rectangle") - WEAPON_CONFIG.damage);
    expect(result.projectiles).toHaveLength(0);
  });

  it("never damages the shooter", () => {
    const shooter = player("a", { x: 800 });
    const result = run({ players: [shooter], projectiles: [aimedAt(shooter, "a")] });
    expect(find(result, "a").hp).toBe(hpOf("rectangle"));
    expect(result.projectiles).toHaveLength(1);
  });

  it("passes through a teammate in team mode", () => {
    const target = player("b", { x: 800, team: 0 });
    const result = run({
      world: world({ mode: "team" }),
      players: [player("a", { team: 0 }), target],
      projectiles: [aimedAt(target, "a")],
    });
    expect(find(result, "b").hp).toBe(hpOf("rectangle"));
    expect(result.projectiles).toHaveLength(1);
  });

  it("damages an enemy in team mode", () => {
    const target = player("b", { x: 800, team: 1 });
    const result = run({
      world: world({ mode: "team" }),
      players: [player("a", { team: 0 }), target],
      projectiles: [aimedAt(target, "a")],
    });
    expect(find(result, "b").hp).toBe(hpOf("rectangle") - WEAPON_CONFIG.damage);
  });

  it("damages a same-team id in ffa, where teams mean nothing", () => {
    const target = player("b", { x: 800, team: 0 });
    const result = run({
      players: [player("a", { team: 0 }), target],
      projectiles: [aimedAt(target, "a")],
    });
    expect(find(result, "b").hp).toBe(hpOf("rectangle") - WEAPON_CONFIG.damage);
  });

  it("passes through a wreck rather than being spent on it", () => {
    const wreck = player("b", { x: 800, hp: 0, alive: false });
    const result = run({ players: [player("a"), wreck], projectiles: [aimedAt(wreck, "a")] });
    expect(result.projectiles).toHaveLength(1);
  });

  it("wrecks a car whose hp reaches zero", () => {
    const target = player("b", { x: 800, hp: WEAPON_CONFIG.damage });
    const result = run({ players: [player("a"), target], projectiles: [aimedAt(target, "a")] });
    expect(find(result, "b").hp).toBe(0);
    expect(find(result, "b").alive).toBe(false);
  });

  it("spends one shot on one target even when two cars overlap", () => {
    const first = player("b", { x: 800 });
    const second = player("c", { x: 800 });
    const result = run({
      players: [player("a"), first, second],
      projectiles: [aimedAt(first, "a")],
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
      projectiles: [
        {
          id: "p1",
          ownerSessionId: "a",
          x: box.x + box.w / 2 - WEAPON_CONFIG.projectileSpeed * DT,
          y: box.y + box.h / 2,
          angle: 0,
          speed: WEAPON_CONFIG.projectileSpeed,
          spawnTick: 100,
          alive: true,
        },
      ],
    });
    expect(result.projectiles).toHaveLength(0);
    expect(find(result, "b").hp).toBe(hpOf("rectangle"));
  });
});

describe("ramming", () => {
  /** Overlapping along +x by 4 units: close enough to contact, far enough to read as a rear-end. */
  const GAP = DRIVE_CONFIG.carWidth - 4;

  it("rear-ends: the car behind deals damage and takes none", () => {
    const result = run({
      players: [
        player("a", { x: 800, angle: 0, carId: "oval" }),
        player("b", { x: 800 + GAP, angle: 0 }),
      ],
    });
    const ramDamage = CAR_TABLE.oval.strength * COMBAT_CONFIG.collisionDamagePerStrength;
    expect(find(result, "b").hp).toBe(hpOf("rectangle") - ramDamage);
    expect(find(result, "a").hp).toBe(hpOf("rectangle"));
  });

  it("head-on: both cars take the other's strength", () => {
    const result = run({
      players: [
        player("a", { x: 800, angle: 0, carId: "oval" }),
        player("b", { x: 800 + GAP, angle: Math.PI, carId: "hexagon" }),
      ],
    });
    const per = COMBAT_CONFIG.collisionDamagePerStrength;
    expect(find(result, "b").hp).toBe(hpOf("rectangle") - CAR_TABLE.oval.strength * per);
    expect(find(result, "a").hp).toBe(hpOf("rectangle") - CAR_TABLE.hexagon.strength * per);
  });

  it("sideswipe: neither car takes damage", () => {
    const result = run({
      players: [
        player("a", { x: 800, y: 400, angle: Math.PI / 2 }),
        player("b", { x: 800 + GAP, y: 400, angle: Math.PI / 2 }),
      ],
    });
    expect(find(result, "a").hp).toBe(hpOf("rectangle"));
    expect(find(result, "b").hp).toBe(hpOf("rectangle"));
  });

  it("deals nothing when the hulls are clear of each other", () => {
    const result = run({
      players: [player("a", { x: 800 }), player("b", { x: 800 + DRIVE_CONFIG.carWidth + 20 })],
    });
    expect(find(result, "b").hp).toBe(hpOf("rectangle"));
  });

  it("sets a pair cooldown so a held ram does not melt hp every tick", () => {
    const result = run({
      players: [player("a", { x: 800 }), player("b", { x: 800 + GAP })],
    });
    expect(result.ramCooldowns.get("a|b")).toBe(100 + COMBAT_CONFIG.collisionDamageCooldownTicks);
  });

  it("does not damage again while the pair cooldown holds", () => {
    const result = run({
      players: [player("a", { x: 800 }), player("b", { x: 800 + GAP })],
      ramCooldowns: new Map([["a|b", 110]]),
    });
    expect(find(result, "b").hp).toBe(hpOf("rectangle"));
  });

  it("damages again on the tick the cooldown expires", () => {
    const result = run({
      world: world({ tick: 110 }),
      players: [player("a", { x: 800 }), player("b", { x: 800 + GAP })],
      ramCooldowns: new Map([["a|b", 110]]),
    });
    expect(find(result, "b").hp).toBeLessThan(hpOf("rectangle"));
  });

  it("forgets cooldowns that have expired rather than growing the map forever", () => {
    const result = run({ ramCooldowns: new Map([["x|y", 50]]) });
    expect(result.ramCooldowns.has("x|y")).toBe(false);
  });

  it("holds a cooldown only per pair, so a third car still connects", () => {
    const result = run({
      players: [
        player("a", { x: 800 }),
        player("b", { x: 800 + GAP }),
        player("c", { x: 800 + GAP, angle: Math.PI }),
      ],
      ramCooldowns: new Map([["a|b", 110]]),
    });
    expect(find(result, "b").hp).toBe(hpOf("rectangle"));
    expect(find(result, "c").hp).toBeLessThan(hpOf("rectangle"));
  });

  it("costs a teammate nothing in team mode: friendly fire is off for contact as well as shots", () => {
    const result = run({
      world: world({ mode: "team" }),
      players: [
        player("a", { x: 800, team: 0, carId: "oval" }),
        player("b", { x: 800 + GAP, team: 0 }),
      ],
    });
    expect(find(result, "b").hp).toBe(hpOf("rectangle"));
    expect(find(result, "a").hp).toBe(hpOf("rectangle"));
  });

  it("does not burn a pair cooldown on a harmless friendly bump", () => {
    // Otherwise shoving past a teammate would put the pair on cooldown, and a real enemy ram a few
    // ticks later would be silently swallowed.
    const result = run({
      world: world({ mode: "team" }),
      players: [
        player("a", { x: 800, team: 0, carId: "oval" }),
        player("b", { x: 800 + GAP, team: 0 }),
      ],
    });
    expect(result.ramCooldowns.size).toBe(0);
  });

  it("spares a teammate head-on too, not just from behind", () => {
    const result = run({
      world: world({ mode: "team" }),
      players: [
        player("a", { x: 800, angle: 0, team: 0, carId: "oval" }),
        player("b", { x: 800 + GAP, angle: Math.PI, team: 0, carId: "hexagon" }),
      ],
    });
    expect(find(result, "a").hp).toBe(hpOf("rectangle"));
    expect(find(result, "b").hp).toBe(hpOf("rectangle"));
  });

  it("still damages an enemy in team mode", () => {
    const result = run({
      world: world({ mode: "team" }),
      players: [
        player("a", { x: 800, team: 0, carId: "oval" }),
        player("b", { x: 800 + GAP, team: 1 }),
      ],
    });
    const ramDamage = CAR_TABLE.oval.strength * COMBAT_CONFIG.collisionDamagePerStrength;
    expect(find(result, "b").hp).toBe(hpOf("rectangle") - ramDamage);
  });

  it("still damages a same-team id in ffa, where teams are only seating", () => {
    const result = run({
      players: [
        player("a", { x: 800, team: 0, carId: "oval" }),
        player("b", { x: 800 + GAP, team: 0 }),
      ],
    });
    expect(find(result, "b").hp).toBeLessThan(hpOf("rectangle"));
  });

  it("wrecks a car whose hp reaches zero by ram", () => {
    const result = run({
      players: [
        player("a", { x: 800, carId: "oval" }),
        player("b", { x: 800 + GAP, hp: CAR_TABLE.oval.strength }),
      ],
    });
    expect(find(result, "b").alive).toBe(false);
  });

  it("head-on into a mutual kill damages both, with no first-strike advantage", () => {
    const result = run({
      players: [
        player("a", { x: 800, angle: 0, carId: "oval", hp: CAR_TABLE.oval.strength }),
        player("b", {
          x: 800 + GAP,
          angle: Math.PI,
          carId: "oval",
          hp: CAR_TABLE.oval.strength,
        }),
      ],
    });
    expect(find(result, "a").alive).toBe(false);
    expect(find(result, "b").alive).toBe(false);
  });

  it("ignores a wreck: you cannot ram a car that is already dead", () => {
    const result = run({
      players: [
        player("a", { x: 800, carId: "oval" }),
        player("b", { x: 800 + GAP, hp: 0, alive: false }),
      ],
    });
    expect(result.ramCooldowns.size).toBe(0);
  });

  it("ignores a player who is not on the roster", () => {
    const result = run({
      players: [
        player("a", { x: 800, carId: "oval" }),
        player("b", { x: 800 + GAP, inRoster: false }),
      ],
    });
    expect(find(result, "b").hp).toBe(hpOf("rectangle"));
  });

  it("falls back to the default chassis for an unrecognised carId rather than NaN-ing hp", () => {
    const result = run({
      players: [
        player("a", { x: 800, carId: "not-a-car" }),
        player("b", { x: 800 + GAP }),
      ],
    });
    const fallback = CAR_TABLE.rectangle.strength * COMBAT_CONFIG.collisionDamagePerStrength;
    expect(find(result, "b").hp).toBe(hpOf("rectangle") - fallback);
  });
});

/**
 * The gap the unit tests above left open, and the live bug they missed.
 *
 * Every ram case above hand-places the two cars overlapping. The sim never produces that state:
 * `resolveWorld` runs before combat and pushes a car out to *exactly* the separation boundary, so
 * two cars that just crashed end the tick touching at a gap of zero. A strict overlap test is false
 * on every tick of a real ram, and ramming silently dealt no damage in a live match while all of the
 * unit tests stayed green.
 *
 * These tests drive real cars into each other through the real `stepSim`, exactly as `serverTick`
 * does, and only then ask `runCombat` for damage.
 */
describe("ramming, driven through the real sim", () => {
  const OPEN = { width: ARENA_01.width, height: ARENA_01.height };
  const CLEAR = { carId: "rectangle" as const, obstacles: [] as never[], bounds: OPEN };
  const THROTTLE: InputMessage = { seq: 1, steer: 0, throttle: 1, fire: false };
  const COAST: InputMessage = { seq: 1, steer: 0, throttle: 0, fire: false };

  /**
   * Step two cars for one tick the way `serverTick` does — sorted order, each against the other's
   * current pose — then run one tick of combat over the result.
   */
  function simTick(
    state: { a: SimBody; b: SimBody; players: CombatPlayer[]; cooldowns: Map<string, number> },
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
      projectiles: [],
      ramCooldowns: state.cooldowns,
      projectileSeq: 0,
    });
    return { a, b, players: result.players, cooldowns: result.ramCooldowns };
  }

  function pair(bAngle: number) {
    const a: SimBody = { x: 800, y: 800, angle: 0, speed: 300, reverseHold: 0 };
    const b: SimBody = { x: 900, y: 800, angle: bAngle, speed: 0, reverseHold: 0 };
    return {
      a,
      b,
      players: [
        player("a", { x: a.x, y: a.y, angle: 0, carId: "oval" }),
        player("b", { x: b.x, y: b.y, angle: bAngle }),
      ],
      cooldowns: new Map<string, number>(),
    };
  }

  it("a car driven into the back of another actually deals damage", () => {
    let state = pair(0);
    let damaged = false;
    for (let tick = 0; tick < 20 && !damaged; tick++) {
      state = simTick(state, tick, { a: THROTTLE, b: COAST });
      damaged = state.players[1]!.hp < hpOf("rectangle");
    }
    expect(damaged).toBe(true);
    expect(state.players[0]!.hp).toBe(hpOf("rectangle"));
  });

  it("the cars end a real ram touching, not overlapping — the case the hand-placed tests miss", () => {
    let state = pair(0);
    let contactTick = -1;
    for (let tick = 0; tick < 20 && contactTick === -1; tick++) {
      state = simTick(state, tick, { a: THROTTLE, b: COAST });
      if (state.players[1]!.hp < hpOf("rectangle")) contactTick = tick;
    }
    expect(contactTick).toBeGreaterThanOrEqual(0);
    // Zero gap: exactly touching. `obbsOverlap` on these hulls is false, which is the whole point.
    const gap = state.b.x - state.a.x - DRIVE_CONFIG.carWidth;
    expect(gap).toBeLessThan(COMBAT_CONFIG.ramContactPad * 2);
    expect(gap).toBeGreaterThanOrEqual(0);
  });

  it("a real head-on damages both cars", () => {
    let state = pair(Math.PI);
    for (let tick = 0; tick < 20; tick++) {
      state = simTick(state, tick, { a: THROTTLE, b: THROTTLE });
      if (state.players[0]!.hp < hpOf("rectangle")) break;
    }
    expect(state.players[0]!.hp).toBeLessThan(hpOf("rectangle"));
    expect(state.players[1]!.hp).toBeLessThan(hpOf("rectangle"));
  });

  it("the pair cooldown holds through a sustained real ram", () => {
    let state = pair(0);
    const hits: number[] = [];
    let previous = hpOf("rectangle");
    for (let tick = 0; tick < 60; tick++) {
      state = simTick(state, tick, { a: THROTTLE, b: COAST });
      if (state.players[1]!.hp < previous) {
        hits.push(tick);
        previous = state.players[1]!.hp;
      }
    }
    expect(hits.length).toBeGreaterThan(1);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i]! - hits[i - 1]!).toBeGreaterThanOrEqual(
        COMBAT_CONFIG.collisionDamageCooldownTicks,
      );
    }
  });

  it("cars that never touch are never damaged", () => {
    let state = pair(0);
    state.b.x = 1600;
    state.players[1] = { ...state.players[1]!, x: 1600 };
    for (let tick = 0; tick < 10; tick++) {
      state = simTick(state, tick, { a: COAST, b: COAST });
    }
    expect(state.players[1]!.hp).toBe(hpOf("rectangle"));
    expect(state.players[0]!.hp).toBe(hpOf("rectangle"));
  });
});
