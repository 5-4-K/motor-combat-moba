import { ClockSync, InputScheduler, NET_CONFIG, type TimePong } from "@motor-combat-moba/shared";

/** The one call of `InputScheduler` the scene makes; an interface so a test can spy on it. */
export interface DueTicks {
  due(nowMs: number, frameMs: number, slackTicks: number | undefined, slackStdTicks?: number): number[];
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
 * The client's input clock (NR18, NR20, NR21): the server-clock estimate, the schedule of `MSG_TIME`
 * requests that feeds it, and which ticks to send a frame for on each render frame.
 *
 * - **Time sync.** `timeRequest` answers a request on join, every `timeSyncBurstMs` for
 *   `timeSyncBurstWindowMs`, then every `timeSyncIntervalMs`. Poll it at least every
 *   `timeSyncBurstMs`.
 * - **Slack, once per snapshot.** `InputScheduler.due`'s slack integrator runs once per sample it is
 *   given, so passing the same snapshot's value on every frame would multiply its gain by the frame
 *   rate and limit-cycle the lead. `onSnapshot` only marks a value fresh; the next `due` passes it and
 *   clears it, and every other call passes `undefined`. A frame that sends nothing (`discard`) drops
 *   the sample rather than holding it.
 * - **Pause.** A paused practice or playground room freezes its tick, so every pong during the pause
 *   stamps the same tick: the estimate snaps back onto the frozen clock while the scheduler's last
 *   emitted tick stays where it was. On the RESUME edge (`setPaused(false)` after `true`) the scheduler
 *   and the clock are rebuilt and the join burst re-runs, so the lead is re-derived from a clock that
 *   is running again instead of from history that spans a clock that stood still.
 */
export class InputClock {
  private clockSync: ClockSync;
  private scheduler: DueTicks;
  private freshSlack: number | undefined;
  /** The same snapshot's `inputSlackStd`, handed over with `freshSlack` (D5 ruling E). */
  private freshSlackStd = 0;
  private nextPingAt: number;
  private burstUntil: number;
  private paused = false;

  constructor(
    nowMs: number,
    private readonly schedulerOf: (clock: ClockSync) => DueTicks = (clock) => new InputScheduler(clock),
  ) {
    this.clockSync = new ClockSync();
    this.scheduler = schedulerOf(this.clockSync);
    this.nextPingAt = nowMs;
    this.burstUntil = nowMs + NET_CONFIG.timeSyncBurstWindowMs;
  }

  /** The current server-clock estimate. Rebuilt on a resume, so never hold on to it. */
  get clock(): ClockSync {
    return this.clockSync;
  }

  /** A `MSG_TIME` request due now, if any. */
  timeRequest(nowMs: number): { c: number } | undefined {
    if (nowMs < this.nextPingAt) return undefined;
    const step = nowMs < this.burstUntil ? NET_CONFIG.timeSyncBurstMs : NET_CONFIG.timeSyncIntervalMs;
    this.nextPingAt = Math.max(this.nextPingAt + step, nowMs + step / 2);
    return { c: nowMs };
  }

  onPong(nowMs: number, pong: TimePong): void {
    this.clockSync.onPong(nowMs, pong);
  }

  /** The room's pause flag, every frame. Only the paused → running edge does anything. */
  setPaused(paused: boolean, nowMs: number): void {
    const resumed = this.paused && !paused;
    this.paused = paused;
    if (!resumed) return;
    this.clockSync = new ClockSync();
    this.scheduler = this.schedulerOf(this.clockSync);
    this.freshSlack = undefined;
    this.nextPingAt = nowMs;
    this.burstUntil = nowMs + NET_CONFIG.timeSyncBurstWindowMs;
  }

  /** A snapshot was reconciled and carried this `inputSlack` (and its spread, `inputSlackStd`). */
  onSnapshot(slackTicks: number, slackStdTicks = 0): void {
    this.freshSlack = slackTicks;
    this.freshSlackStd = slackStdTicks;
  }

  /** The ticks to produce a frame for now, consuming any fresh slack sample. */
  due(nowMs: number, frameMs: number): number[] {
    const slack = this.freshSlack;
    this.freshSlack = undefined;
    return this.scheduler.due(nowMs, frameMs, slack, this.freshSlackStd);
  }

  /** A frame that will not send (paused, not driving): the pending sample, if any, is dropped. */
  discard(): void {
    this.freshSlack = undefined;
  }

  /** `localBlendAlpha` at `nowMs`. */
  blendAlpha(nowMs: number): number {
    return localBlendAlpha(this.clockSync.ready ? this.clockSync.serverTick(nowMs) : undefined);
  }
}

/**
 * One axis of a two-key control as the `-1 | 0 | 1` the wire expects. Both keys down is a
 * deliberate `0` rather than a last-key-wins fight: holding left and right at once should mean "no
 * steering", not an arbitrary direction that depends on keyboard scan order.
 *
 * That rule is also what lets each side be an OR of two key sets — the arrows and WASD both steer,
 * and the free-look camera pans on either — without this function knowing there are two. Holding A
 * and Right is the same situation as holding Left and Right, and it already answers 0.
 */
export function axisOf(negative: boolean, positive: boolean): -1 | 0 | 1 {
  if (negative === positive) return 0;
  return positive ? 1 : -1;
}
