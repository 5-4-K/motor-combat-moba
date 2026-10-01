import { MS_PER_TICK } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";
import type { ClockSync } from "./clock-sync.js";

/** Ticks of safety per tick of slack error, per NEW slack sample (one per snapshot). */
const SAFETY_GAIN = 0.03;
/**
 * The worst-case slack spread that integer quantisation alone produces, in ticks (fix round I3).
 * Slack samples are whole ticks, so a perfectly steady path whose true lead is fractional reads as a
 * Bernoulli mix of two neighbouring integers — std up to 0.5 at a half-tick fraction — with nothing
 * late about it. Only spread beyond this floor is jitter worth margin.
 */
export const SLACK_QUANTISATION_STD_TICKS = 0.5;
/** Slack within this of the target is left alone (NR21). */
const DEADBAND_TICKS = 0.25;

/**
 * Which ticks the client must produce input for, right now (NR20, NR21). The client runs `leadMs`
 * ahead of its estimate of the server clock: half the RTT plus a safety margin steered so the
 * server reports `targetSlackTicks` of slack, clamped to `maxInputLeadMs - 1 tick` because the server
 * drops anything further ahead. The lead moves by at most `maxDilation` of elapsed time per call —
 * the client's tick clock runs up to 4 % fast or slow, and never jumps.
 */
export class InputScheduler {
  private lastTick = 0;
  private started = false;
  private lead = Number.NaN;
  private safetyMs = MS_PER_TICK * NET_CONFIG.targetSlackTicks;

  constructor(private readonly clock: ClockSync) {}

  get leadMs(): number {
    return this.lead;
  }

  /**
   * `slackTicks` is a NEW slack sample — pass it once per snapshot received since the last call, and
   * `undefined` on every other call. The integrator runs per sample, never per call, so its gain does
   * not depend on the frame rate. `slackStdTicks` is the same snapshot's spread (`inputSlackStd`);
   * the target the mean is steered to is `targetSlackTicks + slackSpreadK × max(0, slackStdTicks −
   * SLACK_QUANTISATION_STD_TICKS)` (D5 ruling E, fix round I3), so a jittery path keeps its slow tail
   * on time rather than only its mean, and a steady one is not charged for integer quantisation.
   */
  due(nowMs: number, frameMs: number, slackTicks: number | undefined, slackStdTicks = 0): number[] {
    if (!this.clock.ready) return [];
    if (slackTicks !== undefined) {
      const target = NET_CONFIG.targetSlackTicks + NET_CONFIG.slackSpreadK * Math.max(0, slackStdTicks - SLACK_QUANTISATION_STD_TICKS);
      const err = target - slackTicks;
      const beyond = Math.sign(err) * Math.max(0, Math.abs(err) - DEADBAND_TICKS);
      this.safetyMs += beyond * SAFETY_GAIN * MS_PER_TICK;
      this.safetyMs = Math.max(0, Math.min(this.safetyMs, NET_CONFIG.maxInputLeadMs - MS_PER_TICK));
    }
    const wanted = Math.min(this.clock.rttMs() / 2 + this.safetyMs, NET_CONFIG.maxInputLeadMs - MS_PER_TICK);
    if (Number.isNaN(this.lead)) this.lead = wanted;
    const step = NET_CONFIG.maxDilation * frameMs;
    this.lead += Math.max(-step, Math.min(step, wanted - this.lead));

    const target = Math.floor(this.clock.serverTick(nowMs)) + Math.ceil(this.lead / MS_PER_TICK);
    if (!this.started || target - this.lastTick > NET_CONFIG.clientMaxCatchUpTicks) {
      this.started = true;
      this.lastTick = target - 1;
    }
    const out: number[] = [];
    for (let t = this.lastTick + 1; t <= target; t++) out.push(t);
    if (target > this.lastTick) this.lastTick = target;
    return out;
  }
}
