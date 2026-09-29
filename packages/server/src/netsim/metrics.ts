/**
 * What a netsim run measures (spec NR57–NR59). Every number is taken from the headless client
 * models' own view of the world against the server's recorded truth, over simulated links.
 *
 * - `stepsPerTickMax` — the most `stepSim` calls any one car received in a single server tick.
 * - `repeatedInputRate` — share of car-ticks simulated on a repeated input; `null` for the legacy
 *   model (it never repeats an input: an empty queue is simply not stepped).
 * - `remotePathErrorP95` — each client frame, for each remote car that is alive: distance from the
 *   drawn pose to the nearest point of that car's true trajectory over the last 400 ms (truth
 *   sampled per tick, linearly interpolated). p95 over all samples.
 * - `remoteDisplayDelayMs` — mean of (now − the truth time of that nearest point).
 * - `remoteHoldRate` — share of those samples where the drawn position equals the previous frame's
 *   drawn position (distance < 0.01 u) while the true car moved more than 1 u since the previous
 *   frame (`isHold`). A remote that is standing still is never a hold. "The true car" is the
 *   tick-sampled truth interpolated to each frame's time (`truthAt`), so the rate does not depend
 *   on the tick rate.
 * - `reconcileErrorP95` — at each snapshot the client reconciles, distance between its current
 *   predicted position and the replayed target, p95.
 * - `inputToServerMs` — mean of (the server time a car's input was simulated − the client time it
 *   was produced).
 */
export interface NetsimMetrics {
  stepsPerTickMax: number;
  repeatedInputRate: number | null;
  remotePathErrorP95: number;
  remoteDisplayDelayMs: number;
  remoteHoldRate: number;
  reconcileErrorP95: number;
  inputToServerMs: number;
}

/** The trajectory window a drawn remote pose is judged against, ms. */
export const TRUTH_WINDOW_MS = 400;
/** A drawn pose that moved less than this since the previous frame is frozen, u. */
export const HOLD_DRAWN_EPSILON = 0.01;
/** A true car that moved more than this since the previous frame was really moving, u. */
export const HOLD_TRUTH_MIN_MOVE = 1;

/** Nearest-rank percentile, `p` in [0, 100]. Empty input answers 0. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

export interface PathPoint {
  t: number;
  x: number;
  y: number;
}

/** Closest point to (x, y) on the polyline through `path` (sorted by t), with its interpolated time. */
export function nearestOnPath(
  path: readonly PathPoint[],
  x: number,
  y: number,
): { distance: number; t: number } {
  let best = { distance: Infinity, t: path[0]?.t ?? 0 };
  for (let i = 0; i < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1] ?? a;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    const px = a.x + dx * u;
    const py = a.y + dy * u;
    const d = Math.hypot(x - px, y - py);
    // `<=`: on a tie the NEWER point wins, so a stationary car (every point equidistant) resolves to
    // the newest sample in the window rather than the oldest, which would inflate display delay.
    if (d <= best.distance) best = { distance: d, t: a.t + (b.t - a.t) * u };
  }
  return best;
}

/** First index in `path` (sorted by t) whose t is >= `t`. */
export function lowerBound(path: readonly PathPoint[], t: number): number {
  let lo = 0;
  let hi = path.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (path[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The true pose at time `t`, linearly interpolated between the two tick samples that bracket it, so
 * the answer does not depend on the tick rate. Clamped to the first and last sample outside them.
 */
export function truthAt(path: readonly PathPoint[], t: number): PathPoint {
  const i = lowerBound(path, t);
  if (i === 0) return { ...path[0]!, t };
  if (i >= path.length) return { ...path[path.length - 1]!, t };
  const a = path[i - 1]!;
  const b = path[i]!;
  const u = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
  return { t, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

/**
 * The true trajectory over `[from, to]`: the tick samples strictly inside, with interpolated
 * endpoints at both ends (`truthAt`), so the window is exactly that span whatever the tick rate.
 */
export function truthWindow(path: readonly PathPoint[], from: number, to: number): PathPoint[] {
  const inner = path.slice(lowerBound(path, from), lowerBound(path, to)).filter((p) => p.t > from);
  return [truthAt(path, from), ...inner, truthAt(path, to)];
}

interface Point {
  x: number;
  y: number;
}

/**
 * The hold predicate: the drawn pose did not move (< `HOLD_DRAWN_EPSILON`) while the true car did
 * (> `HOLD_TRUTH_MIN_MOVE`). Both conditions are required — a remote that is standing still is drawn
 * standing still, and that is correct, not a hold.
 */
export function isHold(prevDrawn: Point, drawn: Point, prevTrue: Point, trueNow: Point): boolean {
  const drawnMoved = Math.hypot(drawn.x - prevDrawn.x, drawn.y - prevDrawn.y);
  const trueMoved = Math.hypot(trueNow.x - prevTrue.x, trueNow.y - prevTrue.y);
  return drawnMoved < HOLD_DRAWN_EPSILON && trueMoved > HOLD_TRUTH_MIN_MOVE;
}

export const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length;
