import {
  ClockSync,
  InputScheduler,
  NET_CONFIG,
  PlayerStatus,
  RemoteTimeline,
  TickPrediction,
  axisOfWire,
  buildStepContext,
  drive,
  localAnchorOf,
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

/** One remote as a client drew it this frame (`TickClient.drawnRemote`). */
export interface DrawnRemote {
  x: number;
  y: number;
  angle: number;
  wreck: boolean;
  /** Drawn within `contactBlendRangeCars` car lengths of the local car's drawn pose. */
  inBlendRange: boolean;
  /**
   * The contact blend's own target this frame, before the final-pose settle
   * (`RemoteTimeline.blendTarget`): what the drawn pose should be. Undefined for a wreck.
   */
  intended: { x: number; y: number; angle: number } | undefined;
}

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
 * each one, and the packet carrying `inputRedundancy` older frames), `pushRemoteSnapshots` and
 * `reconcileLocal` (on each patch, in that order, so the replay steps against remotes reckoned from
 * this snapshot — NR32) and `remotePose` — the same shared
 * `RemoteTimeline` the scene draws remotes through, its render tick fixed once per frame. No Phaser,
 * no Colyseus: the "room state" is the last `Snapshot` this client decoded, and every config read happens inside the
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
  /**
   * Every sent frame's honest shot staleness, `tick − viewTick` in ticks (NR35, NR36): how far behind
   * the tick a frame is FOR the remotes were drawn when it was produced. Frames produced before the
   * clock synced carry no `viewTick` and are not recorded.
   */
  readonly staleness: number[] = [];

  private readonly clock = new ClockSync();
  private readonly scheduler = new InputScheduler(this.clock);
  private readonly prediction = new TickPrediction();
  /** Every remote's tick-keyed interpolation, adaptive delay and capped extrapolation (NR29–NR31). */
  private readonly remotes = new RemoteTimeline();
  private last: Snapshot | undefined;
  private lastById = new Map<string, SnapshotCar>();
  private view: StateView | undefined;
  private predicted: SimBody | undefined;
  /** The pose before the newest predicted step: `ArenaScene.predictedPrev`, for the drawn local pose. */
  private predictedPrev: SimBody | undefined;
  /** The newest snapshot's `inputSlack`, handed to the scheduler once and then cleared (NR21). */
  private freshSlack: number | undefined;
  /** That snapshot's `inputSlackStd`, handed over with it (D5 ruling E). */
  private freshSlackStd = 0;
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

  /** `ArenaScene.stepContext`: each step at its own tick's modifiers (M5), remotes reckoned to it (NR32). */
  private stepContext(): (tick: number) => StepContext {
    const view = this.view!;
    return (tick) =>
      buildStepContext(this.arena, view, this.id, tick, localModifiers(view, this.id, tick), (id, at) =>
        this.remotes.reckonedPose(id, at),
      );
  }

  /** One render frame at harness time nowMs; returns the input packets to send this frame. */
  frame(nowMs: number, deltaMs: number): InputPacket[] {
    // `ArenaScene.update`: the remote render tick is fixed once per frame, before anything draws.
    this.remotes.beginFrame(this.clock.ready ? this.clock.serverTick(this.local(nowMs)) : undefined, deltaMs);
    // `pumpInput`: a client that cannot drive sends nothing, and its pending slack sample is dropped.
    if (!this.canDrive()) {
      this.freshSlack = undefined;
      return [];
    }
    const slack = this.freshSlack;
    this.freshSlack = undefined;
    const out: InputPacket[] = [];
    for (const tick of this.scheduler.due(this.local(nowMs), deltaMs, slack, this.freshSlackStd)) {
      out.push(this.sendInputTick(nowMs, tick));
    }
    return out;
  }

  /**
   * `sendInputTick`, less the aim bearing (no firing in the baseline) and the idle-warning UI. The
   * frame carries `viewTick`, the floored render tick this frame's remotes were drawn at
   * (`ArenaScene.lastRenderTick`, NR35), exactly as the scene sends it.
   */
  private sendInputTick(nowMs: number, tick: number): InputPacket {
    const self = this.lastById.get(this.id)!;
    const frame: InputFrame = { tick, ...this.driver.inputFor(tick) };
    // A render tick before tick 0 (the first frames of a fresh room) is not a wire tick: omitted, as
    // the scene omits it.
    const R = this.remotes.renderTick;
    if (R !== undefined && R >= 0) {
      frame.viewTick = Math.floor(R);
      this.staleness.push(tick - frame.viewTick);
    }
    this.producedAt.set(tick, nowMs);
    const from = this.predicted ?? self.body;
    this.predictedPrev = from;
    this.predicted = this.prediction.predict(from, frame, this.stepContext());
    return { inputs: this.prediction.recent(1 + NET_CONFIG.inputRedundancy) };
  }

  /** A snapshot arrived at harness time nowMs: `pushRemoteSnapshots`, then `reconcileLocal`. */
  onSnapshot(nowMs: number, snap: Snapshot): void {
    this.last = snap;
    this.lastById = new Map(snap.cars.map((c) => [c.id, c]));
    this.view = viewOf(snap);
    this.pushRemoteSnapshots(nowMs);
    this.reconcileLocal();
  }

  private reconcileLocal(): void {
    const self = this.lastById.get(this.id);
    if (self) {
      this.freshSlack = self.inputSlack;
      this.freshSlackStd = self.inputSlackStd;
    }
    if (!self || self.status !== PlayerStatus.IN_MATCH || !self.alive) {
      this.prediction.clear();
      this.predicted = undefined;
      this.predictedPrev = undefined;
      return;
    }
    const authoritative = { ...self.body };
    if (!this.predicted) {
      this.predicted = authoritative;
      this.predictedPrev = undefined;
      return;
    }
    const ctx = this.stepContext();
    const tick = this.last!.tick;
    const target = this.prediction.replayTarget(authoritative, tick, ctx);
    this.reconcileErrors.push(Math.hypot(target.x - this.predicted.x, target.y - this.predicted.y));
    this.predicted = this.prediction.reconcile(authoritative, tick, this.predicted, ctx);
  }

  private pushRemoteSnapshots(nowMs: number): void {
    const snap = this.last!;
    const view = this.view!;
    this.remotes.onSnapshot(this.clock.ready ? this.clock.serverTick(this.local(nowMs)) : undefined, snap.tick);
    for (const car of snap.cars) {
      if (car.id === this.id || car.status !== PlayerStatus.IN_MATCH) continue;
      this.remotes.push(car.id, snap.tick, {
        body: car.body,
        keys: { steer: axisOfWire(car.lastSteer), throttle: axisOfWire(car.lastThrottle), fireSlots: 0 },
        ctx: {
          ...buildStepContext(this.arena, view, car.id, snap.tick, localModifiers(view, car.id, snap.tick)),
          others: [],
        },
        alive: car.alive,
      });
    }
  }

  /**
   * The contact blend's anchor, built by the same shared `localAnchorOf` `ArenaScene.localAnchor`
   * calls: the DRAWN local pose (`predictedPrev` blended toward `predicted` at the server clock's
   * phase), the fractional tick it stands at, and none while the local car is a wreck. The one
   * difference from the scene: the scene reads `performance.now()` at draw time, this reads the
   * frame's harness time — the harness has no gap between a frame's start and its draw.
   */
  private localAnchor(nowMs: number) {
    return localAnchorOf({
      predicted: this.predicted,
      predictedPrev: this.predictedPrev,
      newestPredictedTick: this.prediction.newestPredictedTick,
      alive: this.lastById.get(this.id)?.alive === true,
      serverTickNow: this.clock.ready ? this.clock.serverTick(this.local(nowMs)) : undefined,
    });
  }

  /**
   * What this client would draw for a remote car right now (undefined if unknown): `renderCars`'
   * pose choice — a wreck at its patched pose (`wreck: true`), a live car through `remotePose`.
   * `inBlendRange` is whether the drawn remote sits within `contactBlendRangeCars` car lengths of the
   * local car's drawn pose — where the contact blend (NR34) can act on it.
   */
  drawnRemote(
    id: string,
    nowMs: number,
  ): DrawnRemote | undefined {
    const car = this.lastById.get(id);
    if (!car || car.status !== PlayerStatus.IN_MATCH) return undefined;
    if (!car.alive) {
      return { x: car.body.x, y: car.body.y, angle: car.body.angle, wreck: true, inBlendRange: false, intended: undefined };
    }
    const local = this.localAnchor(nowMs);
    const pose = this.remotes.pose(id, local) ?? car.body;
    const inBlendRange =
      local !== undefined &&
      Math.hypot(pose.x - local.pose.x, pose.y - local.pose.y) < NET_CONFIG.contactBlendRangeCars * drive().carWidth;
    const target = this.remotes.blendTarget(id);
    const intended = target ? { x: target.x, y: target.y, angle: target.angle } : undefined;
    return { x: pose.x, y: pose.y, angle: pose.angle, wreck: false, inBlendRange, intended };
  }
}
