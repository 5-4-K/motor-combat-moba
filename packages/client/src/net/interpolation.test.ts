import { describe, expect, it } from "vitest";
import { NET_CONFIG, type SimBody } from "@motor-combat-moba/shared";
import { InterpolationBuffer, blendPose } from "./interpolation.js";

const DELAY = NET_CONFIG.interpolationDelayMs;

function pose(x: number, y: number, angle = 0): SimBody {
  return { x, y, angle, speed: 0, reverseHold: 0 };
}

describe("InterpolationBuffer", () => {
  it("sample on an empty buffer returns undefined", () => {
    expect(new InterpolationBuffer().sample(0)).toBeUndefined();
  });

  it("lerps position between the two snapshots bracketing the render time", () => {
    const buf = new InterpolationBuffer();
    buf.push(1000, pose(0, 0));
    buf.push(1100, pose(100, 200));

    // Render time trails `now` by interpolationDelayMs, so this samples the midpoint of the pair.
    const out = buf.sample(1050 + DELAY);
    expect(out?.x).toBeCloseTo(50, 10);
    expect(out?.y).toBeCloseTo(100, 10);
  });

  it("brackets against the newest matching pair, not the first one it finds", () => {
    // Three or more retained snapshots on a non-linear trajectory, with the render time in the
    // *newest* bracket. Every other test here either holds at an end or retains exactly two
    // snapshots, so the render time never leaves the first bracket and the scan direction cannot
    // matter. It matters here: scanning ascending returns the 0..20 pair and extrapolates it out to
    // x = 12.5, an error of nearly 50 units, twice reconcileSnapPos.
    const buf = new InterpolationBuffer();
    buf.push(0, pose(0, 0));
    buf.push(20, pose(5, 0));
    buf.push(40, pose(60, 0));
    buf.push(60, pose(62, 0));

    const out = buf.sample(50 + DELAY);
    expect(out?.x).toBeCloseTo(61, 10);
  });

  it("holds the first snapshot when the render time predates it", () => {
    const buf = new InterpolationBuffer();
    buf.push(1000, pose(10, 20));
    buf.push(1100, pose(100, 200));

    const out = buf.sample(500);
    expect(out?.x).toBe(10);
    expect(out?.y).toBe(20);
  });

  it("holds the last snapshot past the end of the buffer instead of extrapolating", () => {
    const buf = new InterpolationBuffer();
    buf.push(1000, pose(0, 0));
    buf.push(1100, pose(100, 0));

    const out = buf.sample(5000);
    expect(out?.x).toBe(100);
    expect(out?.y).toBe(0);
  });

  it("lerps angle the short way across the +/-PI seam", () => {
    const buf = new InterpolationBuffer();
    buf.push(1000, pose(0, 0, 3));
    buf.push(1100, pose(0, 0, -3));

    const out = buf.sample(1050 + DELAY);
    // Halfway from 3 to -3 the short way is the seam itself (+/-PI), never 0.
    expect(Math.abs(out?.angle ?? 0)).toBeCloseTo(Math.PI, 6);
  });

  it("carries speed and reverseHold from the snapshot being interpolated toward", () => {
    const buf = new InterpolationBuffer();
    buf.push(1000, { x: 0, y: 0, angle: 0, speed: 10, reverseHold: 0 });
    buf.push(1100, { x: 100, y: 0, angle: 0, speed: 90, reverseHold: 4 });

    const out = buf.sample(1050 + DELAY);
    expect(out?.speed).toBe(90);
    expect(out?.reverseHold).toBe(4);
  });

  it("prunes snapshots older than the interpolation window", () => {
    const buf = new InterpolationBuffer();
    const step = 10;
    const count = 500;
    for (let i = 0; i < count; i++) buf.push(i * step, pose(i, 0));

    // Everything before the retained window is gone, so a render time in the distant past clamps to
    // the oldest *retained* snapshot rather than resurrecting the very first one.
    const oldest = buf.sample(Number.NEGATIVE_INFINITY);
    const newestTime = (count - 1) * step;
    expect(oldest?.x).toBeGreaterThan((newestTime - DELAY - step) / step);
    // ...but the window is not pruned down to a single pose, or there would be nothing to lerp from.
    expect(oldest?.x).toBeLessThan(count - 1);
  });

  it("keeps interpolating correctly after pruning", () => {
    const buf = new InterpolationBuffer();
    for (let t = 0; t <= 1000; t += 50) buf.push(t, pose(t, 0));

    const out = buf.sample(975 + DELAY);
    expect(out?.x).toBeCloseTo(975, 10);
  });
});

describe("blendPose", () => {
  it("lerps position by alpha and carries the newer pose's sim fields", () => {
    const from = pose(0, 0);
    const to: SimBody = { x: 100, y: 200, angle: 0, speed: 7, reverseHold: 3 };
    expect(blendPose(from, to, 0.25)).toEqual({ x: 25, y: 50, angle: 0, speed: 7, reverseHold: 3 });
  });

  it("returns the endpoints exactly at alpha 0 and 1", () => {
    const from = pose(1, 2, 0.5);
    const to = pose(3, 4, 1.5);
    expect(blendPose(from, to, 0)).toMatchObject({ x: 1, y: 2, angle: 0.5 });
    expect(blendPose(from, to, 1)).toMatchObject({ x: 3, y: 4 });
    expect(blendPose(from, to, 1).angle).toBeCloseTo(1.5);
  });

  it("blends angle the short way across the +/-PI seam", () => {
    const blended = blendPose(pose(0, 0, 3), pose(0, 0, -3), 0.5);
    // Halfway between 3 and -3 the short way is PI, not 0.
    expect(Math.abs(Math.abs(blended.angle) - Math.PI)).toBeLessThan(1e-9);
  });
});
