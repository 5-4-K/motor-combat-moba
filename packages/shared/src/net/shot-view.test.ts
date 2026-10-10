import { beforeEach, describe, expect, it } from "vitest";
import { ARENA_01 } from "../arena/arena-01.js";
import { boundsOf } from "../arena/bounds.js";
import { hpOf } from "../config/car-config.js";
import { NET_CONFIG } from "../config/net-config.js";
import type { CarId } from "../config/types.js";
import { weaponDefOf } from "../config/weapon-config.js";
import { msToTicks } from "../config/weapon-ticks.js";
import { MS_PER_TICK } from "../constants.js";
import { installMode } from "../modes/active.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../modes/registry.js";
import type { Aabb, Bounds } from "../sim/collide.js";
import { runCombat, type CombatPlayer, type CombatResult } from "../sim/combat.js";
import { ManeuverKind } from "../sim/maneuver.js";
import type { SimBody } from "../sim/step.js";
import { newFireState } from "../sim/weapons/fire.js";
import {
  bounceOffWorld,
  spawnInstances,
  stepInstance,
  type StepInstanceContext,
  type WeaponInstance,
} from "../sim/weapons/instances.js";
import { ShotView, shotFromWire, shotViewMaxTicks, type ShotPose, type WireShot } from "./shot-view.js";
import { localAnchorOf } from "./tick-interpolation.js";

installMode(modeConfigOf(DEFAULT_GAME_MODE));
beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const DT = MS_PER_TICK / 1000;
const BOUNDS: Bounds = { width: 1280, height: 720 };
const SNAP = 100;

function world(obstacles: readonly Aabb[] = [], ownerPose: StepInstanceContext["ownerPose"] = null, bounds = BOUNDS): StepInstanceContext {
  return { dt: DT, tick: SNAP, obstacles, bounds, ownerPose, homingTarget: null };
}

/** A copy: `at` hands back one reused object per id. */
const copy = (p: Readonly<ShotPose> | undefined): ShotPose | undefined => (p ? { ...p } : undefined);

function wireOf(i: WeaponInstance): WireShot {
  return {
    id: i.id,
    ownerSessionId: i.ownerSessionId,
    weaponId: i.weaponId,
    x: i.x,
    y: i.y,
    angle: i.angle,
    extent: i.extent,
    spawnTick: i.spawnTick,
    isExplosion: i.isExplosion,
    lifeOffsetTicks: i.lifeOffsetTicks ?? 0,
  };
}

/** A real instance, born the way the server births one at SNAP, as the client rebuilds it. */
function shot(weaponId: "pepperbox" | "thumper" | "predator" | "afterburner", x: number, y: number, angle: number): WeaponInstance {
  const carId = weaponId === "thumper" ? "bastion" : weaponId === "afterburner" ? "mirage" : "bullseye";
  const { instances } = spawnInstances(
    { weaponId, slot: 1, finalVolley: true, pressId: "p" },
    { sessionId: "a", team: 0, carId, x, y, angle },
    SNAP,
    0,
  );
  // The forward muzzle's middle pellet: one shot dead along `angle` is all that is under test.
  const ahead = instances.filter((i) => i.muzzleDir === 0);
  return shotFromWire(wireOf(ahead[Math.floor(ahead.length / 2)]!), SNAP)!;
}

/** What the server does to it over `n` ticks: `stepInstance`, one tick at a time, world included. */
function serverSteps(start: WeaponInstance, n: number, ctx: StepInstanceContext): WeaponInstance {
  let s = start;
  for (let i = 1; i <= n; i++) s = stepInstance(s, { ...ctx, tick: SNAP + i, homingTarget: null });
  return s;
}

describe("ShotView", () => {
  it("advances a straight projectile 3 ticks by exactly 3 x v x dt", () => {
    const start = shot("pepperbox", 200, 300, 0);
    const view = new ShotView(20);
    view.update("s", SNAP, start, world());
    const at = view.at("s", SNAP + 3)!;
    const v = weaponDefOf("pepperbox").speed;
    expect(at.x - start.x).toBeCloseTo(3 * v * DT, 9);
    expect(at.y).toBeCloseTo(start.y, 9);
  });

  it("interpolates between whole ticks, so a shot drawn at a fractional tick sits between them", () => {
    const start = shot("pepperbox", 200, 300, 0);
    const view = new ShotView(20);
    view.update("s", SNAP, start, world());
    const v = weaponDefOf("pepperbox").speed;
    expect(view.at("s", SNAP + 2.25)!.x - start.x).toBeCloseTo(2.25 * v * DT, 9);
  });

  it("bounces a bouncing projectile off a wall exactly where stepInstance + bounceOffWorld do", () => {
    // 450 u/s is 7.5 u a tick: started 20 u short of the right wall, it crosses it on tick 3.
    const start = shot("thumper", BOUNDS.width - 20, 300, 0);
    const view = new ShotView(20);
    view.update("s", SNAP, start, world());
    const n = 8;
    const expected = serverSteps(start, n, world());
    const drawn = view.at("s", SNAP + n)!;
    expect(drawn.x).toBeCloseTo(expected.x, 9);
    expect(drawn.y).toBeCloseTo(expected.y, 9);
    expect(drawn.angle).toBeCloseTo(expected.angle, 9);
    expect(Math.cos(drawn.angle)).toBeLessThan(0);
    expect(drawn.x).toBeLessThan(BOUNDS.width);

    // Step by step, the tick that crosses the wall is `bounceOffWorld` applied to the straight step.
    const step = weaponDefOf("thumper").speed * DT;
    let prev = { x: start.x, y: start.y, angle: start.angle };
    for (let i = 1; i <= n; i++) {
      const straight = { x: prev.x + Math.cos(prev.angle) * step, y: prev.y + Math.sin(prev.angle) * step };
      const want = bounceOffWorld(prev.x, prev.y, straight.x, straight.y, prev.angle, [], BOUNDS);
      const got = copy(view.at("s", SNAP + i))!;
      expect(got.x).toBeCloseTo(want.x, 9);
      expect(got.angle).toBeCloseTo(want.angle, 9);
      prev = got;
    }
  });

  it("bounces off an obstacle too, because it is handed the arena's obstacles", () => {
    const box: Aabb = { x: 300, y: 250, w: 40, h: 100 };
    // thumper is turret-aimed now (born at pivot + defaultOffset 25, not the nose at +30), so start
    // the car 5u further out to keep the shot's spawn — and thus this bounce geometry — unchanged.
    const start = shot("thumper", 285, 300, 0);
    const view = new ShotView(20);
    view.update("s", SNAP, start, world([box]));
    const expected = serverSteps(start, 10, world([box]));
    const drawn = view.at("s", SNAP + 10)!;
    expect(drawn.x).toBeCloseTo(expected.x, 9);
    expect(drawn.angle).toBeCloseTo(expected.angle, 9);
    expect(drawn.x).toBeLessThan(box.x);
  });

  it("caps the advance at maxTicks past the snapshot, and holds there", () => {
    const start = shot("pepperbox", 100, 300, 0);
    const view = new ShotView(4);
    view.update("s", SNAP, start, world());
    expect(copy(view.at("s", SNAP + 50))).toEqual(copy(view.at("s", SNAP + 4)));
    const v = weaponDefOf("pepperbox").speed;
    expect(view.at("s", SNAP + 50)!.x - start.x).toBeCloseTo(4 * v * DT, 9);
  });

  it("sizes its cap from maxExtrapolateMs + maxDelayMs", () => {
    expect(shotViewMaxTicks()).toBe(msToTicks(NET_CONFIG.maxExtrapolateMs + NET_CONFIG.maxDelayMs));
  });

  it("hides a non-bouncing shot from the tick the server's wall test ends it, never drawing it through", () => {
    const box: Aabb = { x: 300, y: 250, w: 40, h: 100 };
    const start = shot("pepperbox", 200, 300, 0);
    const view = new ShotView(20);
    view.update("s", SNAP, start, world([box]));
    let lastSeen = -1;
    for (let t = SNAP; t <= SNAP + 20; t++) {
      const at = view.at("s", t);
      if (at) {
        expect(at.x).toBeLessThan(box.x);
        lastSeen = t;
      }
    }
    expect(lastSeen).toBeGreaterThan(SNAP);
    expect(view.at("s", SNAP + 20)).toBeUndefined();
  });

  it("holds a homing shot's heading: the client has no target to steer it at", () => {
    const start = shot("predator", 200, 300, 0);
    const view = new ShotView(20);
    view.update("s", SNAP, { ...start, homingTargetId: "b" }, { ...world(), homingTarget: { x: 200, y: 600 } });
    const at = view.at("s", SNAP + 5)!;
    expect(at.angle).toBe(start.angle);
    expect(at.y).toBeCloseTo(start.y, 9);
  });

  it("re-anchors an attached beam to the owner's DRAWN pose, not its snapshot pose", () => {
    const owner = { x: 400, y: 300, angle: 0 };
    const beam = shot("afterburner", owner.x, owner.y, owner.angle);
    const view = new ShotView(20);
    view.update("b", SNAP, beam, world([], owner));
    const drawnOwner = { x: 430, y: 310, angle: 0.3 };
    const at = view.at("b", SNAP + 2, drawnOwner)!;
    const expected = stepInstance(beam, { ...world([], drawnOwner), dt: 2 * DT, tick: SNAP + 2 });
    expect(at.x).toBeCloseTo(expected.x, 9);
    expect(at.y).toBeCloseTo(expected.y, 9);
    expect(at.angle).toBeCloseTo(0.3, 9);
    expect(at.extent).toBeCloseTo(expected.extent, 9);
  });

  it("leaves an explosion where it is", () => {
    const burst = { ...shot("pepperbox", 500, 300, 0), x: 500, y: 300, weaponId: "magmablast" as const, kind: "beam" as const, isExplosion: true, extent: 60 };
    const view = new ShotView(20);
    view.update("x", SNAP, burst, world());
    expect(view.at("x", SNAP + 1)).toMatchObject({ x: 500, y: 300, extent: 60 });
  });

  it("forgets, and forgetAllBut sweeps every id not live", () => {
    const view = new ShotView(20);
    view.update("s", SNAP, shot("pepperbox", 100, 300, 0), world());
    view.update("t", SNAP, shot("pepperbox", 100, 400, 0), world());
    view.forget("s");
    expect(view.at("s", SNAP + 1)).toBeUndefined();
    view.forgetAllBut(new Set());
    expect([...view.ids()]).toEqual([]);
  });

  it("keeps its cache for a repeat of the same snapshot tick", () => {
    const start = shot("pepperbox", 100, 300, 0);
    const view = new ShotView(20);
    view.update("s", SNAP, start, world());
    expect(view.isCurrent("s", SNAP)).toBe(true);
    view.update("s", SNAP, { ...start, x: 999 }, world());
    expect(view.at("s", SNAP)!.x).toBe(start.x);
    expect(view.isCurrent("s", SNAP + 1)).toBe(false);
  });

  it("a newer snapshot on the same path moves nothing, straight or bouncing", () => {
    for (const [id, start] of [
      ["line", shot("pepperbox", 100, 300, 0)],
      ["bounce", shot("thumper", BOUNDS.width - 40, 300, 0.1)],
    ] as const) {
      const view = new ShotView(20);
      view.update(id, SNAP, start, world());
      const before = copy(view.at(id, SNAP + 12))!;
      view.update(id, SNAP + 2, serverSteps(start, 2, world()), world());
      const after = view.at(id, SNAP + 12)!;
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
      const want = serverSteps(start, 22, world());
      expect(view.at(id, SNAP + 22)!.x).toBeCloseTo(want.x, 9);
    }
  });

  it("eases a rebased path in, so the drawn shot never jumps more than one tick of its own motion", () => {
    const start = shot("predator", 100, 300, 0);
    const step = weaponDefOf("predator").speed * DT;
    const view = new ShotView(20);
    view.update("s", SNAP, start, world());
    const P = SNAP + 15;
    const before = copy(view.at("s", P))!;
    const turned = { ...start, x: start.x + step, angle: (20 * Math.PI) / 180 };
    view.update("s", SNAP + 1, turned, world());
    const first = copy(view.at("s", P))!;
    expect(Math.hypot(first.x - before.x, first.y - before.y)).toBeLessThanOrEqual(step + 1e-9);
    expect(copy(view.at("s", P))).toEqual(first);
    const later = copy(view.at("s", P + 30));
    const truth = new ShotView(20);
    truth.update("s", SNAP + 1, turned, world());
    expect(later).toEqual(copy(truth.at("s", P + 30)));
  });

  it("draws a tick behind its newest snapshot from the snapshots themselves, and nothing before it was fired", () => {
    const start = shot("pepperbox", 200, 300, 0);
    const view = new ShotView(20);
    const w = world();
    view.update("s", SNAP, start, w);
    view.update("s", SNAP + 1, serverSteps(start, 1, w), w);
    view.update("s", SNAP + 2, serverSteps(start, 2, w), w);
    expect(view.at("s", SNAP + 0.5)!.x).toBeCloseTo((start.x + serverSteps(start, 1, w).x) / 2, 9);
    expect(view.at("s", SNAP)!.x).toBe(start.x);
    // Born on SNAP (first seen on its spawn tick): before that it did not exist.
    expect(view.at("s", SNAP - 0.5)).toBeUndefined();
  });

  it("never draws a shot behind the tick it was first seen, even one first seen after its spawn tick", () => {
    // A late joiner, or a burst `settleBurst` backdated inside a compensated shell's fast-forward:
    // the first snapshot holding it is later than its spawn tick. A spectator drawing behind that
    // snapshot must not see it before it was there.
    const start = shot("pepperbox", 200, 300, 0);
    const w = world();
    const view = new ShotView(20);
    view.update("s", SNAP + 3, serverSteps(start, 3, w), w);
    expect(view.at("s", SNAP + 2)).toBeUndefined();
    expect(view.at("s", SNAP + 2.9)).toBeUndefined();
    expect(view.at("s", SNAP + 3)!.x).toBeCloseTo(serverSteps(start, 3, w).x, 9);
  });
});

describe("ShotView against the server's own combat loop", () => {
  const T = 200;
  const MASK_SLOT = (slot: number) => 1 << slot;

  function shooter(carId: CarId, x: number, y: number, angle: number, fireMask: number): CombatPlayer {
    return {
      sessionId: "aaa", x, y, angle, team: 0, carId, hp: hpOf(carId), alive: true, inRoster: true, fireMask,
      fireState: newFireState(carId, 1), statuses: [], maneuver: ManeuverKind.NONE, maneuverTicksLeft: 0,
      maneuverAngle: 0, maneuverSpeed: 0, maneuverWeaponId: "", maneuverPressId: "", lastDamagerSessionId: "",
    };
  }

  /** Every tick's shells, from the press at T until none is left (or `until`). */
  function serverRun(o: {
    carId: CarId; slot: number; k?: number; pose: { x: number; y: number; angle: number };
    obstacles?: readonly Aabb[]; bounds: Bounds; until: number;
    /** The shooter's pose on tick t (default: still). */
    poseAt?: (t: number) => { x: number; y: number; angle: number };
  }): Map<number, Map<string, WeaponInstance>> {
    const byTick = new Map<number, Map<string, WeaponInstance>>();
    let players: CombatPlayer[] = [shooter(o.carId, o.pose.x, o.pose.y, o.pose.angle, MASK_SLOT(o.slot))];
    let instances: readonly WeaponInstance[] = [];
    let seq = 0;
    for (let tick = T; tick <= o.until; tick++) {
      if (o.poseAt) players = players.map((p) => ({ ...p, ...o.poseAt!(tick) }));
      const r: CombatResult = runCombat({
        world: { tick, dt: DT, mode: "ffa", obstacles: o.obstacles ?? [], bounds: o.bounds },
        players,
        instances,
        instanceSeq: seq,
        fastForward: tick === T && o.k ? new Map([["aaa", o.k]]) : undefined,
      });
      players = r.players.map((p) => ({ ...p, fireMask: 0 }));
      instances = r.instances;
      seq = r.instanceSeq;
      byTick.set(tick, new Map(r.instances.filter((i) => !i.isExplosion).map((i) => [i.id, i])));
    }
    return byTick;
  }

  /** Feed the snapshot at `snap`, then: drawn on exactly the ticks the server still has it, at its pose. */
  function expectParity(byTick: Map<number, Map<string, WeaponInstance>>, snap: number, w: StepInstanceContext): number {
    const view = new ShotView(shotViewMaxTicks());
    const ids = [...byTick.get(snap)!.keys()];
    expect(ids.length).toBeGreaterThan(0);
    let deaths = 0;
    for (const id of ids) {
      view.update(id, snap, shotFromWire(wireOf(byTick.get(snap)!.get(id)!), snap)!, w);
      for (let t = snap; t <= snap + shotViewMaxTicks(); t++) {
        const server = byTick.get(t)?.get(id);
        const drawn = view.at(id, t);
        expect(drawn !== undefined, `${id} at ${t}: server ${server ? "has" : "lost"} it`).toBe(server !== undefined);
        if (server && drawn) {
          expect(drawn.x).toBeCloseTo(server.x, 6);
          expect(drawn.y).toBeCloseTo(server.y, 6);
        }
        if (!server && byTick.get(t - 1)?.get(id)) deaths++;
      }
    }
    return deaths;
  }

  const OPEN: Bounds = { width: 5000, height: 5000 };
  const openWorld = (): StepInstanceContext => ({ ...world([], null, OPEN) });
  const deathTick = (byTick: Map<number, Map<string, WeaponInstance>>, from: number): number => {
    for (let t = from; ; t++) if (!byTick.get(t) || byTick.get(t)!.size === 0) return t;
  };

  it("a range-limited shot (pepperbox) disappears on the tick the server's dies", () => {
    const byTick = serverRun({ carId: "bullseye", slot: 2, pose: { x: 2500, y: 2500, angle: 0.3 }, bounds: OPEN, until: T + 80 });
    const dead = deathTick(byTick, T);
    expect(expectParity(byTick, dead - 10, openWorld())).toBeGreaterThan(0);
  });

  it("a lifetime shot (predator, homing with nobody to home on) disappears on the tick the server's dies", () => {
    const byTick = serverRun({ carId: "bullseye", slot: 1, pose: { x: 1500, y: 2500, angle: 0 }, bounds: OPEN, until: T + 140 });
    const dead = deathTick(byTick, T);
    expect(dead - T).toBe(msToTicks(weaponDefOf("predator").lifetimeMs!));
    expect(expectParity(byTick, dead - 10, openWorld())).toBeGreaterThan(0);
  });

  it("a bouncing lifetime shot (thumper) bounces and expires with the server's", () => {
    const bounds = boundsOf(ARENA_01);
    const w = world(ARENA_01.obstacles, null, bounds);
    const byTick = serverRun({ carId: "bastion", slot: 1, pose: { x: 640, y: 360, angle: 0.4 }, obstacles: ARENA_01.obstacles, bounds, until: T + 200 });
    const dead = deathTick(byTick, T);
    expect(expectParity(byTick, T, w)).toBe(0);
    expect(expectParity(byTick, dead - 10, w)).toBeGreaterThan(0);
  });

  it("a compensated shot (lifeOffsetTicks > 0) is drawn and ends exactly as the server's", () => {
    for (const [slot, carId] of [[2, "bullseye"], [1, "bullseye"]] as const) {
      const byTick = serverRun({ carId, slot, k: 5, pose: { x: 2000, y: 2500, angle: 0 }, bounds: OPEN, until: T + 140 });
      const born = [...byTick.get(T)!.values()][0]!;
      expect(born.lifeOffsetTicks).toBe(5);
      const dead = deathTick(byTick, T);
      expectParity(byTick, T, openWorld());
      expect(expectParity(byTick, dead - 10, openWorld())).toBeGreaterThan(0);
    }
  });

  it("a shot into the arena wall disappears on the tick the server's wall test ends it", () => {
    const bounds = boundsOf(ARENA_01);
    const w = world(ARENA_01.obstacles, null, bounds);
    const byTick = serverRun({ carId: "bullseye", slot: 2, pose: { x: ARENA_01.width - 280, y: 360, angle: 0 }, obstacles: ARENA_01.obstacles, bounds, until: T + 60 });
    expect(expectParity(byTick, T, w)).toBeGreaterThan(0);
  });

  it("a shot fired by the driven car leaves its DRAWN muzzle at the tick the car is drawn at (tick convention)", () => {
    // The car drives right at 4 u/tick; it presses on T. The snapshot tagged T holds the car's pose
    // at the END of tick T and the shot born from it; prediction's newest tick T is that same pose.
    const v = 4;
    const poseAt = (t: number) => ({ x: 1000 + v * (t - T), y: 2500, angle: 0 });
    const byTick = serverRun({ carId: "bullseye", slot: 1, pose: poseAt(T), poseAt, bounds: OPEN, until: T + 3 });
    const body = (t: number): SimBody => ({
      ...poseAt(t), vx: v / DT, vy: 0, angVel: 0,
      maneuver: ManeuverKind.NONE, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
    });
    const born = [...byTick.get(T)!.values()][0]!;
    const view = new ShotView(shotViewMaxTicks());
    view.update(born.id, T, shotFromWire(wireOf(born), T)!, openWorld());
    // Newest predicted tick T, drawn at the end of it (phase 1).
    const anchor = localAnchorOf({ predicted: body(T), predictedPrev: body(T - 1), newestPredictedTick: T, alive: true, drawTickNow: undefined })!;
    const drawn = view.at(born.id, anchor.tick)!;
    // predator (bullseye slot 1) is turret-aimed, so it is born at the turret muzzle, not the nose
    // `muzzleOf` returns. The tick convention is that at the spawn tick the drawn shot sits exactly
    // where it was born — the muzzle — so assert against the born instance directly.
    expect(drawn.x).toBeCloseTo(born.x, 9);
    expect(drawn.y).toBeCloseTo(born.y, 9);
    // Mid-tick, the car is half way through tick T+1 and the shot half a step past its tick-T spot.
    const mid = localAnchorOf({ predicted: body(T + 1), predictedPrev: body(T), newestPredictedTick: T + 1, alive: true, drawTickNow: T + 1.5 })!;
    const server1 = byTick.get(T + 1)!.get(born.id)!;
    expect(view.at(born.id, mid.tick)!.x).toBeCloseTo((born.x + server1.x) / 2, 9);
  });
});

describe("shotFromWire", () => {
  it("rebuilds a sim instance from the networked fields, moving exactly as the sim's own does", () => {
    const real = spawnInstances(
      { weaponId: "thumper", slot: 1, finalVolley: true, pressId: "p" },
      { sessionId: "a", team: 0, carId: "bastion", x: 1200, y: 300, angle: 0.2 },
      SNAP,
      0,
    ).instances[0]!;
    const rebuilt = shotFromWire(wireOf(real), SNAP)!;
    expect(rebuilt.expiresAtTick).toBe(real.expiresAtTick);
    expect(rebuilt.distance).toBe(0);
    const a = serverSteps(real, 12, world());
    const b = serverSteps(rebuilt, 12, world());
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.angle).toBeCloseTo(a.angle, 9);
  });

  it("refuses an unknown weapon id rather than inventing a motion for it", () => {
    expect(
      shotFromWire(
        { id: "x", ownerSessionId: "a", weaponId: "nope", x: 0, y: 0, angle: 0, extent: 0, spawnTick: 0, isExplosion: false, lifeOffsetTicks: 0 },
        0,
      ),
    ).toBeUndefined();
  });
});
