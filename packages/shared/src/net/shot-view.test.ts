import { beforeEach, describe, expect, it } from "vitest";
import { MS_PER_TICK } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";
import { weaponDefOf } from "../config/weapon-config.js";
import { msToTicks } from "../config/weapon-ticks.js";
import { installMode } from "../modes/active.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../modes/registry.js";
import type { Aabb, Bounds } from "../sim/collide.js";
import {
  bounceOffWorld,
  spawnInstances,
  stepInstance,
  type StepInstanceContext,
  type WeaponInstance,
} from "../sim/weapons/instances.js";
import { ShotView, shotFromWire, shotViewMaxTicks } from "./shot-view.js";

installMode(modeConfigOf(DEFAULT_GAME_MODE));
beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const DT = MS_PER_TICK / 1000;
const BOUNDS: Bounds = { width: 1280, height: 720 };
const SNAP = 100;

function world(obstacles: readonly Aabb[] = [], ownerPose: StepInstanceContext["ownerPose"] = null): StepInstanceContext {
  return { dt: DT, tick: SNAP, obstacles, bounds: BOUNDS, ownerPose, homingTarget: null };
}

/** A real instance, born the way the server births one. */
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
  return ahead[Math.floor(ahead.length / 2)]!;
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

  it("does not draw before its snapshot: a tick at or behind it is the snapshot itself", () => {
    const start = shot("pepperbox", 200, 300, 0);
    const view = new ShotView(20);
    view.update("s", SNAP, start, world());
    expect(view.at("s", SNAP - 4)!.x).toBe(start.x);
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
    // It really did bounce: heading back left, inside the arena.
    expect(Math.cos(drawn.angle)).toBeLessThan(0);
    expect(drawn.x).toBeLessThan(BOUNDS.width);

    // And the bounce is the shared one, step by step: the tick that crosses the wall is
    // `bounceOffWorld` applied to the straight step, nothing client-side.
    const step = weaponDefOf("thumper").speed * DT;
    let prev = start;
    for (let i = 1; i <= n; i++) {
      const straight = { x: prev.x + Math.cos(prev.angle) * step, y: prev.y + Math.sin(prev.angle) * step };
      const want = bounceOffWorld(prev.x, prev.y, straight.x, straight.y, prev.angle, [], BOUNDS);
      const got = view.at("s", SNAP + i)!;
      expect(got.x).toBeCloseTo(want.x, 9);
      expect(got.angle).toBeCloseTo(want.angle, 9);
      prev = got;
    }
  });

  it("bounces off an obstacle too, because it is handed the arena's obstacles", () => {
    const box: Aabb = { x: 300, y: 250, w: 40, h: 100 };
    const start = shot("thumper", 280, 300, 0);
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
    expect(view.at("s", SNAP + 50)).toEqual(view.at("s", SNAP + 4));
    const v = weaponDefOf("pepperbox").speed;
    expect(view.at("s", SNAP + 50)!.x - start.x).toBeCloseTo(4 * v * DT, 9);
  });

  it("sizes its cap from maxExtrapolateMs + maxDelayMs", () => {
    expect(shotViewMaxTicks()).toBe(msToTicks(NET_CONFIG.maxExtrapolateMs + NET_CONFIG.maxDelayMs));
  });

  it("stops a non-bouncing shot where the server's wall test ends it, never drawing it through", () => {
    const box: Aabb = { x: 300, y: 250, w: 40, h: 100 };
    const start = shot("pepperbox", 260, 300, 0);
    const view = new ShotView(20);
    view.update("s", SNAP, start, world([box]));
    const far = view.at("s", SNAP + 20)!;
    expect(far.x).toBeLessThan(box.x);
    // Held, not hidden: its end is the server's to report.
    expect(view.at("s", SNAP + 19)).toEqual(far);
  });

  it("holds a homing shot's heading: the client has no target to steer it at", () => {
    const start = shot("predator", 200, 300, 0);
    const homed = { ...start, homingTargetId: "b" };
    const view = new ShotView(20);
    view.update("s", SNAP, homed, { ...world(), homingTarget: { x: 200, y: 600 } });
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
    expect(view.at("x", SNAP + 6)).toMatchObject({ x: 500, y: 300, extent: 60 });
  });

  it("forgets", () => {
    const view = new ShotView(20);
    view.update("s", SNAP, shot("pepperbox", 100, 300, 0), world());
    view.forget("s");
    expect(view.at("s", SNAP + 1)).toBeUndefined();
    expect([...view.ids()]).toEqual([]);
  });

  it("keeps its cache for a repeat of the same snapshot tick, rebuilds it on a newer one", () => {
    const start = shot("pepperbox", 100, 300, 0);
    const view = new ShotView(20);
    view.update("s", SNAP, start, world());
    expect(view.isCurrent("s", SNAP)).toBe(true);
    view.update("s", SNAP, { ...start, x: 999 }, world());
    expect(view.at("s", SNAP)!.x).toBe(start.x);
    expect(view.isCurrent("s", SNAP + 1)).toBe(false);
  });

  it("a newer snapshot on the same straight path moves nothing", () => {
    const start = shot("pepperbox", 100, 300, 0);
    const view = new ShotView(20);
    view.update("s", SNAP, start, world());
    const before = view.at("s", SNAP + 6)!;
    view.update("s", SNAP + 1, serverSteps(start, 1, world()), world());
    const after = view.at("s", SNAP + 6)!;
    expect(after.x).toBeCloseTo(before.x, 9);
  });

  it("keeps the confirmed path across a newer snapshot and extends it exactly as the server would", () => {
    const start = shot("thumper", BOUNDS.width - 40, 300, 0.1);
    const view = new ShotView(20);
    view.update("s", SNAP, start, world());
    view.at("s", SNAP + 12);
    const confirmed = serverSteps(start, 2, world());
    view.update("s", SNAP + 2, confirmed, world());
    expect(view.at("s", SNAP + 2)).toEqual(confirmed);
    const want = serverSteps(start, 22, world());
    const got = view.at("s", SNAP + 22)!;
    expect(got.x).toBeCloseTo(want.x, 9);
    expect(got.y).toBeCloseTo(want.y, 9);
    expect(got.angle).toBeCloseTo(want.angle, 9);
  });

  it("eases a rebased path in, so the drawn shot never jumps more than one tick of its own motion", () => {
    // A homing shot the server curved: the client drew it straight, and the next snapshot says it
    // has turned 20 degrees. Drawn far ahead of its snapshot, that is a big jump if taken whole.
    const start = shot("predator", 100, 300, 0);
    const step = weaponDefOf("predator").speed * DT;
    const view = new ShotView(20);
    view.update("s", SNAP, start, world());
    const P = SNAP + 15;
    const before = view.at("s", P)!;
    const turned = { ...start, x: start.x + step, angle: (20 * Math.PI) / 180 };
    view.update("s", SNAP + 1, turned, world());
    const first = view.at("s", P)!;
    expect(Math.hypot(first.x - before.x, first.y - before.y)).toBeLessThanOrEqual(step + 1e-9);
    // Repeat calls on the same frame agree (the scene asks several times a frame).
    expect(view.at("s", P)).toEqual(first);
    // And it converges onto the new path rather than carrying the gap for ever.
    const later = view.at("s", P + 30)!;
    const truth = new ShotView(20);
    truth.update("s", SNAP + 1, turned, world());
    expect(later).toEqual(truth.at("s", P + 30));
  });
});

describe("shotFromWire", () => {
  it("rebuilds a sim instance from the networked fields, moving exactly as the sim's own does", () => {
    const real = shot("thumper", 1200, 300, 0.2);
    const wire = {
      id: real.id,
      ownerSessionId: real.ownerSessionId,
      weaponId: real.weaponId,
      x: real.x,
      y: real.y,
      angle: real.angle,
      extent: real.extent,
      spawnTick: real.spawnTick,
      isExplosion: false,
      lifeOffsetTicks: 0,
    };
    const rebuilt = shotFromWire(wire)!;
    const a = serverSteps(real, 12, world());
    const b = serverSteps(rebuilt, 12, world());
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.angle).toBeCloseTo(a.angle, 9);
  });

  it("refuses an unknown weapon id rather than inventing a motion for it", () => {
    expect(
      shotFromWire({
        id: "x", ownerSessionId: "a", weaponId: "nope", x: 0, y: 0, angle: 0, extent: 0, spawnTick: 0,
        isExplosion: false, lifeOffsetTicks: 0,
      }),
    ).toBeUndefined();
  });
});
