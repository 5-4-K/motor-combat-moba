/**
 * Fill a ribbon-shaped polygon as the triangle strip it already is.
 *
 * **Why.** Phaser fills a path by running Earcut over it, every frame, into fresh arrays. A flame
 * layer is 194 vertices and a bolt layer 415, a weapon stacks five to eight of them, and every one
 * is rebuilt per frame because it is animated — so the general-purpose triangulator is asked, sixty
 * times a second, for an answer the shape was BUILT from: station `i` on one edge, station `i` on
 * the other, two triangles between each pair. Measured on twelve instances: `afterburner`'s render
 * cost 3.67 -> 1.61 ms, and `lance`'s 16.2 -> 7.3 ms together with `BOLT_VISIBLE_TEAR`.
 *
 * **What a ribbon is** (`DrawBeamLayer.ribbon`): `stations` points down the near edge, the same
 * stations back up the far edge in REVERSE, then any remaining points are a convex cap running from
 * the far edge's start round to the near edge's start. The two edges never cross, which the
 * builders guarantee, so the quads tile the polygon exactly: translucent layers composite the same
 * as one fill, because no pixel is covered twice.
 *
 * Phaser-free on purpose — it takes the one method it calls — so the tiling is unit-tested, which
 * `ArenaScene` cannot be.
 */

/** The slice of `Phaser.GameObjects.Graphics` a ribbon fill needs. */
export interface TriangleSink {
  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): unknown;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Fewest segments a disc is drawn with. 12 was tried first and failed the rim bound below at a
 * radius of 9 to 10 units (0.307), which is exactly the size of a basic attack.
 */
const DISC_MIN_SEGMENTS = 16;
/** Most segments a disc is drawn with; past it the extra vertices are under a tenth of a pixel. */
const DISC_MAX_SEGMENTS = 48;
/**
 * Segments per world unit of radius. At 1.2 the rim's furthest departure from a true circle —
 * `r * (1 - cos(PI / n))` — stays under 0.3 units for every radius from 1 to 60 (the test sweeps them all),
 * which at the arena's fixed zoom of 1 is under a third of a pixel.
 */
const DISC_SEGMENTS_PER_UNIT = 1.2;

/** How many segments a disc of this radius is drawn with. Exported for the test that bounds it. */
export function discSegments(radius: number): number {
  const wanted = Math.ceil(radius * DISC_SEGMENTS_PER_UNIT);
  return Math.max(DISC_MIN_SEGMENTS, Math.min(DISC_MAX_SEGMENTS, wanted));
}

/** Unit-circle rims by segment count: `[cos0, sin0, cos1, sin1, ...]`, closed. At most 37 entries. */
const UNIT_RIMS = new Map<number, Float64Array>();

function unitRim(segments: number): Float64Array {
  let rim = UNIT_RIMS.get(segments);
  if (!rim) {
    rim = new Float64Array((segments + 1) * 2);
    for (let i = 0; i <= segments; i += 1) {
      const t = (i / segments) * Math.PI * 2;
      rim[i * 2] = Math.cos(t);
      rim[i * 2 + 1] = Math.sin(t);
    }
    UNIT_RIMS.set(segments, rim);
  }
  return rim;
}

/**
 * Fill a disc as a fan from its centre, instead of `fillCircle`.
 *
 * Same reason as the ribbon: `fillCircle` is an arc path, and Phaser triangulates a path with
 * Earcut every frame. A round shot is three to nine nested discs, so a volley of them is dozens of
 * Earcut runs over shapes whose triangulation is a fan by definition. Measured on twelve instances:
 * `magmablast`'s shell 1.33 -> 0.43 ms, a basic attack 0.47 -> 0.17 ms. The rim comes from a table
 * per segment count, so a disc costs no trig.
 */
export function fillDisc(sink: TriangleSink, x: number, y: number, radius: number): void {
  if (!(radius > 0)) return;
  const segments = discSegments(radius);
  const rim = unitRim(segments);
  let px = x + radius * rim[0]!;
  let py = y + radius * rim[1]!;
  for (let i = 1; i <= segments; i += 1) {
    const nx = x + radius * rim[i * 2]!;
    const ny = y + radius * rim[i * 2 + 1]!;
    sink.fillTriangle(x, y, px, py, nx, ny);
    px = nx;
    py = ny;
  }
}

export function fillRibbon(sink: TriangleSink, points: readonly Point[], stations: number): void {
  if (stations < 2 || points.length < stations * 2) return;
  const lastFar = stations * 2 - 1;
  for (let i = 0; i < stations - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    // The far edge is stored reversed: station `i` sits at `lastFar - i`.
    const c = points[lastFar - (i + 1)]!;
    const d = points[lastFar - i]!;
    sink.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
    sink.fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y);
  }

  // The cap, as a fan from the middle of the edge it closes. Convex by construction (a half
  // ellipse), so every fan triangle lies inside it.
  if (points.length === stations * 2) return;
  const farStart = points[lastFar]!;
  const nearStart = points[0]!;
  const mx = (farStart.x + nearStart.x) / 2;
  const my = (farStart.y + nearStart.y) / 2;
  let previous: Point = farStart;
  for (let k = stations * 2; k < points.length; k += 1) {
    const next = points[k]!;
    sink.fillTriangle(mx, my, previous.x, previous.y, next.x, next.y);
    previous = next;
  }
  sink.fillTriangle(mx, my, previous.x, previous.y, nearStart.x, nearStart.y);
}
