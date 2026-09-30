import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../modes/registry.js";
import { installMode } from "../modes/active.js";
import { ACTIVE_ARENA_ID } from "../config/arena-config.js";
import { ManeuverKind } from "../sim/maneuver.js";
import { MS_PER_TICK, SNAPSHOT_RATE_HZ } from "../constants.js";
import { NEUTRAL_MODIFIERS } from "../sim/status/modifiers.js";
import { NET_CONFIG } from "../config/net-config.js";
import { getArena } from "../arena/registry.js";
import { ramDefenceOf } from "../config/car-config.js";
import { stepSim, type SimBody, type StepContext } from "../sim/step.js";
import { TickPrediction, reconcileEasePerSnapshot } from "./prediction.js";
import { msToTicks } from "../config/weapon-ticks.js";
import type { InputFrame, InputKeys } from "./tick-input.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));
// Also installed directly, synchronously, at module scope: fixture constants below (and
// some describe bodies) read config during test COLLECTION, which happens once, before any
// beforeEach hook ever fires.
installMode(modeConfigOf(DEFAULT_GAME_MODE));

const arena = getArena(ACTIVE_ARENA_ID);
const ctx: StepContext = {
  carId: "mirage",
  others: [],
  obstacles: arena.obstacles,
  bounds: { width: arena.width, height: arena.height },
  // Unbuffed: every expectation here is the plain drive model.
  modifiers: NEUTRAL_MODIFIERS,
  // `others` is empty in every case here, so nothing actually reads this — `ramDefenceOf` rather
  // than a hardcoded number so this stays true (not a silently stale copy) if Mirage's ramDefence
  // rating ever changes.
  selfRamDefence: ramDefenceOf("mirage"),
};

const DT = MS_PER_TICK / 1000;
const START: SimBody = {
  x: 200,
  y: 200,
  angle: 0,
  vx: 0,
  vy: 0,
  angVel: 0,
  maneuver: 0,
  maneuverTicksLeft: 0,
  maneuverAngle: 0,
  maneuverSpeed: 0,
};

const UP: InputKeys = { steer: 0, throttle: 1, fireSlots: 0 };

/**
 * A predicted pose deliberately far enough from the replayed target to force the snap branch, so a
 * test can read the replay target back out of `reconcile` verbatim instead of through the ease.
 */
function farFrom(body: SimBody): SimBody {
  return { ...body, x: body.x + NET_CONFIG.reconcileSnapPos * 10 };
}

describe("TickPrediction.predict", () => {
  it("runs the shared stepSim, so Up from rest moves the pose forward", () => {
    const tp = new TickPrediction();
    const out = tp.predict(START, { tick: 1, ...UP }, ctx);
    expect(out).toEqual(stepSim(START, UP, DT, ctx));
    expect(out.x).toBeGreaterThan(START.x);
    expect(out.vx).toBeGreaterThan(0);
  });
});

describe("TickPrediction.reconcile (settle)", () => {
  it("snaps to the replayed target when the position error exceeds reconcileSnapPos", () => {
    const buf = new TickPrediction();
    const authoritative: SimBody = {
      x: 400,
      y: 400,
      angle: 0.2,
      vx: 30,
      vy: 6,
      angVel: 0,
      maneuver: 0,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
    };
    const wayOff: SimBody = {
      ...authoritative,
      x: authoritative.x + NET_CONFIG.reconcileSnapPos + 1,
    };

    expect(buf.reconcile(authoritative, 0, wayOff, ctx)).toEqual(authoritative);
  });

  it("snaps when the angle error exceeds reconcileSnapAngle even with position in tolerance", () => {
    const buf = new TickPrediction();
    const authoritative: SimBody = {
      x: 400,
      y: 400,
      angle: 0,
      vx: 0,
      vy: 0,
      angVel: 0,
      maneuver: 0,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
    };
    const twisted: SimBody = { ...authoritative, angle: NET_CONFIG.reconcileSnapAngle + 0.1 };

    expect(buf.reconcile(authoritative, 0, twisted, ctx)).toEqual(authoritative);
  });

  it("eases x/y toward the target inside the snap threshold", () => {
    const buf = new TickPrediction();
    const authoritative: SimBody = {
      x: 400,
      y: 400,
      angle: 0,
      vx: 0,
      vy: 0,
      angVel: 0,
      maneuver: 0,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
    };
    const nearby: SimBody = { ...authoritative, x: 410, y: 406 };

    const out = buf.reconcile(authoritative, 0, nearby, ctx);
    const rate = reconcileEasePerSnapshot();
    expect(out.x).toBeCloseTo(410 + rate * (400 - 410), 10);
    expect(out.y).toBeCloseTo(406 + rate * (400 - 406), 10);
  });

  it("snaps vx/vy to the replayed target instead of easing them", () => {
    // Derived sim fields are inputs to the next step, so a half-eased velocity would feed a wrong
    // integration next tick and never converge.
    const buf = new TickPrediction();
    const authoritative: SimBody = {
      x: 400,
      y: 400,
      angle: 0,
      vx: 50,
      vy: -20,
      angVel: 0,
      maneuver: 0,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
    };
    const nearby: SimBody = {
      x: 410,
      y: 400,
      angle: 0,
      vx: 0,
      vy: 0,
      angVel: 0,
      maneuver: 0,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
    };

    const out = buf.reconcile(authoritative, 0, nearby, ctx);
    expect(out.vx).toBe(50);
    expect(out.vy).toBe(-20);
    expect(out.x).not.toBe(400);
  });

  it("measures angle error as a wrapped delta, so an accumulated angle does not force a snap", () => {
    // `stepDrive` never normalises `angle`, so after minutes of turning it is thousands of radians.
    // A raw subtraction here would read a ~628 rad error and snap every single tick.
    const buf = new TickPrediction();
    const authoritative: SimBody = {
      x: 400,
      y: 400,
      angle: 0.1,
      vx: 0,
      vy: 0,
      angVel: 0,
      maneuver: 0,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
    };
    const wound = 0.1 + 100 * 2 * Math.PI;
    const spun: SimBody = { ...authoritative, angle: wound };

    const out = buf.reconcile(authoritative, 0, spun, ctx);
    expect(out.angle).toBeCloseTo(wound, 6);
    expect(out.angle).not.toBeCloseTo(authoritative.angle, 6);
  });

  it("snaps angVel and vx/vy to the authoritative value on the EASE path, never eases them", () => {
    // The dangerous mistake here is changing `angVel`/`vx`/`vy` in `reconcile` from a snap to a
    // `lerp` — per R16 that would break the "unpredicted ram" feature outright, and every OTHER test
    // in this suite uses neutral knock values (0, 0, 0) on both sides, so such a change would pass
    // the whole file undetected. Exercising it specifically on the EASE branch (small positional
    // error, so x/y visibly lerp) is what makes this test able to catch a `lerp` slipped in beside
    // the position/angle easing, rather than only a wholesale drop of the fields.
    const buf = new TickPrediction();
    const authoritative: SimBody = {
      x: 400,
      y: 400,
      angle: 0,
      vx: 120,
      vy: -60,
      angVel: 2.5,
      maneuver: 0,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
    };
    const nearby: SimBody = {
      x: 405,
      y: 402,
      angle: 0,
      vx: 0,
      vy: 0,
      angVel: 0,
      maneuver: 0,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
    };

    const out = buf.reconcile(authoritative, 0, nearby, ctx);

    // Precondition: this really is the ease path, not the snap path.
    expect(out.x).not.toBe(authoritative.x);
    expect(out.y).not.toBe(authoritative.y);

    expect(out.angVel).toBe(2.5);
    expect(out.vx).toBe(120);
    expect(out.vy).toBe(-60);
  });

  it("snaps maneuver state on reconcile — it is rules for the next integration, not a pose", () => {
    // Same reasoning as the knock fields above: maneuver state feeds the next `stepSim` call rather
    // than describing a drawn pose, so it must snap to the authoritative value on both the snap AND
    // ease branches, never ease toward it. Exercised on the EASE branch (small positional error)
    // since every other reconcile test in this file uses ManeuverKind.NONE on both sides, which
    // would let a `lerp` slipped in beside the maneuver fields pass unnoticed.
    const buf = new TickPrediction();
    const authoritative: SimBody = {
      x: 400,
      y: 400,
      angle: 0,
      vx: 0,
      vy: 0,
      angVel: 0,
      maneuver: ManeuverKind.DASH,
      maneuverTicksLeft: 5,
      maneuverAngle: 2,
      maneuverSpeed: 1600,
    };
    const nearby: SimBody = {
      x: 405,
      y: 402,
      angle: 0,
      vx: 0,
      vy: 0,
      angVel: 0,
      maneuver: ManeuverKind.NONE,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
    };

    const out = buf.reconcile(authoritative, 0, nearby, ctx);

    // Precondition: this really is the ease path, not the snap path.
    expect(out.x).not.toBe(authoritative.x);
    expect(out.y).not.toBe(authoritative.y);

    // No frames are held by this fresh buffer, so the replayed tail is empty and the
    // authoritative maneuver state passes through untouched.
    expect(out.maneuver).toBe(ManeuverKind.DASH);
    expect(out.maneuverTicksLeft).toBe(5);
    expect(out.maneuverAngle).toBe(2);
    expect(out.maneuverSpeed).toBe(1600);
  });

  it("eases angle the short way round the wrap", () => {
    const buf = new TickPrediction();
    const authoritative: SimBody = {
      x: 400,
      y: 400,
      angle: -3,
      vx: 0,
      vy: 0,
      angVel: 0,
      maneuver: 0,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
    };
    const nearWrap: SimBody = { ...authoritative, angle: 3 };

    const out = buf.reconcile(authoritative, 0, nearWrap, ctx);
    // Short way is +0.283 rad across the seam, not the -6 rad the raw difference suggests.
    const shortWay = -3 - 3 + 2 * Math.PI;
    expect(out.angle).toBeCloseTo(3 + reconcileEasePerSnapshot() * shortWay, 10);
    expect(out.angle).toBeGreaterThan(3);
  });
});

// Phase C I2: the ease is authored per 50 ms (one 20 Hz snapshot) and applied per snapshot, so it
// has to be rescaled to SNAPSHOT_RATE_HZ — at 60 Hz, unscaled, a correction landed three times as
// fast as it was tuned to.
describe("reconcileEasePerSnapshot (Phase C I2)", () => {
  const snapshotMs = 1000 / SNAPSHOT_RATE_HZ;
  const snapshotsPerReference = NET_CONFIG.reconcileEaseReferenceMs / snapshotMs;

  it("compounds to exactly reconcileEaseRate over reconcileEaseReferenceMs of snapshots", () => {
    const perSnapshot = reconcileEasePerSnapshot();
    const remaining = (1 - perSnapshot) ** snapshotsPerReference;
    expect(1 - remaining).toBeCloseTo(NET_CONFIG.reconcileEaseRate, 12);
  });

  it("is reconcileEaseRate itself at the 20 Hz snapshot rate it was authored at", () => {
    expect(reconcileEasePerSnapshot(1000 / NET_CONFIG.reconcileEaseReferenceMs)).toBeCloseTo(
      NET_CONFIG.reconcileEaseRate,
      12,
    );
  });

  it("eases a held error by exactly reconcileEaseRate across one reference span of reconciles", () => {
    // Integer at every shipped rate (60 Hz -> 3 snapshots per 50 ms); the check below needs it.
    expect(Number.isInteger(snapshotsPerReference)).toBe(true);
    const buf = new TickPrediction();
    const authoritative: SimBody = {
      x: 400,
      y: 400,
      angle: 0,
      vx: 0,
      vy: 0,
      angVel: 0,
      maneuver: 0,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
    };
    let current: SimBody = { ...authoritative, x: 410, y: 406, angle: 0.2 };
    for (let i = 0; i < snapshotsPerReference; i++) {
      current = buf.reconcile(authoritative, 0, current, ctx);
    }
    const rate = NET_CONFIG.reconcileEaseRate;
    expect(current.x).toBeCloseTo(410 + rate * (400 - 410), 10);
    expect(current.y).toBeCloseTo(406 + rate * (400 - 406), 10);
    expect(current.angle).toBeCloseTo(0.2 - rate * 0.2, 10);
  });
});

describe("TickPrediction", () => {
  const frame = (tick: number): InputFrame => ({ tick, steer: 0, throttle: 1, fireSlots: 0 });

  it("reconciles against the replay of frames after the snapshot tick", () => {
    const tp = new TickPrediction();
    let cur = START;
    for (const t of [11, 12, 13]) cur = tp.predict(cur, frame(t), ctx);
    const authoritative = stepSim(START, frame(11), DT, ctx); // pose at tick 11
    const target = replay2(authoritative, [12, 13]);
    const out = tp.reconcile(authoritative, 11, farFrom(cur), ctx);
    for (const k of ["x", "y", "angle", "vx", "vy", "angVel"] as const) expect(out[k]).toBeCloseTo(target[k], 9);
    expect(tp.frameAt(11)).toBeUndefined();
    expect(tp.frameAt(12)).toBeDefined();
    expect(tp.replayTarget(authoritative, 11, ctx).x).toBeCloseTo(target.x, 9);
  });

  it("eases (does not snap) a small error toward the replay target", () => {
    const tp = new TickPrediction();
    let cur = START;
    for (const t of [1, 2, 3]) cur = tp.predict(cur, frame(t), ctx);
    const target = tp.replayTarget(START, 0, ctx);
    const off = { ...target, x: target.x + 1 };
    const out = tp.reconcile(START, 0, off, ctx);
    const ease = reconcileEasePerSnapshot();
    expect(out.x).toBeCloseTo(off.x + (target.x - off.x) * ease, 9);
    expect(out.x).not.toBeCloseTo(target.x, 3);
    expect(out.vx).toBeCloseTo(target.vx, 9);
  });

  it("replays a stall-skip gap the way the server simulated it (repeat, then neutral)", () => {
    const tp = new TickPrediction();
    const repeat = msToTicks(NET_CONFIG.inputRepeatMs);
    const far = 10 + repeat + 20; // gap longer than the repeat window
    tp.predict(START, frame(10), ctx);
    tp.predict(START, frame(far), ctx);
    const got = tp.replayTarget(START, 9, ctx);
    let want = START;
    for (let t = 10; t <= far; t++) {
      const keys = t === far || t - 10 <= repeat ? { steer: 0 as const, throttle: 1 as const } : { steer: 0 as const, throttle: 0 as const };
      want = stepSim(want, { fireSlots: 0, ...keys }, DT, ctx);
    }
    for (const k of ["x", "y", "angle", "vx", "vy"] as const) expect(got[k]).toBeCloseTo(want[k], 9);
  });

  it("keeps frames until acked, well past the old 23-tick cap", () => {
    const tp = new TickPrediction();
    let cur = START;
    for (let t = 1; t <= 60; t++) cur = tp.predict(cur, frame(t), ctx);
    expect(tp.frameAt(1)).toBeDefined();
  });

  it("recent() returns the newest frames last, and clear() empties", () => {
    const tp = new TickPrediction();
    let cur = START;
    for (const t of [1, 2, 3, 4, 5]) cur = tp.predict(cur, frame(t), ctx);
    expect(tp.recent(3).map((f) => f.tick)).toEqual([3, 4, 5]);
    tp.clear();
    expect(tp.recent(3)).toEqual([]);
  });
});

function replay2(from: SimBody, ticks: readonly number[]): SimBody {
  const frame = (tick: number): InputFrame => ({ tick, ...UP });
  let body = from;
  for (const t of ticks) body = stepSim(body, frame(t), DT, ctx);
  return body;
}
