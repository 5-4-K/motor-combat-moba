import { MS_PER_TICK, SNAPSHOT_RATE_HZ } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";
import { stepSim, type SimBody, type StepContext } from "../sim/step.js";
import { msToTicks } from "../config/weapon-ticks.js";
import { type InputMessage } from "./input.js";
import { NEUTRAL_KEYS, type InputFrame, type InputKeys } from "./tick-input.js";

/** One input the client has simulated locally but the server has not acknowledged yet. */
export interface PendingInput {
  seq: number;
  input: InputMessage;
}

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
 * Client-side prediction: run the local car through the same `stepSim` the server will run, then
 * reconcile against the authoritative pose once the server's ack catches up.
 *
 * The buffer holds every input the server has not acked. `reconcile` re-simulates that tail on top
 * of the authoritative pose, which is what lets the local car respond on the same frame the key is
 * pressed instead of a round-trip later.
 */
export class PredictionBuffer {
  private pending: PendingInput[] = [];

  /**
   * Record an input and advance the predicted pose by it. The buffer is capped at
   * `NET_CONFIG.pendingInputCap` and drops the *oldest* entry on overflow: during a long stall the
   * client keeps predicting while no ack arrives, and an unbounded buffer would grow for as long as
   * the stall lasts and then replay all of it in one frame. Dropping the oldest is the right end to
   * lose — those are the entries the server is most likely to have already applied, and anything
   * genuinely lost is corrected by the next authoritative snap.
   */
  predict(state: SimBody, pending: PendingInput, ctx: StepContext): SimBody {
    this.pending.push(pending);
    if (this.pending.length > NET_CONFIG.pendingInputCap) {
      this.pending.splice(0, this.pending.length - NET_CONFIG.pendingInputCap);
    }
    return stepSim(state, pending.input, DT_SECONDS, ctx);
  }

  /**
   * Fold an authoritative snapshot back into the predicted pose.
   *
   * Acked inputs are dropped by the *predicate* `seq <= lastProcessedSeq`, never by position or by a
   * remembered cursor. `withSimulatedLatency` delays every message independently, so a high-seq
   * input can land in tick N's batch while a lower-seq one lands in tick N+1's, and the server's ack
   * therefore walks backwards across ticks as a matter of course. Under the predicate a stale lower
   * ack is a harmless no-op; a cursor would either throw away still-unacked inputs or re-replay
   * already-integrated ones, and both read as rubber-banding.
   *
   * The remaining tail replays from the authoritative pose to give the *target*. Small errors ease
   * toward that target so corrections are not visible as a jerk; large ones snap, because easing a
   * big error is just a slow visible slide to the same place. `vx`/`vy` always snap: they are
   * derived sim fields that feed the next integration, so a half-eased value would poison every
   * subsequent step rather than merely look wrong.
   */
  reconcile(
    authoritative: SimBody,
    lastProcessedSeq: number,
    currentPredicted: SimBody,
    ctx: StepContext,
  ): SimBody {
    this.pending = this.pending.filter((entry) => entry.seq > lastProcessedSeq);

    let target = copyBody(authoritative);
    for (const entry of this.pending) {
      target = stepSim(target, entry.input, DT_SECONDS, ctx);
    }

    return settle(target, currentPredicted);
  }
}

/** `stepSim` takes the legacy `InputMessage`; it never reads `seq`, so the tick stands in for it. */
export const frameAsInput = (f: InputKeys & { tick: number }): InputMessage => ({ ...f, seq: f.tick });

/**
 * Tick-keyed prediction (NR26): frames are stamped with the tick they will execute on, and a
 * snapshot's `tick` — not an ack seq — says which ones the server has already applied. Sits beside
 * `PredictionBuffer`, which is deleted once the client moves over.
 */
export class TickPrediction {
  private frames: InputFrame[] = []; // ascending by tick
  /** The newest frame at or before the last acknowledged tick: what the server would repeat from. */
  private base: InputFrame | undefined;

  predict(state: SimBody, frame: InputFrame, ctx: StepContext): SimBody {
    this.frames.push(frame);
    // A safety bound only: the ack prunes in `replayTarget`. Long enough for any lead plus a second
    // of snapshot silence.
    const cap = msToTicks(NET_CONFIG.maxInputLeadMs + 1000);
    if (this.frames.length > cap) this.base = this.frames.splice(0, this.frames.length - cap).at(-1);
    return stepSim(state, frameAsInput(frame), DT_SECONDS, ctx);
  }

  /**
   * The authoritative pose at `snapshotTick`, replayed through every tick after it up to the newest
   * frame. A tick with no frame (a stall-skip gap) replays what the server simulated for it under
   * NR22: the last known frame repeated for `inputRepeatMs`, then neutral keys.
   */
  replayTarget(authoritative: SimBody, snapshotTick: number, ctx: StepContext): SimBody {
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
      target = stepSim(target, frameAsInput({ ...keys, tick: t }), DT_SECONDS, ctx);
    }
    return target;
  }

  reconcile(authoritative: SimBody, snapshotTick: number, current: SimBody, ctx: StepContext): SimBody {
    return settle(this.replayTarget(authoritative, snapshotTick, ctx), current);
  }

  frameAt(tick: number): InputFrame | undefined {
    return this.frames.find((f) => f.tick === tick);
  }

  /** Newest last, for packet redundancy. */
  recent(count: number): InputFrame[] {
    return this.frames.slice(-count);
  }

  clear(): void {
    this.frames = [];
    this.base = undefined;
  }
}
