import { MS_PER_TICK, SNAPSHOT_RATE_HZ } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";
import { msToTicks } from "../config/weapon-ticks.js";
import { drive } from "../modes/active.js";
import { type SimBody, type StepContext } from "../sim/step.js";
import { contactBlendWeight } from "./contact-blend.js";
import { blendPose } from "./interpolation.js";
import { RemoteReckoner } from "./remote-reckoner.js";
import type { InputKeys } from "./tick-input.js";

function copyBody(b: SimBody): SimBody {
  return {
    x: b.x,
    y: b.y,
    angle: b.angle,
    vx: b.vx,
    vy: b.vy,
    angVel: b.angVel,
    maneuver: b.maneuver,
    maneuverTicksLeft: b.maneuverTicksLeft,
    maneuverAngle: b.maneuverAngle,
    maneuverSpeed: b.maneuverSpeed,
  };
}

/** Wrap an angle difference into (-PI, PI], so an eased heading turns the short way. */
function wrapAngle(a: number): number {
  const turn = 2 * Math.PI;
  let r = a % turn;
  if (r > Math.PI) r -= turn;
  else if (r <= -Math.PI) r += turn;
  return r;
}

/**
 * One remote car's snapshot history keyed by SERVER TICK (NR29), not by arrival time: arrival is
 * jittered by the link, the tick is not, so bracketing by tick draws the car's real trajectory and
 * leaves arrival time to `DisplayDelay` alone. Snapshot rate is not assumed — any two ticks that
 * bracket the render tick are blended, however far apart (invariant 5).
 */
export class TickInterpolation {
  private readonly snaps: { tick: number; body: SimBody }[] = [];

  /** Ticks must ascend; a snapshot at or before the newest is ignored (out of order or duplicate). */
  push(tick: number, body: SimBody): void {
    const newest = this.snaps[this.snaps.length - 1];
    if (newest && tick <= newest.tick) return;
    this.snaps.push({ tick, body: copyBody(body) });
    if (this.snaps.length > TICK_INTERPOLATION_CAPACITY) this.snaps.shift();
  }

  /**
   * The pose at fractional `renderTick`. Before the oldest snapshot it holds the oldest (not
   * beyond); past the newest it holds the newest and reports `beyond`, which is the caller's cue to
   * extrapolate (NR31). Position and angle blend through `blendPose`; every other field comes from
   * the later snapshot un-blended.
   */
  sample(renderTick: number): { body: SimBody; beyond: boolean } | undefined {
    const n = this.snaps.length;
    if (n === 0) return undefined;
    const last = this.snaps[n - 1]!;
    if (renderTick > last.tick) return { body: copyBody(last.body), beyond: true };
    if (renderTick <= this.snaps[0]!.tick) return { body: copyBody(this.snaps[0]!.body), beyond: false };
    // Newest bracket first: the render tick almost always sits near the newest end.
    for (let i = n - 2; i >= 0; i--) {
      const from = this.snaps[i]!;
      if (from.tick > renderTick) continue;
      const to = this.snaps[i + 1]!;
      return { body: blendPose(from.body, to.body, (renderTick - from.tick) / (to.tick - from.tick)), beyond: false };
    }
    return { body: copyBody(last.body), beyond: false };
  }

  newestTick(): number | undefined {
    return this.snaps[this.snaps.length - 1]?.tick;
  }

  /**
   * Replace the newest snapshot's pose, keeping its tick: a patch whose tick did not advance but
   * whose pose did (a playground edit applied while the room is paused). No-op when empty.
   */
  replaceNewest(body: SimBody): void {
    const newest = this.snaps[this.snaps.length - 1];
    if (newest) newest.body = copyBody(body);
  }
}

/**
 * Snapshots kept per remote: at 60 Hz, 64 covers ~1 s, four times `maxDelayMs`, so the render tick
 * always finds its bracket however the delay sits within its clamps.
 */
const TICK_INTERPOLATION_CAPACITY = 64;
/** Lateness samples the adaptive delay's p95 covers (NR30). */
const LATENESS_WINDOW = 120;
/** The percentile of lateness the delay covers (NR30). */
const LATENESS_PERCENTILE = 0.95;
/** Most the delay moves per call (per rendered frame), ms, so nothing visibly jumps (NR30). */
const DELAY_SLEW_MS_PER_FRAME = 1;

/**
 * The adaptive remote render delay (NR30). Each snapshot's lateness is how far the synced server
 * clock had run past the snapshot's own tick when it arrived (one-way delay plus jitter). The target
 * is `clamp(p95 of the last 120 latenesses + one snapshot interval, minDelayMs, maxDelayMs)`: the
 * snapshot interval is what keeps a snapshot on BOTH sides of the render tick, not merely one. The
 * current delay starts at the first sample's target and then slews at most 1 ms per frame.
 */
export class DisplayDelay {
  private readonly lateness: number[] = [];
  private currentMs: number | undefined;
  /** `targetMs` of the current window: it moves only when a sample does, so it is kept, not re-sorted per frame. */
  private targetCachedMs: number = NET_CONFIG.minDelayMs;
  /** The newest snapshot tick sampled: each server tick is measured once (E2 review minor 3). */
  private newestSampledTick = Number.NEGATIVE_INFINITY;

  /**
   * Record one snapshot's lateness: how far the server clock had moved past its tick on arrival.
   * A tick at or below one already sampled is ignored — a paused practice or playground room
   * re-broadcasts its frozen tick while the server clock runs on, and every such patch would
   * otherwise read as one more tick late, inflating the delay for a whole window after the resume.
   */
  onSnapshot(arrivalServerTick: number, snapshotTick: number): void {
    if (!Number.isFinite(arrivalServerTick)) return;
    if (!(snapshotTick > this.newestSampledTick)) return;
    this.newestSampledTick = snapshotTick;
    this.lateness.push(arrivalServerTick - snapshotTick);
    if (this.lateness.length > LATENESS_WINDOW) this.lateness.shift();
    this.targetCachedMs = this.targetMs();
    if (this.currentMs === undefined) this.currentMs = this.targetCachedMs;
  }

  private targetMs(): number {
    const sorted = [...this.lateness].sort((a, b) => a - b);
    const p = sorted[Math.max(0, Math.ceil(LATENESS_PERCENTILE * sorted.length) - 1)] ?? 0;
    const raw = p * MS_PER_TICK + 1000 / SNAPSHOT_RATE_HZ;
    return Math.min(NET_CONFIG.maxDelayMs, Math.max(NET_CONFIG.minDelayMs, raw));
  }

  /**
   * Current delay in ticks, moved at most 1 ms per call toward its target. Call it ONCE per rendered
   * frame — the slew is per call. `minDelayMs` before the first sample. `_frameMs` is the frame's
   * length; the slew is authored per frame (NR30), so it does not scale with it.
   */
  ticks(_frameMs: number): number {
    if (this.currentMs === undefined) return NET_CONFIG.minDelayMs / MS_PER_TICK;
    const target = this.targetCachedMs;
    const step = Math.max(-DELAY_SLEW_MS_PER_FRAME, Math.min(DELAY_SLEW_MS_PER_FRAME, target - this.currentMs));
    this.currentMs += step;
    return this.currentMs / MS_PER_TICK;
  }
}

/**
 * A networked `int8` steer or throttle (`PlayerState.lastSteer`/`lastThrottle`, NR33) as the
 * `-1 | 0 | 1` `InputKeys` carries. The server only ever writes those three, so this is a type
 * narrowing that also refuses anything else rather than stepping a car with an out-of-range key.
 */
export function axisOfWire(value: number): -1 | 0 | 1 {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

/** The local car as `RemoteTimeline.pose` measures contact range from it (NR34). */
export interface LocalAnchor {
  /** The local car's drawn (predicted) pose. */
  pose: { x: number; y: number };
  /**
   * The (fractional) tick the local car is DRAWN at: its predicted tick plus the render phase the
   * drawn pose is blended at, so the reckoned target moves smoothly as prediction advances.
   */
  tick: number;
}

/**
 * How far the drawn local car is through the current predicted tick, in [0, 1), for `blendPose`
 * between the previous and the newest predicted pose.
 *
 * The phase is the SERVER clock's alone, never `serverTick + lead`. `InputScheduler` emits a new
 * predicted tick when `floor(serverTick) + ceil(leadTicks)` steps, which at a steady lead is exactly
 * when `frac(serverTick)` wraps — so that fraction is the one that runs 0 → 1 between two predicted
 * ticks. Adding a fractional lead shifts the wrap to somewhere mid-tick, and a display faster than
 * the tick rate would then draw the car stepping backwards once per tick. 1 (draw the newest pose)
 * before the clock has its first pong.
 */
export function localBlendAlpha(serverTickNow: number | undefined): number {
  if (serverTickNow === undefined || !Number.isFinite(serverTickNow)) return 1;
  return serverTickNow - Math.floor(serverTickNow);
}

/**
 * The local car as the contact blend measures from it (NR34), built the one way `ArenaScene` and the
 * netsim tick client both use: the DRAWN local pose — `predictedPrev` blended toward `predicted` at
 * the server clock's phase (`localBlendAlpha`) — and the fractional tick that pose stands at,
 * `newestPredictedTick − 1 + phase` (`predicted` is the end of the newest predicted tick,
 * `predictedPrev` the end of the one before). Undefined with nothing predicted, or while the local
 * car is a wreck or not on the field: those get no blend.
 */
export function localAnchorOf(input: {
  predicted: SimBody | undefined;
  predictedPrev: SimBody | undefined;
  newestPredictedTick: number | undefined;
  /** The local car is alive (and on the field). */
  alive: boolean;
  /** The synced server clock now, undefined before it is ready. */
  serverTickNow: number | undefined;
}): LocalAnchor | undefined {
  const { predicted, predictedPrev, newestPredictedTick: tick } = input;
  if (!input.alive || !predicted || tick === undefined) return undefined;
  if (!predictedPrev) return { pose: predicted, tick };
  const phase = localBlendAlpha(input.serverTickNow);
  return { pose: blendPose(predictedPrev, predicted, phase), tick: tick - 1 + phase };
}

/** One remote's snapshot, as `RemoteTimeline.push` takes it. */
export interface RemoteSnapshot {
  body: SimBody;
  /** The car's last consumed input (`PlayerState.lastSteer`/`lastThrottle`, NR33). */
  keys: InputKeys;
  /** `buildStepContext` for THIS car, with its own modifiers and `others: []` (NR31). */
  ctx: StepContext;
  alive: boolean;
}

interface Track {
  readonly interp: TickInterpolation;
  lastBody: SimBody;
  alive: boolean;
  /** A snapshot has been pushed since the last drawn frame. */
  fresh: boolean;
  /** Last frame's drawn pose, and whether it was extrapolated. */
  drawn: SimBody | undefined;
  drawnBeyond: boolean;
  /**
   * Last frame was HELD at the newest snapshot rather than drawn at the render tick: before the
   * clock syncs, or while the room is paused with the render tick past the newest snapshot. The
   * frame that leaves the hold eases the step rather than snapping (phase E review I2, M3).
   */
  drawnHeld: boolean;
  /** The gap being eased out (drawn − path), and how much of `extrapolateSettleMs` is left of it. */
  offset: { x: number; y: number; angle: number } | undefined;
  offsetLeftMs: number;
  /** Contact blend (NR34): the slewed weight, the tick it samples at, the final drawn pose, and its settle gap. */
  blendW: number;
  /**
   * A snapshot has replaced the reckoning since the last drawn frame; the reckoning the last frame
   * drew from was handed to `RemoteTimeline.superseded` on the first such push.
   */
  rebased: boolean;
  anchorTick: number;
  final: SimBody | undefined;
  finalOffset: { x: number; y: number; angle: number } | undefined;
  finalOffsetLeftMs: number;
  /** The frame `cached` was computed on. */
  frame: number;
  cached: SimBody | undefined;
}

/** Below this many world units (and radians) of gap, there is nothing to ease. */
const SETTLE_EPSILON = 1e-6;
/**
 * The contact blend's anchor tick may differ from last frame's plus one frame's worth by up to this
 * many ticks and still count as the local car's clock advancing (render phase, clock slew). Beyond
 * it — a catch-up burst, a prediction reset, an anchor that returns after a gap, a pause — the
 * reckoned target jumped, and the step is eased like a rebase (NR34).
 */
const ANCHOR_JUMP_TICKS = 1;

/** `to − from` as an easeable gap: position difference and the short-way angle difference. */
function gapOf(from: SimBody, to: SimBody): { x: number; y: number; angle: number } {
  return { x: to.x - from.x, y: to.y - from.y, angle: wrapAngle(to.angle - from.angle) };
}

function hasGap(g: { x: number; y: number; angle: number }): boolean {
  return Math.hypot(g.x, g.y) > SETTLE_EPSILON || Math.abs(g.angle) > SETTLE_EPSILON;
}

/** Same pose: every field a step or a draw reads. */
function samePose(a: SimBody, b: SimBody): boolean {
  return a.x === b.x && a.y === b.y && a.angle === b.angle && a.vx === b.vx && a.vy === b.vy && a.angVel === b.angVel;
}

/**
 * How every remote car is drawn (NR29–NR31), shared by `ArenaScene` and the netsim tick client so
 * the harness measures the code players run.
 *
 * - Once per snapshot: `onSnapshot` (lateness → `DisplayDelay`), then `push` per remote. `push`
 *   feeds the tick-keyed `TickInterpolation` and, for a NEW tick only, the `RemoteReckoner`. A
 *   change in `alive` (death, respawn) or a jump of more than `remoteTeleportCars` car lengths in
 *   one snapshot resets both, so a respawned car never slides from its wreck to its spawn.
 * - Once per frame: `beginFrame(serverTickNow, frameMs)` fixes the render tick
 *   `R = serverTickNow − delay` (the delay slews once per frame). Then `pose(id)` any number of
 *   times — it is computed once per frame and cached, so two render passes cannot advance the ease
 *   twice.
 * - `pose`: interpolated when `R` is bracketed; past the newest snapshot, dead-reckoned with
 *   `stepSim` and capped at `maxExtrapolateMs`, after which it holds. When a frame drawn from
 *   extrapolation is followed by a new snapshot (or by `R` falling back inside the buffer), the gap
 *   between the old drawn pose (plus this frame's motion and rotation) and the new path is eased out
 *   linearly over `extrapolateSettleMs` instead of snapped.
 * - HELD: before the clock syncs (`R` undefined), and while `beginFrame`'s `paused` is set with `R`
 *   past the newest snapshot, the newest snapshot is drawn as it stands — nothing is reckoned past a
 *   paused room's frozen tick. The frame that leaves a hold eases like an extrapolated one.
 */
export class RemoteTimeline {
  readonly delay = new DisplayDelay();
  private readonly reckoner = new RemoteReckoner(msToTicks(NET_CONFIG.maxExtrapolateMs));
  /** Per remote, the reckoning the last drawn frame used, once a snapshot has replaced it (NR34 rebase gap). */
  private readonly superseded = new RemoteReckoner(msToTicks(NET_CONFIG.maxExtrapolateMs));
  private readonly tracks = new Map<string, Track>();
  private frame = 0;
  private frameMs = 0;
  private R: number | undefined;
  private paused = false;

  /** The render tick of the current frame (`serverTickNow − delay`); undefined before the clock syncs. */
  get renderTick(): number | undefined {
    return this.R;
  }

  /** A snapshot of server tick `snapshotTick` arrived when the synced clock read `arrivalServerTick`. */
  onSnapshot(arrivalServerTick: number | undefined, snapshotTick: number): void {
    if (arrivalServerTick !== undefined) this.delay.onSnapshot(arrivalServerTick, snapshotTick);
  }

  push(id: string, tick: number, snap: RemoteSnapshot): void {
    let track = this.tracks.get(id);
    if (track) {
      const jump = Math.hypot(snap.body.x - track.lastBody.x, snap.body.y - track.lastBody.y);
      if (snap.alive !== track.alive || jump > NET_CONFIG.remoteTeleportCars * drive().carWidth) {
        this.forget(id);
        track = undefined;
      }
    }
    if (!track) {
      track = {
        interp: new TickInterpolation(),
        lastBody: snap.body,
        alive: snap.alive,
        fresh: true,
        drawn: undefined,
        drawnBeyond: false,
        drawnHeld: false,
        offset: undefined,
        offsetLeftMs: 0,
        blendW: 0,
        rebased: false,
        anchorTick: 0,
        final: undefined,
        finalOffset: undefined,
        finalOffsetLeftMs: 0,
        frame: -1,
        cached: undefined,
      };
      this.tracks.set(id, track);
    }
    const newest = track.interp.newestTick();
    if (newest !== undefined && tick < newest) return;
    // A patch whose tick did not advance: a re-broadcast of the same pose adds nothing, but a pose
    // that moved on the same tick (a playground edit while paused) replaces the newest snapshot, so
    // it is drawn now rather than only once the tick moves (phase E review M2). Lateness is sampled
    // per tick by `DisplayDelay` and is unaffected.
    const sameTick = newest !== undefined && tick === newest;
    if (sameTick && samePose(track.lastBody, snap.body)) return;
    // The first rebase since the last drawn frame keeps the reckoning that frame drew from.
    if (!track.rebased) this.reckoner.handOver(id, this.superseded);
    track.rebased = true;
    if (sameTick) {
      track.interp.replaceNewest(snap.body);
      this.reckoner.forget(id);
    } else {
      track.interp.push(tick, snap.body);
    }
    track.lastBody = copyBody(snap.body);
    track.alive = snap.alive;
    track.fresh = true;
    this.reckoner.update(id, { tick, body: copyBody(snap.body), keys: snap.keys, ctx: snap.ctx });
  }

  /**
   * Fix this frame's render tick. `serverTickNow` is undefined until the clock has synced. `paused`
   * is the room's sim pause (practice and the playground): its tick stands still while the clock
   * estimate runs on, so while it is set no remote is drawn past its newest snapshot — the render
   * tick is held there and the contact blend's anchor tick is clamped to it (phase E review I2).
   */
  beginFrame(serverTickNow: number | undefined, frameMs: number, paused = false): void {
    this.frame += 1;
    this.frameMs = frameMs;
    this.paused = paused;
    const delay = this.delay.ticks(frameMs);
    this.R = serverTickNow === undefined || !Number.isFinite(serverTickNow) ? undefined : serverTickNow - delay;
  }

  /** The pose to draw this frame, or undefined for a car with no snapshot. */
  pose(id: string, local?: LocalAnchor): SimBody | undefined {
    const track = this.tracks.get(id);
    if (!track) return undefined;
    if (track.frame === this.frame) return track.cached;
    track.frame = this.frame;
    track.cached = this.compute(id, track, local);
    return track.cached;
  }

  private compute(id: string, track: Track, local: LocalAnchor | undefined): SimBody | undefined {
    // HELD at the newest snapshot: before the clock syncs there is no render tick, and while the
    // room is paused nothing is drawn past the frozen tick (no extrapolation over a pause).
    const newest = track.interp.newestTick();
    if (newest === undefined) return undefined;
    const held = this.R === undefined || (this.paused && this.R > newest);
    const R = held ? newest : this.R!;
    const s = track.interp.sample(R);
    if (!s) return undefined;
    const target = s.beyond ? (this.reckoner.poseAt(id, R) ?? s.body) : s.body;

    const prev = track.drawn;
    const leftExtrapolation = track.drawnBeyond && (track.fresh || !s.beyond);
    const leftHold = track.drawnHeld && !held;
    if (prev && (leftExtrapolation || leftHold)) {
      // The path under an extrapolated (or held) frame changed: carry the gap (less this frame's own
      // motion and rotation) and ease it out, rather than jumping onto the new path.
      const dt = this.frameMs / 1000;
      const gap = {
        x: prev.x + target.vx * dt - target.x,
        y: prev.y + target.vy * dt - target.y,
        angle: wrapAngle(prev.angle + target.angVel * dt - target.angle),
      };
      if (hasGap(gap)) {
        track.offset = gap;
        track.offsetLeftMs = NET_CONFIG.extrapolateSettleMs;
      }
    }

    let out = target;
    if (track.offset) {
      track.offsetLeftMs -= this.frameMs;
      const k = NET_CONFIG.extrapolateSettleMs > 0 ? Math.max(0, track.offsetLeftMs / NET_CONFIG.extrapolateSettleMs) : 0;
      if (k <= 0) track.offset = undefined;
      else {
        out = {
          ...target,
          x: target.x + track.offset.x * k,
          y: target.y + track.offset.y * k,
          angle: wrapAngle(target.angle + track.offset.angle * k),
        };
      }
    }
    track.drawn = out;
    track.drawnBeyond = s.beyond;
    track.drawnHeld = held;
    track.fresh = false;
    const final = this.nearLocal(id, track, out, local, newest);
    track.rebased = false;
    return final;
  }

  /**
   * NR34: within `contactBlendRangeCars` car lengths of the local car the drawn pose moves toward
   * the remote's dead-reckoned pose at the local car's predicted tick — where the local prediction
   * will meet it — fully at one car length. The settle logic above is fed the un-blended pose.
   *
   * The blend target is continuous from frame to frame except when something REPLACES it: a
   * snapshot rebases the reckoning (a shove the reckoner could not know about), or the anchor tick
   * jumps (more than `ANCHOR_JUMP_TICKS` off its expected advance). Only then is the final-pose
   * settle armed, with the gap between the old target and the new one at the SAME tick — so the
   * car's own motion and rotation are never part of the gap, and a car the reckoner already had right
   * (every snapshot of a steady turn) arms nothing (phase E review I1). A settle still running when
   * the next one arms is carried into it, not dropped.
   */
  private nearLocal(
    id: string,
    track: Track,
    pose: SimBody,
    local: LocalAnchor | undefined,
    newest: number,
  ): SimBody {
    const dtMs = this.frameMs;
    const expectedAnchor = track.anchorTick + dtMs / MS_PER_TICK;
    // The weight the anchor asks for; no anchor (death, spectator, cleared prediction) asks for 0.
    let want = 0;
    if (local) {
      // Paused: the reckoned target is clamped to the frozen tick, like the render tick.
      track.anchorTick = this.paused ? Math.min(local.tick, newest) : local.tick;
      want = contactBlendWeight(
        Math.hypot(pose.x - local.pose.x, pose.y - local.pose.y),
        drive().carWidth,
        NET_CONFIG.contactBlendRangeCars,
      );
    } else {
      track.anchorTick = this.paused ? Math.min(expectedAnchor, newest) : expectedAnchor;
    }
    const prevW = track.blendW;
    // Slewed in time: the weight moves at most one settle-ease's worth per frame.
    const maxStep = NET_CONFIG.extrapolateSettleMs > 0 ? dtMs / NET_CONFIG.extrapolateSettleMs : 1;
    track.blendW += Math.max(-maxStep, Math.min(maxStep, want - track.blendW));
    const w = track.blendW;
    let out = pose;
    if (w > 0) {
      const reckoned = this.reckoner.poseAt(id, track.anchorTick);
      if (reckoned) {
        out = blendPose(pose, reckoned, w);
        // What the target would have been without the replacement: the superseded reckoning (when a
        // snapshot rebased it) at the tick the anchor was expected at (when the anchor jumped).
        const anchorJumped = Math.abs(track.anchorTick - expectedAnchor) > ANCHOR_JUMP_TICKS;
        if (track.final && prevW > 0 && (track.rebased || anchorJumped)) {
          const before = (track.rebased ? this.superseded : this.reckoner).poseAt(
            id,
            anchorJumped ? expectedAnchor : track.anchorTick,
          );
          if (before) {
            const gap = gapOf(out, blendPose(pose, before, w));
            if (hasGap(gap)) {
              // Carry what is still un-eased of a running settle into the new one.
              const left = track.finalOffset && NET_CONFIG.extrapolateSettleMs > 0
                ? Math.max(0, track.finalOffsetLeftMs / NET_CONFIG.extrapolateSettleMs)
                : 0;
              const carried = track.finalOffset ?? { x: 0, y: 0, angle: 0 };
              track.finalOffset = {
                x: gap.x + carried.x * left,
                y: gap.y + carried.y * left,
                angle: wrapAngle(gap.angle + carried.angle * left),
              };
              track.finalOffsetLeftMs = NET_CONFIG.extrapolateSettleMs;
            }
          }
        }
      }
    }
    if (track.finalOffset) {
      track.finalOffsetLeftMs -= dtMs;
      const k = NET_CONFIG.extrapolateSettleMs > 0 ? Math.max(0, track.finalOffsetLeftMs / NET_CONFIG.extrapolateSettleMs) : 0;
      if (k <= 0) track.finalOffset = undefined;
      else {
        out = {
          ...out,
          x: out.x + track.finalOffset.x * k,
          y: out.y + track.finalOffset.y * k,
          angle: wrapAngle(out.angle + track.finalOffset.angle * k),
        };
      }
    }
    track.final = out;
    return out;
  }

  /**
   * Where this remote will be at server tick `tick`, for the local car's prediction (NR32): its
   * newest snapshot dead-reckoned with its last known input through the shared `stepSim`, capped at
   * `maxExtrapolateMs` past that snapshot and held there — on a slow link, that slow player's cost.
   * The same cached `RemoteReckoner` the drawn pose extrapolates through, so a reckoned step is
   * computed once per snapshot however many predicted and replayed ticks ask for it. Undefined for
   * a car with no track (the caller falls back to its roster pose).
   */
  reckonedPose(id: string, tick: number): Readonly<SimBody> | undefined {
    return this.tracks.has(id) ? this.reckoner.poseAt(id, tick) : undefined;
  }

  /** Drop a remote: on leave, and (internally) on death, respawn and teleport. */
  forget(id: string): void {
    this.tracks.delete(id);
    this.reckoner.forget(id);
    this.superseded.forget(id);
  }
}
