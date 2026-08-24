import { DRIVE_CONFIG } from "../config/drive-config.js";
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

/** Arena extent. The world is `[0, width] x [0, height]`, top-left origin. */
export interface Bounds {
  width: number;
  height: number;
}

interface Vec2 {
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
 * separation, and obstacles are last precisely because level geometry is the one that must win.
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
 * may differ by an ULP between engines (see the note in `drive.ts`). Prediction reconciles against
 * authoritative state rather than assuming bit-exact replay.
 *
 * Ordering is a priority ranking, because the last contact resolved is the one guaranteed to end
 * separated (see `RELAXATION_PASSES`). From least to most inviolable:
 *
 *   1. other cars   — an overlap here is recoverable and self-corrects as both cars drive on
 *   2. obstacles    — level geometry; clipping into a wall looks broken and traps players
 *   3. world bounds — a car outside the arena renders off-screen and nothing downstream expects it
 *
 * So a car crushed between another car and an obstacle keeps a little car-car overlap, and one
 * crushed between an obstacle and a wall keeps a little obstacle overlap. Those are the deliberate
 * concessions; the alternatives are worse.
 */
export function resolveWorld(
  body: SimBody,
  others: readonly Obb[],
  obstacles: readonly Aabb[],
  bounds: Bounds,
): SimBody {
  let next = body;
  for (let pass = 0; pass < RELAXATION_PASSES; pass++) {
    // Leading bounds pass — position and bounce. A body that has driven into a wall is put back
    // inside before any SAT runs, so contacts are tested against the pose the car can actually
    // occupy. Skipping this measurably changes the outcome for over half of ordinary wall contacts.
    next = resolveBounds(next, bounds);
    for (const other of others) {
      next = resolveAgainst(next, other);
    }
    for (const obstacle of obstacles) {
      next = resolveAgainst(next, aabbToObb(obstacle));
    }
    // Trailing bounds pass — position only, no bounce. The boundary still gets the last word on
    // where the car may be, but restitution was already applied to whichever surfaces the car
    // actually struck: each distinct surface damps the speed exactly once, never r^2 or r^3.
    next = clampIntoBounds(next, bounds);
  }
  return { x: next.x, y: next.y, angle: next.angle, speed: next.speed, reverseHold: next.reverseHold };
}

/**
 * The correction that brings the car's hull back inside the arena, per axis. Zero on an axis that
 * is already inside. The two axes are independent: `hullHalfExtents` depends only on `angle`, which
 * resolution never changes, so both components can be measured from the same pose.
 */
function boundsPush(body: SimBody, bounds: Bounds): Vec2 {
  const { x: hx, y: hy } = hullHalfExtents(body);

  let x = 0;
  if (body.x < hx) x = hx - body.x;
  else if (body.x > bounds.width - hx) x = bounds.width - hx - body.x;

  let y = 0;
  if (body.y < hy) y = hy - body.y;
  else if (body.y > bounds.height - hy) y = bounds.height - hy - body.y;

  return { x, y };
}

/**
 * Bounds contact with bounce, one `applyContact` per violated axis so a corner reflects off both
 * walls rather than off some blended diagonal.
 *
 * World bounds are an axis clamp rather than four SAT wall boxes. A clamp cannot pick the wrong
 * separating axis for a deeply penetrating body — a thin wall box would happily eject a fast car out
 * the far side — and for the ordinary shallow case it yields exactly the axis-aligned MTV a wall box
 * would. The clamp still feeds `applyContact`, so bounds, obstacles, and cars bounce identically.
 */
function resolveBounds(body: SimBody, bounds: Bounds): SimBody {
  const push = boundsPush(body, bounds);

  let next = body;
  if (push.x !== 0) next = applyContact(next, { x: push.x, y: 0 });
  if (push.y !== 0) next = applyContact(next, { x: 0, y: push.y });
  return next;
}

/**
 * Positional guard: put the hull back inside the arena and leave `speed` alone. Used as the final
 * word on position, after restitution has already been applied by the surfaces the car struck.
 */
function clampIntoBounds(body: SimBody, bounds: Bounds): SimBody {
  const push = boundsPush(body, bounds);
  if (push.x === 0 && push.y === 0) return body;
  return {
    x: body.x + push.x,
    y: body.y + push.y,
    angle: body.angle,
    speed: body.speed,
    reverseHold: body.reverseHold,
  };
}

/** Resolve the body's car OBB against one static or moving box. Only the body moves. */
function resolveAgainst(body: SimBody, box: Obb): SimBody {
  const mtv = mtvBetween(carObbOf(body), box);
  return mtv === null ? body : applyContact(body, mtv);
}

/**
 * Positional correction along `push`, then the bounce. With `n` the unit push direction (pointing
 * out of the surface, toward the car) and `v = forward * speed`:
 *
 *   if dot(v, n) < 0:  v' = v - (1 + restitution) * dot(v, n) * n
 *   speed = |v'|, negated when dot(v', forward) < 0 so reverse stays negative along the facing.
 *
 * `angle` never changes during resolution, so `speed` stays a scalar along the car's facing.
 *
 * That last step — re-projecting the reflected velocity back onto an unchanged `forward` — is the
 * rule as specified, and it has two consequences worth knowing about before anyone "fixes" them.
 * Both are pinned by tests; changing either means changing the spec, not this function.
 *
 *  1. Walls damp but never redirect. The reflected direction is discarded and only its magnitude
 *     survives, so a car angled into a wall does not slide off it: it grinds along, pinned to the
 *     boundary, shedding a few percent of speed per tick while still facing into the wall. Real
 *     deflection would need `angle` to change, which collision resolution deliberately does not do.
 *
 *  2. The sign flips discontinuously at |dot(n, forward)| = 1/sqrt(1 + restitution) — about 30.6
 *     degrees off the surface normal. Just inside that, the reflected velocity still opposes the
 *     facing and the car is reported as reversing; just outside, it agrees and the car is reported
 *     as driving forward. The magnitude is continuous across the boundary, but the reported `speed`
 *     jumps by roughly twice it. Head-on impacts are nowhere near this angle; glancing ones sit
 *     right on it.
 */
function applyContact(body: SimBody, push: Vec2): SimBody {
  const length = Math.hypot(push.x, push.y);
  if (length <= MIN_OVERLAP) return body;
  const n: Vec2 = { x: push.x / length, y: push.y / length };

  const forward: Vec2 = { x: Math.cos(body.angle), y: Math.sin(body.angle) };
  let vx = forward.x * body.speed;
  let vy = forward.y * body.speed;

  const intoSurface = vx * n.x + vy * n.y;
  if (intoSurface < 0) {
    const scale = (1 + DRIVE_CONFIG.restitution) * intoSurface;
    vx -= scale * n.x;
    vy -= scale * n.y;
  }

  const magnitude = Math.hypot(vx, vy);
  const speed = vx * forward.x + vy * forward.y < 0 ? -magnitude : magnitude;

  return {
    x: body.x + push.x,
    y: body.y + push.y,
    angle: body.angle,
    speed,
    reverseHold: body.reverseHold,
  };
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
function obbCorners(o: Obb): Vec2[] {
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
