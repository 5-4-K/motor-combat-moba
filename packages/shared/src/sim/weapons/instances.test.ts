import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "../../constants.js";
import { DRIVE_CONFIG } from "../../config/drive-config.js";
import { weaponTicksOf } from "../../config/weapon-ticks.js";
import { DEFAULT_CAR_ID } from "../../config/car-config.js";
import { weaponDamageOf } from "../damage.js";
import {
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
  ...over,
});

const owner = { sessionId: "aaa", team: 0 as const, carId: "mirage", x: 500, y: 300, angle: 0 };

describe("spawning", () => {
  it("births a shot at the car's nose, not its centre", () => {
    const { instances } = spawnInstances({ weaponId: "fireball", slot: 0 }, owner, 100, 0);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.x).toBeCloseTo(500 + DRIVE_CONFIG.carWidth / 2);
    expect(instances[0]!.y).toBeCloseTo(300);
  });

  it("gives every instance a unique id from the sequence and returns the advanced sequence", () => {
    const first = spawnInstances({ weaponId: "fireball", slot: 0 }, owner, 100, 7);
    const second = spawnInstances({ weaponId: "fireball", slot: 0 }, owner, 101, first.seq);
    expect(first.seq).toBe(8);
    expect(second.seq).toBe(9);
    expect(first.instances[0]!.id).not.toBe(second.instances[0]!.id);
  });

  it("carries the weapon's pierce budget onto the instance", () => {
    const { instances } = spawnInstances({ weaponId: "fireball", slot: 0 }, owner, 100, 0);
    expect(instances[0]!.pierceLeft).toBe(0);
  });

  it("puts a single-pellet volley exactly on the heading", () => {
    const { instances } = spawnInstances({ weaponId: "fireball", slot: 0 }, owner, 100, 0);
    expect(instances[0]!.angle).toBe(owner.angle);
  });

  it("freezes the owner's chassis-scaled damage onto the instance", () => {
    const { instances } = spawnInstances({ weaponId: "fireball", slot: 0 }, owner, 100, 0);
    expect(instances[0]!.damage).toBe(weaponDamageOf("mirage", "fireball"));
  });

  it("gives a harder-hitting chassis a harder-hitting shot from the same weapon", () => {
    // T5 made mirage the roster's highest-attack chassis (63, above bullseye's 55 and bastion's
    // 42), so it can no longer be the "softer" baseline this test compares against — bullseye vs
    // bastion is the pair that still orders the way the test name says.
    const softHitter = { ...owner, carId: "bastion" };
    const hardHitter = { ...owner, carId: "bullseye" };
    const soft = spawnInstances({ weaponId: "fireball", slot: 0 }, softHitter, 100, 0).instances[0]!;
    const hard = spawnInstances({ weaponId: "fireball", slot: 0 }, hardHitter, 100, 0).instances[0]!;
    expect(hard.damage).toBe(weaponDamageOf("bullseye", "fireball"));
    expect(soft.damage).toBe(weaponDamageOf("bastion", "fireball"));
    expect(hard.damage).toBeGreaterThan(soft.damage);
  });

  it("falls back to the default chassis for an unrecognised carId rather than NaN-ing damage", () => {
    const unknown = { ...owner, carId: "not-a-car" };
    const { instances } = spawnInstances({ weaponId: "fireball", slot: 0 }, unknown, 100, 0);
    expect(instances[0]!.damage).toBe(weaponDamageOf(DEFAULT_CAR_ID, "fireball"));
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
    const { instances } = spawnInstances({ weaponId: "fireball", slot: 0 }, owner, 100, 0);
    const stepped = stepInstance(instances[0]!, ctx());
    expect(stepped.x).toBeCloseTo(instances[0]!.x + 900 * DT);
    expect(stepped.distance).toBeCloseTo(900 * DT);
  });

  it("ignores the owner's pose, even when the owner turns", () => {
    const { instances } = spawnInstances({ weaponId: "fireball", slot: 0 }, owner, 100, 0);
    const stepped = stepInstance(instances[0]!, ctx({ ownerPose: { x: 0, y: 0, angle: Math.PI } }));
    expect(stepped.angle).toBe(instances[0]!.angle);
    expect(stepped.x).toBeGreaterThan(instances[0]!.x);
  });

  it("expires once it has travelled its range", () => {
    const { instances } = spawnInstances({ weaponId: "fireball", slot: 0 }, owner, 100, 0);
    const spent: WeaponInstance = { ...instances[0]!, distance: 900 };
    const short: WeaponInstance = { ...instances[0]!, distance: 899 };
    expect(instanceExpired(spent, 130)).toBe(true);
    expect(instanceExpired(short, 130)).toBe(false);
  });

  it("does not alias damageClock with the instance it was stepped from", () => {
    const { instances } = spawnInstances({ weaponId: "fireball", slot: 0 }, owner, 100, 0);
    const before: WeaponInstance = { ...instances[0]!, damageClock: new Map([["bbb", 105]]) };
    const after = stepInstance(before, ctx());
    after.damageClock.set("ccc", 999);
    expect(before.damageClock.has("ccc")).toBe(false);
    expect(before.damageClock.get("bbb")).toBe(105);
  });
});

describe("beam growth and expiry", () => {
  /**
   * No beam ships in `WEAPON_TABLE` (D22 ships zero balance change), so these hand-build a
   * `kind: "beam"` instance over `fireball`'s numbers — 900 u/s across a 900-unit range — exactly as
   * `combat.test.ts` does for the ownership gate. `stepInstance`'s beam branch reads only
   * `def.range`/`def.speed` and `instanceExpired`'s only `flight`/`lifetime`, so borrowing a
   * projectile's row exercises the real branches with real numbers. The one thing it cannot show is
   * a non-zero linger: `fireball` has none, so the expiry below is `flight` alone — asserted through
   * `weaponTicksOf` rather than a literal, so it moves with the def the day a real beam arrives.
   */
  const beam = (over: Partial<WeaponInstance> = {}): WeaponInstance => ({
    id: "b1",
    ownerSessionId: "aaa",
    ownerTeam: 0,
    damage: weaponDamageOf("mirage", "fireball"),
    weaponId: "fireball",
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
    ...over,
  });

  /** Room for a 900-unit beam in any direction, so the arena edge never stands in for a wall. */
  const ROOMY = { width: 5000, height: 5000 };

  it("grows from the muzzle at its own speed, a tick at a time", () => {
    const first = stepInstance(beam(), ctx({ bounds: ROOMY }));
    expect(first.extent).toBeCloseTo(900 * DT);
    expect(stepInstance(first, ctx({ bounds: ROOMY })).extent).toBeCloseTo(900 * DT * 2);
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
    const ticks = weaponTicksOf("fireball");
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
  const order = { weaponId: "fireball" as const, slot: 0 };

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
