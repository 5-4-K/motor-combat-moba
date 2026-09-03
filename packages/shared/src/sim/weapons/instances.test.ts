import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "../../constants.js";
import { DRIVE_CONFIG } from "../../config/drive-config.js";
import { weaponTicksOf } from "../../config/weapon-ticks.js";
import { DEFAULT_CAR_ID } from "../../config/car-config.js";
import { WEAPON_TABLE } from "../../config/weapon-config.js";
import { weaponDamageOf } from "../damage.js";
import {
  bounceOffWorld,
  fanOffset,
  instanceExpired,
  muzzleOffset,
  spawnInstances,
  stepInstance,
  wallClipDistance,
  type WeaponInstance,
} from "./instances.js";

const DT = MS_PER_TICK / 1000;
const BOUNDS = { width: 2000, height: 1200 };
const ctx = (over: Partial<Parameters<typeof stepInstance>[1]> = {}) => ({
  dt: DT,
  tick: 100,
  obstacles: [],
  bounds: BOUNDS,
  ownerPose: null,
  homingTarget: null,
  ...over,
});

const owner = { sessionId: "aaa", team: 0 as const, carId: "mirage", x: 500, y: 300, angle: 0 };

describe("spawning", () => {
  it("births a shot at the car's nose, not its centre", () => {
    const { instances } = spawnInstances({ weaponId: "magmablast", slot: 0, finalVolley: true }, owner, 100, 0);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.x).toBeCloseTo(500 + DRIVE_CONFIG.carWidth / 2);
    expect(instances[0]!.y).toBeCloseTo(300);
  });

  it("gives every instance a unique id from the sequence and returns the advanced sequence", () => {
    const first = spawnInstances({ weaponId: "magmablast", slot: 0, finalVolley: true }, owner, 100, 7);
    const second = spawnInstances({ weaponId: "magmablast", slot: 0, finalVolley: true }, owner, 101, first.seq);
    expect(first.seq).toBe(8);
    expect(second.seq).toBe(9);
    expect(first.instances[0]!.id).not.toBe(second.instances[0]!.id);
  });

  it("carries the weapon's pierce budget onto the instance", () => {
    const { instances } = spawnInstances({ weaponId: "magmablast", slot: 0, finalVolley: true }, owner, 100, 0);
    expect(instances[0]!.pierceLeft).toBe(0);
  });

  it("puts a single-pellet volley exactly on the heading", () => {
    const { instances } = spawnInstances({ weaponId: "magmablast", slot: 0, finalVolley: true }, owner, 100, 0);
    expect(instances[0]!.angle).toBe(owner.angle);
  });

  it("freezes the owner's chassis-scaled damage onto the instance", () => {
    const { instances } = spawnInstances({ weaponId: "magmablast", slot: 0, finalVolley: true }, owner, 100, 0);
    expect(instances[0]!.damage).toBe(weaponDamageOf("mirage", "magmablast"));
  });

  it("gives a harder-hitting chassis a harder-hitting shot from the same weapon", () => {
    // T5 made mirage the roster's highest-attack chassis (63, above bullseye's 55 and bastion's
    // 42), so it can no longer be the "softer" baseline this test compares against — bullseye vs
    // bastion is the pair that still orders the way the test name says.
    const softHitter = { ...owner, carId: "bastion" };
    const hardHitter = { ...owner, carId: "bullseye" };
    const soft = spawnInstances({ weaponId: "magmablast", slot: 0, finalVolley: true }, softHitter, 100, 0).instances[0]!;
    const hard = spawnInstances({ weaponId: "magmablast", slot: 0, finalVolley: true }, hardHitter, 100, 0).instances[0]!;
    expect(hard.damage).toBe(weaponDamageOf("bullseye", "magmablast"));
    expect(soft.damage).toBe(weaponDamageOf("bastion", "magmablast"));
    expect(hard.damage).toBeGreaterThan(soft.damage);
  });

  it("falls back to the default chassis for an unrecognised carId rather than NaN-ing damage", () => {
    const unknown = { ...owner, carId: "not-a-car" };
    const { instances } = spawnInstances({ weaponId: "magmablast", slot: 0, finalVolley: true }, unknown, 100, 0);
    expect(instances[0]!.damage).toBe(weaponDamageOf(DEFAULT_CAR_ID, "magmablast"));
  });

  it("freezes the wave's finality onto every instance it spawns", () => {
    const owner = { sessionId: "a", team: 0 as const, carId: "mirage", x: 0, y: 0, angle: 0 };
    const mid = spawnInstances(
      { weaponId: "magmablast", slot: 0, finalVolley: false }, owner, 0, 0,
    );
    const last = spawnInstances(
      { weaponId: "magmablast", slot: 0, finalVolley: true }, owner, 0, 0,
    );
    expect(mid.instances[0]!.finalWave).toBe(false);
    expect(last.instances[0]!.finalWave).toBe(true);
  });
});

describe("the volley fan", () => {
  /** `fanOffset` is tested directly so the fan math has coverage independent of any one weapon's numbers. */
  const SIXTY = (60 * Math.PI) / 180;

  it("spreads pellets evenly and symmetrically about the heading", () => {
    expect(fanOffset(0, 3, SIXTY)).toBeCloseTo(-SIXTY / 2);
    expect(fanOffset(1, 3, SIXTY)).toBeCloseTo(0);
    expect(fanOffset(2, 3, SIXTY)).toBeCloseTo(SIXTY / 2);
  });

  it("splits an even pellet count across the heading, leaving nothing down the middle", () => {
    expect(fanOffset(0, 2, SIXTY)).toBeCloseTo(-SIXTY / 2);
    expect(fanOffset(1, 2, SIXTY)).toBeCloseTo(SIXTY / 2);
  });

  it("gives a lone pellet no offset at all, whatever the configured spread", () => {
    expect(fanOffset(0, 1, SIXTY)).toBe(0);
    expect(fanOffset(0, 0, SIXTY)).toBe(0);
  });
});

describe("projectile flight", () => {
  it("moves along its own frozen heading and accumulates distance", () => {
    const { instances } = spawnInstances({ weaponId: "magmablast", slot: 0, finalVolley: true }, owner, 100, 0);
    const stepped = stepInstance(instances[0]!, ctx());
    expect(stepped.x).toBeCloseTo(instances[0]!.x + WEAPON_TABLE.magmablast.speed * DT);
    expect(stepped.distance).toBeCloseTo(WEAPON_TABLE.magmablast.speed * DT);
  });

  it("ignores the owner's pose, even when the owner turns", () => {
    const { instances } = spawnInstances({ weaponId: "magmablast", slot: 0, finalVolley: true }, owner, 100, 0);
    const stepped = stepInstance(instances[0]!, ctx({ ownerPose: { x: 0, y: 0, angle: Math.PI } }));
    expect(stepped.angle).toBe(instances[0]!.angle);
    expect(stepped.x).toBeGreaterThan(instances[0]!.x);
  });

  it("expires once it has travelled its range", () => {
    const { instances } = spawnInstances({ weaponId: "magmablast", slot: 0, finalVolley: true }, owner, 100, 0);
    const spent: WeaponInstance = { ...instances[0]!, distance: 900 };
    const short: WeaponInstance = { ...instances[0]!, distance: 899 };
    expect(instanceExpired(spent, 130)).toBe(true);
    expect(instanceExpired(short, 130)).toBe(false);
  });

  it("does not alias damageClock with the instance it was stepped from", () => {
    const { instances } = spawnInstances({ weaponId: "magmablast", slot: 0, finalVolley: true }, owner, 100, 0);
    const before: WeaponInstance = { ...instances[0]!, damageClock: new Map([["bbb", 105]]) };
    const after = stepInstance(before, ctx());
    after.damageClock.set("ccc", 999);
    expect(before.damageClock.has("ccc")).toBe(false);
    expect(before.damageClock.get("bbb")).toBe(105);
  });
});

describe("beam growth and expiry", () => {
  /**
   * These hand-build a `kind: "beam"` instance over `magmablast`'s numbers — 600 u/s across a
   * 900-unit range as of the 2026-09-02 detonation pass — exactly as `combat.test.ts` does for the
   * ownership gate. `stepInstance`'s beam branch reads only `def.range`/`def.speed` and
   * `instanceExpired`'s only `flight`/`lifetime`, so borrowing a projectile's row exercises the real
   * branches with real numbers. The one thing it cannot show is a non-zero linger: the shell itself
   * (as opposed to its burst) has none, so the expiry below is `flight` alone — asserted through
   * `weaponTicksOf` rather than a literal, so it moves with the def the day a real beam ships one.
   */
  const beam = (over: Partial<WeaponInstance> = {}): WeaponInstance => ({
    id: "b1",
    ownerSessionId: "aaa",
    ownerTeam: 0,
    finalWave: true,
    damage: weaponDamageOf("mirage", "magmablast"),
    weaponId: "magmablast",
    kind: "beam",
    x: 500,
    y: 300,
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

  /** Room for a 900-unit beam in any direction, so the arena edge never stands in for a wall. */
  const ROOMY = { width: 5000, height: 5000 };

  it("grows from the muzzle at its own speed, a tick at a time", () => {
    const first = stepInstance(beam(), ctx({ bounds: ROOMY }));
    expect(first.extent).toBeCloseTo(WEAPON_TABLE.magmablast.speed * DT);
    expect(stepInstance(first, ctx({ bounds: ROOMY })).extent).toBeCloseTo(WEAPON_TABLE.magmablast.speed * DT * 2);
  });

  it("holds at full range rather than growing past it", () => {
    expect(stepInstance(beam({ extent: 890 }), ctx({ bounds: ROOMY })).extent).toBe(900);
  });

  it("is clamped to the wall when the wall is nearer than the range", () => {
    const box = { x: 700, y: 250, w: 100, h: 100 }; // 200 units down the axis from (500, 300)
    const clipped = stepInstance(beam({ extent: 890 }), ctx({ bounds: ROOMY, obstacles: [box] }));
    expect(clipped.extent).toBe(200);
  });

  it("re-anchors an attached beam on its owner's pose every tick", () => {
    const pose = { x: 800, y: 400, angle: Math.PI / 2 };
    const moved = stepInstance(beam({ attached: true }), ctx({ bounds: ROOMY, ownerPose: pose }));
    expect(moved.x).toBeCloseTo(800);
    expect(moved.y).toBeCloseTo(400 + muzzleOffset());
    expect(moved.angle).toBeCloseTo(Math.PI / 2);
  });

  it("re-clips an attached beam as the car turns it into and off a wall", () => {
    const box = { x: 700, y: 250, w: 100, h: 100 };
    const at = (angle: number) =>
      stepInstance(
        beam({ attached: true, extent: 890 }),
        ctx({ bounds: ROOMY, obstacles: [box], ownerPose: { x: 500, y: 300, angle } }),
      ).extent;
    // Facing the box: the muzzle is a nose-length ahead of the car centre, so the reach is the gap
    // from the muzzle to the near face, not from the car to it.
    expect(at(0)).toBe(700 - (500 + muzzleOffset()));
    // Turned 90 degrees away, the same beam reaches its full range again — the clip is recomputed
    // from the owner's CURRENT pose every tick, not frozen at the tick it was fired.
    expect(at(Math.PI / 2)).toBe(900);
  });

  it("leaves an unattached beam stamped where it was fired, owner pose or not", () => {
    const stamped = stepInstance(
      beam({ extent: 100 }),
      ctx({ bounds: ROOMY, ownerPose: { x: 0, y: 0, angle: Math.PI } }),
    );
    expect(stamped.x).toBe(500);
    expect(stamped.y).toBe(300);
    expect(stamped.angle).toBe(0);
  });

  it("expires on its clock rather than on distance, unlike a projectile", () => {
    const ticks = weaponTicksOf("magmablast");
    const life = ticks.flight + ticks.lifetime; // borrowed row: `lifetime` is 0, so this is `flight`
    const held = beam({ extent: 900 });
    expect(instanceExpired(held, 100 + life - 1)).toBe(false);
    expect(instanceExpired(held, 100 + life)).toBe(true);
    // A beam never accumulates `distance`, so the projectile branch would keep this alive forever.
    expect(instanceExpired({ ...held, kind: "projectile" }, 100 + life)).toBe(false);
  });
});

describe("wall clipping", () => {
  it("stops a beam at the first obstacle down its centre axis", () => {
    const box = { x: 700, y: 250, w: 100, h: 100 };
    expect(wallClipDistance(500, 300, 0, 600, [box], BOUNDS)).toBeCloseTo(200, 0);
  });

  it("stops a beam at the arena edge", () => {
    expect(wallClipDistance(1900, 300, 0, 600, [], BOUNDS)).toBeCloseTo(100, 0);
  });

  it("returns the full range when nothing is in the way", () => {
    expect(wallClipDistance(500, 300, 0, 600, [], BOUNDS)).toBe(600);
  });
});

describe("spawnInstances aim angle", () => {
  const owner = { sessionId: "p1", team: 0 as const, carId: "mirage", x: 100, y: 100, angle: 0 };
  const order = { weaponId: "magmablast" as const, slot: 0, finalVolley: true };

  it("uses the owner's heading when no aim angle is given", () => {
    const { instances } = spawnInstances(order, owner, 0, 0);
    expect(instances[0]!.angle).toBeCloseTo(0, 6);
  });

  it("fires along the aim angle when one is given", () => {
    const { instances } = spawnInstances(order, owner, 0, 0, Math.PI / 4);
    expect(instances[0]!.angle).toBeCloseTo(Math.PI / 4, 6);
  });

  it("keeps the muzzle on the car's nose whatever the aim angle", () => {
    // A11b. The muzzle is a physical point on the hull. If the lock moved it, a wide-angle lock
    // would spawn shots off the side of the car in open space.
    const straight = spawnInstances(order, owner, 0, 0).instances[0]!;
    const swung = spawnInstances(order, owner, 0, 0, Math.PI / 3).instances[0]!;
    expect(swung.x).toBeCloseTo(straight.x, 6);
    expect(swung.y).toBeCloseTo(straight.y, 6);
  });
});

/**
 * A synthetic def spread from `magmablast` — retired `needler`'s numeric shape, carried over as the
 * generic single-shot dart to spread multi-muzzle fields onto, independent of any one shipped
 * multi-muzzle row's own numbers.
 */
const quadMuzzle = {
  ...WEAPON_TABLE.magmablast,
  usesAimAssist: false,
  aimRangeUnits: undefined,
  muzzles: [0, 90, 180, 270],
} as const;

describe("multi-muzzle", () => {
  const order = { weaponId: "magmablast", slot: 0, finalVolley: true } as const;
  const owner = { sessionId: "a", team: 0 as const, carId: "bullseye", x: 100, y: 100, angle: 0 };

  it("emits one fan per muzzle, each centred on its own direction", () => {
    const { instances } = spawnInstances(order, owner, 1, 0, null, 1, "", quadMuzzle);
    expect(instances).toHaveLength(4); // 4 muzzles x 1 pellet
    // Muzzle degrees convert to radians unnormalized: with owner.angle = 0 the four instance
    // angles are exactly [0, pi/2, pi, 3pi/2] -- no wraparound to [-pi, pi] happens anywhere in
    // this path.
    const angles = instances.map((i) => i.angle).sort((a, b) => a - b);
    expect(angles[0]).toBeCloseTo(0);
    expect(angles[1]).toBeCloseTo(Math.PI / 2);
    expect(angles[2]).toBeCloseTo(Math.PI);
    expect(angles[3]).toBeCloseTo((3 * Math.PI) / 2);
    // Each dart leaves the hull edge along its own direction, not the nose. cos(pi) = -1 while
    // cos(3pi/2) = 0, so this predicate isolates the rear (180 deg) dart from the other three.
    const rear = instances.find((i) => Math.abs(Math.cos(i.angle) + 1) < 1e-6)!;
    expect(rear.x).toBeCloseTo(100 - muzzleOffset());
    expect(rear.muzzleDir).toBeCloseTo(Math.PI);
  });

  it("defaults to the single forward muzzle, byte-for-byte as before", () => {
    const single = spawnInstances(order, owner, 1, 0, null, 1);
    expect(single.instances).toHaveLength(1);
    expect(single.instances[0]!.x).toBeCloseTo(100 + muzzleOffset());
    expect(single.instances[0]!.muzzleDir).toBe(0);
  });

  it("re-anchors an attached beam through its own muzzle direction", () => {
    const rearFlame = { ...WEAPON_TABLE.afterburner, muzzles: [180] } as const;
    const { instances } = spawnInstances(order, owner, 1, 0, null, 1, "", rearFlame);
    const stepped = stepInstance(
      instances[0]!,
      {
        dt: 1 / 30,
        tick: 2,
        obstacles: [],
        bounds: { width: 4000, height: 4000 },
        ownerPose: { x: 200, y: 100, angle: 0 },
        homingTarget: null,
      },
      rearFlame,
    );
    expect(stepped.x).toBeCloseTo(200 - muzzleOffset()); // welded to the TAIL as the car moves
    expect(stepped.angle).toBeCloseTo(Math.PI);
  });
});

// `predator` now ships exactly this shape for real (speed 900, homing 300deg/s over 2000ms), so this
// exercises the real row rather than a synthetic spread. It is `acquire: "proximity"` in
// production, so a real shot always spawns with `homingTargetId: ""` — `sim/combat.ts`'s
// `runCombat` writes a target in later, the tick a car first comes within `acquireRadius`; this
// module never performs that scan itself. The tests below instead hand `spawnInstances` an
// explicit target so they can drive the STEERING branch (turn-rate clamp, guidance window) in
// isolation. That is a legitimate way to exercise steering, but the target is hand-set, not
// acquired — it does not reflect how a `predator` shot actually gets a target in a real tick.
const rocket = WEAPON_TABLE.predator;
const homingCtx = (tick: number, target: { x: number; y: number } | null) => ({
  dt: 1 / 30, tick, obstacles: [], bounds: { width: 4000, height: 4000 },
  ownerPose: null, homingTarget: target,
});
const homingOwner = { sessionId: "a", team: 0 as const, carId: "mirage", x: 0, y: 0, angle: 0 };
const homingOrder = { weaponId: "predator", slot: 0, finalVolley: true } as const;

describe("homing", () => {
  it("bends toward a hand-set target, capped at the turn rate (steering only, not acquisition)", () => {
    const { instances } = spawnInstances(homingOrder, homingOwner, 10, 0, 0, 1, "victim", rocket);
    const shot = instances[0]!;
    expect(shot.homingTargetId).toBe("victim");
    const stepped = stepInstance(shot, homingCtx(11, { x: 500, y: 500 }), rocket); // 45 deg off
    const maxTurn = (300 * Math.PI / 180) / 30;
    expect(stepped.angle).toBeCloseTo(maxTurn); // clamped, not snapped to 45 deg
  });

  it("flies straight after the guidance window", () => {
    const { instances } = spawnInstances(homingOrder, homingOwner, 10, 0, 0, 1, "victim", rocket);
    const until = instances[0]!.homingUntilTick;
    expect(until).toBe(10 + 60); // msToTicks(2000) at 30 Hz
    const past = stepInstance({ ...instances[0]!, x: 100 }, homingCtx(until + 1, { x: 500, y: 500 }), rocket);
    expect(past.angle).toBe(0);
  });

  it("flies straight when fired without a lock", () => {
    const { instances } = spawnInstances(homingOrder, homingOwner, 10, 0, null, 1, "", rocket);
    expect(instances[0]!.homingTargetId).toBe("");
    // The guidance clock still arms at spawn — off `homing` alone, not off having a target (this is
    // the fix a proximity row needs: it also spawns with no target, but must still gain a window to
    // use once it later acquires one). It just never matters here, because `stepInstance`'s gate
    // ALSO requires a non-empty `homingTargetId`, which a bare lock-mode shot never gets.
    expect(instances[0]!.homingUntilTick).toBe(10 + 60); // msToTicks(2000) at 30 Hz, same as spawned-with-a-lock
    const stepped = stepInstance(instances[0]!, homingCtx(11, null), rocket);
    expect(stepped.angle).toBe(0);
  });
});

// `thumper` now ships `bounces: true` with `lifetimeMs: 2900` for real, so this exercises the real row.
const bouncer = WEAPON_TABLE.thumper;
const bounds = { width: 1000, height: 1000 };

describe("bounce", () => {
  it("reflects off the arena edge, folding position and mirroring the angle", () => {
    const r = bounceOffWorld(990, 500, 1010, 500, 0, [], bounds);
    expect(r.x).toBeCloseTo(990); // folded back inside
    expect(Math.cos(r.angle)).toBeCloseTo(-1); // now travelling -x
  });

  it("reflects off an obstacle face chosen by approach side", () => {
    const wall = { x: 500, y: 0, w: 40, h: 1000 };
    const r = bounceOffWorld(480, 500, 510, 500, 0, [wall], bounds);
    expect(r.x).toBeLessThanOrEqual(500);
    expect(Math.cos(r.angle)).toBeCloseTo(-1);
  });

  it("expires on its clock, not at range", () => {
    const owner = { sessionId: "a", team: 0 as const, carId: "bastion", x: 0, y: 0, angle: 0 };
    const order = { weaponId: "thumper", slot: 0, finalVolley: true } as const;
    const { instances } = spawnInstances(order, owner, 100, 0, null, 1, "", bouncer);
    const shot = instances[0]!;
    expect(shot.expiresAtTick).toBe(100 + 87); // msToTicks(2900) at 30 Hz
    expect(instanceExpired({ ...shot, distance: 99999 }, 150, bouncer)).toBe(false); // range ignored
    expect(instanceExpired(shot, 187, bouncer)).toBe(true);
  });
});

describe("spawnInstances pressId (B8)", () => {
  it("stamps every pellet of one press with the same pressId", () => {
    const order = { weaponId: "pepperbox", slot: 1, finalVolley: true, pressId: "p1#5#1" } as const;
    const owner = { sessionId: "p1", team: 0, carId: "bullseye", x: 0, y: 0, angle: 0 } as const;
    const { instances } = spawnInstances(order, owner, 5, 0);
    expect(instances.length).toBeGreaterThan(1); // pepperbox is a fan
    expect(instances.every((i) => i.pressId === "p1#5#1")).toBe(true);
  });
});
