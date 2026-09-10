import { DRIVE_CONFIG } from "../config/drive-config.js";
import { planePenetration, rectPlanes, supportRadius, type BoundaryPlane } from "./boundary.js";
import type { SimBody } from "./step.js";

/**
 * Axis-aligned box. `x, y` is the TOP-LEFT corner, matching how `Obstacle` is authored in the arena
 * defs, so arena obstacles pass straight into `resolveWorld` without conversion.
 */
export interface Aabb {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Oriented box. `x, y` is the CENTRE (matching `PlayerState.x/y`); `angle` is radians, +y down. */
export interface Obb {
  x: number;
  y: number;
  angle: number;
  w: number;
  h: number;
}

/** One other car as the resolver sees it: where it is, and how hard it is to shove. */
export interface CarObstacle {
  hull: Obb;
  ramDefence: number;
}

/** Arena extent. The world is `[0, width] x [0, height]`, top-left origin. */
export interface Bounds {
  width: number;
  height: number;
  /**
   * The convex boundary, as inward half-planes. Absent means the plain rectangle above, which is
   * what every rectangular arena and every test fixture gets (AS6). Built once by `boundsOf`.
   */
  planes?: readonly BoundaryPlane[];
}

export interface Vec2 {
  x: number;
  y: number;
}

interface Span {
  min: number;
  max: number;
}

/** Contacts shallower than this count as "just touching": no push-out and no bounce. */
const MIN_OVERLAP = 1e-6;

/**
 * One pass. Re-running the sweep on a resolved body is a no-op for every case measured against
 * ARENA_01, so extra passes buy nothing.
 *
 * Read that precisely: the sweep reaches a *fixed point*, which is not the same as "everything ends
 * separated". Sequential resolution gives the last contact the final word, so a body squeezed by
 * several surfaces at once — a pileup, or a car crushed against a wall — converges to a state that
 * still penetrates whichever surface was resolved earlier. More passes cannot help; the same
 * ordering re-applies every pass. The resolve order below is what decides *which* surface keeps its
 * separation: obstacles go last among the SAT contacts, so level geometry outranks other cars. The
 * bounds clamp that follows them is positional only, and outranks everything on where the car may
 * end up — see `resolveWorld` for the full ranking.
 *
 * This was briefly 2 to paper over an MTV that used the raw span intersection and so came out too
 * short whenever one projection was contained in the other. Extra passes never fixed that either
 * (the wrong axis was re-picked every pass); they only masked how short the push was. A second pass
 * is now strictly harmful in one case: a body that genuinely cannot fit — wider than the gap between
 * two obstacles — bounces once per pass and sheds speed it should have kept.
 */
const RELAXATION_PASSES = 1;

/**
 * Push a body out of the world it is overlapping and bounce its speed. Pure: inputs are never
 * mutated and the result is always a fresh `SimBody` with `angle` and `reverseHold` carried through.
 *
 * Contacts resolve in a fixed order — bounds, `others` in array order, `obstacles` in array order,
 * then a final bounds clamp. Fixed order means server and client agree on *which* contacts are
 * applied and in what sequence; it does not promise bit-identical coordinates, since `cos`/`sin`
 * may differ by an ULP between engines (see the note beside `stepSim` in `step.ts`). Prediction
 * reconciles against authoritative state rather than assuming bit-exact replay.
 *
 * Ordering is a priority ranking, because the last contact resolved is the one guaranteed to end
 * separated (see `RELAXATION_PASSES`). From least to most inviolable:
 *
 *   1. other cars   — the cheapest overlap to concede (see the caveat below)
 *   2. obstacles    — level geometry; clipping into a wall looks broken and traps players
 *   3. world bounds — a car outside the arena renders off-screen and nothing downstream expects it
 *
 * Be clear about the size of those concessions: they are not grazes. A car crushed between another
 * car and an obstacle, or between an obstacle and a wall, can hold an overlap as deep as a full car
 * dimension — 48px measured on the flush-obstacle fixture in the tests — and hold it *stably*,
 * because the ranking re-applies identically every tick. Nothing here bounds the depth.
 *
 * The car-car case used to be the mildest only because the server resolves every player against the
 * current state each tick, so the *other* car is being pushed off this one at the same time — but
 * "at the same time" is sequential, not simultaneous: the caller mutates each player in place and
 * rebuilds `others` from whichever pose is current, so the SECOND car in resolution order resolves
 * against the FIRST car's already-corrected position, not its pre-tick one. Before the positional
 * split (stage 2 Task 2), each side conceded the FULL correction, so the first car removed the whole
 * depth and the second found nothing left to concede — one tick, fully separated. Since that split
 * below, each side concedes only its own `shareOf` — weighted by `ramDefence` as of stage 3 Task 3,
 * `mass` before it, the split itself unchanged — and `shareA + shareB` (the two cars' shares of each
 * other's `ramDefence` fraction) always sums to exactly 1. One full tick — both cars resolved once —
 * removes `shareA + shareB - shareA * shareB` of the original depth and leaves a residual of
 * `shareA * shareB * depth`: a quarter of the original overlap at equal `ramDefence` (0.5 * 0.5),
 * less as the ratings diverge. That residual is not the end of it — it shrinks by the same `shareA * shareB`
 * factor every subsequent tick both cars keep resolving, so the pair converges toward separation
 * geometrically over several ticks, not in the one tick that first detects the overlap. If only ONE
 * side of the pair is ever re-resolved (an idle or unqueued opponent, say), that geometric decay
 * never starts for the side that never runs, and the moving car's own single-sided concession sets a
 * standing residual instead of converging further — see `packages/server/src/sim/tick.test.ts`'s
 * "stops a driver short of another player" for a measured example. Either way, the relief comes from
 * the caller's loop, not from anything in this function: `resolveWorld` on its own will happily hold
 * two cars overlapped forever if the caller never re-resolves the pair.
 */
export function resolveWorld(
  body: SimBody,
  others: readonly CarObstacle[],
  obstacles: readonly Aabb[],
  bounds: Bounds,
  selfRamDefence: number,
): SimBody {
  let next = body;
  for (let pass = 0; pass < RELAXATION_PASSES; pass++) {
    // Leading bounds pass — position and bounce. A body that has driven into a wall is put back
    // inside before any SAT runs, so contacts are tested against the pose the car can actually
    // occupy. Skipping this measurably changes the outcome for over half of ordinary wall contacts.
    next = resolveBounds(next, bounds);
    for (const other of others) {
      next = resolveAgainst(next, other.hull, shareOf(selfRamDefence, other.ramDefence));
    }
    for (const obstacle of obstacles) {
      next = resolveAgainst(next, aabbToObb(obstacle), OBSTACLE_SHARE);
    }
    // Trailing bounds pass — position only, no bounce. The boundary still gets the last word on
    // where the car may be, but restitution was already applied to whichever surfaces the car
    // actually struck: each distinct surface damps the speed exactly once, never r^2 or r^3.
    next = clampIntoBounds(next, bounds);
  }
  return { ...next };
}

/**
 * The fraction of a car-car correction THIS body absorbs.
 *
 * A more solid car (higher `ramDefence`) takes less of the push, so a Bastion is something you
 * cannot shoulder aside and a Bullseye gets moved constantly. Renamed from a `mass`-weighted split
 * in stage 3 Task 3 — the split itself (a plain ratio of the two sides) is unchanged, only which
 * rating it reads. Static geometry has no `ramDefence` and does not yield: obstacles and bounds
 * still hand the body the whole correction, which is what `OBSTACLE_SHARE` names.
 *
 * Note this is a POSITIONAL split, not an impulse — velocity exchange is `applyImpulse`'s job. The
 * two are separate on purpose: separation runs every tick a pair overlaps, and routing it through
 * impulses would re-apply a knock on each of them.
 */
function shareOf(selfRamDefence: number, otherRamDefence: number): number {
  const total = selfRamDefence + otherRamDefence;
  return total <= 0 ? OBSTACLE_SHARE : otherRamDefence / total;
}

const OBSTACLE_SHARE = 1;

/**
 * The correction that brings the car's hull back inside the arena, resolved plane by plane.
 *
 * Sequential rather than summed: each plane is measured against the position the previous plane
 * left the body at. For an axis-aligned rectangle the two are identical — an x push cannot change
 * a y penetration — so this is a no-op for every arena that declares no polygon. For a chamfer it
 * is the difference between converging on the corner and overshooting it.
 */
function boundsPush(body: SimBody, bounds: Bounds): Vec2 {
  const planes = bounds.planes ?? rectPlanes(bounds.width, bounds.height);
  let x = body.x;
  let y = body.y;
  for (const plane of planes) {
    const r = supportRadius(body.angle, plane.nx, plane.ny);
    const pen = planePenetration(x, y, r, plane);
    if (pen > 0) {
      x += plane.nx * pen;
      y += plane.ny * pen;
    }
  }
  return { x: x - body.x, y: y - body.y };
}

/**
 * Bounds contact with bounce, one `applyContact` per violated plane so a corner reflects off both
 * walls rather than off some blended diagonal. That was the rule when bounds were two axes and it
 * is the rule now that they are N planes.
 *
 * World bounds are a plane clamp rather than SAT wall boxes. A clamp cannot pick the wrong
 * separating axis for a deeply penetrating body — a thin wall box would happily eject a fast car out
 * the far side — and for the ordinary shallow case it yields exactly the same MTV a wall box would.
 * The clamp still feeds `applyContact`, so bounds, obstacles, and cars bounce identically.
 */
function resolveBounds(body: SimBody, bounds: Bounds): SimBody {
  const planes = bounds.planes ?? rectPlanes(bounds.width, bounds.height);
  let next = body;
  for (const plane of planes) {
    const r = supportRadius(next.angle, plane.nx, plane.ny);
    const pen = planePenetration(next.x, next.y, r, plane);
    if (pen > 0) next = applyContact(next, { x: plane.nx * pen, y: plane.ny * pen });
  }
  return next;
}

/**
 * Positional guard: put the hull back inside the arena and leave `vx/vy` alone. Used as the final
 * word on position, after restitution has already been applied by the surfaces the car struck.
 */
function clampIntoBounds(body: SimBody, bounds: Bounds): SimBody {
  const push = boundsPush(body, bounds);
  if (push.x === 0 && push.y === 0) return body;
  return { ...body, x: body.x + push.x, y: body.y + push.y };
}

/**
 * Resolve the body's car OBB against one static or moving box, conceding only `share` of the push.
 * `share` is always `OBSTACLE_SHARE` (1) for static geometry and `shareOf(selfRamDefence,
 * other.ramDefence)` for another car — see `resolveWorld`. Only the body moves; the box itself is
 * never touched here.
 */
function resolveAgainst(body: SimBody, box: Obb, share: number): SimBody {
  const mtv = mtvBetween(carObbOf(body), box);
  if (mtv === null) return body;
  return applyContact(body, { x: mtv.x * share, y: mtv.y * share });
}

/**
 * Positional correction along `push`, then the bounce. With `n` the unit push direction (pointing
 * out of the surface, toward the car):
 *
 *   if dot(v, n) < 0:  v' = v - (1 + restitution) * dot(v, n) * n
 *
 * `angle` never changes during resolution — collision does not rotate a car — but the VELOCITY is
 * now free to point somewhere other than the facing. That is what makes a wall deflect rather than
 * merely damp: before this rework the reflected direction was discarded and only its magnitude
 * survived along the unchanged heading, so a car angled into a wall ground along it, pinned to the
 * boundary, still facing in. It now slides off, which is also what makes a car-to-car bounce read
 * as a bounce.
 */
function applyContact(body: SimBody, push: Vec2): SimBody {
  const length = Math.hypot(push.x, push.y);
  if (length <= MIN_OVERLAP) return body;
  const n: Vec2 = { x: push.x / length, y: push.y / length };

  let vx = body.vx;
  let vy = body.vy;
  const intoSurface = vx * n.x + vy * n.y;
  if (intoSurface < 0) {
    const scale = (1 + DRIVE_CONFIG.restitution) * intoSurface;
    vx -= scale * n.x;
    vy -= scale * n.y;
  }

  return { ...body, x: body.x + push.x, y: body.y + push.y, vx, vy };
}

/**
 * Separating Axis Theorem for two oriented boxes. Returns the minimum translation vector that moves
 * `a` clear of `b`, or `null` when they are separated or merely touching.
 */
function mtvBetween(a: Obb, b: Obb): Vec2 | null {
  const cornersA = obbCorners(a);
  const cornersB = obbCorners(b);
  const axes = [...axesOf(a), ...axesOf(b)];

  let bestDepth = Infinity;
  let bestAxis: Vec2 | null = null;
  let bestDirection = 1;

  for (const axis of axes) {
    const spanA = projectOnto(cornersA, axis);
    const spanB = projectOnto(cornersB, axis);

    // The two distances that separate the spans: slide `a` back along the axis until its leading end
    // clears b's trailing end, or forward until its trailing end clears b's leading end. Taking the
    // smaller of these — rather than the raw span intersection — is what makes containment work.
    // When one span lies wholly inside the other, the intersection is merely the inner span's own
    // extent: far too short to eject, and small enough to win the min-depth vote on the wrong axis,
    // which shoves the body sideways along a face it is buried in and leaves it still overlapping.
    const pushBack = spanA.max - spanB.min;
    const pushForward = spanB.max - spanA.min;
    if (pushBack <= MIN_OVERLAP || pushForward <= MIN_OVERLAP) return null;

    const depth = Math.min(pushBack, pushForward);
    if (depth < bestDepth) {
      bestDepth = depth;
      bestAxis = axis;
      // Leave by the nearer end. A flipped sign here would drive the body deeper into the box
      // instead of out of it. An exact tie (a perfectly centred body) goes forward: arbitrary,
      // but fixed, so replays agree.
      bestDirection = pushBack < pushForward ? -1 : 1;
    }
  }
  if (bestAxis === null) return null;

  const push = bestDirection * bestDepth;
  return { x: bestAxis.x * push, y: bestAxis.y * push };
}

/** The four corners, in a fixed local order so projections are deterministic. */
export function obbCorners(o: Obb): Vec2[] {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const hw = o.w / 2;
  const hh = o.h / 2;
  const local: Vec2[] = [
    { x: hw, y: hh },
    { x: -hw, y: hh },
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
  ];
  return local.map((p) => ({ x: o.x + p.x * c - p.y * s, y: o.y + p.x * s + p.y * c }));
}

/** A box's two unit face normals. The other two are their negations, which SAT does not need. */
function axesOf(o: Obb): [Vec2, Vec2] {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  return [
    { x: c, y: s },
    { x: -s, y: c },
  ];
}

function projectOnto(corners: readonly Vec2[], axis: Vec2): Span {
  let min = Infinity;
  let max = -Infinity;
  for (const corner of corners) {
    const projection = corner.x * axis.x + corner.y * axis.y;
    if (projection < min) min = projection;
    if (projection > max) max = projection;
  }
  return { min, max };
}

function carObbOf(body: SimBody): Obb {
  return { x: body.x, y: body.y, angle: body.angle, w: DRIVE_CONFIG.carWidth, h: DRIVE_CONFIG.carHeight };
}

/** Top-left `Aabb` to centre-based `Obb`, so one SAT path covers obstacles and cars alike. */
function aabbToObb(box: Aabb): Obb {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2, angle: 0, w: box.w, h: box.h };
}

/** Half-extents of the axis-aligned box enclosing the car OBB at its current angle. */
function hullHalfExtents(body: SimBody): Vec2 {
  const c = Math.abs(Math.cos(body.angle));
  const s = Math.abs(Math.sin(body.angle));
  const { carWidth, carHeight } = DRIVE_CONFIG;
  return { x: (c * carWidth + s * carHeight) / 2, y: (s * carWidth + c * carHeight) / 2 };
}

/**
 * Do two oriented boxes overlap? The same SAT the resolver uses, asked as a yes/no question rather
 * than for a push vector — a contact test needs the fact of overlap, not the correction.
 *
 * Sharing `mtvBetween` is the point: a separate overlap test would drift from the resolver, so
 * whatever consumes this answer can never disagree with what the resolver already pushed apart (or
 * didn't). "Merely touching" is not an overlap here, exactly as it is not there.
 */
export function obbsOverlap(a: Obb, b: Obb): boolean {
  return mtvBetween(a, b) !== null;
}

/**
 * Are two boxes touching or overlapping, within `pad` units of slack on each?
 *
 * This exists because `obbsOverlap` answers the wrong question for anything that runs *after*
 * resolution. `resolveWorld` pushes a car out to exactly the separation boundary, and the SAT treats
 * "just touching" as separated — so two cars that collided this tick end it at a measured gap of
 * zero and `obbsOverlap` is false.
 *
 * Kept as a tested pure-geometry predicate on the package's public surface even though it now has
 * zero callers: its original caller, ram detection, was removed on 2026-08-28 when collision stopped
 * dealing damage (see `docs/superpowers/specs/2026-08-28-attack-stat-damage-formula-design.md`).
 * `resolveInstanceHits`/projectile hit tests use `pointInObb` instead, so nothing in the live tick
 * calls this today — it stays as a documented, exercised primitive for whatever next needs a padded
 * contact test.
 *
 * The slack is applied to the half-extents of both boxes, so the effective tolerance on the gap
 * between them is `2 * pad`. Keep it small — the config key that used to size it,
 * `COMBAT_CONFIG.ramContactPad`, was deleted with ram detection; a future caller supplies its own.
 */
export function obbsInContact(a: Obb, b: Obb, pad: number): boolean {
  return obbsOverlap(inflate(a, pad), inflate(b, pad));
}

function inflate(o: Obb, pad: number): Obb {
  return { x: o.x, y: o.y, angle: o.angle, w: o.w + pad * 2, h: o.h + pad * 2 };
}

/**
 * The unit contact normal between two boxes that are touching or overlapping within `pad`, or `null`
 * when they are apart.
 *
 * **`n` points from `b` toward `a`**, matching `mtvBetween`'s contract that its vector moves `a`
 * clear of `b`. Pinned by test, because an inverted normal here would spin ram victims the wrong way
 * and classify every front hit as a rear one.
 *
 * The pad is not optional decoration. `resolveWorld` runs before anything that would ask this
 * question and pushes colliding cars out to *exactly* the separation boundary, where SAT reports
 * them separated — so an unpadded normal is `null` on every tick of a real collision. This is the
 * same problem, and the same fix, as `obbsInContact`.
 */
export function contactNormalBetween(a: Obb, b: Obb, pad: number): Vec2 | null {
  const mtv = mtvBetween(inflate(a, pad), inflate(b, pad));
  if (mtv === null) return null;
  const length = Math.hypot(mtv.x, mtv.y);
  if (length <= MIN_OVERLAP) return null;
  return { x: mtv.x / length, y: mtv.y / length };
}

/**
 * Point-in-oriented-box, by rotating the point into the box's local frame. The v1 projectile hit
 * test: a shot is a point, so a hit is this against the target's car OBB — the same box the driving
 * collision resolves against, never the drawn silhouette.
 */
export function pointInObb(px: number, py: number, o: Obb): boolean {
  const dx = px - o.x;
  const dy = py - o.y;
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const localX = dx * c + dy * s;
  const localY = -dx * s + dy * c;
  return Math.abs(localX) <= o.w / 2 && Math.abs(localY) <= o.h / 2;
}

/** Point-in-axis-aligned-box, with `box.x, box.y` the TOP-LEFT corner as arena obstacles author it. */
export function pointInAabb(px: number, py: number, box: Aabb): boolean {
  return px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h;
}

/**
 * The four corners of an axis-aligned box, so an obstacle can be fed to `convexOverlap` alongside a
 * weapon's swept hull. Routed through `obbCorners` rather than spelled out again, so obstacles
 * always wind the same way the car hulls do.
 */
export function aabbCorners(box: Aabb): Vec2[] {
  return obbCorners(aabbToObb(box));
}

/**
 * Is this point off the field? INCLUSIVE on every edge — a point exactly on the boundary is out —
 * matching `pointInAabb`'s convention that a point on an obstacle's face is inside it.
 *
 * One spelling of one rule, shared by everything that asks it: a projectile leaving the arena
 * (`combat.ts`) and a beam clipping against it (`weapons/instances.ts`) used to disagree by a strict
 * `<` against a `<=`, so a shot exactly on the edge survived where a beam already stopped.
 *
 * With `bounds.planes` set, the rectangle test is replaced by a walk over the convex boundary's
 * half-planes, keeping the same inclusive-on-every-edge convention: `<= 0` on the signed distance.
 */
export function pointOutsideBounds(px: number, py: number, bounds: Bounds): boolean {
  if (bounds.planes === undefined) {
    return px <= 0 || py <= 0 || px >= bounds.width || py >= bounds.height;
  }
  // Inclusive on every edge, exactly as the rectangle form is: `<= 0` on the signed distance means
  // a point resting on a plane is out.
  for (const plane of bounds.planes) {
    if (plane.nx * px + plane.ny * py - plane.d <= 0) return true;
  }
  return false;
}

/**
 * Separating Axis Theorem over two convex polygons, as a yes/no. Shares `MIN_OVERLAP` with
 * `mtvBetween`, so "just touching" counts as separated here exactly as it does for driving. That is
 * the same property `obbsInContact` exists to work around, and weapon hit tests inherit it rather
 * than contradicting it: one rule about touching, applied everywhere.
 *
 * Both inputs must be convex and wound consistently. Weapon hitboxes are generated by
 * `sim/weapons/shapes.ts`, never hand-authored, which is what makes that safe to assume.
 */
export function convexOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (const axis of [...edgeNormals(a), ...edgeNormals(b)]) {
    const spanA = projectOnto(a, axis);
    const spanB = projectOnto(b, axis);
    if (spanA.max - spanB.min <= MIN_OVERLAP) return false;
    if (spanB.max - spanA.min <= MIN_OVERLAP) return false;
  }
  return true;
}

/** Outward normals of each edge, the candidate separating axes for a convex polygon. */
function edgeNormals(points: readonly Vec2[]): Vec2[] {
  const axes: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const length = Math.hypot(ex, ey);
    if (length <= MIN_OVERLAP) continue;
    axes.push({ x: -ey / length, y: ex / length });
  }
  return axes;
}

/**
 * The point of `box` nearest `(px, py)` — on its surface for a source outside, the source itself for
 * one inside.
 *
 * The clamp-into-the-local-frame technique `circleOverlapsObb` performs inline and `sim/ram.ts`'s
 * `contactPointOn` performs against a car's own half-extents, lifted out so a third caller does not
 * have to write a fourth copy: rotate the source into the box's frame, clamp it to the half-extents,
 * rotate the clamped point back out. World space in, world space out, so callers never handle a
 * lever arm pre-resolved in somebody's local frame.
 *
 * Returning an interior source UNCHANGED rather than pushing it out to the nearest face is
 * deliberate and is what the FX layer wants: a shot that stopped inside a hull bursts where it
 * stopped, not on the skin beside it.
 */
export function nearestPointOnObb(px: number, py: number, box: Obb): Vec2 {
  const cos = Math.cos(-box.angle);
  const sin = Math.sin(-box.angle);
  const dx = px - box.x;
  const dy = py - box.y;

  const hx = box.w / 2;
  const hy = box.h / 2;
  const localX = Math.min(hx, Math.max(-hx, dx * cos - dy * sin));
  const localY = Math.min(hy, Math.max(-hy, dx * sin + dy * cos));

  const cosBack = Math.cos(box.angle);
  const sinBack = Math.sin(box.angle);
  return {
    x: box.x + (localX * cosBack - localY * sinBack),
    y: box.y + (localX * sinBack + localY * cosBack),
  };
}

/**
 * Exact circle-vs-OBB: rotate the circle's centre into the box's local frame, clamp to the box, and
 * compare the distance to the radius. Exact rather than polygonal because a circle is the common
 * projectile hitbox and an inscribed polygon would quietly under-report hits.
 */
export function circleOverlapsObb(cx: number, cy: number, r: number, box: Obb): boolean {
  const cos = Math.cos(-box.angle);
  const sin = Math.sin(-box.angle);
  const dx = cx - box.x;
  const dy = cy - box.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  const hx = box.w / 2;
  const hy = box.h / 2;
  const nearestX = Math.min(hx, Math.max(-hx, localX));
  const nearestY = Math.min(hy, Math.max(-hy, localY));

  return Math.hypot(localX - nearestX, localY - nearestY) < r;
}
