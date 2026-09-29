import { MS_PER_TICK } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";
import type { ClockSync } from "./clock-sync.js";

const SAFETY_GAIN = 0.1; // ms of safety per tick of slack error, per snapshot

/**
 * Which ticks the client must produce input for, right now (NR20, NR21). The client runs `leadMs`
 * ahead of its estimate of the server clock: half the RTT plus a safety margin steered so the
 * server reports `targetSlackTicks` of slack. The lead moves by at most `maxDilation` of elapsed
 * time per call — the client's tick clock runs up to 4 % fast or slow, and never jumps.
 */
export class InputScheduler {
  private lastTick = -1;
  private lead = Number.NaN;
  private safetyMs = MS_PER_TICK * NET_CONFIG.targetSlackTicks;

  constructor(private readonly clock: ClockSync) {}

  get leadMs(): number {
    return this.lead;
  }

  due(nowMs: number, frameMs: number, slackTicks: number | undefined): number[] {
    if (!this.clock.ready) return [];
    if (slackTicks !== undefined) {
      this.safetyMs += (NET_CONFIG.targetSlackTicks - slackTicks) * SAFETY_GAIN * MS_PER_TICK;
      this.safetyMs = Math.max(0, Math.min(this.safetyMs, NET_CONFIG.maxInputLeadMs));
    }
    const wanted = this.clock.rttMs() / 2 + this.safetyMs;
    if (Number.isNaN(this.lead)) this.lead = wanted;
    const step = NET_CONFIG.maxDilation * frameMs;
    this.lead += Math.max(-step, Math.min(step, wanted - this.lead));

    const target = Math.floor(this.clock.serverTick(nowMs) + this.lead / MS_PER_TICK);
    if (this.lastTick < 0 || target - this.lastTick > NET_CONFIG.clientMaxCatchUpTicks) this.lastTick = target - 1;
    const out: number[] = [];
    for (let t = this.lastTick + 1; t <= target; t++) out.push(t);
    if (target > this.lastTick) this.lastTick = target;
    return out;
  }
}
