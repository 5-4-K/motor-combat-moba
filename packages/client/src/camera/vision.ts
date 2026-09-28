import type { FovConfig, Obstacle, WorldShape } from "@motor-combat-moba/shared";

/**
 * Field-of-vision geometry (spec 2026-09-28-camera-behaviors-design.md, CB25–CB29). Pure: the
 * scene hands in poses and obstacles, this answers "is that point seen" and "what polygon do I
 * cut out of the dark overlay". Car-local frame: +x is the nose, +y the car's right.
 */

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export interface VisionShape {
  readonly cx: number;
  readonly cy: number;
  readonly heading: number;
  readonly rangeX: number;
  readonly rangeY: number;
  readonly halfAngle: number;
  readonly full: boolean;
}

const ANGLE_EPSILON = 1e-9;

/** One car's vision: an ellipse at the car-frame offset, cut to a cone from its centre (CB25). */
export function visionShapeOf(pose: Pose, fov: FovConfig): VisionShape {
  const cos = Math.cos(pose.angle);
  const sin = Math.sin(pose.angle);
  return {
    // +offsetX is ahead (nose), +offsetY is the car's RIGHT on screen (the arena is y-down: at
    // heading 0 it is world +y, clockwise from the nose). sim/velocity.ts's prose calls this
    // same local +y side 'left' — a y-up label for the same axis; the maths agree.
    cx: pose.x + fov.offsetX * cos - fov.offsetY * sin,
    cy: pose.y + fov.offsetX * sin + fov.offsetY * cos,
    heading: pose.angle,
    rangeX: fov.rangeX,
    rangeY: fov.rangeY,
    halfAngle: (fov.angleDeg * Math.PI) / 360,
    full: fov.angleDeg >= 360,
  };
}

/** Inside the ellipse and the cone, ignoring obstacles. */
export function inShape(p: Pt, s: VisionShape): boolean {
  const dx = p.x - s.cx;
  const dy = p.y - s.cy;
  const cos = Math.cos(s.heading);
  const sin = Math.sin(s.heading);
  const along = dx * cos + dy * sin;
  const across = -dx * sin + dy * cos;
  if ((along / s.rangeX) ** 2 + (across / s.rangeY) ** 2 > 1) return false;
  if (s.full || (along === 0 && across === 0)) return true;
  return Math.abs(Math.atan2(across, along)) <= s.halfAngle + ANGLE_EPSILON;
}

function containsPoint(r: Obstacle, p: Pt): boolean {
  return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
}

/** Liang–Barsky: does segment a→b touch the axis-aligned box (top-left `x, y`)? */
export function segmentHitsRect(a: Pt, b: Pt, r: Obstacle): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - r.x, r.x + r.w - a.x, a.y - r.y, r.y + r.h - a.y];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (pi === 0) {
      if (qi < 0) return false;
      continue;
    }
    const t = qi / pi;
    if (pi < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

function blockedFrom(apex: Pt, p: Pt, obstacles: readonly Obstacle[]): boolean {
  // An obstacle the apex sits inside would blank everything; it is ignored (Review Focus 4).
  return obstacles.some((o) => !containsPoint(o, apex) && segmentHitsRect(apex, p, o));
}

/** Seen by at least one shape, with a clear line from that shape's apex when `blocked` (CB25). */
export function inVision(
  p: Pt,
  shapes: readonly VisionShape[],
  obstacles: readonly Obstacle[],
  blocked: boolean,
): boolean {
  return shapes.some(
    (s) => inShape(p, s) && (!blocked || !blockedFrom({ x: s.cx, y: s.cy }, p, obstacles)),
  );
}

/** A car is seen when its centre or any hull corner is (CB27). */
export function carVisible(
  pose: Pose,
  hull: { width: number; height: number },
  shapes: readonly VisionShape[],
  obstacles: readonly Obstacle[],
  blocked: boolean,
): boolean {
  const cos = Math.cos(pose.angle);
  const sin = Math.sin(pose.angle);
  const hw = hull.width / 2;
  const hh = hull.height / 2;
  const points: Pt[] = [{ x: pose.x, y: pose.y }];
  for (const [lx, ly] of [[hw, hh], [hw, -hh], [-hw, hh], [-hw, -hh]] as const) {
    points.push({ x: pose.x + lx * cos - ly * sin, y: pose.y + lx * sin + ly * cos });
  }
  return points.some((p) => inVision(p, shapes, obstacles, blocked));
}

/** Where to test a drawn shot: a circle's centre and four rim points, a polygon's vertices and centroid. */
export function shotSamplePoints(shape: WorldShape): Pt[] {
  if (shape.kind === "circle") {
    const { x, y, radius: r } = shape;
    return [{ x, y }, { x: x + r, y }, { x: x - r, y }, { x, y: y + r }, { x, y: y - r }];
  }
  const n = shape.points.length;
  if (n === 0) return [];
  const cx = shape.points.reduce((sum, p) => sum + p.x, 0) / n;
  const cy = shape.points.reduce((sum, p) => sum + p.y, 0) / n;
  return [...shape.points.map((p) => ({ x: p.x, y: p.y })), { x: cx, y: cy }];
}

/** Distance along a unit ray to an axis-aligned box, or Infinity. */
function rayToRect(o: Pt, dx: number, dy: number, r: Obstacle): number {
  let tmin = 0;
  let tmax = Infinity;
  for (const [origin, dir, lo, hi] of [
    [o.x, dx, r.x, r.x + r.w],
    [o.y, dy, r.y, r.y + r.h],
  ] as const) {
    if (Math.abs(dir) < 1e-12) {
      if (origin < lo || origin > hi) return Infinity;
      continue;
    }
    let t1 = (lo - origin) / dir;
    let t2 = (hi - origin) / dir;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/**
 * The shape as a ray fan for DRAWING the cut-out (CB29): the apex first (unless the cone is a full
 * circle), then `rays + 1` rim points across the cone, each stopped at the first obstacle when
 * `blocked`. Visibility tests use `inVision`, which is exact; this is only as fine as `rays`.
 */
export function visionPolygon(
  s: VisionShape,
  obstacles: readonly Obstacle[],
  blocked: boolean,
  rays = 96,
): Pt[] {
  const apex = { x: s.cx, y: s.cy };
  const start = s.full ? -Math.PI : -s.halfAngle;
  const span = s.full ? Math.PI * 2 : s.halfAngle * 2;
  const count = s.full ? rays : rays + 1;
  const live = blocked ? obstacles.filter((o) => !containsPoint(o, apex)) : [];
  const points: Pt[] = s.full ? [] : [apex];
  for (let i = 0; i < count; i++) {
    const local = start + (span * i) / rays;
    const rim = 1 / Math.hypot(Math.cos(local) / s.rangeX, Math.sin(local) / s.rangeY);
    const dx = Math.cos(s.heading + local);
    const dy = Math.sin(s.heading + local);
    let dist = rim;
    for (const o of live) dist = Math.min(dist, rayToRect(apex, dx, dy, o));
    points.push({ x: apex.x + dx * dist, y: apex.y + dy * dist });
  }
  return points;
}

export interface VisionPlayer {
  readonly sessionId: string;
  readonly team: number;
  readonly alive: boolean;
  readonly pose: Pose;
}

/**
 * Whose eyes the perspective player sees through (CB26): their own living car, or the frozen death
 * pose the scene passes for "pov" (undefined for "blind"); plus living teammates when vision is
 * shared in a team mode.
 */
export function visionPoses(input: {
  readonly perspective: { readonly sessionId: string; readonly team: number };
  readonly players: readonly VisionPlayer[];
  readonly sides: "ffa" | "team";
  readonly sharedVision: boolean;
  readonly frozenPose: Pose | undefined;
}): Pose[] {
  const poses: Pose[] = [];
  const self = input.players.find((p) => p.sessionId === input.perspective.sessionId);
  if (self?.alive) poses.push(self.pose);
  else if (input.frozenPose) poses.push(input.frozenPose);
  if (input.sharedVision && input.sides === "team") {
    for (const p of input.players) {
      if (p.sessionId === input.perspective.sessionId || !p.alive) continue;
      if (p.team === input.perspective.team) poses.push(p.pose);
    }
  }
  return poses;
}
