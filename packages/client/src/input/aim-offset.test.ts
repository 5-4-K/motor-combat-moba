import { describe, expect, it } from "vitest";
import { CROSSHAIR_CONFIG } from "../config/crosshair.js";
import { clampAimOffset, cssDeltaToWorld, initialAimOffset, moveAimOffset, projectToScreen } from "./aim-offset.js";

const HALF_PI = Math.PI / 2;

describe("the crosshair's world offset (TR56)", () => {
  it("starts straight ahead of the car at the max distance", () => {
    const o = initialAimOffset(HALF_PI, 60);
    expect(o.x).toBeCloseTo(0, 12);
    expect(o.y).toBeCloseTo(60, 12);
  });

  it("defaults the max distance to CROSSHAIR_CONFIG, read at call time", () => {
    expect(CROSSHAIR_CONFIG.maxDistance).toBe(60);
    const o = initialAimOffset(0);
    expect(Math.hypot(o.x, o.y)).toBeCloseTo(CROSSHAIR_CONFIG.maxDistance, 12);
  });

  it("clamps its length to the max distance, keeping the direction", () => {
    const o = moveAimOffset({ x: 0, y: 0 }, 300, 400, 0, 60, 360);
    expect(o.x).toBeCloseTo(36, 12);
    expect(o.y).toBeCloseTo(48, 12);
  });

  it("moves freely inside the circle", () => {
    expect(moveAimOffset({ x: 10, y: 5 }, 3, -4, 0, 60, 360)).toEqual({ x: 13, y: 1 });
  });

  it("keeps its WORLD direction when the car turns, with an unrestricted arc", () => {
    const o = { x: 60, y: 0 };
    expect(clampAimOffset(o, 2.5, 60, 360)).toEqual(o);
  });

  it("holds its direction inside the swing arc about the car's heading", () => {
    // Facing +x with a 180 arc: straight behind is pushed to the nearer edge, length kept.
    const o = moveAimOffset({ x: 0, y: 30 }, -60, 1, 0, 60, 180);
    expect(o.x).toBeCloseTo(0, 9);
    expect(o.y).toBeGreaterThan(0);
    expect(Math.hypot(o.x, o.y)).toBeCloseTo(60, 9);
  });

  it("is pushed to the arc edge when the car turns the offset out of the arc", () => {
    // Ahead of a car facing +x, then the car turns to face -y: +x is now 90 deg to its left, which a
    // 120 arc (+-60) forbids, so it lands on the nearer edge (heading + 60 deg).
    const o = clampAimOffset({ x: 60, y: 0 }, -HALF_PI, 60, 120);
    const a = Math.atan2(o.y, o.x);
    expect(a).toBeCloseTo(-HALF_PI + Math.PI / 3, 9);
    expect(Math.hypot(o.x, o.y)).toBeCloseTo(60, 9);
  });

  it("leaves a zero offset alone", () => {
    expect(clampAimOffset({ x: 0, y: 0 }, 1, 60, 90)).toEqual({ x: 0, y: 0 });
  });
});

describe("cssDeltaToWorld (TR56)", () => {
  it("scales CSS pixels to game pixels, then divides by the camera zoom", () => {
    // Canvas drawn at half its game size: one CSS pixel is two game pixels; zoom 2 halves that again.
    expect(cssDeltaToWorld(10, -4, { width: 1600, height: 900 }, { width: 800, height: 450 }, 2)).toEqual({
      x: 10,
      y: -4,
    });
    expect(cssDeltaToWorld(10, -4, { width: 1600, height: 900 }, { width: 1600, height: 900 }, 1)).toEqual({
      x: 10,
      y: -4,
    });
    expect(cssDeltaToWorld(6, 3, { width: 1200, height: 600 }, { width: 1200, height: 600 }, 1.5)).toEqual({
      x: 4,
      y: 2,
    });
  });

  it("treats an unlaid-out canvas as unscaled rather than dividing by zero", () => {
    expect(cssDeltaToWorld(5, 5, { width: 1600, height: 900 }, { width: 0, height: 0 }, 1)).toEqual({ x: 5, y: 5 });
  });

  it("turns the delta by the view rotation, so a 180° view maps a screen step to its world opposite (CQ48)", () => {
    const d = cssDeltaToWorld(10, 5, { width: 1600, height: 900 }, { width: 1600, height: 900 }, 1, Math.PI);
    expect(d.x).toBeCloseTo(-10, 9);
    expect(d.y).toBeCloseTo(-5, 9);
  });
});

describe("projectToScreen (TR56)", () => {
  const view = {
    x: 0, y: 0, width: 1000, height: 600, originX: 0.5, originY: 0.5, zoomX: 2, zoomY: 2,
    scrollX: 100, scrollY: 50,
  };

  it("puts the camera's centre of view at the viewport's centre", () => {
    // Centred on (100 + 500, 50 + 300): the midpoint Phaser's own camera looks at.
    expect(projectToScreen(view, { x: 600, y: 350 })).toEqual({ x: 500, y: 300 });
  });

  it("scales a world step by the zoom and offsets by the viewport origin", () => {
    expect(projectToScreen(view, { x: 610, y: 345 })).toEqual({ x: 520, y: 290 });
    expect(projectToScreen({ ...view, x: 40, y: 8 }, { x: 600, y: 350 })).toEqual({ x: 540, y: 308 });
  });

  it("under a 180° view puts a point right of the camera centre LEFT of the viewport centre (CQ48)", () => {
    const flat = { ...view, zoomX: 1, zoomY: 1 };
    // Camera centre at (100 + 500, 50 + 300); 100 u to its right.
    const screen = projectToScreen(flat, { x: 700, y: 350 }, Math.PI);
    expect(screen.x).toBeCloseTo(400, 9);
    expect(screen.y).toBeCloseTo(300, 9);
    expect(projectToScreen(flat, { x: 700, y: 350 }, 0)).toEqual(projectToScreen(flat, { x: 700, y: 350 }));
  });

  it("is the inverse of cssDeltaToWorld at any view rotation (Phaser's +rotation convention)", () => {
    const game = { width: 1000, height: 600 };
    for (const rotation of [0.3, -1.1, Math.PI]) {
      const step = cssDeltaToWorld(12, -7, game, game, view.zoomX, rotation);
      const centre = { x: 600, y: 350 };
      const a = projectToScreen(view, centre, rotation);
      const b = projectToScreen(view, { x: centre.x + step.x, y: centre.y + step.y }, rotation);
      expect(b.x - a.x).toBeCloseTo(12, 9);
      expect(b.y - a.y).toBeCloseTo(-7, 9);
    }
  });
});
