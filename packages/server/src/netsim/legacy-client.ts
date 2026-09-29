import {
  InterpolationBuffer,
  MS_PER_TICK,
  NET_CONFIG,
  PlayerStatus,
  PredictionBuffer,
  buildStepContext,
  localModifiers,
  stepSim,
  type ArenaDef,
  type ContextPlayer,
  type InputMessage,
  type PendingInput,
  type SimBody,
  type StepContext,
} from "@motor-combat-moba/shared";
import type { ScriptedDriver } from "./drivers.js";
import type { Snapshot, SnapshotCar } from "./server-world.js";

/** Same derivation as `PredictionBuffer`'s own: one replayed step is one sim tick. */
const DT_SECONDS = MS_PER_TICK / 1000;

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
 * `PredictionBuffer.reconcile`'s replay, without the ease: the pose the pending tail lands on when
 * replayed from the authoritative one. Kept in lockstep with `reconcile` so the harness can record
 * |target − predicted| before `reconcile` eases (or snaps) toward it.
 */
function replayTarget(
  authoritative: SimBody,
  pending: readonly PendingInput[],
  ctx: StepContext,
): SimBody {
  let target: SimBody = {
    x: authoritative.x,
    y: authoritative.y,
    angle: authoritative.angle,
    vx: authoritative.vx,
    vy: authoritative.vy,
    angVel: authoritative.angVel,
    maneuver: authoritative.maneuver,
    maneuverTicksLeft: authoritative.maneuverTicksLeft,
    maneuverAngle: authoritative.maneuverAngle,
    maneuverSpeed: authoritative.maneuverSpeed,
  };
  for (const entry of pending) target = stepSim(target, entry.input, DT_SECONDS, ctx);
  return target;
}

/**
 * Today's client, headless: `ArenaScene`'s `pumpInput` → `sendInputTick` (the input clock and local
 * prediction), `reconcileLocal` and `pushRemoteSnapshots` (on each patch, in that order) and
 * `remotePose` (remote interpolation sampling). No Phaser, no Colyseus: the "room state" is the last
 * `Snapshot` this client decoded, and every config read happens inside the caller's mode scope.
 */
export class LegacyClient {
  /** Every reconcile's |predicted − target| distance, appended as it happens. */
  readonly reconcileErrors: number[] = [];
  /** clientMs at which each seq was produced. */
  readonly producedAt = new Map<number, number>();

  private readonly prediction = new PredictionBuffer();
  /**
   * The buffer's private `pending` list, mirrored with the same push/cap/filter rules, so
   * `replayTarget` can replay exactly what `reconcile` is about to.
   */
  private pending: PendingInput[] = [];
  private readonly interps = new Map<string, InterpolationBuffer>();
  private last: Snapshot | undefined;
  private lastById = new Map<string, SnapshotCar>();
  private view: StateView | undefined;
  private predicted: SimBody | undefined;
  private inputAccumulatorMs = 0;
  private inputSeq = 0;

  constructor(
    readonly id: string,
    private readonly driver: ScriptedDriver,
    private readonly arena: ArenaDef,
  ) {}

  /** The newest predicted pose, for tests and diagnostics. */
  get predictedPose(): SimBody | undefined {
    return this.predicted;
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

  /** One render frame at client time nowMs; returns the input messages to send this frame. */
  frame(nowMs: number, deltaMs: number): InputMessage[] {
    // `pumpInput`: a client that cannot drive stops its input clock outright.
    if (!this.canDrive()) {
      this.inputAccumulatorMs = 0;
      return [];
    }
    // `drainTicks`: clamp BEFORE draining, at what the server will simulate in one tick.
    const clamped = Math.min(this.inputAccumulatorMs + deltaMs, MS_PER_TICK * NET_CONFIG.maxInputsPerTick);
    const ticks = Math.floor(clamped / MS_PER_TICK);
    this.inputAccumulatorMs = clamped - ticks * MS_PER_TICK;

    const out: InputMessage[] = [];
    for (let i = 0; i < ticks; i++) out.push(this.sendInputTick(nowMs));
    return out;
  }

  /** `sendInputTick`, less the aim bearing (no firing in the baseline) and the idle-warning UI. */
  private sendInputTick(nowMs: number): InputMessage {
    const self = this.lastById.get(this.id)!;
    this.inputSeq += 1;
    const input: InputMessage = { seq: this.inputSeq, ...this.driver.inputFor(this.inputSeq), aimAngle: undefined };
    this.producedAt.set(input.seq, nowMs);

    const from = this.predicted ?? self.body;
    const entry: PendingInput = { seq: input.seq, input };
    this.pending.push(entry);
    if (this.pending.length > NET_CONFIG.pendingInputCap) {
      this.pending.splice(0, this.pending.length - NET_CONFIG.pendingInputCap);
    }
    this.predicted = this.prediction.predict(from, entry, this.stepContext());
    return input;
  }

  /** A snapshot arrived at client time nowMs: `reconcileLocal`, then `pushRemoteSnapshots`. */
  onSnapshot(nowMs: number, snap: Snapshot): void {
    this.last = snap;
    this.lastById = new Map(snap.cars.map((c) => [c.id, c]));
    this.view = viewOf(snap);
    this.reconcileLocal();
    this.pushRemoteSnapshots(nowMs);
  }

  private reconcileLocal(): void {
    const self = this.lastById.get(this.id);
    if (!self || self.status !== PlayerStatus.IN_MATCH || !self.alive) {
      this.predicted = undefined;
      return;
    }
    const authoritative = { ...self.body };
    if (!this.predicted) {
      this.predicted = authoritative;
      return;
    }
    const ctx = this.stepContext();
    this.pending = this.pending.filter((e) => e.seq > self.lastProcessedInputSeq);
    const target = replayTarget(authoritative, this.pending, ctx);
    this.reconcileErrors.push(Math.hypot(target.x - this.predicted.x, target.y - this.predicted.y));
    this.predicted = this.prediction.reconcile(authoritative, self.lastProcessedInputSeq, this.predicted, ctx);
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
