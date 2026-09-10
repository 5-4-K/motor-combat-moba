import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { Vec2 } from "./collide.js";

/**
 * One inward half-plane of a convex world boundary. A point `p` is inside when
 * `nx * p.x + ny * p.y >= d`, so `(nx, ny)` is a UNIT normal pointing INTO the arena — the same
 * direction the resulting push is applied along, which is what lets `applyContact` take it
 * unchanged.
 *
 * Half-planes rather than wall boxes on purpose (AS7). A clamp cannot pick the wrong separating
 * axis for a deeply penetrating body; a thin SAT wall box would happily eject a fast car out the
 * far side. See `resolveBounds` in `collide.ts`, which has said so since before there were planes.
 */
export interface BoundaryPlane {
  nx: number;
  ny: number;
  d: number;
}

/**
 * The four planes of the axis-aligned rectangle `0,0 -> width,height`.
 *
 * Spelled out rather than routed through `planesOf` so the default costs no trig and lands on
 * exact integers: an arena that declares no boundary must behave bit-identically to the code this
 * replaced, and `cos(PI/2)` is not exactly 0.
 */
export function rectPlanes(width: number, height: number): BoundaryPlane[] {
  return [
    { nx: 1, ny: 0, d: 0 },
    { nx: 0, ny: 1, d: 0 },
    { nx: -1, ny: 0, d: -width },
    { nx: 0, ny: -1, d: -height },
  ];
}

/**
 * Planes from a convex polygon wound CLOCKWISE in screen coordinates (`+y` down).
 *
 * For an edge `a -> b` with direction `e`, the inward normal is `(-e.y, e.x)` normalised. Check it
 * against the top edge of a rectangle: `e = (+w, 0)` gives `(0, +w)`, i.e. straight down, into the
 * arena. Winding the polygon the other way inverts every normal and turns the boundary inside out,
 * which is why `arena.test.ts` asserts the arena centre is inside every plane.
 *
 * Degenerate edges (a repeated vertex) are dropped rather than producing a NaN normal.
 */
export function planesOf(vertices: readonly Vec2[]): BoundaryPlane[] {
  const planes: BoundaryPlane[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len === 0) continue;
    const nx = -ey / len;
    const ny = ex / len;
    planes.push({ nx, ny, d: nx * a.x + ny * a.y });
  }
  return planes;
}

/**
 * How far the car's hull reaches from its centre along `(nx, ny)` — the OBB's support radius.
 *
 * This is the generalisation of `hullHalfExtents` in `collide.ts`: project both half-extents onto
 * the normal and add. For `(1, 0)` and `(0, 1)` it reproduces that function exactly, which is the
 * property `boundary.test.ts` pins and what makes a rectangular arena unchanged.
 */
export function supportRadius(angle: number, nx: number, ny: number): number {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const { carWidth, carHeight } = DRIVE_CONFIG;
  // (c, s) is the car's forward axis (length carWidth); (-s, c) is its lateral axis (carHeight).
  return Math.abs(nx * c + ny * s) * (carWidth / 2) + Math.abs(-nx * s + ny * c) * (carHeight / 2);
}

/**
 * How deep a hull of support radius `r` centred at `(x, y)` pokes through `plane`. Positive means
 * penetrating; zero or negative means clear. Push the body by `plane.n * penetration` to separate.
 */
export function planePenetration(x: number, y: number, r: number, plane: BoundaryPlane): number {
  return plane.d + r - (plane.nx * x + plane.ny * y);
}
