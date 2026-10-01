import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MS_PER_TICK, SNAPSHOT_RATE_HZ } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";
import { ramDefenceOf } from "../config/car-config.js";
import { msToTicks } from "../config/weapon-ticks.js";
import { drive, installMode } from "../modes/active.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../modes/registry.js";
import { NEUTRAL_MODIFIERS } from "../sim/status/modifiers.js";
import { stepSim, type SimBody, type StepContext } from "../sim/step.js";
import type { InputKeys } from "./tick-input.js";
import { DisplayDelay, RemoteTimeline, type LocalAnchor, TickInterpolation, axisOfWire } from "./tick-interpolation.js";

installMode(modeConfigOf(DEFAULT_GAME_MODE));
beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const at = (x: number) => ({ x, y: 0, angle: 0, vx: 0, vy: 0, angVel: 0, maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0 });

describe("TickInterpolation", () => {
  it("interpolates by tick, not by arrival", () => {
    const b = new TickInterpolation();
    b.push(10, at(0));
    b.push(12, at(20));
    expect(b.sample(11)!.body.x).toBeCloseTo(10);
    expect(b.sample(11)!.beyond).toBe(false);
  });
  it("reports beyond past the newest snapshot and holds its pose", () => {
    const b = new TickInterpolation();
    b.push(10, at(0));
    expect(b.sample(13)).toMatchObject({ beyond: true, body: { x: 0 } });
  });
  it("ignores a snapshot older than the newest", () => {
    const b = new TickInterpolation();
    b.push(12, at(20));
    b.push(10, at(0));
    expect(b.newestTick()).toBe(12);
  });
  it("holds the oldest snapshot, not beyond, when the render tick predates it", () => {
    const b = new TickInterpolation();
    b.push(10, at(5));
    b.push(11, at(9));
    expect(b.sample(3)).toMatchObject({ beyond: false, body: { x: 5 } });
  });
  it("brackets the newest matching pair on a non-linear path", () => {
    const b = new TickInterpolation();
    b.push(0, at(0));
    b.push(1, at(5));
    b.push(2, at(60));
    b.push(3, at(62));
    expect(b.sample(2.5)!.body.x).toBeCloseTo(61);
  });
  it("carries vx/vy from the later snapshot, un-blended", () => {
    const b = new TickInterpolation();
    b.push(10, { ...at(0), vx: 10, vy: -5 });
    b.push(11, { ...at(100), vx: 90, vy: 15 });
    expect(b.sample(10.5)!.body).toMatchObject({ x: 50, vx: 90, vy: 15 });
  });
  it("keeps at most 64 snapshots", () => {
    const b = new TickInterpolation();
    for (let t = 0; t < 200; t++) b.push(t, at(t));
    expect(b.sample(0)!.body.x).toBe(200 - 64);
    expect(b.newestTick()).toBe(199);
  });
});

describe("DisplayDelay", () => {
  it("settles near lateness p95 plus one snapshot interval, within the clamps", () => {
    const d = new DisplayDelay();
    for (let i = 0; i < 200; i++) d.onSnapshot(100 + i + 40 / MS_PER_TICK, 100 + i); // 40 ms late, no jitter
    let t = 0;
    for (let i = 0; i < 2000; i++) t = d.ticks(1000 / 60);
    const expectMs = 40 + 1000 / SNAPSHOT_RATE_HZ;
    expect(t * MS_PER_TICK).toBeCloseTo(expectMs, 0);
  });
  it("never goes below minDelayMs on a perfect link", () => {
    const d = new DisplayDelay();
    for (let i = 0; i < 200; i++) d.onSnapshot(100 + i, 100 + i);
    let t = 0;
    for (let i = 0; i < 2000; i++) t = d.ticks(1000 / 60);
    expect(t * MS_PER_TICK).toBeGreaterThanOrEqual(33 - 1e-9);
  });
  it("never goes above maxDelayMs on a terrible link", () => {
    const d = new DisplayDelay();
    for (let i = 0; i < 200; i++) d.onSnapshot(100 + i + 900 / MS_PER_TICK, 100 + i);
    let t = 0;
    for (let i = 0; i < 2000; i++) t = d.ticks(1000 / 60);
    expect(t * MS_PER_TICK).toBeCloseTo(NET_CONFIG.maxDelayMs, 6);
  });
  it("moves at most 1 ms per call when the link changes, starting at its first sample's target", () => {
    const d = new DisplayDelay();
    d.onSnapshot(100 + 40 / MS_PER_TICK, 100);
    const first = d.ticks(1000 / 60) * MS_PER_TICK;
    expect(first).toBeCloseTo(40 + 1000 / SNAPSHOT_RATE_HZ, 6);
    for (let i = 1; i < 200; i++) d.onSnapshot(100 + i + 150 / MS_PER_TICK, 100 + i);
    let prev = first;
    for (let i = 0; i < 50; i++) {
      const now = d.ticks(1000 / 60) * MS_PER_TICK;
      expect(Math.abs(now - prev)).toBeLessThanOrEqual(1 + 1e-9);
      prev = now;
    }
    expect(prev).toBeGreaterThan(first + 49);
  });
});

describe("DisplayDelay samples each server tick once (E2 review minors 2 and 3)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ignores a re-broadcast of a tick it already sampled, so a pause cannot inflate the delay", () => {
    const d = new DisplayDelay();
    for (let i = 0; i < 120; i++) d.onSnapshot(100 + i + 40 / MS_PER_TICK, 100 + i); // 40 ms late
    // A paused practice room re-broadcasts its frozen tick 219 while the server clock runs on.
    for (let k = 1; k <= 120; k++) d.onSnapshot(219 + k, 219);
    let t = 0;
    for (let i = 0; i < 2000; i++) t = d.ticks(1000 / 60);
    expect(t * MS_PER_TICK).toBeCloseTo(40 + 1000 / SNAPSHOT_RATE_HZ, 6);
  });

  it("ignores a snapshot older than the newest one sampled", () => {
    const d = new DisplayDelay();
    d.onSnapshot(100 + 40 / MS_PER_TICK, 100);
    d.onSnapshot(400, 50); // out of order: would read 350 ticks late
    expect(d.ticks(1000 / 60) * MS_PER_TICK).toBeCloseTo(40 + 1000 / SNAPSHOT_RATE_HZ, 6);
  });

  it("computes its target once per snapshot, not per rendered frame", () => {
    const d = new DisplayDelay();
    for (let i = 0; i < 120; i++) d.onSnapshot(100 + i + 40 / MS_PER_TICK, 100 + i);
    const sort = vi.spyOn(Array.prototype, "sort");
    for (let i = 0; i < 100; i++) d.ticks(1000 / 60);
    expect(sort).not.toHaveBeenCalled();
  });
});

// --- RemoteTimeline: the per-remote drawing rule ArenaScene and the netsim tick client share ---

const OPEN: StepContext = {
  carId: "mirage",
  others: [],
  obstacles: [],
  bounds: { width: 4000, height: 4000 },
  modifiers: NEUTRAL_MODIFIERS,
  selfRamDefence: ramDefenceOf("mirage"),
};
const GO: InputKeys = { steer: 0, throttle: 1, fireSlots: 0 };
const LEFT: InputKeys = { steer: -1, throttle: 1, fireSlots: 0 };
const DT = MS_PER_TICK / 1000;
const FRAME_MS = 1000 / 60;

function moving(x: number, vx = 200): SimBody {
  return { ...at(x), y: 1000, vx };
}

/** A path stepped from `from` with `keys`, one pose per tick, index 0 = `from`. */
function path(from: SimBody, keys: InputKeys, ticks: number): SimBody[] {
  const out = [from];
  for (let i = 0; i < ticks; i++) out.push(stepSim(out[out.length - 1]!, keys, DT, OPEN));
  return out;
}

/**
 * One frame drawing at render tick `R`. With no lateness sample yet the delay sits at its floor,
 * `minDelayMs`, so the server tick handed in is `R` plus that.
 */
function frameAt(tl: RemoteTimeline, R: number): void {
  tl.beginFrame(R + NET_CONFIG.minDelayMs / MS_PER_TICK, FRAME_MS);
  expect(tl.renderTick).toBeCloseTo(R, 9);
}

describe("RemoteTimeline", () => {
  it("never extrapolates past maxExtrapolateMs of the newest snapshot, then holds", () => {
    const tl = new RemoteTimeline();
    const p = path(moving(1000), GO, 1);
    tl.push("a", 10, { body: p[0]!, keys: GO, ctx: OPEN, alive: true });
    tl.push("a", 11, { body: p[1]!, keys: GO, ctx: OPEN, alive: true });
    const cap = msToTicks(NET_CONFIG.maxExtrapolateMs);
    const capped = path(p[1]!, GO, cap)[cap]!;
    const drawn: number[] = [];
    for (let R = 11; R <= 11 + 4 * cap; R += 0.5) {
      frameAt(tl, R);
      drawn.push(tl.pose("a")!.x);
    }
    expect(Math.max(...drawn)).toBeCloseTo(capped.x, 6);
    // Well past the cap the pose is exactly the capped one, frame after frame: it holds.
    expect(drawn[drawn.length - 1]).toBeCloseTo(capped.x, 6);
    expect(drawn[drawn.length - 2]).toBeCloseTo(capped.x, 6);
  });

  it("answers the same pose for every call within one frame", () => {
    const tl = new RemoteTimeline();
    tl.push("a", 10, { body: moving(0), keys: GO, ctx: OPEN, alive: true });
    frameAt(tl, 12.3);
    expect(tl.pose("a")).toEqual(tl.pose("a"));
  });

  it("eases a late snapshot in over extrapolateSettleMs instead of snapping", () => {
    const tl = new RemoteTimeline();
    // The client extrapolates the car straight on…
    const start = moving(1000);
    tl.push("a", 10, { body: start, keys: GO, ctx: OPEN, alive: true });
    let R = 10;
    let prev: SimBody | undefined;
    for (let i = 0; i < 4; i++) {
      R += 1;
      frameAt(tl, R);
      prev = tl.pose("a")!;
    }
    // …but the car had actually been shoved sideways: the late snapshots show where it really went.
    const DRIFT = 4;
    const truth = path(start, GO, 16).map((b, t) => ({ ...b, y: b.y + DRIFT * t, vy: DRIFT / DT }));
    for (let t = 1; t <= 16; t++) tl.push("a", 10 + t, { body: truth[t]!, keys: GO, ctx: OPEN, alive: true });
    const gap = Math.hypot(prev!.x - truth[4]!.x, prev!.y - truth[4]!.y);
    expect(gap).toBeGreaterThan(10); // there is a real gap to ease out

    const settleFrames = Math.ceil(NET_CONFIG.extrapolateSettleMs / FRAME_MS);
    for (let i = 0; i < settleFrames + 2; i++) {
      R += FRAME_MS / MS_PER_TICK;
      frameAt(tl, R);
      const now = tl.pose("a")!;
      const moved = Math.hypot(now.x - prev!.x, now.y - prev!.y);
      const carMoved = Math.hypot(truth[4]!.vx, truth[4]!.vy) * (FRAME_MS / 1000) * 1.5;
      // Never more than the car moved plus this frame's share of the ease.
      expect(moved).toBeLessThanOrEqual(carMoved + gap * (FRAME_MS / NET_CONFIG.extrapolateSettleMs) + 1e-6);
      prev = now;
    }
    // Once the ease has run out the drawn pose is the interpolated one exactly.
    const lo = Math.floor(R);
    const alpha = R - lo;
    const expectX = truth[lo - 10]!.x + (truth[lo - 9]!.x - truth[lo - 10]!.x) * alpha;
    const expectY = truth[lo - 10]!.y + (truth[lo - 9]!.y - truth[lo - 10]!.y) * alpha;
    expect(prev!.x).toBeCloseTo(expectX, 6);
    expect(prev!.y).toBeCloseTo(expectY, 6);
  });

  it("does not ease when nothing was extrapolated", () => {
    const tl = new RemoteTimeline();
    const p = path(moving(1000), GO, 6);
    for (let t = 0; t <= 6; t++) tl.push("a", 10 + t, { body: p[t]!, keys: GO, ctx: OPEN, alive: true });
    frameAt(tl, 13.5);
    expect(tl.pose("a")!.x).toBeCloseTo((p[3]!.x + p[4]!.x) / 2, 9);
  });

  it("resets on death and respawn: no slide from the death pose to the spawn", () => {
    const tl = new RemoteTimeline();
    const p = path(moving(1000), GO, 3);
    for (let t = 0; t <= 3; t++) tl.push("a", 10 + t, { body: p[t]!, keys: GO, ctx: OPEN, alive: true });
    tl.push("a", 14, { body: p[3]!, keys: GO, ctx: OPEN, alive: false });
    const spawn = { ...at(200), y: 200 };
    tl.push("a", 40, { body: spawn, keys: GO, ctx: OPEN, alive: true });
    // Rendering behind the respawn snapshot draws the spawn, never a blend from the wreck.
    frameAt(tl, 38);
    expect(tl.pose("a")).toMatchObject({ x: 200, y: 200 });
    frameAt(tl, 40);
    expect(tl.pose("a")).toMatchObject({ x: 200, y: 200 });
  });

  it("resets on a teleport of more than three car lengths in one snapshot", () => {
    const tl = new RemoteTimeline();
    tl.push("a", 10, { body: moving(1000, 0), keys: GO, ctx: OPEN, alive: true });
    const far = moving(1000 + 3 * drive().carWidth + 1, 0);
    tl.push("a", 11, { body: far, keys: GO, ctx: OPEN, alive: true });
    frameAt(tl, 10.5);
    expect(tl.pose("a")!.x).toBe(far.x);
  });

  it("forget drops a remote entirely", () => {
    const tl = new RemoteTimeline();
    tl.push("a", 10, { body: moving(0), keys: GO, ctx: OPEN, alive: true });
    tl.forget("a");
    frameAt(tl, 10);
    expect(tl.pose("a")).toBeUndefined();
  });

  it("answers a remote's dead-reckoned pose at a tick, capped at maxExtrapolateMs (NR32)", () => {
    const tl = new RemoteTimeline();
    const p = path(moving(1000), GO, 1);
    tl.push("a", 10, { body: p[0]!, keys: GO, ctx: OPEN, alive: true });
    tl.push("a", 11, { body: p[1]!, keys: GO, ctx: OPEN, alive: true });
    const cap = msToTicks(NET_CONFIG.maxExtrapolateMs);
    const ahead = path(p[1]!, GO, cap);
    expect(tl.reckonedPose("a", 11)!.x).toBeCloseTo(p[1]!.x, 9);
    expect(tl.reckonedPose("a", 13)!.x).toBeCloseTo(ahead[2]!.x, 9);
    // A slow link: the remote holds at its capped pose rather than being reckoned on.
    expect(tl.reckonedPose("a", 11 + cap + 20)!.x).toBeCloseTo(ahead[cap]!.x, 9);
    expect(tl.reckonedPose("nobody", 13)).toBeUndefined();
    tl.forget("a");
    expect(tl.reckonedPose("a", 13)).toBeUndefined();
  });

  it("draws the newest snapshot until the clock has synced", () => {
    const tl = new RemoteTimeline();
    tl.push("a", 10, { body: moving(0), keys: GO, ctx: OPEN, alive: true });
    tl.push("a", 11, { body: moving(7), keys: GO, ctx: OPEN, alive: true });
    tl.beginFrame(undefined, FRAME_MS);
    expect(tl.pose("a")!.x).toBe(7);
    expect(tl.renderTick).toBeUndefined();
  });
});

describe("RemoteTimeline contact blend (NR34)", () => {
  /** A remote moving +x at 200 u/s, snapshots at ticks 10 and 11, drawn at R = 10.5 (interpolated). */
  function drawnWith(localDx: number | undefined, tick = 14): { x: number; interpolated: number; reckoned: number } {
    const tl = new RemoteTimeline();
    const p = path(moving(1000), GO, 1);
    tl.push("a", 10, { body: p[0]!, keys: GO, ctx: OPEN, alive: true });
    tl.push("a", 11, { body: p[1]!, keys: GO, ctx: OPEN, alive: true });
    const interpolated = (p[0]!.x + p[1]!.x) / 2;
    // The weight slews in time (one settle-ease per frame at most): hold the scene still until it settles.
    let pose!: SimBody;
    for (let f = 0; f < 12; f++) {
      frameAt(tl, 10.5);
      pose = tl.pose("a", localDx === undefined ? undefined : { pose: { x: interpolated + localDx, y: 1000 }, tick })!;
    }
    return { x: pose.x, interpolated, reckoned: tl.reckonedPose("a", tick)!.x };
  }
  const carLength = () => drive().carWidth;

  it("draws the interpolated pose with no local car, or one two car lengths away or more", () => {
    const none = drawnWith(undefined);
    expect(none.x).toBeCloseTo(none.interpolated, 9);
    const far = drawnWith(2 * carLength() + 1);
    expect(far.x).toBeCloseTo(far.interpolated, 9);
  });

  it("draws the dead-reckoned pose at the predicted tick within one car length", () => {
    const near = drawnWith(0.5 * carLength());
    expect(near.reckoned).toBeGreaterThan(near.interpolated + 1);
    expect(near.x).toBeCloseTo(near.reckoned, 9);
  });

  it("is halfway between at one and a half car lengths", () => {
    const mid = drawnWith(1.5 * carLength());
    expect(mid.x).toBeCloseTo((mid.interpolated + mid.reckoned) / 2, 6);
  });
});

describe("RemoteTimeline contact blend is continuous (NR34, no drawn-pose jump)", () => {
  const TICKS_PER_FRAME = FRAME_MS / MS_PER_TICK;
  /** A remote that drives straight, then brakes hard at tick 45 (so a snapshot rebases its reckoning). */
  const BRAKE: InputKeys = { steer: 0, throttle: -1, fireSlots: 0 };
  const keysAt = (t: number): InputKeys => (t < 45 ? GO : BRAKE);
  const remotePath = (() => {
    const out = [moving(1000, 150)];
    for (let t = 0; t < 400; t++) {
      const next = stepSim(out[t]!, keysAt(t), DT, OPEN);
      // A ram at tick 45: a shove the reckoner cannot know until the next snapshot (a rebase).
      out.push(t === 45 ? { ...next, vx: next.vx - 250 } : next);
    }
    return out;
  })();
  const stepLen = Math.max(...remotePath.slice(1).map((b, i) => Math.hypot(b.x - remotePath[i]!.x, b.y - remotePath[i]!.y)));

  /**
   * Frame-by-frame drawn positions of remote "a" while `anchorAt(frame, remoteDrawn)` supplies the
   * local car (undefined = none). Snapshots arrive every 2 ticks on time; the local car is
   * predicted `ahead` ticks beyond the server clock.
   */
  function run(
    frames: number,
    anchorAt: (frame: number, nearX: number, serverTick: number) => LocalAnchor | undefined,
  ): { dx: number[]; ease: number } {
    const tl = new RemoteTimeline();
    const pts: { x: number; y: number }[] = [];
    let pushed = -1;
    let near = remotePath[0]!.x;
    for (let f = 0; f < frames; f++) {
      const server = 20 + f * TICKS_PER_FRAME;
      for (let t = pushed + 2; t <= Math.floor(server); t += 2) {
        tl.push("a", t, { body: remotePath[t]!, keys: keysAt(t), ctx: OPEN, alive: true });
        // Late by LATE ticks, so the render tick sits well behind the predicted one.
        tl.onSnapshot(t + LATE, t);
        pushed = t;
      }
      tl.beginFrame(server, FRAME_MS);
      const pose = tl.pose("a", anchorAt(f, near, server))!;
      near = pose.x;
      pts.push({ x: pose.x, y: pose.y });
    }
    const dx = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y));
    return { dx, ease: FRAME_MS / NET_CONFIG.extrapolateSettleMs };
  }
  /** The bound: the car's own motion over one frame plus the ease's share of a (generous) gap. */
  const bound = (ease: number, gap: number) => stepLen * TICKS_PER_FRAME * 1.05 + gap * ease;
  const GAP = 40; // u: the most the blend target ever sits from the interpolated path in these runs
  const AHEAD = 3;
  const LATE = 5;
  const nearTo = (x: number, server: number): LocalAnchor => ({
    pose: { x: x + drive().carWidth * 0.5, y: 1000 },
    tick: server + AHEAD,
  });

  it("holds through a snapshot that rebases the reckoning while near", () => {
    const r = run(60, (_f, x, s) => nearTo(x, s));
    // Only the shove's rebase (about 20 u) is in play here, not the blend's full target gap.
    expect(Math.max(...r.dx.slice(20))).toBeLessThanOrEqual(bound(r.ease, 25));
  });

  it("holds as the predicted tick advances at full weight (no whole-tick steps)", () => {
    const r = run(60, (_f, x, s) => nearTo(x, s));
    // Steady stretch before the turn: only the advancing P could add motion beyond the car's own.
    const steady = r.dx.slice(8, 24);
    expect(Math.max(...steady)).toBeLessThanOrEqual(stepLen * TICKS_PER_FRAME * 1.05 + 1);
  });

  it("fades when the anchor turns off and on (local death, respawn)", () => {
    const r = run(80, (f, x, s) => (f >= 10 && f < 22 ? undefined : nearTo(x, s)));
    expect(Math.max(...r.dx)).toBeLessThanOrEqual(bound(r.ease, GAP));
  });

  it("holds crossing the range edge in and out", () => {
    const L = drive().carWidth;
    const r = run(120, (f, x, s) => {
      // Fast in and out (three frames each way), at a steady stretch of the remote's path.
      const k = f < 8 ? 0 : f < 11 ? (f - 8) / 3 : f < 18 ? 1 : f < 21 ? 1 - (f - 18) / 3 : 0;
      const sep = 3 * L - k * 2.5 * L;
      return { pose: { x: x + sep, y: 1000 }, tick: s + AHEAD };
    });
    expect(Math.max(...r.dx)).toBeLessThanOrEqual(bound(r.ease, GAP));
  });
});

describe("RemoteTimeline contact blend on a turning remote (phase E review I1)", () => {
  const TICKS_PER_FRAME = FRAME_MS / MS_PER_TICK;
  const LATE = 5;
  const AHEAD = 3;
  const deg = (r: number) => (Math.abs(r) * 180) / Math.PI;
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

  /**
   * A remote at full lock and full throttle, one snapshot every tick on time (LATE ticks of
   * lateness), the local car 20 u off its drawn pose (well inside one car length, so the blend
   * weight is 1) and predicted AHEAD ticks past the server clock. Returns, per frame, the drawn pose
   * and the pose prediction collides with at the anchor tick.
   */
  function turning(frames: number): { drawn: SimBody[]; target: SimBody[]; stepLen: number } {
    const truth = path(moving(1000, 150), LEFT, 40 + frames);
    const stepLen = Math.max(...truth.slice(1).map((b, i) => Math.hypot(b.x - truth[i]!.x, b.y - truth[i]!.y)));
    const tl = new RemoteTimeline();
    const drawn: SimBody[] = [];
    const target: SimBody[] = [];
    let pushed = -1;
    let near = truth[0]!;
    for (let f = 0; f < frames; f++) {
      const server = 20 + f * TICKS_PER_FRAME;
      for (let t = pushed + 1; t <= Math.floor(server); t++) {
        tl.push("a", t, { body: truth[t]!, keys: LEFT, ctx: OPEN, alive: true });
        tl.onSnapshot(t + LATE, t);
        pushed = t;
      }
      tl.beginFrame(server, FRAME_MS);
      const anchor: LocalAnchor = { pose: { x: near.x + 20, y: near.y }, tick: server + AHEAD };
      const pose = tl.pose("a", anchor)!;
      near = pose;
      drawn.push(pose);
      target.push(tl.reckonedPose("a", anchor.tick)!);
    }
    return { drawn, target, stepLen };
  }

  it("draws the heading prediction collides with, with no standing lag", () => {
    const { drawn, target } = turning(90);
    // Past the weight's slew-in and any settle (well over 100 ms), drawn and target agree.
    const errs = drawn.slice(30).map((p, i) => deg(wrap(p.angle - target[30 + i]!.angle)));
    expect(Math.max(...errs)).toBeLessThan(0.5);
    const posErr = drawn.slice(30).map((p, i) => Math.hypot(p.x - target[30 + i]!.x, p.y - target[30 + i]!.y));
    expect(Math.max(...posErr)).toBeLessThan(0.1);
  });

  it("never jumps by more than the car moved plus the ease", () => {
    const { drawn, stepLen } = turning(90);
    const dx = drawn.slice(1).map((p, i) => Math.hypot(p.x - drawn[i]!.x, p.y - drawn[i]!.y));
    const carMoved = stepLen * TICKS_PER_FRAME * 1.05;
    // While the weight slews in, the ease's share of the blend gap (at most 40 u here) on top.
    expect(Math.max(...dx)).toBeLessThanOrEqual(carMoved + 40 * (FRAME_MS / NET_CONFIG.extrapolateSettleMs));
    // Once it has, the car's own motion alone.
    expect(Math.max(...dx.slice(30))).toBeLessThanOrEqual(carMoved + 1e-6);
  });
});

describe("RemoteTimeline while the room is paused (phase E review I2, M2, M3)", () => {
  const TICKS_PER_FRAME = FRAME_MS / MS_PER_TICK;
  const FROZEN = 30;
  /** A remote driving straight, snapshots every tick up to FROZEN, then the room pauses. */
  const truth = path(moving(1000), GO, FROZEN + 1);
  const stepLen = Math.max(...truth.slice(1).map((b, i) => Math.hypot(b.x - truth[i]!.x, b.y - truth[i]!.y)));

  function pausedRun(anchored: boolean): { tl: RemoteTimeline; drawn: SimBody[]; server: number; frozenTick: number } {
    const tl = new RemoteTimeline();
    const drawn: SimBody[] = [];
    let pushed = -1;
    let server = 10.5;
    let near = truth[0]!;
    // Running: the server tick advances with the clock.
    for (; server < FROZEN; server += TICKS_PER_FRAME) {
      for (let t = pushed + 1; t <= Math.floor(server); t++) {
        tl.push("a", t, { body: truth[t]!, keys: GO, ctx: OPEN, alive: true });
        tl.onSnapshot(t + 1, t);
        pushed = t;
      }
      tl.beginFrame(server, FRAME_MS);
      near = tl.pose("a", anchored ? { pose: { x: near.x + 20, y: near.y }, tick: server + 3 } : undefined)!;
      drawn.push(near);
    }
    // Paused: the clock runs on (and a frozen tick is re-broadcast), the room's tick does not.
    for (let f = 0; f < 60; f++, server += TICKS_PER_FRAME) {
      tl.push("a", pushed, { body: truth[pushed]!, keys: GO, ctx: OPEN, alive: true });
      tl.onSnapshot(server, pushed);
      tl.beginFrame(server, FRAME_MS, true);
      near = tl.pose("a", anchored ? { pose: { x: near.x + 20, y: near.y }, tick: server + 3 } : undefined)!;
      drawn.push(near);
    }
    return { tl, drawn, server, frozenTick: pushed };
  }

  it("draws a remote at its frozen snapshot pose, not reckoned ahead", () => {
    for (const anchored of [false, true]) {
      const { drawn, frozenTick } = pausedRun(anchored);
      const frozen = truth[frozenTick]!;
      const last = drawn[drawn.length - 1]!;
      // The newest snapshot pushed before the pause, exactly.
      expect(last.x).toBeCloseTo(frozen.x, 6);
      expect(last.y).toBeCloseTo(frozen.y, 6);
      const dx = drawn.slice(1).map((p, i) => Math.hypot(p.x - drawn[i]!.x, p.y - drawn[i]!.y));
      // Entering the pause never jumps: the car's own motion at most (past the blend weight's slew-in).
      expect(Math.max(...dx.slice(10))).toBeLessThanOrEqual(stepLen * TICKS_PER_FRAME * 1.05 + 1e-6);
    }
  });

  it("draws a pose changed on the paused tick (a playground edit), and ignores a re-broadcast", () => {
    const { tl, server, frozenTick } = pausedRun(false);
    const edited = { ...truth[frozenTick]!, x: truth[frozenTick]!.x + 30, vx: 0 };
    tl.push("a", frozenTick, { body: edited, keys: GO, ctx: OPEN, alive: true });
    tl.beginFrame(server, FRAME_MS, true);
    expect(tl.pose("a")!.x).toBeCloseTo(edited.x, 9);
    tl.push("a", frozenTick, { body: edited, keys: GO, ctx: OPEN, alive: true });
    tl.beginFrame(server + TICKS_PER_FRAME, FRAME_MS, true);
    expect(tl.pose("a")!.x).toBeCloseTo(edited.x, 9);
  });

  it("eases, rather than snaps, when the clock first becomes ready (late join, resume)", () => {
    const tl = new RemoteTimeline();
    const run = path(moving(1000), GO, 80);
    const drawn: SimBody[] = [];
    let pushed = -1;
    for (let f = 0; f < 60; f++) {
      const server = 10.5 + f * TICKS_PER_FRAME;
      for (let t = pushed + 1; t <= Math.floor(server); t++) {
        tl.push("a", t, { body: run[t]!, keys: GO, ctx: OPEN, alive: true });
        tl.onSnapshot(t + 4, t);
        pushed = t;
      }
      // The clock is not ready for the first 20 frames: the newest snapshot is drawn as it stands.
      tl.beginFrame(f < 20 ? undefined : server, FRAME_MS);
      drawn.push(tl.pose("a")!);
    }
    const dx = drawn.slice(1).map((p, i) => Math.hypot(p.x - drawn[i]!.x, p.y - drawn[i]!.y));
    // The render tick drops back by the delay when the clock becomes ready; that step is eased, so
    // the drawn pose never moves backwards (a snap back would read as a negative step along +x).
    const back = drawn.slice(1).map((p, i) => p.x - drawn[i]!.x);
    expect(Math.min(...back)).toBeGreaterThanOrEqual(0);
    const runStep = Math.max(...run.slice(1).map((b, i) => Math.hypot(b.x - run[i]!.x, b.y - run[i]!.y)));
    expect(Math.max(...dx)).toBeLessThanOrEqual(runStep * TICKS_PER_FRAME * 1.05 + 1e-6);
  });
});

describe("axisOfWire", () => {
  it("narrows a wire int8 to -1, 0 or 1", () => {
    expect([-128, -1, 0, 1, 127].map(axisOfWire)).toEqual([-1, -1, 0, 1, 1]);
  });
});
