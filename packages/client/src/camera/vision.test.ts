import { describe, expect, it } from "vitest";
import type { FovConfig } from "@motor-combat-moba/shared";
import {
  carVisible,
  inShape,
  inVision,
  segmentHitsRect,
  shotSamplePoints,
  visionPolygon,
  visionPoses,
  visionShapeOf,
} from "./vision.js";

const FOV: FovConfig = {
  enabled: true, rangeX: 400, rangeY: 200, offsetX: 0, offsetY: 0, angleDeg: 90,
  blockedByObstacles: true, outsideDim: 0.5, sharedVision: true,
};
const EAST = { x: 0, y: 0, angle: 0 };

describe("visionShapeOf / inShape (CB25)", () => {
  const s = visionShapeOf(EAST, FOV);
  it("sees straight ahead inside the range", () => {
    expect(inShape({ x: 399, y: 0 }, s)).toBe(true);
  });
  it("does not see past the ellipse", () => {
    expect(inShape({ x: 401, y: 0 }, s)).toBe(false);
  });
  it("does not see outside the cone", () => {
    // 60° off the nose, well inside the ellipse, outside a 90° cone (45° half-angle).
    expect(inShape({ x: 50, y: 50 * Math.tan(Math.PI / 3) }, s)).toBe(false);
    expect(inShape({ x: 100, y: 90 }, s)).toBe(true); // ~42°
  });
  it("does not see behind", () => {
    expect(inShape({ x: -10, y: 0 }, s)).toBe(false);
  });
  it("sees all round at 360°", () => {
    const round = visionShapeOf(EAST, { ...FOV, angleDeg: 360 });
    expect(inShape({ x: -150, y: 0 }, round)).toBe(true);
  });
  it("turns with the car and offsets in the car's frame", () => {
    const south = visionShapeOf({ x: 0, y: 0, angle: Math.PI / 2 }, { ...FOV, offsetX: 100 });
    expect(south.cx).toBeCloseTo(0);
    expect(south.cy).toBeCloseTo(100);
    expect(inShape({ x: 0, y: 400 }, south)).toBe(true);
    expect(inShape({ x: 400, y: 0 }, south)).toBe(false);
  });
  it("uses rangeY across the car", () => {
    const round = visionShapeOf(EAST, { ...FOV, angleDeg: 360 });
    expect(inShape({ x: 0, y: 199 }, round)).toBe(true);
    expect(inShape({ x: 0, y: 201 }, round)).toBe(false);
  });
  it("offsetY moves the ellipse to the car's right: world +y at heading 0, screen y-down", () => {
    const s = visionShapeOf(EAST, { ...FOV, offsetY: 50 });
    expect(s.cx).toBeCloseTo(0);
    expect(s.cy).toBeCloseTo(50);
    const north = visionShapeOf({ x: 0, y: 0, angle: -Math.PI / 2 }, { ...FOV, offsetY: 50 });
    expect(north.cx).toBeCloseTo(50); // facing up the screen, the right is +x
    expect(north.cy).toBeCloseTo(0);
  });
});

describe("segmentHitsRect", () => {
  const box = { x: 100, y: -50, w: 50, h: 100 };
  it("hits a box across the segment", () => {
    expect(segmentHitsRect({ x: 0, y: 0 }, { x: 300, y: 0 }, box)).toBe(true);
  });
  it("misses a box beside it", () => {
    expect(segmentHitsRect({ x: 0, y: 100 }, { x: 300, y: 100 }, box)).toBe(false);
  });
  it("misses a box beyond the end", () => {
    expect(segmentHitsRect({ x: 0, y: 0 }, { x: 90, y: 0 }, box)).toBe(false);
  });
});

describe("inVision (CB25, Review Focus 4)", () => {
  const shapes = [visionShapeOf(EAST, FOV)];
  const wall = { x: 100, y: -50, w: 50, h: 100 };
  it("an obstacle hides what is behind it when blocking is on", () => {
    expect(inVision({ x: 300, y: 0 }, shapes, [wall], true)).toBe(false);
  });
  it("blocking off sees through it", () => {
    expect(inVision({ x: 300, y: 0 }, shapes, [wall], false)).toBe(true);
  });
  it("spike obstacles block like any other", () => {
    expect(inVision({ x: 300, y: 0 }, shapes, [{ ...wall, kind: "spike" as const }], true)).toBe(false);
  });
  it("an obstacle containing the apex is ignored", () => {
    const around = { x: -20, y: -20, w: 40, h: 40 };
    expect(inVision({ x: 300, y: 0 }, shapes, [around], true)).toBe(true);
  });
  it("any shape in the union will do", () => {
    const west = visionShapeOf({ x: 0, y: 0, angle: Math.PI }, FOV);
    expect(inVision({ x: -300, y: 0 }, [shapes[0]!, west], [], true)).toBe(true);
    expect(inVision({ x: -300, y: 0 }, shapes, [], true)).toBe(false);
  });
  it("no shapes sees nothing", () => {
    expect(inVision({ x: 10, y: 0 }, [], [], true)).toBe(false);
  });
});

describe("carVisible", () => {
  const shapes = [visionShapeOf(EAST, FOV)];
  it("shows a car whose nose pokes into vision", () => {
    // Centre just outside the ellipse, front corners inside it.
    expect(carVisible({ x: 420, y: 0, angle: Math.PI }, { width: 60, height: 40 }, shapes, [], true)).toBe(true);
  });
  it("hides a car wholly outside", () => {
    expect(carVisible({ x: 600, y: 0, angle: 0 }, { width: 60, height: 40 }, shapes, [], true)).toBe(false);
  });
});

describe("shotSamplePoints", () => {
  it("a circle gives its centre and four rim points", () => {
    const pts = shotSamplePoints({ kind: "circle", x: 10, y: 20, radius: 5 });
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual({ x: 10, y: 20 });
  });
  it("a polygon gives its vertices and centroid", () => {
    const pts = shotSamplePoints({ kind: "polygon", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] });
    expect(pts).toHaveLength(4);
  });
});

describe("visionPolygon (CB29)", () => {
  it("fans from the apex and stops at an obstacle", () => {
    const s = visionShapeOf(EAST, FOV);
    const poly = visionPolygon(s, [{ x: 100, y: -50, w: 50, h: 100 }], true, 8);
    expect(poly[0]).toEqual({ x: 0, y: 0 });
    const straight = poly[1 + 4]!; // the middle ray of 9 (0..8) points dead ahead
    expect(straight.x).toBeCloseTo(100);
  });
  it("reaches the ellipse with nothing in the way", () => {
    const s = visionShapeOf(EAST, FOV);
    const poly = visionPolygon(s, [], true, 8);
    expect(poly[1 + 4]!.x).toBeCloseTo(400);
  });
});

describe("visionPoses (CB26)", () => {
  const me = { sessionId: "me", team: 0 };
  const car = (sessionId: string, team: number, alive: boolean) => ({
    sessionId, team, alive, pose: { x: team * 100, y: 0, angle: 0 },
  });
  const players = [car("me", 0, true), car("ally", 0, true), car("foe", 1, true)];

  it("is your own car in FFA", () => {
    expect(visionPoses({ perspective: me, players, sides: "ffa", sharedVision: true, frozenPose: undefined })).toHaveLength(1);
  });
  it("adds living teammates with shared vision in a team mode", () => {
    expect(visionPoses({ perspective: me, players, sides: "team", sharedVision: true, frozenPose: undefined })).toHaveLength(2);
  });
  it("keeps teammates out without shared vision", () => {
    expect(visionPoses({ perspective: me, players, sides: "team", sharedVision: false, frozenPose: undefined })).toHaveLength(1);
  });
  it("uses the frozen death pose for a dead perspective (pov)", () => {
    const dead = [car("me", 0, false), car("foe", 1, true)];
    const frozen = { x: 5, y: 5, angle: 1 };
    expect(visionPoses({ perspective: me, players: dead, sides: "ffa", sharedVision: true, frozenPose: frozen })).toEqual([frozen]);
  });
  it("is empty when dead, blind, and alone", () => {
    const dead = [car("me", 0, false), car("foe", 1, true)];
    expect(visionPoses({ perspective: me, players: dead, sides: "ffa", sharedVision: true, frozenPose: undefined })).toEqual([]);
  });
});
