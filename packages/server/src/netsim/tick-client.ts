import {
  ClockSync,
  InputScheduler,
  LocalFire,
  ManeuverKind,
  ProvisionalShots,
  ShotView,
  boundsOf,
  isWeaponId,
  provisionalOf,
  shotFromWire,
  shotViewMaxTicks,
  weaponDefOf,
  weaponTicksOf,
  NET_CONFIG,
  PlayerStatus,
  RemoteTimeline,
  TICK_RATE_HZ,
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
import type { Snapshot, SnapshotCar, SnapshotShot } from "./server-world.js";

/** One fire press this client made (F5): a fire bit that rose in a frame it produced. */
export interface ClientPress {
  /** The server tick the pressing frame is for. */
  tick: number;
  slot: number;
  /** The weapon in that slot per the newest snapshot of this car when it pressed. */
  weaponId: string;
  /** Harness ms the pressing frame was produced. */
  pressMs: number;
  /** Harness ms of the first frame this press's shot was drawn — provisional or confirmed. */
  drawnMs?: number;
  /** `LocalFire` released a provisional shot for it. */
  predicted?: boolean;
}

/**
 * A shot belongs to a press on its slot (or weapon) no more than this many ticks before its release
 * tick, beyond the weapon's wind-up: the server's press edge can land a few ticks after the client's
 * (a late pressing frame is repeated over) and a confirm matches within `provisionalShotMatchTicks`.
 * Without it, a shot nothing predicted would be credited to an old press that was never drawn.
 */
const PRESS_ASSOC_TICKS = 8;

/**
 * One provisional dropped unconfirmed (F5): at the first snapshot at or past its `spawnTick +
 * provisionalShotMatchTicks` since the Phase F final review (`ProvisionalShots.expireBySnapshot`).
 */
export interface ExpiredProvisional {
  slot: number;
  weaponId: string;
  spawnTick: number;
  /** Harness ms it was dropped. */
  atMs: number;
  /** Its confirming instance arrived after the drop (counted in `lateConfirms` too). */
  confirmedLate: boolean;
}

/** How long an expired provisional is remembered, to recognise a confirm that arrives after it. */
const EXPIRED_MEMORY_MS = 5000;

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
  /** Every fire press, in order (F5, `ownShotDelayMs`). */
  readonly presses: ClientPress[] = [];
  /**
   * Every hand-over (NR39), F5's `shotConfirmJumpP95`: the distance between where a provisional was
   * drawn and where its confirming instance is drawn on the frame the confirm arrives — the gap the
   * hand-over ease then closes.
   */
  readonly confirmJumps: number[] = [];
  /** The same, for homing shots alone, kept apart: both are drawn on a held heading (NR40). */
  readonly confirmJumpsHoming: number[] = [];
  /**
   * Provisional shots added (one per pellet), dropped unconfirmed, and confirmed after that — the
   * last can no longer happen by construction (confirm and expiry read the same snapshot) and is
   * kept as the check that it does not.
   */
  provisionalsMade = 0;
  provisionalsExpired = 0;
  lateConfirms = 0;
  /** Provisionals ended by an ENDED row: the server's shot ended on its birth tick (Phase F final review I1). */
  endedConfirms = 0;
  /** Own non-burst instances that confirmed no provisional, live or expired (a press `LocalFire` did not predict). */
  unpredictedShots = 0;

  private readonly localFire: LocalFire;
  private readonly provisionals = new ProvisionalShots();
  /** This client's own server instances, drawn at the local present (`ArenaScene.shotView`). */
  private readonly shotView = new ShotView(shotViewMaxTicks());
  private provisionalSeq = 0;
  private prevFireMask = 0;
  private readonly provisionalPress = new Map<string, ClientPress>();
  private readonly shotPress = new Map<string, ClientPress>();
  private readonly seenOwnShots = new Set<string>();
  /** Every provisional dropped unconfirmed, for the run to sort into late, unseen and refused. */
  readonly expiredProvisionals: ExpiredProvisional[] = [];
  private shotBounds: ReturnType<typeof boundsOf> | undefined;

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
    this.localFire = new LocalFire(id);
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
   * `sendInputTick`, less the aim bearing (no turret weapon fires in a shipped mode) and the
   * idle-warning UI, plus `fireProvisional` (NR39) on the predicted pose. The
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
    this.fireProvisional(nowMs, frame, self, this.predicted);
    return { inputs: this.prediction.recent(1 + NET_CONFIG.inputRedundancy) };
  }

  /** The arena a shot flies in, as `ArenaScene.shotWorld` builds it. */
  private shotWorld() {
    this.shotBounds ??= boundsOf(this.arena);
    return { obstacles: this.arena.obstacles, bounds: this.shotBounds };
  }

  /**
   * `ArenaScene.fireProvisional` (NR39): the frame through the predicted fire state, and every shot
   * it releases on this tick added as a provisional at the predicted pose. Also records the frame's
   * presses for `ownShotDelayMs`, which the scene has no need to.
   */
  private fireProvisional(nowMs: number, frame: InputFrame, self: SnapshotCar, body: SimBody): void {
    const rising = frame.fireSlots & ~this.prevFireMask;
    this.prevFireMask = frame.fireSlots;
    for (let slot = 0; rising >> slot !== 0; slot++) {
      if ((rising & (1 << slot)) === 0) continue;
      this.presses.push({ tick: frame.tick, slot, weaponId: self.fire.weapons[slot]?.weaponId ?? "", pressMs: nowMs });
    }
    const mods = localModifiers(this.view!, this.id, frame.tick);
    const step = this.localFire.step({
      tick: frame.tick,
      mask: frame.fireSlots,
      aimAngle: frame.aimAngle,
      carAngle: body.angle,
      viewTick: frame.viewTick,
      disarmed: mods.disarmed,
      weaponCooldown: mods.weaponCooldown,
      maneuvering: body.maneuver !== ManeuverKind.NONE,
    });
    if (step.orders.length === 0) return;
    const world = this.shotWorld();
    const owner = { sessionId: this.id, team: self.team === 1 ? 1 : 0, carId: self.carId, x: body.x, y: body.y, angle: body.angle } as const;
    for (const order of step.orders) {
      const earliest = frame.tick - (isWeaponId(order.weaponId) ? weaponTicksOf(order.weaponId).startUp : 0) - PRESS_ASSOC_TICKS;
      const press = this.latestPress((p) => p.slot === order.slot && p.tick <= frame.tick && p.tick >= earliest);
      for (const p of provisionalOf(order, owner, frame.tick, step.compTicks, `prov-${++this.provisionalSeq}`, nowMs, world)) {
        this.provisionals.add(p, world);
        this.provisionalsMade++;
        if (press) {
          this.provisionalPress.set(p.key, press);
          press.predicted = true;
        }
      }
    }
  }

  private latestPress(match: (p: ClientPress) => boolean): ClientPress | undefined {
    for (let i = this.presses.length - 1; i >= 0; i--) if (match(this.presses[i]!)) return this.presses[i];
    return undefined;
  }

  /**
   * `ArenaScene.beginShotFrame` + `beginProvisionalFrame` for this client's OWN shots (enemy shots
   * are not measured): own instances (ended rows included) confirm provisionals, each live instance
   * is drawn at the local car's tick through `ShotView`, provisionals still unconfirmed by the
   * snapshot of their `spawnTick + provisionalShotMatchTicks` are dropped, and the rest are drawn. Records the hand-over distance, the first drawn frame of each press, and
   * the expiry and late-confirm counts. Called once per frame, after `frame`.
   */
  drawShots(nowMs: number): void {
    const snap = this.last;
    if (!snap) return;
    const anchor = this.localAnchor(nowMs);
    const R = this.remotes.renderTick;
    const drawTick = anchor?.tick ?? (R === undefined ? snap.tick : R);
    // The local car as drawn (`ArenaScene.drawnPoseOf` for the driven car): `localAnchorOf`'s pose is
    // `predicted` or `blendPose` of it, a whole `SimBody`, typed down to x/y for the contact blend.
    const drawnBody = anchor?.pose as SimBody | undefined;
    const ownDrawn = drawnBody ? { x: drawnBody.x, y: drawnBody.y, angle: drawnBody.angle } : undefined;
    const own: SnapshotShot[] = snap.shots.filter((w) => w.ownerSessionId === this.id);

    // Confirm (before anything is drawn, as the scene does), then sort the newly seen instances.
    const handover = new Map<string, { x: number; y: number }>();
    for (const pair of this.provisionals.confirm(own, drawTick, ownDrawn)) {
      if (pair.ended) this.endedConfirms++;
      if (pair.from) handover.set(pair.serverId, pair.from);
      const press = this.provisionalPress.get(pair.provisionalKey);
      if (press) this.shotPress.set(pair.serverId, press);
      this.provisionalPress.delete(pair.provisionalKey);
    }
    const window = NET_CONFIG.provisionalShotMatchTicks;
    for (const row of own) {
      if (this.seenOwnShots.has(row.id)) continue;
      this.seenOwnShots.add(row.id);
      if (row.isExplosion || this.shotPress.has(row.id)) continue;
      const late = this.expiredProvisionals.find(
        (e) =>
          !e.confirmedLate &&
          nowMs - e.atMs < EXPIRED_MEMORY_MS &&
          e.weaponId === row.weaponId &&
          Math.abs(e.spawnTick - row.spawnTick) <= window,
      );
      if (late) {
        late.confirmedLate = true;
        this.lateConfirms++;
      } else {
        this.unpredictedShots++;
      }
      const earliest = row.spawnTick - (isWeaponId(row.weaponId) ? weaponTicksOf(row.weaponId).startUp : 0) - PRESS_ASSOC_TICKS;
      const press = this.latestPress(
        (p) => p.weaponId === row.weaponId && p.tick <= row.spawnTick && p.tick >= earliest && p.drawnMs === undefined,
      );
      if (press) this.shotPress.set(row.id, press);
    }

    // Own instances, drawn at the local present.
    const world = this.shotWorld();
    const live = new Set<string>();
    const self = this.lastById.get(this.id);
    for (const row of own) {
      // An ended row is an impact, never a drawn shot (`ArenaScene.beginShotFrame` skips it too).
      if (!row.alive) continue;
      if (!this.shotView.isCurrent(row.id, snap.tick)) {
        const sim = shotFromWire(row, snap.tick);
        if (!sim) continue;
        this.shotView.update(row.id, snap.tick, sim, {
          dt: 1 / TICK_RATE_HZ,
          tick: snap.tick,
          obstacles: world.obstacles,
          bounds: world.bounds,
          ownerPose: self ? { x: self.body.x, y: self.body.y, angle: self.body.angle } : null,
          homingTarget: null,
        });
      }
      live.add(row.id);
      const at = this.shotView.at(row.id, drawTick, this.shotView.isAttached(row.id) ? ownDrawn : undefined);
      if (!at) continue;
      const from = handover.get(row.id);
      if (from) {
        const def = isWeaponId(row.weaponId) ? weaponDefOf(row.weaponId) : undefined;
        const homing = def?.kind === "projectile" && def.homing !== undefined;
        (homing ? this.confirmJumpsHoming : this.confirmJumps).push(Math.hypot(from.x - at.x, from.y - at.y));
      }
      const press = this.shotPress.get(row.id);
      if (press && press.drawnMs === undefined) press.drawnMs = nowMs;
    }
    this.shotView.forgetAllBut(live);
    for (const id of this.shotPress.keys()) if (!live.has(id)) this.shotPress.delete(id);

    // Expire (by the snapshot `confirm` just read), then draw what is left.
    const before = new Map(this.provisionals.list().map((p) => [p.key, p]));
    for (const key of this.provisionals.expireBySnapshot(snap.tick)) {
      const p = before.get(key)!;
      this.provisionalsExpired++;
      this.expiredProvisionals.push({ slot: p.slot, weaponId: p.instance.weaponId, spawnTick: p.spawnTick, atMs: nowMs, confirmedLate: false });
      this.provisionalPress.delete(key);
    }
    for (const p of this.provisionals.list()) {
      const at = this.provisionals.at(p.key, drawTick, p.instance.attached ? ownDrawn : undefined);
      if (!at) continue;
      const press = this.provisionalPress.get(p.key);
      if (press && press.drawnMs === undefined) press.drawnMs = nowMs;
    }
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
      this.localFire.clear();
      return;
    }
    // NR39: the networked slots reseed the predicted fire state whenever no press is in flight.
    this.localFire.resync({ tick: this.last!.tick, ...self.fire });
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
