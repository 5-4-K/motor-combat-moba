import type { BeamHitbox, ProjectileHitbox } from "../../config/weapon-types.js";
import { circleOverlapsObb, convexOverlap, obbCorners, type Obb, type Vec2 } from "../collide.js";

/**
 * A hitbox placed in the world. A circle stays a circle because it is the common projectile shape
 * and an inscribed polygon would quietly under-report hits; everything else is a convex polygon
 * running through the same SAT the car hulls use.
 */
export type WorldShape =
  | { kind: "circle"; x: number; y: number; radius: number }
  | { kind: "polygon"; points: Vec2[] };

/** Segments in a generated ellipse. Even, so the shape is symmetric about both axes. */
export const ELLIPSE_SEGMENTS = 12;
/** Segments used when a circle has to become a polygon (only inside `smear`). */
export const CIRCLE_SEGMENTS = 12;

export function projectileShapeAt(
  hitbox: ProjectileHitbox,
  x: number,
  y: number,
  angle: number,
): WorldShape {
  if (hitbox.shape === "circle") return { kind: "circle", x, y, radius: hitbox.radius };
  return {
    kind: "polygon",
    points: ring(ELLIPSE_SEGMENTS).map((t) =>
      rotateInto(x, y, angle, Math.cos(t) * hitbox.radiusAlong, Math.sin(t) * hitbox.radiusAcross),
    ),
  };
}

/**
 * A beam at its current reach. `extent` is the axial dimension — beams configure cross-section
 * only (D7) — so a zero extent is a degenerate shape that hits nothing, which is what makes the
 * tick a beam is born harmless.
 */
export function beamShapeAt(
  hitbox: BeamHitbox,
  x: number,
  y: number,
  angle: number,
  extent: number,
): WorldShape {
  const reach = Math.max(0, extent);
  // A zero-reach beam must hit nothing, independent of where the muzzle happens to sit — e.g. flush
  // against a hull the instant it fires. Letting `reach` fall through to 0 in the shapes below would
  // instead degenerate into a zero-width segment (rect) or a zero-spread point (cone) still located
  // AT the muzzle, and SAT calls a degenerate shape strictly inside a box an overlap, not a miss. An
  // empty polygon sidesteps that: `convexOverlap` treats fewer than 3 points as always separated.
  if (reach <= 0) return { kind: "polygon", points: [] };
  if (hitbox.shape === "rect") {
    const half = hitbox.width / 2;
    return {
      kind: "polygon",
      points: [
        rotateInto(x, y, angle, 0, -half),
        rotateInto(x, y, angle, reach, -half),
        rotateInto(x, y, angle, reach, half),
        rotateInto(x, y, angle, 0, half),
      ],
    };
  }
  // Cone: apex at the muzzle, so it fans wider in absolute terms as it grows.
  const half = (hitbox.angleDeg * Math.PI) / 360;
  const spread = Math.tan(half) * reach;
  return {
    kind: "polygon",
    points: [
      rotateInto(x, y, angle, 0, 0),
      rotateInto(x, y, angle, reach, -spread),
      rotateInto(x, y, angle, reach, spread),
    ],
  };
}

/**
 * The convex hull of a shape at its previous and current positions: a solid covering the whole
 * path travelled this tick.
 *
 * Without it a 3-unit shot moving 30 units per tick is sampled only where it lands and can pass
 * clean through a car. The smear is deliberately generous — it registers anywhere along that
 * tick's path — which is the correct bias for a shooter.
 */
export function smear(from: WorldShape, to: WorldShape): WorldShape {
  return { kind: "polygon", points: convexHull([...verticesOf(from), ...verticesOf(to)]) };
}

export function shapeHitsObb(shape: WorldShape, hull: Obb): boolean {
  if (shape.kind === "circle") return circleOverlapsObb(shape.x, shape.y, shape.radius, hull);
  return convexOverlap(shape.points, obbCorners(hull));
}

/** Local (forward, lateral) offset placed at a world pose. Forward is +x at angle 0. */
function rotateInto(x: number, y: number, angle: number, forward: number, lateral: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: x + forward * cos - lateral * sin, y: y + forward * sin + lateral * cos };
}

function ring(segments: number): number[] {
  return Array.from({ length: segments }, (_, i) => (i / segments) * Math.PI * 2);
}

/**
 * Circles become polygons only here, and are *circumscribed* (radius scaled by 1/cos(pi/n)) so the
 * smear never covers less area than the circle it stands for.
 */
function verticesOf(shape: WorldShape): Vec2[] {
  if (shape.kind === "polygon") return shape.points;
  const scale = 1 / Math.cos(Math.PI / CIRCLE_SEGMENTS);
  return ring(CIRCLE_SEGMENTS).map((t) => ({
    x: shape.x + Math.cos(t) * shape.radius * scale,
    y: shape.y + Math.sin(t) * shape.radius * scale,
  }));
}

/** Monotone chain. Deterministic: sorted input, fixed traversal, no floating tie-breaks. */
function convexHull(points: readonly Vec2[]): Vec2[] {
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (sorted.length < 3) return sorted;

  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const build = (input: Vec2[]): Vec2[] => {
    const out: Vec2[] = [];
    for (const p of input) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };

  return [...build(sorted), ...build([...sorted].reverse())];
}
