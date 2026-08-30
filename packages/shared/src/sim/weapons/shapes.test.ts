import { describe, expect, it } from "vitest";
import { beamShapeAt, projectileShapeAt, shapeHitsObb, smear } from "./shapes.js";

const hull = { x: 200, y: 100, angle: 0, w: 48, h: 32 };

describe("projectile shapes", () => {
  it("keeps a circle exact so small shots are not under-reported", () => {
    const shape = projectileShapeAt({ shape: "circle", radius: 5 }, 100, 100, 0);
    expect(shape).toEqual({ kind: "circle", x: 100, y: 100, radius: 5 });
  });

  it("builds an ellipse as a polygon oriented along the heading", () => {
    const shape = beamOrEllipse();
    if (shape.kind !== "polygon") throw new Error("ellipse must be a polygon");
    const xs = shape.points.map((p) => p.x);
    const ys = shape.points.map((p) => p.y);
    // 20 long, 6 across, pointing +x: wider in x than in y
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(Math.max(...ys) - Math.min(...ys));
  });

  it("rotates the ellipse with the heading", () => {
    const turned = projectileShapeAt(
      { shape: "ellipse", radiusAlong: 20, radiusAcross: 6 },
      100,
      100,
      Math.PI / 2,
    );
    if (turned.kind !== "polygon") throw new Error("ellipse must be a polygon");
    const xs = turned.points.map((p) => p.x);
    const ys = turned.points.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(Math.max(...xs) - Math.min(...xs));
  });

  function beamOrEllipse() {
    return projectileShapeAt({ shape: "ellipse", radiusAlong: 20, radiusAcross: 6 }, 100, 100, 0);
  }
});

describe("beam shapes", () => {
  it("grows a rectangle forward from the muzzle, not around it", () => {
    const shape = beamShapeAt({ shape: "rect", width: 20 }, 100, 100, 0, 300);
    if (shape.kind !== "polygon") throw new Error("beam must be a polygon");
    const xs = shape.points.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(100); // starts at the muzzle
    expect(Math.max(...xs)).toBeCloseTo(400); // reaches muzzle + extent
    const ys = shape.points.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(20); // cross-section is the width
  });

  it("fans a cone from an apex at the muzzle, widening with extent", () => {
    const near = beamShapeAt({ shape: "cone", angleDeg: 60 }, 100, 100, 0, 100);
    const far = beamShapeAt({ shape: "cone", angleDeg: 60 }, 100, 100, 0, 300);
    if (near.kind !== "polygon" || far.kind !== "polygon") throw new Error("cone must be a polygon");
    const spread = (s: { points: { y: number }[] }) =>
      Math.max(...s.points.map((p) => p.y)) - Math.min(...s.points.map((p) => p.y));
    expect(spread(far)).toBeGreaterThan(spread(near));
  });

  it("has zero area at zero extent, so a beam does not hit on the tick it is born", () => {
    const shape = beamShapeAt({ shape: "rect", width: 20 }, 200, 100, 0, 0);
    expect(shapeHitsObb(shape, hull)).toBe(false);
  });
});

describe("smear", () => {
  it("covers the gap between two positions, so a fast shot cannot tunnel", () => {
    // A 3-unit shot stepping 120 units per tick straddles the hull without a smear.
    const before = projectileShapeAt({ shape: "circle", radius: 3 }, 140, 100, 0);
    const after = projectileShapeAt({ shape: "circle", radius: 3 }, 260, 100, 0);

    expect(shapeHitsObb(before, hull)).toBe(false);
    expect(shapeHitsObb(after, hull)).toBe(false);
    expect(shapeHitsObb(smear(before, after), hull)).toBe(true);
  });

  it("still misses a hull the path never crosses", () => {
    const before = projectileShapeAt({ shape: "circle", radius: 3 }, 140, 300, 0);
    const after = projectileShapeAt({ shape: "circle", radius: 3 }, 260, 300, 0);
    expect(shapeHitsObb(smear(before, after), hull)).toBe(false);
  });

  it("is a no-op in effect when the shot has not moved", () => {
    const still = projectileShapeAt({ shape: "circle", radius: 3 }, 200, 100, 0);
    expect(shapeHitsObb(smear(still, still), hull)).toBe(true);
  });
});
