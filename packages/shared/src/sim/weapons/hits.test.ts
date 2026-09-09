import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { instanceDefOf, WEAPON_TABLE } from "../../config/weapon-config.js";
import type { WeaponId } from "../../config/weapon-types.js";
import { carHullOf } from "../context.js";
import { weaponDamageOf } from "../damage.js";
import { spawnInstances, stepInstance, type WeaponInstance } from "./instances.js";
import { resolveInstanceHits, type PoseSnapshot } from "./hits.js";

const modeBox = vi.hoisted(() => ({ current: null as "onceEver" | "perEntry" | null }));

vi.mock("../../config/weapon-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/weapon-config.js")>();
  return {
    ...actual,
    explosionDamageModeOf: (id: WeaponId) =>
      modeBox.current ?? actual.explosionDamageModeOf(id),
  };
});

afterEach(() => {
  modeBox.current = null;
});

const BOUNDS = { width: 2000, height: 1200 };
const DT = 1 / 30;

const snapshot = (
  entries: { sessionId: string; team?: 0 | 1; x: number; y: number }[],
): PoseSnapshot =>
  entries
    .map((e) => ({ sessionId: e.sessionId, team: e.team ?? 0, hull: carHullOf(e.x, e.y, 0) }))
    .sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1));

function shotFrom(x: number, y: number, angle = 0, team: 0 | 1 = 0, carId = "mirage"): WeaponInstance {
  return spawnInstances(
    { weaponId: "magmablast", slot: 0, finalVolley: true, pressId: "aaa#100#0" },
    { sessionId: "aaa", team, carId, x, y, angle },
    100,
    0,
  ).instances[0]!;
}

describe("hit resolution", () => {
  it("damages a car the shot has reached", () => {
    const shot = shotFrom(400, 300);
    const moved = stepInstance(shot, {
      dt: DT,
      tick: 101,
      obstacles: [],
      bounds: BOUNDS,
      ownerPose: null,
      homingTarget: null,
    });
    const out = resolveInstanceHits(moved, shot, snapshot([{ sessionId: "bbb", x: 434, y: 300 }]), "ffa", 101);
    expect(out.damaged).toEqual([{ sessionId: "bbb", amount: weaponDamageOf("mirage", "magmablast") }]);
  });

  it("uses the damage frozen on the instance, not the weapon table's own number", () => {
    // The whole point of freezing at spawn: firing a `magmablast` scales off the owner's own attack
    // rating (55 for bullseye, not the table's raw 50), and hits.ts learns that from the instance
    // rather than by looking the owner up. `shotFrom` stamps the owner directly and needs no real
    // loadout to back it — bullseye no longer carries magmablast since the 2026-09-02 loadout swap,
    // but the mechanism this test pins does not care which chassis a shot's damage was frozen from.
    const shot = shotFrom(400, 300, 0, 0, "bullseye");
    const moved = stepInstance(shot, {
      dt: DT,
      tick: 101,
      obstacles: [],
      bounds: BOUNDS,
      ownerPose: null,
      homingTarget: null,
    });
    const out = resolveInstanceHits(moved, shot, snapshot([{ sessionId: "bbb", x: 434, y: 300 }]), "ffa", 101);
    expect(out.damaged).toEqual([{ sessionId: "bbb", amount: weaponDamageOf("bullseye", "magmablast") }]);
    expect(out.damaged[0]!.amount).not.toBe(WEAPON_TABLE.magmablast.damage);
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
    expect(out.damaged).toEqual([{ sessionId: "ccc", amount: weaponDamageOf("mirage", "magmablast") }]);
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

/**
 * A magmablast burst at full extent, the shape `detonate` produces. Built as a literal rather than
 * by exporting `detonate`, which is private to combat.ts and has no reason not to be.
 */
function burstAt(x: number, y: number, tick: number): WeaponInstance {
  const def = instanceDefOf("magmablast", true);
  return {
    id: "aaa-1",
    ownerSessionId: "aaa",
    ownerTeam: 0,
    finalWave: true,
    damage: 15,
    weaponId: "magmablast",
    kind: "beam",
    x,
    y,
    angle: 0,
    extent: def.range,
    spawnTick: tick,
    distance: 0,
    pierceLeft: 0,
    attached: false,
    damageClock: new Map(),
    alive: true,
    muzzleDir: 0,
    homingTargetId: "",
    homingUntilTick: 0,
    expiresAtTick: 0,
    isExplosion: true,
    pressId: "aaa#100#0",
  } satisfies WeaponInstance;
}

/** Inside the 60-unit disc; a car hull is 48 x 24, so this overlaps comfortably. */
const INSIDE = { sessionId: "bbb", team: 1 as const, x: 420, y: 300 };
/** Well clear of a 60-unit disc centred at (400, 300). */
const OUTSIDE = { sessionId: "bbb", team: 1 as const, x: 900, y: 300 };

describe("a lingering field's per-entry damage clock (LZ8)", () => {
  it("damages a car once when it enters and never again while it stays", () => {
    modeBox.current = "perEntry";
    const field = burstAt(400, 300, 100);
    const inside = snapshot([INSIDE]);

    const first = resolveInstanceHits(field, field, inside, "ffa", 101);
    expect(first.damaged).toEqual([{ sessionId: "bbb", amount: 15 }]);

    // Ten more ticks parked in the same place.
    let carried = first.instance;
    for (let tick = 102; tick <= 111; tick++) {
      const out = resolveInstanceHits(carried, carried, inside, "ffa", tick);
      expect(out.damaged, `tick ${tick}`).toEqual([]);
      carried = out.instance;
    }
  });

  it("re-arms on exit, so leaving and returning costs a second hit", () => {
    modeBox.current = "perEntry";
    const field = burstAt(400, 300, 100);

    const entered = resolveInstanceHits(field, field, snapshot([INSIDE]), "ffa", 101);
    expect(entered.damaged).toHaveLength(1);

    const left = resolveInstanceHits(entered.instance, entered.instance, snapshot([OUTSIDE]), "ffa", 102);
    expect(left.damaged).toEqual([]);
    expect(left.instance.damageClock.has("bbb")).toBe(false);

    const returned = resolveInstanceHits(left.instance, left.instance, snapshot([INSIDE]), "ffa", 103);
    expect(returned.damaged).toEqual([{ sessionId: "bbb", amount: 15 }]);
  });

  it("does not re-arm for a car that merely leaves the snapshot (LZ11)", () => {
    // A car that dies or goes `phased` inside the field is dropped from the snapshot by
    // `isTargetable` — it never fails the overlap test, so it must not count as having exited.
    modeBox.current = "perEntry";
    const field = burstAt(400, 300, 100);
    const entered = resolveInstanceHits(field, field, snapshot([INSIDE]), "ffa", 101);

    const gone = resolveInstanceHits(entered.instance, entered.instance, snapshot([]), "ffa", 102);
    expect(gone.instance.damageClock.has("bbb")).toBe(true);

    const back = resolveInstanceHits(gone.instance, gone.instance, snapshot([INSIDE]), "ffa", 103);
    expect(back.damaged).toEqual([]);
  });

  it("leaves an onceEver field damaging each car exactly once, ever (LZ6)", () => {
    modeBox.current = "onceEver";
    const field = burstAt(400, 300, 100);
    const entered = resolveInstanceHits(field, field, snapshot([INSIDE]), "ffa", 101);
    expect(entered.damaged).toHaveLength(1);

    const left = resolveInstanceHits(entered.instance, entered.instance, snapshot([OUTSIDE]), "ffa", 102);
    const returned = resolveInstanceHits(left.instance, left.instance, snapshot([INSIDE]), "ffa", 103);
    expect(returned.damaged).toEqual([]);
  });
});

