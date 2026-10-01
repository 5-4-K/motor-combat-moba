/**
 * What a netsim run measures (spec NR57–NR59). Every number is taken from the headless client
 * models' own view of the world against the server's recorded truth, over simulated links.
 *
 * - `stepsPerTickMax` — the most `stepSim` calls any one car received in a single server tick, as
 *   `runPipeline` counted them (NR17: 1).
 * - `repeatedInputRate` — share of stepped car-ticks simulated on a repeated or neutral input,
 *   because that car's own frame for the tick had not arrived (NR22). `null` is kept in the type for
 *   a model that never repeats; the `"tick"` model always reports a number.
 * - `remotePathErrorP95` — each client frame, for each remote car that is alive (on the server and
 *   as the client draws it): distance from the drawn pose to the nearest point of that car's true
 *   trajectory from 400 ms before to 100 ms after the frame (`TRUTH_WINDOW_MS`, `TRUTH_LEAD_MS`;
 *   truth sampled per tick, linearly interpolated). The 100 ms lead is spec NR31's dead-reckoning
 *   cap, so a remote drawn ahead on its true path is not punished. p95 over all samples.
 * - `remoteDisplayDelayMs` — mean of (now − the truth time of that nearest point). Signed: negative
 *   when a remote is drawn ahead of where the car really is at `now`.
 * - `remoteHoldRate` — share of those samples where the drawn position equals the previous frame's
 *   drawn position (distance < 0.01 u) while the true car moved more than 1 u since the previous
 *   frame (`isHold`). A remote that is standing still is never a hold. "The true car" is the
 *   tick-sampled truth interpolated to each frame's time (`truthAt`), so the rate does not depend
 *   on the tick rate.
 * - `reconcileErrorP95` — at each snapshot the client reconciles, distance between its current
 *   predicted position and the replayed target, p95.
 * - `inputToServerMs` — mean of (the server time a car's input was simulated − the client time it
 *   was produced), over inputs simulated as their own tick's input.
 *
 * Reported with no target (phase E review I3) — they exist so a contact-blend or heading regression
 * is visible, which none of the metrics above can see:
 *
 * - `remoteHeadingErrorP95Deg` — per remote sample, |drawn heading − the true heading at the time
 *   of the nearest true point| (the same point `remotePathErrorP95` scores against, so the display
 *   delay is not counted as error), degrees, p95.
 * - `remoteJumpExcessMax` / `remoteJumpExcessP99` — per remote sample with a previous frame, the
 *   length of the drawn displacement since that frame minus the true car's displacement over one
 *   frame's span ending at the time being drawn (the sample's display delay back from the frame, so
 *   a remote drawn a delay behind a car that just braked is not read as jumping), as VECTORS:
 *   `|Δdrawn − Δtrue|`, u — a sideways jump of the car's own length scores its length. A span whose
 *   truth touches a death or respawn (`aliveThrough`) is not scored: its truth has the teleport in it. The Phase E Global Constraint is that this never exceeds the settle
 *   ease's share of a gap.
 * - `remoteBlendPathErrorP95` / `remoteBlendHeadingErrorP95Deg` — `remotePathErrorP95` and
 *   `remoteHeadingErrorP95Deg` over only the samples drawn within `contactBlendRangeCars` car
 *   lengths of the local car's drawn pose, where the contact blend (NR34) acts; those are a few
 *   percent of all samples, too few for the all-sample p95 to see. 0 when there are none (the count
 *   is `NetsimDiagnostics.blendSamples`). Both are nearest-point scores, so they are blind to a pose
 *   lagged ALONG its path (it carries that path point's heading) — which is what the next two see.
 * - `remoteBlendLagP95` / `remoteBlendLagHeadingP95Deg` — over the same blend-range samples, the
 *   drawn pose against the blend's own target that frame, `blend(interpolated, reckoned at the
 *   anchor tick, current weight)` (`RemoteTimeline.blendTarget`): position u and heading degrees,
 *   p95. Time-aware: a settle that trails the target (phase E re-review I4) reads here.
 */
export interface NetsimMetrics {
  stepsPerTickMax: number;
  repeatedInputRate: number | null;
  remotePathErrorP95: number;
  remoteDisplayDelayMs: number;
  remoteHoldRate: number;
  reconcileErrorP95: number;
  inputToServerMs: number;
  remoteHeadingErrorP95Deg: number;
  remoteJumpExcessMax: number;
  remoteJumpExcessP99: number;
  remoteBlendPathErrorP95: number;
  remoteBlendHeadingErrorP95Deg: number;
  remoteBlendLagP95: number;
  remoteBlendLagHeadingP95Deg: number;
}

/** How far BEFORE the frame the trajectory a drawn remote pose is judged against reaches, ms. */
export const TRUTH_WINDOW_MS = 400;
/**
 * How far AFTER the frame that trajectory reaches, ms: spec NR31's dead-reckoning cap
 * (the future `NET_CONFIG.maxExtrapolateMs`, 100), so a remote drawn ahead within it scores ~0 error.
 */
export const TRUTH_LEAD_MS = 100;
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

/**
 * Closest point to (x, y) on the polyline through `path` (sorted by t), with its interpolated time.
 * On an exact distance tie the NEWER point wins — or, when `preferT` is given, the point whose time
 * is closest to `preferT` (then the newer of those).
 */
export function nearestOnPath(
  path: readonly PathPoint[],
  x: number,
  y: number,
  preferT?: number,
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
    const t = a.t + (b.t - a.t) * u;
    // On a tie the NEWER point wins, so a stationary car (every point equidistant) resolves to the
    // newest sample in the window rather than the oldest, which would inflate display delay. With a
    // `preferT` (the frame's time, when the window also reaches past it) the tie goes to the point
    // nearest that time instead, so a stationary car is not scored as drawn ahead.
    const closer =
      d < best.distance ||
      (d === best.distance &&
        (preferT === undefined || Math.abs(t - preferT) <= Math.abs(best.t - preferT)));
    if (closer) best = { distance: d, t };
  }
  return best;
}

/** First index in `path` (sorted by t) whose t is >= `t`. */
export function lowerBound(path: readonly { t: number }[], t: number): number {
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

/**
 * Scores one drawn remote pose against that car's true trajectory over
 * `[now − TRUTH_WINDOW_MS, now + TRUTH_LEAD_MS]`: the distance to the nearest point, and the signed
 * display delay (frame time − that point's time; negative when drawn ahead). A window reaching past
 * the last truth sample clamps to it (`truthAt`). An exact tie (a stationary car) resolves to the
 * point nearest `now`, so only a pose genuinely ahead on the path reads as a negative delay.
 */
export function scoreRemoteSample(
  path: readonly PathPoint[],
  now: number,
  x: number,
  y: number,
): { distance: number; delayMs: number } {
  // A knot at `now` itself, so the tie-break toward `now` can land on it exactly.
  const window = [
    ...truthWindow(path, now - TRUTH_WINDOW_MS, now),
    ...truthWindow(path, now, now + TRUTH_LEAD_MS).slice(1),
  ];
  const hit = nearestOnPath(window, x, y, now);
  return { distance: hit.distance, delayMs: now - hit.t };
}

/** Wrap an angle into (-PI, PI]. */
function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export interface HeadingPoint {
  t: number;
  angle: number;
}

/**
 * The true heading at time `t`, interpolated the short way between the two tick samples that
 * bracket it (like `truthAt` for position), clamped to the first and last sample outside them.
 */
export function headingAt(path: readonly HeadingPoint[], t: number): number {
  const i = lowerBound(path, t);
  if (i === 0) return path[0]!.angle;
  if (i >= path.length) return path[path.length - 1]!.angle;
  const a = path[i - 1]!;
  const b = path[i]!;
  const u = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
  return a.angle + wrapAngle(b.angle - a.angle) * u;
}

/** |drawn − true| heading, degrees, the short way round. */
export function headingErrorDeg(drawn: number, truth: number): number {
  return (Math.abs(wrapAngle(drawn - truth)) * 180) / Math.PI;
}

/**
 * How far the drawn pose's displacement between two frames differs from the true car's over the
 * matching span, as vectors: `|(drawn − prevDrawn) − (trueNow − prevTrue)|`, u. A drawn pose that
 * moves exactly as its car scores 0; one that jumps sideways, holds, or runs ahead scores the
 * difference.
 */
export function jumpExcess(prevDrawn: Point, drawn: Point, prevTrue: Point, trueNow: Point): number {
  return Math.hypot(drawn.x - prevDrawn.x - (trueNow.x - prevTrue.x), drawn.y - prevDrawn.y - (trueNow.y - prevTrue.y));
}

/**
 * Whether the car was alive on every tick sample from the one before `from` to the one after `to`:
 * a span that touches a death or a respawn has a teleport in its truth (wreck to spawn), which no
 * per-frame motion comparison can score.
 */
export function aliveThrough(path: readonly { t: number; alive: boolean }[], from: number, to: number): boolean {
  const lo = Math.max(0, lowerBound(path, from) - 1);
  const hi = Math.min(path.length - 1, lowerBound(path, to));
  for (let i = lo; i <= hi; i++) if (!path[i]!.alive) return false;
  return true;
}

export const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length;
