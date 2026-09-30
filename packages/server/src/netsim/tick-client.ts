import {
  ClockSync,
  InputScheduler,
  InterpolationBuffer,
  NET_CONFIG,
  PlayerStatus,
  TickPrediction,
  buildStepContext,
  localModifiers,
  type ArenaDef,
  type ContextPlayer,
  type InputFrame,
  type InputPacket,
  type SimBody,
  type StepContext,
  type TimePong,
} from "@motor-combat-moba/shared";
import type { ScriptedDriver } from "./drivers.js";
import type { Snapshot, SnapshotCar } from "./server-world.js";

/** `buildStepContext`'s and `localModifiers`' view of a decoded patch. */
interface StateView {
  players: {
    forEach(callback: (player: ContextPlayer, sessionId: string) => void): void;
    get(sessionId: string): ContextPlayer | undefined;
  };
}

function viewOf(snap: Snapshot): StateView {
  const byId = new Map<string, ContextPlayer>();
  for (const car of snap.cars) {
    byId.set(car.id, {
      x: car.body.x,
      y: car.body.y,
      angle: car.body.angle,
      status: car.status,
      carId: car.carId,
      alive: car.alive,
      statuses: car.statuses,
    });
  }
  return {
    players: {
      forEach: (cb) => byId.forEach((p, id) => cb(p, id)),
      get: (id) => byId.get(id),
    },
  };
}

/**
 * The Phase D client, headless: `ArenaScene`'s `bindTimeSync` (a `ClockSync` fed by `MSG_TIME`
 * pongs, a burst on join then the steady rate), `pumpInput` → `sendInputTick` (the shared
 * `InputScheduler` deciding which server ticks to send a frame for, a `TickPrediction` predicting
 * each one, and the packet carrying `inputRedundancy` older frames), `reconcileLocal` and
 * `pushRemoteSnapshots` (on each patch, in that order) and `remotePose`. No Phaser, no Colyseus: the
 * "room state" is the last `Snapshot` this client decoded, and every config read happens inside the
 * caller's mode scope.
 *
 * The only logic written here is the plumbing between those shared modules: the slack sample is
 * handed to the scheduler once per snapshot and then cleared (the browser's `InputClock` rule), and
 * the reconcile error is read off `TickPrediction.replayTarget` — the same target `reconcile` eases
 * toward — rather than a copy of the replay.
 *
 * `clockOffsetMs` is this client's clock minus the harness clock: a real client's `performance.now()`
 * has nothing to do with the server's wall clock, and `ClockSync` must earn the offset from pongs.
 * Every time this class REPORTS (`producedAt`) is on the harness clock, so the harness can compare it
 * with server time directly.
 */
export class TickClient {
  /** Every reconcile's |predicted − target| distance, appended as it happens. */
  readonly reconcileErrors: number[] = [];
  /** Harness ms at which the frame for each server tick was produced. */
  readonly producedAt = new Map<number, number>();

  private readonly clock = new ClockSync();
  private readonly scheduler = new InputScheduler(this.clock);
  private readonly prediction = new TickPrediction();
  private readonly interps = new Map<string, InterpolationBuffer>();
  private last: Snapshot | undefined;
  private lastById = new Map<string, SnapshotCar>();
  private view: StateView | undefined;
  private predicted: SimBody | undefined;
  /** The newest snapshot's `inputSlack`, handed to the scheduler once and then cleared (NR21). */
  private freshSlack: number | undefined;
  private nextTimeSyncAt: number;
  private readonly joinedAt: number;

  constructor(
    readonly id: string,
    private readonly driver: ScriptedDriver,
    private readonly arena: ArenaDef,
    private readonly clockOffsetMs: number,
    joinMs: number,
  ) {
    this.joinedAt = joinMs;
    this.nextTimeSyncAt = joinMs;
  }

  /** The newest predicted pose, for tests and diagnostics. */
  get predictedPose(): SimBody | undefined {
    return this.predicted;
  }

  private local(nowMs: number): number {
    return nowMs + this.clockOffsetMs;
  }

  /**
   * A `MSG_TIME` request due at harness time `nowMs`, if any: on join, every `timeSyncBurstMs` for
   * `timeSyncBurstWindowMs`, then every `timeSyncIntervalMs` — `bindTimeSync`'s schedule.
   */
  timeRequest(nowMs: number): { c: number } | undefined {
    if (nowMs < this.nextTimeSyncAt) return undefined;
    const inBurst = nowMs - this.joinedAt < NET_CONFIG.timeSyncBurstWindowMs;
    this.nextTimeSyncAt += inBurst ? NET_CONFIG.timeSyncBurstMs : NET_CONFIG.timeSyncIntervalMs;
    return { c: this.local(nowMs) };
  }

  onPong(nowMs: number, pong: TimePong): void {
    this.clock.onPong(this.local(nowMs), pong);
  }

  /** `ArenaScene.canDrive`: phase is always MATCH here, so the patched self must be on the field. */
  private canDrive(): boolean {
    const self = this.lastById.get(this.id);
    return self?.status === PlayerStatus.IN_MATCH && self.alive === true;
  }

  private stepContext(): StepContext {
    const snap = this.last!;
    const view = this.view!;
    return buildStepContext(this.arena, view, this.id, snap.tick, localModifiers(view, this.id, snap.tick));
  }

  /** One render frame at harness time nowMs; returns the input packets to send this frame. */
  frame(nowMs: number, deltaMs: number): InputPacket[] {
    // `pumpInput`: a client that cannot drive sends nothing, and its pending slack sample is dropped.
    if (!this.canDrive()) {
      this.freshSlack = undefined;
      return [];
    }
    const slack = this.freshSlack;
    this.freshSlack = undefined;
    const out: InputPacket[] = [];
    for (const tick of this.scheduler.due(this.local(nowMs), deltaMs, slack)) {
      out.push(this.sendInputTick(nowMs, tick));
    }
    return out;
  }

  /** `sendInputTick`, less the aim bearing (no firing in the baseline) and the idle-warning UI. */
  private sendInputTick(nowMs: number, tick: number): InputPacket {
    const self = this.lastById.get(this.id)!;
    const frame: InputFrame = { tick, ...this.driver.inputFor(tick) };
    this.producedAt.set(tick, nowMs);
    const from = this.predicted ?? self.body;
    this.predicted = this.prediction.predict(from, frame, this.stepContext());
    return { inputs: this.prediction.recent(1 + NET_CONFIG.inputRedundancy) };
  }

  /** A snapshot arrived at harness time nowMs: `reconcileLocal`, then `pushRemoteSnapshots`. */
  onSnapshot(nowMs: number, snap: Snapshot): void {
    this.last = snap;
    this.lastById = new Map(snap.cars.map((c) => [c.id, c]));
    this.view = viewOf(snap);
    this.reconcileLocal();
    this.pushRemoteSnapshots(nowMs);
  }

  private reconcileLocal(): void {
    const self = this.lastById.get(this.id);
    if (self) this.freshSlack = self.inputSlack;
    if (!self || self.status !== PlayerStatus.IN_MATCH || !self.alive) {
      this.prediction.clear();
      this.predicted = undefined;
      return;
    }
    const authoritative = { ...self.body };
    if (!this.predicted) {
      this.predicted = authoritative;
      return;
    }
    const ctx = this.stepContext();
    const tick = this.last!.tick;
    const target = this.prediction.replayTarget(authoritative, tick, ctx);
    this.reconcileErrors.push(Math.hypot(target.x - this.predicted.x, target.y - this.predicted.y));
    this.predicted = this.prediction.reconcile(authoritative, tick, this.predicted, ctx);
  }

  private pushRemoteSnapshots(nowMs: number): void {
    for (const car of this.last!.cars) {
      if (car.id === this.id || car.status !== PlayerStatus.IN_MATCH) continue;
      let buf = this.interps.get(car.id);
      if (!buf) {
        buf = new InterpolationBuffer();
        this.interps.set(car.id, buf);
      }
      buf.push(nowMs, car.body);
    }
  }

  /**
   * What this client would draw for a remote car right now (undefined if unknown): `renderCars`'
   * pose choice — a wreck at its patched pose (`wreck: true`), a live car through `remotePose`.
   */
  drawnRemote(id: string, nowMs: number): { x: number; y: number; wreck: boolean } | undefined {
    const car = this.lastById.get(id);
    if (!car || car.status !== PlayerStatus.IN_MATCH) return undefined;
    if (!car.alive) return { x: car.body.x, y: car.body.y, wreck: true };
    const pose = this.interps.get(id)?.sample(nowMs) ?? car.body;
    return { x: pose.x, y: pose.y, wreck: false };
  }
}
