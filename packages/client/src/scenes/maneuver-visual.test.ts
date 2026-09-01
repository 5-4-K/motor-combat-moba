import { describe, expect, it } from "vitest";
import { ManeuverKind } from "@motor-combat-moba/shared";
import {
  dashGhostAlphas,
  dashGhostOffsets,
  dashGhostPose,
  hullOutlinePoints,
  maneuverOutline,
} from "./maneuver-visual.js";

describe("maneuverOutline", () => {
  it("is null for NONE, DASH and HOLD", () => {
    expect(maneuverOutline(ManeuverKind.NONE)).toBeNull();
    expect(maneuverOutline(ManeuverKind.DASH)).toBeNull();
    expect(maneuverOutline(ManeuverKind.HOLD)).toBeNull();
  });

  it("is styled for CHARGE, in wildcharge's own hex", () => {
    expect(maneuverOutline(ManeuverKind.CHARGE)).toEqual({ color: 0xd9a814, width: 3 });
  });

  it("is null for an out-of-range value", () => {
    expect(maneuverOutline(99)).toBeNull();
  });
});

describe("dashGhostAlphas", () => {
  it("returns three values, descending and each in (0, 1)", () => {
    const alphas = dashGhostAlphas();
    expect(alphas).toHaveLength(3);
    for (const a of alphas) {
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThan(1);
    }
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i]).toBeLessThan(alphas[i - 1]!);
    }
  });
});

describe("dashGhostOffsets", () => {
  it("returns one ascending spacing per ghost alpha", () => {
    const offsets = dashGhostOffsets();
    expect(offsets).toHaveLength(dashGhostAlphas().length);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]!);
    }
    expect(offsets.every((o) => o > 0)).toBe(true);
  });
});

describe("hullOutlinePoints", () => {
  it("returns four corners centred on the pose, sized to the hull", () => {
    const pts = hullOutlinePoints({ x: 100, y: 200, angle: 0 }, 48, 32);
    expect(pts).toHaveLength(4);
    // Facing +x (angle 0): corners sit at (x +/- 24, y +/- 16).
    const xs = pts.map((p) => p.x).sort((a, b) => a - b);
    const ys = pts.map((p) => p.y).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(76);
    expect(xs[3]).toBeCloseTo(124);
    expect(ys[0]).toBeCloseTo(184);
    expect(ys[3]).toBeCloseTo(216);
  });

  it("rotates the footprint with the pose's angle", () => {
    const pts = hullOutlinePoints({ x: 0, y: 0, angle: Math.PI / 2 }, 48, 32);
    // Rotated 90 degrees: the long (48) axis now runs along y, the short (32) axis along x.
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    for (const x of xs) expect(Math.abs(x)).toBeCloseTo(16);
    for (const y of ys) expect(Math.abs(y)).toBeCloseTo(24);
  });
});

describe("dashGhostPose", () => {
  it("sits `offset` units behind the car along -maneuverAngle, sharing its rotation", () => {
    const pose = dashGhostPose({ x: 100, y: 100, angle: 1.23 }, 0, 18);
    expect(pose.x).toBeCloseTo(82);
    expect(pose.y).toBeCloseTo(100);
    expect(pose.angle).toBe(1.23);
  });

  it("trails opposite the maneuver angle regardless of the car's own facing", () => {
    const pose = dashGhostPose({ x: 0, y: 0, angle: 0 }, Math.PI / 2, 10);
    expect(pose.x).toBeCloseTo(0);
    expect(pose.y).toBeCloseTo(-10);
  });
});
