import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { planePenetration, planesOf, rectPlanes, supportRadius } from "./boundary.js";

describe("rectPlanes", () => {
  it("produces four inward unit normals for a rectangle", () => {
    expect(rectPlanes(1280, 720)).toEqual([
      { nx: 1, ny: 0, d: 0 },
      { nx: 0, ny: 1, d: 0 },
      { nx: -1, ny: 0, d: -1280 },
      { nx: 0, ny: -1, d: -720 },
    ]);
  });
});

describe("planesOf", () => {
  it("derives the same planes from a clockwise rectangle", () => {
    const planes = planesOf([
      { x: 0, y: 0 },
      { x: 1280, y: 0 },
      { x: 1280, y: 720 },
      { x: 0, y: 720 },
    ]);
    // Same set, edge order rather than rectPlanes' axis order.
    for (const p of planes) expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1, 12);
    expect(planes).toHaveLength(4);
    // Every corner is on or inside every plane.
    for (const c of [{ x: 0, y: 0 }, { x: 1280, y: 720 }, { x: 640, y: 360 }]) {
      for (const p of planes) expect(p.nx * c.x + p.ny * c.y - p.d).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("points a chamfer's normal into the arena", () => {
    // The top-left chamfer of ARENA_01, as its own two-vertex edge. Vertex order matters: this is
    // the CLOCKWISE direction, the same one the octagon winds. Reversed, the normal points out.
    const [plane] = planesOf([{ x: 74, y: 104 }, { x: 124, y: 54 }]);
    expect(plane!.nx).toBeCloseTo(Math.SQRT1_2, 12);
    expect(plane!.ny).toBeCloseTo(Math.SQRT1_2, 12);
    // The arena centre is well inside it.
    expect(plane!.nx * 640 + plane!.ny * 360 - plane!.d).toBeGreaterThan(0);
  });
});

describe("supportRadius", () => {
  it("matches the axis-aligned half-extent an axis normal implies", () => {
    const { carWidth, carHeight } = DRIVE_CONFIG;
    const angle = 0.7;
    const c = Math.abs(Math.cos(angle));
    const s = Math.abs(Math.sin(angle));
    expect(supportRadius(angle, 1, 0)).toBeCloseTo((c * carWidth + s * carHeight) / 2, 12);
    expect(supportRadius(angle, 0, 1)).toBeCloseTo((s * carWidth + c * carHeight) / 2, 12);
  });

  it("is half the length along the car's own forward axis", () => {
    expect(supportRadius(0, 1, 0)).toBeCloseTo(DRIVE_CONFIG.carWidth / 2, 12);
    expect(supportRadius(0, 0, 1)).toBeCloseTo(DRIVE_CONFIG.carHeight / 2, 12);
  });
});

describe("planePenetration", () => {
  const left = { nx: 1, ny: 0, d: 0 };

  it("is zero for a body clear of the plane", () => {
    expect(planePenetration(500, 360, 24, left)).toBeLessThanOrEqual(0);
  });

  it("is how far the hull pokes through", () => {
    expect(planePenetration(10, 360, 24, left)).toBeCloseTo(14, 12);
  });
});
