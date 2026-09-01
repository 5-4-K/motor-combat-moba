import { describe, expect, it } from "vitest";
import { beamShapeAt, projectileShapeAt, shapeHitsObb, smear, type PolygonShape } from "./shapes.js";

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

describe("capsule projectiles", () => {
  const capsule = { shape: "capsule", radiusAlong: 24, radiusAcross: 15 } as const;

  /** Cross product of consecutive edges; a convex polygon never changes its sign. */
  function turnsConsistently(points: Array<{ x: number; y: number }>): boolean {
    let sign = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      const c = points[(i + 2) % points.length]!;
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) < 1e-9) continue;
      const next = Math.sign(cross);
      if (sign === 0) sign = next;
      else if (next !== sign) return false;
    }
    return true;
  }

  it("is convex, which is the whole contract SAT rests on", () => {
    // SAT does not reject a concave polygon, it just answers the wrong question about it. Every
    // ratio down to the degenerate square-backed circle has to stay convex.
    for (const radiusAlong of [15, 16, 20, 24, 40]) {
      const shape = projectileShapeAt({ ...capsule, radiusAlong }, 0, 0, 0);
      if (shape.kind !== "polygon") throw new Error("a capsule must be a polygon");
      expect(turnsConsistently(shape.points)).toBe(true);
    }
  });

  it("is flat across the tail and round at the nose", () => {
    const shape = projectileShapeAt(capsule, 0, 0, 0);
    if (shape.kind !== "polygon") throw new Error("a capsule must be a polygon");
    // Exactly two vertices sit on the tail edge: it is a cut, not a curve.
    const onTail = shape.points.filter((p) => Math.abs(p.x + 24) < 1e-9);
    expect(onTail).toHaveLength(2);
    // The nose reaches its full half-length, and does so at a single forward-most point.
    const foremost = Math.max(...shape.points.map((p) => p.x));
    expect(foremost).toBeCloseTo(24, 9);
    expect(shape.points.filter((p) => Math.abs(p.x - foremost) < 1e-9)).toHaveLength(1);
  });

  it("points its nose along the shot's angle, not along the world", () => {
    const east = projectileShapeAt(capsule, 0, 0, 0);
    const north = projectileShapeAt(capsule, 0, 0, -Math.PI / 2);
    if (east.kind !== "polygon" || north.kind !== "polygon") throw new Error("polygons expected");
    expect(Math.max(...east.points.map((p) => p.x))).toBeCloseTo(24, 6);
    expect(Math.min(...north.points.map((p) => p.y))).toBeCloseTo(-24, 6);
  });

  it("catches on its squared tail where the same ellipse slips past", () => {
    // The shapes share an extent, so the difference is not reach — it is that the tail is FULL
    // WIDTH at its extreme where an ellipse has tapered to a point. Parked off the hull's corner,
    // the capsule's back edge clips it and the ellipse of identical dimensions does not. This is
    // the whole behavioural consequence of the shape change, so it is worth one explicit case.
    const ellipse = { shape: "ellipse", radiusAlong: 24, radiusAcross: 15 } as const;
    expect(shapeHitsObb(projectileShapeAt(capsule, 246, 128, 0), hull)).toBe(true);
    expect(shapeHitsObb(projectileShapeAt(ellipse, 246, 128, 0), hull)).toBe(false);
  });

  it("smears into a swept hull like any other projectile", () => {
    const before = projectileShapeAt(capsule, 100, 100, 0);
    const after = projectileShapeAt(capsule, 300, 100, 0);
    expect(shapeHitsObb(smear(before, after), hull)).toBe(true);
  });
});

describe("bar", () => {
  const bar = { shape: "bar", radiusAlong: 6, radiusAcross: 60 } as const;

  it("is long across the travel axis and thin along it", () => {
    const s = projectileShapeAt(bar, 0, 0, 0); // travelling +x
    expect(s.kind).toBe("polygon");
    const xs = (s as PolygonShape).points.map((p) => p.x);
    const ys = (s as PolygonShape).points.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(12); // 2 * radiusAlong
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(120); // 2 * radiusAcross
  });

  it("rotates with the flight angle", () => {
    const s = projectileShapeAt(bar, 0, 0, Math.PI / 2) as PolygonShape; // travelling +y
    const xs = s.points.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(120); // long side now spans x
  });

  it("catches two hulls a car-length apart at once", () => {
    const s = projectileShapeAt(bar, 0, 0, 0);
    expect(shapeHitsObb(s, { x: 10, y: 50, angle: 0, w: 48, h: 32 })).toBe(true);
    expect(shapeHitsObb(s, { x: 10, y: -50, angle: 0, w: 48, h: 32 })).toBe(true);
  });
});
