import { describe, expect, it } from "vitest";
import { ARENA_01 } from "../arena/arena-01.js";
import { CAR_TABLE, hpOf } from "../config/car-config.js";
import { COMBAT_CONFIG } from "../config/combat-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { CarId } from "../config/types.js";
import { WEAPON_TABLE } from "../config/weapon-config.js";
import { MS_PER_TICK } from "../constants.js";
import { runCombat, type CombatInput, type CombatPlayer, type CombatWorld } from "./combat.js";
import { carHullOf } from "./context.js";
import { newFireState } from "./weapons/fire.js";
import type { WeaponInstance } from "./weapons/instances.js";
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
    ...over,
  };
}

function run(over: Partial<CombatInput> = {}): ReturnType<typeof runCombat> {
  return runCombat({
    world: world(),
    players: [],
    instances: [],
    ramCooldowns: new Map(),
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
      ...over,
    };
  }

  it("spawns one instance at the muzzle when slot 1 is pressed", () => {
    const result = runCombat({
      world: world(),
      players: [player({ fireMask: 0b001 })],
      instances: [],
      ramCooldowns: new Map(),
      instanceSeq: 0,
    });
    expect(result.instances).toHaveLength(1);
    expect(result.instances[0]!.weaponId).toBe("cannon");
  });

  it("does not fire again inside the cooldown, held or tapped", () => {
    const state: CombatInput = {
      world: world(),
      players: [player({ fireMask: 0b001 })],
      instances: [],
      ramCooldowns: new Map(),
      instanceSeq: 0,
    };
    const first = runCombat(state);
    const second = runCombat({
      world: world({ tick: 101 }),
      players: first.players.map((p) => ({ ...p, fireMask: 0b001 })),
      instances: first.instances,
      ramCooldowns: first.ramCooldowns,
      instanceSeq: first.instanceSeq,
    });
    expect(second.instances.filter((i) => i.spawnTick === 101)).toHaveLength(0);
  });

  it("fires nothing for a player with no chassis", () => {
    const result = runCombat({
      world: world(),
      players: [player({ carId: "", fireState: newFireState("", 1), fireMask: 0b001 })],
      instances: [],
      ramCooldowns: new Map(),
      instanceSeq: 0,
    });
    expect(result.instances).toEqual([]);
  });

  it("does not fire for a player who is not on the roster", () => {
    const result = runCombat({
      world: world(),
      players: [player({ fireMask: 0b001, inRoster: false })],
      instances: [],
      ramCooldowns: new Map(),
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
        pending: { weaponId: "cannon", slot: 0, shotsLeft: 2, nextShotTick: 100 },
      },
    });
    const result = runCombat({
      world: world(),
      players: [wrecked],
      instances: [],
      ramCooldowns: new Map(),
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
      weaponId: "cannon",
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
      ramCooldowns: new Map(),
      instanceSeq: 0,
    });
    const ids = result.instances.map((i) => i.id);
    expect(ids).not.toContain("beam-1");
    expect(ids).toContain("shot-1");
  });

  it("still lands the migrated cannon's damage on a car in front", () => {
    const shooter = player({ sessionId: "aaa", x: 300, fireMask: 0b001 });
    // A fresh press spawns its instance at the muzzle and is hit-tested THIS tick, without a tick of
    // travel — so a same-tick hit is necessarily point-blank. `cannon`'s hitbox is a 3-unit-radius
    // circle sitting exactly on the shooter's own hull edge, and `COMBAT_CONFIG.ramContactPad` is 1
    // unit each side, so any target within (0, 3] units of that edge overlaps the shot; only a
    // target beyond 2 units (the padded contact threshold) is clear of a simultaneous ram. 50.5
    // (0.5 units inside the disc, comfortably outside the ±1 pad) isolates the cannon's own damage
    // from the ramming half of `runCombat`, which is exercised on its own below.
    const target = player({ sessionId: "bbb", x: 300 + 50.5, fireMask: 0 });
    const result = runCombat({
      world: world(),
      players: [shooter, target],
      instances: [],
      ramCooldowns: new Map(),
      instanceSeq: 0,
    });
    const hit = result.players.find((p) => p.sessionId === "bbb")!;
    expect(hit.hp).toBe(hpOf("rectangle") - WEAPON_TABLE.cannon.damage);
  });

  it("drives repeater, the table's only multi-stock weapon, through a real tick", () => {
    // `repeater` is carried by no car, so nothing in ordinary play ever reaches `runCombat` with it
    // and the stock mechanic would otherwise only ever be seen in hand-built `FireState` literals.
    // The hand-built loadout is the whole difference here; everything downstream is the shipped path.
    const shooter = player({
      fireMask: 0b001,
      fireState: {
        slots: [{ weaponId: "repeater", stocks: 2, rechargeEndsTick: 0, refireLockUntilTick: 0 }],
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
      ramCooldowns: new Map(),
      instanceSeq: 0,
    });
    expect(result.instances.map((i) => i.weaponId)).toEqual(["repeater"]);

    const fired = result.players[0]!.fireState;
    expect(fired.slots[0]!.stocks).toBe(1); // one of two spent
    expect(fired.slots[0]!.rechargeEndsTick).toBe(190); // tick 100 + a 3000ms cooldown == 90 ticks
    expect(fired.slots[0]!.refireLockUntilTick).toBe(103); // 100ms refire delay == 3 ticks
    expect(fired.switchLockUntilTick).toBe(250); // 5000ms recovery == 150 ticks
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
      ramCooldowns: new Map(),
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
    weaponId: "cannon",
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
    expect(result.instances[0]!.x).toBeCloseTo(400 + WEAPON_TABLE.cannon.speed * DT, 6);
  });

  it("drops a shot that has outlived its range", () => {
    const result = run({ instances: [flying({ distance: WEAPON_TABLE.cannon.range })] });
    expect(result.instances).toHaveLength(0);
  });

  it("drops a shot that flies into an obstacle", () => {
    const box = TEST_BOX;
    const justShort = box.x - WEAPON_TABLE.cannon.speed * DT + 1;
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
    const result = run({ instances: [flying({ x: ARENA_01.width - WEAPON_TABLE.cannon.speed * DT })] });
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
      weaponId: "cannon",
      kind: "projectile",
      x: target.x - WEAPON_TABLE.cannon.speed * DT,
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
    expect(find(result, "b").hp).toBe(hpOf("rectangle") - WEAPON_TABLE.cannon.damage);
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
    expect(find(result, "b").hp).toBe(hpOf("rectangle") - WEAPON_TABLE.cannon.damage);
  });

  it("damages a same-team id in ffa, where teams mean nothing", () => {
    const target = player("b", { x: 800, team: 0 });
    const result = run({
      players: [player("a", { team: 0 }), target],
      instances: [aimedAt(target, "a")],
    });
    expect(find(result, "b").hp).toBe(hpOf("rectangle") - WEAPON_TABLE.cannon.damage);
  });

  it("passes through a wreck rather than being spent on it", () => {
    const wreck = player("b", { x: 800, hp: 0, alive: false });
    const result = run({ players: [player("a"), wreck], instances: [aimedAt(wreck, "a")] });
    expect(result.instances).toHaveLength(1);
  });

  it("wrecks a car whose hp reaches zero", () => {
    const target = player("b", { x: 800, hp: WEAPON_TABLE.cannon.damage });
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
          weaponId: "cannon",
          kind: "projectile",
          x: box.x + box.w / 2 - WEAPON_TABLE.cannon.speed * DT,
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
  const THROTTLE: InputMessage = { seq: 1, steer: 0, throttle: 1, fireSlots: 0 };
  const COAST: InputMessage = { seq: 1, steer: 0, throttle: 0, fireSlots: 0 };

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
      instances: [],
      ramCooldowns: state.cooldowns,
      instanceSeq: 0,
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
