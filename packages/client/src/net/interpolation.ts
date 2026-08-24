import { NET_CONFIG, type SimBody } from "@motor-combat-moba/shared";

interface Snapshot {
  time: number;
  pose: SimBody;
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

/**
 * Angle blend through the unit circle rather than through the number line: lerp the sine and cosine
 * and read the result back with `atan2`. A plain lerp of 3 and -3 sweeps the long way through 0;
 * this takes the short way across the seam, which is what the eye expects. The result is normalised
 * to (-PI, PI], which is fine — it only ever feeds a render rotation, never `stepSim`.
 */
function lerpAngle(from: number, to: number, alpha: number): number {
  return Math.atan2(
    lerp(Math.sin(from), Math.sin(to), alpha),
    lerp(Math.cos(from), Math.cos(to), alpha),
  );
}

/**
 * Remote-car smoothing. Server patches arrive at `DEFAULT_PATCH_RATE_HZ`, well under the render
 * rate, so drawing each patch as it lands makes remotes visibly step. This holds a short history and
 * renders them `NET_CONFIG.interpolationDelayMs` in the past, which buys enough buffer to always
 * have a snapshot on both sides of the render time.
 *
 * Local prediction is deliberately not built on this: the local car must respond on the frame the
 * key is pressed, so it runs ahead through `PredictionBuffer` while remotes lag behind.
 */
export class InterpolationBuffer {
  private snapshots: Snapshot[] = [];

  /**
   * **`time` must be non-decreasing across calls.** Snapshots are appended without reordering, and
   * both `sample` and `prune` treat the last element as the newest. Fed out of order — say (1000,
   * 1100, 1050) — the buffer would take 1050 as its newest, drop a legitimate render time into the
   * hold-last branch, and silently return a stale pose. Callers use a monotonic clock
   * (`performance.now()` on patch arrival), so this holds; nothing here enforces it.
   */
  push(time: number, pose: SimBody): void {
    this.snapshots.push({
      time,
      pose: {
        x: pose.x,
        y: pose.y,
        angle: pose.angle,
        speed: pose.speed,
        reverseHold: pose.reverseHold,
      },
    });
    this.prune(time);
  }

  /**
   * The pose to draw at wall-clock `now`, sampled `interpolationDelayMs` in the past.
   *
   * Past the newest snapshot this *holds* rather than extrapolating. Extrapolation would guess a
   * pose the server never authorised — sliding a coasting car through a wall it actually bounced off
   * — and then have to be yanked back. A remote briefly frozen at its last known pose is the
   * cheaper artefact, and at LAN patch rates the freeze lasts a frame or two.
   */
  sample(now: number): SimBody | undefined {
    if (this.snapshots.length === 0) return undefined;

    const renderTime = now - NET_CONFIG.interpolationDelayMs;
    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];
    if (renderTime <= first.time) return { ...first.pose };
    if (renderTime >= last.time) return { ...last.pose };

    for (let i = this.snapshots.length - 2; i >= 0; i--) {
      const from = this.snapshots[i];
      const to = this.snapshots[i + 1];
      if (from.time > renderTime) continue;

      const span = to.time - from.time;
      const alpha = span > 0 ? (renderTime - from.time) / span : 1;
      return {
        x: lerp(from.pose.x, to.pose.x, alpha),
        y: lerp(from.pose.y, to.pose.y, alpha),
        angle: lerpAngle(from.pose.angle, to.pose.angle, alpha),
        // Derived sim fields are not blended — they exist on the wire for prediction, and a remote's
        // half-lerped speed would be a number no tick ever produced. Same rule as reconciliation.
        speed: to.pose.speed,
        reverseHold: to.pose.reverseHold,
      };
    }
    return { ...last.pose };
  }

  /**
   * Keep only the interpolation window: every snapshot inside `interpolationDelayMs` of the newest,
   * plus the one immediately before it, which is the `from` end of the pair the next sample will
   * blend. Anything older can never be read again. Without this the buffer grows for the whole match
   * at the patch rate, per remote player.
   */
  private prune(newestTime: number): void {
    const horizon = newestTime - NET_CONFIG.interpolationDelayMs;
    let keepFrom = 0;
    for (let i = 0; i < this.snapshots.length; i++) {
      if (this.snapshots[i].time > horizon) break;
      keepFrom = i;
    }
    if (keepFrom > 0) this.snapshots.splice(0, keepFrom);
  }
}
