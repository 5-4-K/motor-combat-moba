import { MS_PER_TICK, SNAPSHOT_RATE_HZ } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";
import { stepSim, type SimBody, type StepContext } from "../sim/step.js";
import { msToTicks } from "../config/weapon-ticks.js";
import { NEUTRAL_KEYS, type InputFrame, type InputKeys } from "./tick-input.js";

/**
 * The client sends exactly one input per sim tick, so a replayed step always advances by one tick.
 * Derived from the shared tick rate — never a literal 1/30.
 */
const DT_SECONDS = MS_PER_TICK / 1000;

/**
 * The fraction of the reconcile error one snapshot eases away. `NET_CONFIG.reconcileEaseRate` is
 * authored per `reconcileEaseReferenceMs` (50 ms — one snapshot at the 20 Hz it was tuned at), and
 * the ease runs once per snapshot, so it is compounded to the snapshot interval:
 * `1 - (1 - rate) ** (snapshotMs / referenceMs)`. At 60 Hz that is ~0.0914 per snapshot, three of
 * which ease exactly 0.25 — the same wall-clock correction speed the 20 Hz build had.
 * `snapshotRateHz` is a parameter only so a test can evaluate the authored rate; production calls
 * it bare.
 */
export function reconcileEasePerSnapshot(snapshotRateHz: number = SNAPSHOT_RATE_HZ): number {
  const exponent = 1000 / snapshotRateHz / NET_CONFIG.reconcileEaseReferenceMs;
  return 1 - (1 - NET_CONFIG.reconcileEaseRate) ** exponent;
}

/** Shortest signed rotation from `from` to `to`, in (-PI, PI]. */
function wrapAngle(delta: number): number {
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

function lerp(from: number, to: number, rate: number): number {
  return from + (to - from) * rate;
}

/** The ten-field pose a replay starts from. Maneuver state and knock fields are rules for the next
 * integration, not a drawn pose, so they are carried whole. */
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

/**
 * Small errors ease toward the replayed target so corrections are not visible as a jerk; large ones
 * snap. `vx`/`vy`, `angVel` and maneuver/knock state always snap: they feed the next integration, so
 * a half-eased value would poison every subsequent step rather than merely look wrong.
 */
function settle(target: SimBody, currentPredicted: SimBody): SimBody {
  const dx = target.x - currentPredicted.x;
  const dy = target.y - currentPredicted.y;
  // Wrapped, not raw: `stepDrive` never normalises `angle`, so after a few minutes of turning both
  // numbers are in the thousands and a raw difference would compare accumulated winding, not error.
  const dAngle = wrapAngle(target.angle - currentPredicted.angle);

  if (
    Math.hypot(dx, dy) > NET_CONFIG.reconcileSnapPos ||
    Math.abs(dAngle) > NET_CONFIG.reconcileSnapAngle
  ) {
    return target;
  }

  const ease = reconcileEasePerSnapshot();
  return {
    x: lerp(currentPredicted.x, target.x, ease),
    y: lerp(currentPredicted.y, target.y, ease),
    // Ease along the wrapped delta so the correction takes the short way round the seam.
    angle: currentPredicted.angle + dAngle * ease,
    vx: target.vx,
    vy: target.vy,
    // Knock state snaps for the same reason `vx`/`vy` does: these feed the next integration. This
    // is also what makes an unpredicted ram viable — the knock lands as one velocity snap and the
    // client then plays the whole spin-and-slide out locally through its own stepSim.
    angVel: target.angVel,
    maneuver: target.maneuver,
    maneuverTicksLeft: target.maneuverTicksLeft,
    maneuverAngle: target.maneuverAngle,
    maneuverSpeed: target.maneuverSpeed,
  };
}

/**
 * The world one predicted step runs in: either one `StepContext` for every tick, or a builder asked
 * for each tick's own (phase D review M5, NR32). The builder is what the client passes — its status
 * multipliers lapse on the tick the server lapses them, and remotes stand at their dead-reckoned pose
 * for that tick — so the first prediction of a frame and every later replay of it ask the SAME
 * question (`ctxFor(frame.tick)`), answered from whatever the client knows by then. A single context
 * is for tests and the playtest probe, whose world does not change across the frames in flight.
 */
export type StepContextFor = StepContext | ((tick: number) => StepContext);

function contextAt(ctxFor: StepContextFor, tick: number): StepContext {
  return typeof ctxFor === "function" ? ctxFor(tick) : ctxFor;
}

/**
 * Client-side prediction, keyed by tick (NR26): run the local car through the same `stepSim` the
 * server will run, one frame per tick, and reconcile against each authoritative snapshot.
 *
 * Frames are stamped with the tick they will execute on, and a snapshot's `tick` — not an ack seq —
 * says which ones the server has already applied: every car steps every tick (NR17), so the
 * snapshot's pose IS the pose at the end of its own tick. `reconcile` replays the frames after it on
 * top of the authoritative pose, which is what lets the local car respond on the frame the key is
 * pressed instead of a round trip later. Small errors ease toward that target; large ones snap
 * (`settle`).
 */
export class TickPrediction {
  private frames: InputFrame[] = []; // ascending by tick
  /** The newest frame at or before the last acknowledged tick: what the server would repeat from. */
  private base: InputFrame | undefined;
  /** The newest tick `predict` ever accepted since the last `clear`, pruned or not. */
  private newestTick = Number.NEGATIVE_INFINITY;

  /** The newest tick `predict` accepted, or undefined before any (the tick the predicted pose stands at the end of). */
  get newestPredictedTick(): number | undefined {
    return Number.isFinite(this.newestTick) ? this.newestTick : undefined;
  }

  /**
   * Steps `state` through `frame` and records it for replay. Frames must arrive strictly ascending by
   * tick (`replayTarget` walks them with one index), so a frame at or below the newest tick already
   * predicted is REFUSED: not recorded, and `state` comes back unchanged, since that tick was already
   * stepped (phase D review M9). No current path produces one; this keeps the invariant local rather
   * than resting on `InputScheduler` internals across a rebuild.
   */
  predict(state: SimBody, frame: InputFrame, ctxFor: StepContextFor): SimBody {
    if (!(frame.tick > this.newestTick)) return state;
    this.newestTick = frame.tick;
    this.frames.push(frame);
    // A safety bound only: the ack prunes in `replayTarget`. Long enough for any lead plus a second
    // of snapshot silence.
    const cap = msToTicks(NET_CONFIG.maxInputLeadMs + 1000);
    if (this.frames.length > cap) this.base = this.frames.splice(0, this.frames.length - cap).at(-1);
    return stepSim(state, frame, DT_SECONDS, contextAt(ctxFor, frame.tick));
  }

  /**
   * The authoritative pose at `snapshotTick`, replayed through every tick after it up to the newest
   * frame. A tick with no frame (a stall-skip gap) replays what the server simulated for it under
   * NR22: the last known frame repeated for `inputRepeatMs`, then neutral keys. Each tick `t` steps
   * in `ctxFor(t)`, the same context its first prediction was asked for.
   */
  replayTarget(authoritative: SimBody, snapshotTick: number, ctxFor: StepContextFor): SimBody {
    for (const f of this.frames) if (f.tick <= snapshotTick) this.base = f;
    this.frames = this.frames.filter((f) => f.tick > snapshotTick);
    const repeatTicks = msToTicks(NET_CONFIG.inputRepeatMs);
    let last: InputKeys | undefined = this.base;
    let lastReal = this.base?.tick ?? Number.NEGATIVE_INFINITY;
    let target = copyBody(authoritative);
    let i = 0;
    const newest = this.frames.at(-1)?.tick ?? snapshotTick;
    for (let t = snapshotTick + 1; t <= newest; t++) {
      let keys: InputKeys;
      if (this.frames[i]?.tick === t) {
        keys = last = this.frames[i++]!;
        lastReal = t;
      } else {
        keys = last !== undefined && t - lastReal <= repeatTicks ? last : NEUTRAL_KEYS;
      }
      target = stepSim(target, keys, DT_SECONDS, contextAt(ctxFor, t));
    }
    return target;
  }

  reconcile(authoritative: SimBody, snapshotTick: number, current: SimBody, ctxFor: StepContextFor): SimBody {
    return settle(this.replayTarget(authoritative, snapshotTick, ctxFor), current);
  }

  /** Newest last, for packet redundancy. */
  recent(count: number): InputFrame[] {
    return this.frames.slice(-count);
  }

  clear(): void {
    this.frames = [];
    this.base = undefined;
    this.newestTick = Number.NEGATIVE_INFINITY;
  }
}
