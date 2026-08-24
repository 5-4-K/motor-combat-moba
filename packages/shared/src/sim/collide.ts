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
 * One pass is enough: a correct MTV separates a contact outright, so re-running the sweep is a
 * no-op for every case measured against ARENA_01 — deep penetrations, corners, pileups, and a body
 * fully contained in an obstacle all settle after the first pass.
 *
 * This was briefly 2 to paper over an MTV that used the raw span intersection and so came out too
 * short whenever one projection was contained in the other. Extra passes never actually fixed that
 * (the wrong axis was re-picked every pass); they only masked how short the push was. A second pass
 * is now strictly harmful in one case: a body that genuinely cannot fit — wider than the gap between
 * two obstacles — bounces once per pass and sheds speed it should have kept.
 */
const RELAXATION_PASSES = 1;

/**
 * Push a body out of the world it is overlapping and bounce its speed. Pure: inputs are never
 * mutated and the result is always a fresh `SimBody` with `angle` and `reverseHold` carried through.
 *
 * Contacts are resolved in a fixed order — bounds, then `obstacles` in array order, then `others` in
 * array order — so server and client replays of the same tick agree.
 */
export function resolveWorld(
  body: SimBody,
  others: readonly Obb[],
  obstacles: readonly Aabb[],
  bounds: { width: number; height: number },
): SimBody {
  let next = body;
  for (let pass = 0; pass < RELAXATION_PASSES; pass++) {
    next = resolveBounds(next, bounds);
    for (const obstacle of obstacles) {
      next = resolveAgainst(next, aabbToObb(obstacle));
    }
    for (const other of others) {
      next = resolveAgainst(next, other);
    }
  }
  return { x: next.x, y: next.y, angle: next.angle, speed: next.speed, reverseHold: next.reverseHold };
}

/**
 * World bounds are an axis clamp rather than four SAT wall boxes. A clamp cannot pick the wrong
 * separating axis for a deeply penetrating body — a thin wall box would happily eject a fast car out
 * the far side — and for the ordinary shallow case it yields exactly the axis-aligned MTV a wall box
 * would. The clamp still feeds `applyContact`, so bounds, obstacles, and cars bounce identically.
 */
function resolveBounds(body: SimBody, bounds: { width: number; height: number }): SimBody {
  const { x: hx, y: hy } = hullHalfExtents(body);

  let next = body;
  if (next.x < hx) next = applyContact(next, { x: hx - next.x, y: 0 });
  else if (next.x > bounds.width - hx) next = applyContact(next, { x: bounds.width - hx - next.x, y: 0 });

  if (next.y < hy) next = applyContact(next, { x: 0, y: hy - next.y });
  else if (next.y > bounds.height - hy) next = applyContact(next, { x: 0, y: bounds.height - hy - next.y });

  return next;
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
