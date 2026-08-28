import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { WEAPON_TABLE } from "../../config/weapon-config.js";
import { carHullOf } from "../context.js";
import { weaponDamageOf } from "../damage.js";
import { spawnInstances, stepInstance, type WeaponInstance } from "./instances.js";
import { resolveInstanceHits, type PoseSnapshot } from "./hits.js";

const BOUNDS = { width: 2000, height: 1200 };
const DT = 1 / 30;

const snapshot = (
  entries: { sessionId: string; team?: 0 | 1; x: number; y: number }[],
): PoseSnapshot =>
  entries
    .map((e) => ({ sessionId: e.sessionId, team: e.team ?? 0, hull: carHullOf(e.x, e.y, 0) }))
    .sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1));

function shotFrom(x: number, y: number, angle = 0, team: 0 | 1 = 0, carId = "rectangle"): WeaponInstance {
  return spawnInstances(
    { weaponId: "fireball", slot: 0 },
    { sessionId: "aaa", team, carId, x, y, angle },
    100,
    0,
  ).instances[0]!;
}

describe("hit resolution", () => {
  it("damages a car the shot has reached", () => {
    const shot = shotFrom(400, 300);
    const moved = stepInstance(shot, { dt: DT, tick: 101, obstacles: [], bounds: BOUNDS, ownerPose: null });
    const out = resolveInstanceHits(moved, shot, snapshot([{ sessionId: "bbb", x: 434, y: 300 }]), "ffa", 101);
    expect(out.damaged).toEqual([{ sessionId: "bbb", amount: weaponDamageOf("rectangle", "fireball") }]);
  });

  it("uses the damage frozen on the instance, not the weapon table's own number", () => {
    // The whole point of freezing at spawn: an oval's fireball hits harder than a rectangle's, and
    // hits.ts learns that from the instance rather than by looking the owner up.
    const shot = shotFrom(400, 300, 0, 0, "oval");
    const moved = stepInstance(shot, { dt: DT, tick: 101, obstacles: [], bounds: BOUNDS, ownerPose: null });
    const out = resolveInstanceHits(moved, shot, snapshot([{ sessionId: "bbb", x: 434, y: 300 }]), "ffa", 101);
    expect(out.damaged).toEqual([{ sessionId: "bbb", amount: 60 }]);
    expect(60).not.toBe(WEAPON_TABLE.fireball.damage);
  });

  it("never damages the shooter", () => {
    const shot = shotFrom(400, 300);
    const out = resolveInstanceHits(shot, shot, snapshot([{ sessionId: "aaa", x: 424, y: 300 }]), "ffa", 100);
    expect(out.damaged).toEqual([]);
  });

  it("passes through a teammate in team mode without spending pierce", () => {
    const shot = { ...shotFrom(400, 300), pierceLeft: 0 };
    const out = resolveInstanceHits(
      shot,
      shot,
      snapshot([{ sessionId: "bbb", team: 0, x: 424, y: 300 }]),
      "team",
      100,
    );
    expect(out.damaged).toEqual([]);
    expect(out.instance.alive).toBe(true);
    expect(out.instance.pierceLeft).toBe(0);
  });

  it("dies on the first car it damages when pierce is 0", () => {
    const shot = shotFrom(400, 300);
    const out = resolveInstanceHits(shot, shot, snapshot([{ sessionId: "bbb", x: 424, y: 300 }]), "ffa", 100);
    expect(out.instance.alive).toBe(false);
  });

  it("spends one pierce per car and keeps flying while budget remains", () => {
    const shot = { ...shotFrom(400, 300), pierceLeft: 1 };
    const two = snapshot([
      { sessionId: "bbb", x: 424, y: 300 },
      { sessionId: "ccc", x: 424, y: 300 },
    ]);
    const out = resolveInstanceHits(shot, shot, two, "ffa", 100);
    expect(out.damaged).toHaveLength(2);
    expect(out.instance.alive).toBe(false); // budget of 1 = two cars total
  });

  it("damages a given car once per instance when damageFrequencyMs is 0", () => {
    const shot = { ...shotFrom(400, 300), pierceLeft: 5 };
    const target = snapshot([{ sessionId: "bbb", x: 424, y: 300 }]);
    const first = resolveInstanceHits(shot, shot, target, "ffa", 100);
    const second = resolveInstanceHits(first.instance, shot, target, "ffa", 101);
    expect(first.damaged).toHaveLength(1);
    expect(second.damaged).toEqual([]);
  });

  it("resolves overlapping targets in sorted sessionId order", () => {
    const shot = shotFrom(400, 300);
    const overlapping = snapshot([
      { sessionId: "zzz", x: 424, y: 300 },
      { sessionId: "bbb", x: 424, y: 300 },
    ]);
    const out = resolveInstanceHits(shot, shot, overlapping, "ffa", 100);
    expect(out.damaged[0]!.sessionId).toBe("bbb");
  });

  it("does not mutate the instance it is given", () => {
    const shot = shotFrom(400, 300);
    const before = JSON.stringify({ ...shot, damageClock: [...shot.damageClock] });
    resolveInstanceHits(shot, shot, snapshot([{ sessionId: "bbb", x: 424, y: 300 }]), "ffa", 100);
    expect(JSON.stringify({ ...shot, damageClock: [...shot.damageClock] })).toBe(before);
  });

  it("keeps a shot's allegiance frozen to its owner's team, even after the owner is wrecked and missing from the snapshot", () => {
    const shot = shotFrom(400, 300, 0, 1); // owner was on team 1
    // "aaa" (the owner) is deliberately absent from the snapshot: the pose snapshot only carries
    // living fighters, and the owner has since been wrecked.
    const mixed = snapshot([
      { sessionId: "bbb", team: 1, x: 424, y: 300 }, // teammate: must not be damaged
      { sessionId: "ccc", team: 0, x: 424, y: 300 }, // enemy: must still be damaged
    ]);
    const out = resolveInstanceHits(shot, shot, mixed, "team", 100);
    expect(out.damaged).toEqual([{ sessionId: "ccc", amount: weaponDamageOf("rectangle", "fireball") }]);
  });
});

describe("the lag-compensation seam", () => {
  it("reads nothing but its arguments — no player-state imports", () => {
    const source = readFileSync(new URL("./hits.ts", import.meta.url), "utf8");
    expect(source).not.toContain("CombatPlayer");
    expect(source).not.toContain("PlayerState");
    expect(source).not.toMatch(/from "\.\.\/combat\.js"/);
  });
});
