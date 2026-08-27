import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "../../constants.js";
import { DRIVE_CONFIG } from "../../config/drive-config.js";
import {
  instanceExpired,
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

const owner = { sessionId: "aaa", x: 500, y: 300, angle: 0 };

describe("spawning", () => {
  it("births a shot at the car's nose, not its centre", () => {
    const { instances } = spawnInstances({ weaponId: "cannon", slot: 0 }, owner, 100, 0);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.x).toBeCloseTo(500 + DRIVE_CONFIG.carWidth / 2);
    expect(instances[0]!.y).toBeCloseTo(300);
  });

  it("gives every instance a unique id from the sequence and returns the advanced sequence", () => {
    const first = spawnInstances({ weaponId: "cannon", slot: 0 }, owner, 100, 7);
    const second = spawnInstances({ weaponId: "cannon", slot: 0 }, owner, 101, first.seq);
    expect(first.seq).toBe(8);
    expect(second.seq).toBe(9);
    expect(first.instances[0]!.id).not.toBe(second.instances[0]!.id);
  });

  it("carries the weapon's pierce budget onto the instance", () => {
    const { instances } = spawnInstances({ weaponId: "cannon", slot: 0 }, owner, 100, 0);
    expect(instances[0]!.pierceLeft).toBe(0);
  });
});

describe("projectile flight", () => {
  it("moves along its own frozen heading and accumulates distance", () => {
    const { instances } = spawnInstances({ weaponId: "cannon", slot: 0 }, owner, 100, 0);
    const stepped = stepInstance(instances[0]!, ctx());
    expect(stepped.x).toBeCloseTo(instances[0]!.x + 900 * DT);
    expect(stepped.distance).toBeCloseTo(900 * DT);
  });

  it("ignores the owner's pose, even when the owner turns", () => {
    const { instances } = spawnInstances({ weaponId: "cannon", slot: 0 }, owner, 100, 0);
    const stepped = stepInstance(instances[0]!, ctx({ ownerPose: { x: 0, y: 0, angle: Math.PI } }));
    expect(stepped.angle).toBe(instances[0]!.angle);
    expect(stepped.x).toBeGreaterThan(instances[0]!.x);
  });

  it("expires once it has travelled its range", () => {
    const { instances } = spawnInstances({ weaponId: "cannon", slot: 0 }, owner, 100, 0);
    const spent: WeaponInstance = { ...instances[0]!, distance: 900 };
    const short: WeaponInstance = { ...instances[0]!, distance: 899 };
    expect(instanceExpired(spent, 130)).toBe(true);
    expect(instanceExpired(short, 130)).toBe(false);
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
