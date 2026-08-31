import {
  MS_PER_TICK,
  NET_CONFIG,
  stepSim,
  type InputMessage,
  type SimBody,
  type StepContext,
} from "@motor-combat-moba/shared";

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

/** Shortest signed rotation from `from` to `to`, in (-PI, PI]. */
function wrapAngle(delta: number): number {
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

function lerp(from: number, to: number, rate: number): number {
  return from + (to - from) * rate;
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
   * big error is just a slow visible slide to the same place. `speed` and `reverseHold` always snap:
   * they are derived sim fields that feed the next integration, so a half-eased value would poison
   * every subsequent step rather than merely look wrong.
   */
  reconcile(
    authoritative: SimBody,
    lastProcessedSeq: number,
    currentPredicted: SimBody,
    ctx: StepContext,
  ): SimBody {
    this.pending = this.pending.filter((entry) => entry.seq > lastProcessedSeq);

    let target: SimBody = {
      x: authoritative.x,
      y: authoritative.y,
      angle: authoritative.angle,
      speed: authoritative.speed,
      reverseHold: authoritative.reverseHold,
      angVel: authoritative.angVel,
      shoveX: authoritative.shoveX,
      shoveY: authoritative.shoveY,
      authority: authoritative.authority,
      // Pass-through today, same treatment as the knock fields below: these feed the next
      // integration, so they snap to the authoritative value rather than easing. Task 9 formalizes
      // any maneuver-specific reconcile rule on top of this.
      maneuver: authoritative.maneuver,
      maneuverTicksLeft: authoritative.maneuverTicksLeft,
      maneuverAngle: authoritative.maneuverAngle,
      maneuverSpeed: authoritative.maneuverSpeed,
    };
    for (const entry of this.pending) {
      target = stepSim(target, entry.input, DT_SECONDS, ctx);
    }

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

    return {
      x: lerp(currentPredicted.x, target.x, NET_CONFIG.reconcileEaseRate),
      y: lerp(currentPredicted.y, target.y, NET_CONFIG.reconcileEaseRate),
      // Ease along the wrapped delta so the correction takes the short way round the seam.
      angle: currentPredicted.angle + dAngle * NET_CONFIG.reconcileEaseRate,
      speed: target.speed,
      reverseHold: target.reverseHold,
      // Knock state snaps for the same reason `speed` does: these feed the next integration. This is
      // also what makes an unpredicted ram viable — the knock lands as one velocity snap and the
      // client then plays the whole spin-and-slide out locally through its own stepSim.
      angVel: target.angVel,
      shoveX: target.shoveX,
      shoveY: target.shoveY,
      authority: target.authority,
      maneuver: target.maneuver,
      maneuverTicksLeft: target.maneuverTicksLeft,
      maneuverAngle: target.maneuverAngle,
      maneuverSpeed: target.maneuverSpeed,
    };
  }
}
