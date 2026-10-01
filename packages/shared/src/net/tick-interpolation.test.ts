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
import { DisplayDelay, RemoteTimeline, TickInterpolation, axisOfWire } from "./tick-interpolation.js";

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

describe("axisOfWire", () => {
  it("narrows a wire int8 to -1, 0 or 1", () => {
    expect([-128, -1, 0, 1, 127].map(axisOfWire)).toEqual([-1, -1, 0, 1, 1]);
  });
});
