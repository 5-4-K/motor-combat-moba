import { TICK_RATE_HZ } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";
import { isWeaponId, weaponDefOf } from "../config/weapon-config.js";
import { msToTicks } from "../config/weapon-ticks.js";
import { bornOlder, maneuverSlotMask } from "../sim/combat.js";
import { beginFire, releaseShots, tickRecharge, type FireState } from "../sim/weapons/fire.js";
import {
  spawnInstances,
  type OwnerPose,
  type ShotOrder,
  type StepInstanceContext,
  type WeaponInstance,
} from "../sim/weapons/instances.js";
import { turnTurret } from "../sim/weapons/turret.js";
import { ShotView, shotViewMaxTicks, type ShotPose } from "./shot-view.js";

/**
 * Provisional own shots (NR39). The moment the local player presses a slot the client predicts will
 * fire, the shot is drawn at the predicted muzzle and flown with the SHARED motion (`ShotView`), until
 * the server's own instance arrives and replaces it — or, for a press the server refused, until
 * `rtt + provisionalShotGraceMs` has passed and it is dropped.
 *
 * Nothing here is ever handed to anything that decides a hit: a provisional shot never damages,
 * never spawns impact FX (it is not in `state.weapons`, which is all the fx layer reads) and never
 * feeds prediction.
 *
 * Three pieces, all built from the sim's own functions (invariant 4 — no client copy of a rule):
 *
 * - `LocalFire` decides WHETHER and WHEN a press fires: the shooter's own fire state, stepped per
 *   predicted tick through the same `tickRecharge -> beginFire -> turnTurret -> releaseShots` the
 *   server's `runCombat` runs, seeded from the local player's networked slots.
 * - `provisionalOf` turns a released order into instances with `spawnInstances` at the predicted
 *   pose, aged by the client's own shot compensation (`bornOlder`, the server's NR37 clocks).
 * - `ProvisionalShots` holds them, draws them through a `ShotView`, matches each to the server
 *   instance that confirms it, and eases the hand-over.
 */

const DT = 1 / TICK_RATE_HZ;

/** One provisional shot: a single instance (one pellet of one volley) the client drew on its own. */
export interface Provisional {
  key: string;
  ownerId: string;
  slot: number;
  /**
   * The tick the server is expected to spawn it on: the press tick plus the wind-up (and a volley's
   * own gap) — the tick `releaseShots` let it out on. Matched against the server instance's
   * `spawnTick`, which the server leaves at that tick even for a compensated shot (NR37).
   */
  spawnTick: number;
  /**
   * The instance as `spawnInstances` births it at the muzzle on `spawnTick`, aged by the client's
   * shot compensation through `bornOlder` (`lifeOffsetTicks` is that `k`). It is drawn as the shot a
   * press `k` ticks earlier would be — which is exactly what the server's fast-forward makes of it.
   */
  instance: WeaponInstance;
  bornAtMs: number;
}

/** A server instance as `confirm` reads it. */
export interface ServerShot {
  id: string;
  ownerSessionId: string;
  weaponId: string;
  spawnTick: number;
  /** A burst is never a provisional's partner (the client never spawns one). */
  isExplosion?: boolean;
  /** Breaks a tie between the pellets of one volley: the provisional on the nearest heading wins. */
  angle?: number;
}

export interface Confirmed {
  provisionalKey: string;
  serverId: string;
  /** Where the provisional was drawn at the `drawTick` handed to `confirm`, if it was drawn there. */
  from?: { x: number; y: number };
}

/** The arena a provisional flies in: the slice of `StepInstanceContext` the motion reads. */
export type ShotWorld = Pick<StepInstanceContext, "obstacles" | "bounds">;

interface Handover {
  dx: number;
  dy: number;
  startMs: number;
}

/**
 * The live provisional shots, their drawing, their confirmation and the hand-over ease.
 */
export class ProvisionalShots {
  private readonly live: Provisional[] = [];
  /** Server ids already offered to `confirm`: each instance confirms at most one provisional, once. */
  private seen = new Set<string>();
  private readonly view = new ShotView(provisionalViewMaxTicks());
  private readonly handovers = new Map<string, Handover>();

  /**
   * On a local press the client predicts will fire. With a `world`, it is drawable through `at`: its
   * `ShotView` snapshot is the muzzle-born instance at `spawnTick − k`, so at any later tick it stands
   * exactly where the server's fast-forwarded instance (born at `spawnTick`, advanced `k`) does.
   */
  add(p: Provisional, world?: ShotWorld): void {
    this.live.push(p);
    if (!world) return;
    const k = p.instance.lifeOffsetTicks ?? 0;
    this.view.update(p.key, p.spawnTick - k, p.instance, {
      dt: DT,
      tick: p.spawnTick - k,
      obstacles: world.obstacles,
      bounds: world.bounds,
      ownerPose: null,
      homingTarget: null,
    });
  }

  /**
   * Server instances seen this frame. A provisional with the same owner and weapon whose `spawnTick`
   * is within `provisionalShotMatchTicks` of the instance's is confirmed and removed; returns the
   * pairs. Each server instance is considered on the first call that lists it and never again, and
   * confirms at most one provisional (one pellet each); among several candidates the nearest tick
   * wins, then the nearest heading, then the oldest. With `drawTick`, each pair carries where the
   * provisional stood at that tick, for the hand-over.
   */
  confirm(serverInstances: readonly ServerShot[], drawTick?: number): Confirmed[] {
    const window = NET_CONFIG.provisionalShotMatchTicks;
    const out: Confirmed[] = [];
    const seen = new Set<string>();
    for (const s of serverInstances) {
      seen.add(s.id);
      if (this.seen.has(s.id) || s.isExplosion || this.live.length === 0) continue;
      let best = -1;
      let bestTicks = Infinity;
      let bestTurn = Infinity;
      for (let i = 0; i < this.live.length; i++) {
        const p = this.live[i]!;
        if (p.ownerId !== s.ownerSessionId || p.instance.weaponId !== s.weaponId) continue;
        const ticks = Math.abs(p.spawnTick - s.spawnTick);
        if (ticks > window) continue;
        const turn = s.angle === undefined ? 0 : Math.abs(Math.atan2(Math.sin(s.angle - p.instance.angle), Math.cos(s.angle - p.instance.angle)));
        if (ticks < bestTicks || (ticks === bestTicks && turn < bestTurn - 1e-9)) {
          best = i;
          bestTicks = ticks;
          bestTurn = turn;
        }
      }
      if (best < 0) continue;
      const p = this.live[best]!;
      const pair: Confirmed = { provisionalKey: p.key, serverId: s.id };
      if (drawTick !== undefined) {
        const at = this.at(p.key, drawTick);
        if (at) pair.from = { x: at.x, y: at.y };
      }
      this.live.splice(best, 1);
      this.view.forget(p.key);
      out.push(pair);
    }
    this.seen = seen;
    return out;
  }

  /** Drop provisionals older than `ttlMs`; returns their keys. */
  expire(nowMs: number, ttlMs: number): string[] {
    const gone: string[] = [];
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      if (nowMs - p.bornAtMs < ttlMs) continue;
      gone.push(p.key);
      this.live.splice(i, 1);
      this.view.forget(p.key);
    }
    return gone;
  }

  list(): readonly Provisional[] {
    return this.live;
  }

  /**
   * Where provisional `key` is drawn at (fractional) `tick`, or undefined when it is not drawn there
   * (past its range, lifetime or wall end — the server's own end rules, through `ShotView`). Never
   * drawn before the tick its `ShotView` snapshot stands on: a press drawn the frame it is made, at a
   * draw tick a fraction behind its spawn tick, sits at that snapshot (the muzzle for an
   * uncompensated press). The returned record is reused; copy it.
   */
  at(key: string, tick: number, ownerPose?: OwnerPose): Readonly<ShotPose> | undefined {
    const p = this.live.find((q) => q.key === key);
    const floor = p ? p.spawnTick - (p.instance.lifeOffsetTicks ?? 0) : tick;
    return this.view.at(key, Math.max(tick, floor), ownerPose);
  }

  /**
   * An unconfirmed provisional's opacity: 1, then down to 0 over the last `provisionalShotFadeMs`
   * of its `ttlMs`.
   */
  alpha(p: Provisional, nowMs: number, ttlMs: number): number {
    const left = ttlMs - (nowMs - p.bornAtMs);
    const fade = NET_CONFIG.provisionalShotFadeMs;
    return fade <= 0 ? (left > 0 ? 1 : 0) : Math.max(0, Math.min(1, left / fade));
  }

  /**
   * Start easing confirmed instance `serverId` from where its provisional was drawn (`from`) to where
   * it is drawn (`to`): the gap is added to the instance's drawn pose and closes linearly over
   * `provisionalShotEaseMs`.
   */
  beginHandover(serverId: string, from: { x: number; y: number }, to: { x: number; y: number }, nowMs: number): void {
    this.handovers.set(serverId, { dx: from.x - to.x, dy: from.y - to.y, startMs: nowMs });
  }

  /** `pose` (an instance's drawn pose) with its hand-over gap still left at `nowMs` added. */
  applyHandover(serverId: string, pose: { x: number; y: number }, nowMs: number): void {
    const h = this.handovers.get(serverId);
    if (!h) return;
    const left = 1 - (nowMs - h.startMs) / NET_CONFIG.provisionalShotEaseMs;
    if (left <= 0) {
      this.handovers.delete(serverId);
      return;
    }
    pose.x += h.dx * left;
    pose.y += h.dy * left;
  }

  /** Forget the hand-over of every instance not in `live`. */
  forgetHandoversBut(live: ReadonlySet<string>): void {
    for (const id of this.handovers.keys()) if (!live.has(id)) this.handovers.delete(id);
  }

  clear(): void {
    for (const p of this.live) this.view.forget(p.key);
    this.live.length = 0;
    this.seen.clear();
    this.handovers.clear();
  }
}

/**
 * How far past its `ShotView` snapshot a provisional may be flown: the enemy-shot cap plus the most
 * shot compensation it can carry, since its snapshot stands `k` ticks behind its spawn tick. Past
 * it, the shot holds; an unconfirmed one is gone by `rtt + provisionalShotGraceMs` anyway.
 */
export function provisionalViewMaxTicks(): number {
  return shotViewMaxTicks() + msToTicks(NET_CONFIG.shotCompCapMs);
}

/**
 * The client's own shot compensation for a press on `pressTick` (NR39): the same `pressTick − viewTick`
 * the server prices from (NR36), clamped to `capTicks`. The server may clamp lower (its link-measured
 * `allowedTicks`); the hand-over ease covers that difference. 0 without a `viewTick`, as on the server.
 */
export function clientCompTicks(pressTick: number, viewTick: number | undefined): number {
  if (viewTick === undefined) return 0;
  return Math.max(0, Math.min(pressTick - viewTick, msToTicks(NET_CONFIG.shotCompCapMs)));
}

/**
 * A released order's provisional instances (one per pellet per muzzle), born by `spawnInstances` from
 * the shooter's predicted pose on `tick` and aged `compTicks` with the server's own `bornOlder`.
 */
export function provisionalOf(
  order: ShotOrder,
  owner: { sessionId: string; team: 0 | 1; carId: string } & OwnerPose,
  tick: number,
  compTicks: number,
  keyPrefix: string,
  nowMs: number,
  world?: ShotWorld,
): Provisional[] {
  const def = weaponDefOf(order.weaponId);
  if (def.kind === "maneuver") return [];
  const { instances } = spawnInstances(order, owner, tick, 0, 1, "", def, world);
  return instances.map((born, i) => ({
    key: `${keyPrefix}-${i}`,
    ownerId: owner.sessionId,
    slot: order.slot,
    spawnTick: tick,
    instance: compTicks > 0 ? bornOlder(born, compTicks) : { ...born, lifeOffsetTicks: 0 },
    bornAtMs: nowMs,
  }));
}

// --- the shooter's fire state ---------------------------------------------------------------------

/** One weapon slot as the local player's networked row carries it (`WeaponSlotState`). */
export interface SlotView {
  weaponId: string;
  stocks: number;
  rechargeEndsTick: number;
  refireLockUntilTick: number;
}

/** The local player's networked fire fields at snapshot `tick`. */
export interface FireView {
  tick: number;
  weapons: ArrayLike<SlotView>;
  switchLockUntilTick: number;
  pendingUntilTick: number;
  lastFiredSlot: number;
  level: number;
  turretAngle: number;
}

/**
 * The sim's `FireState` at a snapshot, or undefined when it cannot be rebuilt from the wire: a press
 * is mid-flight there (`pendingUntilTick` past the snapshot — how many volleys are left, and its
 * shot compensation, are server-only), or a slot names a weapon this build does not know.
 */
export function fireStateOf(view: FireView): FireState | undefined {
  if (view.pendingUntilTick > view.tick) return undefined;
  const slots: FireState["slots"] = [];
  for (let i = 0; i < view.weapons.length; i++) {
    const w = view.weapons[i]!;
    if (!isWeaponId(w.weaponId)) return undefined;
    slots.push({ weaponId: w.weaponId, stocks: w.stocks, rechargeEndsTick: w.rechargeEndsTick, refireLockUntilTick: w.refireLockUntilTick });
  }
  return {
    slots,
    switchLockUntilTick: view.switchLockUntilTick,
    lastFiredSlot: view.lastFiredSlot,
    pending: null,
    level: view.level,
    turretAngle: view.turretAngle,
  };
}

/** One predicted tick of the shooter, as `runCombat` would see it on the server. */
export interface FireFrame {
  tick: number;
  /** Raw held slot bits, as sent (`InputFrame.fireSlots`); the press edge is found here, as the server does. */
  mask: number;
  aimAngle?: number;
  /** The car's heading at the end of the tick (after driving — `runCombat` runs after `stepSim`). */
  carAngle: number;
  viewTick?: number;
  disarmed: boolean;
  weaponCooldown: number;
  /** Is the car mid-maneuver at the end of the tick? Then `runCombat` masks maneuver and hold presses out. */
  maneuvering: boolean;
}

export interface FireStep {
  orders: ShotOrder[];
  /** The shot compensation the released orders' press froze (`PendingFire.compTicks`). */
  compTicks: number;
}

const NO_STEP: FireStep = { orders: [], compTicks: 0 };

/**
 * The shooter's own fire state, predicted (NR39). Each predicted tick runs the server's per-tick fire
 * order — `tickRecharge -> beginFire -> turnTurret -> releaseShots`, the shared functions — so a
 * press is predicted to fire exactly when the server's gates would let it (stock, refire and switch
 * locks, nothing pending, the mode's basic-attack switch, `unlocksAt`, the highest-slot tie rule) and
 * its shots are released on the tick the server releases them (wind-up and volley gaps included).
 *
 * It is reseeded from the networked slots whenever the two cannot disagree about a press in flight —
 * nothing pending in the snapshot or locally, and no local press after the snapshot — and the frames
 * after the snapshot are replayed on top. Between reseeds it runs on its own, so a second press
 * before the server has answered the first is gated by the first. A press the server refuses anyway
 * (a status the client had not seen, a lost input) costs one provisional shot that is never
 * confirmed, gone after `rtt + provisionalShotGraceMs`.
 */
export class LocalFire {
  private state: FireState | undefined;
  private prevMask = 0;
  private lastTick = Number.NEGATIVE_INFINITY;
  private lastPressTick = Number.NEGATIVE_INFINITY;
  /** Frames stepped since the newest snapshot, oldest first: replayed over a reseed. */
  private frames: FireFrame[] = [];
  /** The held mask of the newest frame at or before the newest snapshot (the server's `prevFireMasks`). */
  private maskAtSnapshot = 0;

  constructor(private readonly sessionId: string) {}

  /** A snapshot of the local player arrived: prune, and reseed if nothing is in flight. */
  resync(view: FireView): void {
    while (this.frames.length > 0 && this.frames[0]!.tick <= view.tick) this.maskAtSnapshot = this.frames.shift()!.mask;
    const inFlight = this.state !== undefined && (this.state.pending !== null || this.lastPressTick > view.tick);
    if (inFlight) return;
    const seed = fireStateOf(view);
    if (!seed) return;
    this.state = seed;
    this.prevMask = this.maskAtSnapshot;
    let tick = view.tick;
    for (const f of this.frames) {
      this.fill(tick, f.tick);
      this.advance(f);
      tick = f.tick;
    }
    this.lastTick = Math.max(tick, this.lastTick);
  }

  /** Step one predicted tick; the orders it releases ON that tick, with their compensation. */
  step(frame: FireFrame): FireStep {
    if (!(frame.tick > this.lastTick)) return NO_STEP;
    this.frames.push(frame);
    if (this.frames.length > FRAME_CAP) this.frames.shift();
    if (!this.state) {
      this.lastTick = frame.tick;
      return NO_STEP;
    }
    if (Number.isFinite(this.lastTick)) this.fill(this.lastTick, frame.tick);
    this.lastTick = frame.tick;
    return this.advance(frame);
  }

  clear(): void {
    this.state = undefined;
    this.prevMask = 0;
    this.lastTick = Number.NEGATIVE_INFINITY;
    this.lastPressTick = Number.NEGATIVE_INFINITY;
    this.frames = [];
    this.maskAtSnapshot = 0;
  }

  /** Ticks with no frame between `from` and `to` (exclusive): the server repeats the held keys — no press. */
  private fill(from: number, to: number): void {
    if (to - from > FRAME_CAP) {
      this.state = undefined;
      return;
    }
    for (let t = from + 1; t < to && this.state; t++) {
      this.state = tickRecharge(this.state, t);
      this.state = releaseShots(this.state, t).state;
    }
  }

  private advance(f: FireFrame): FireStep {
    let state = this.state;
    if (!state) return NO_STEP;
    // `serverTick`: only a bit that was not down on the previous simulated input is a press.
    const pressed = f.mask & ~this.prevMask;
    this.prevMask = f.mask;
    state = tickRecharge(state, f.tick, f.weaponCooldown);
    if (!f.disarmed) {
      const before = state.pending;
      const blocked = f.maneuvering ? maneuverSlotMask(state) : 0;
      state = beginFire(this.sessionId, state, pressed & ~blocked, f.tick, f.aimAngle ?? null, f.carAngle);
      const pending = state.pending;
      if (pending !== null && before === null) {
        this.lastPressTick = f.tick;
        const comp = clientCompTicks(f.tick, f.viewTick);
        if (comp > 0) state = { ...state, pending: { ...pending, compTicks: comp } };
      }
    }
    state = turnTurret(state, f.carAngle, f.tick);
    const compTicks = state.pending?.compTicks ?? 0;
    const released = releaseShots(state, f.tick, f.weaponCooldown);
    this.state = released.state;
    return { orders: released.orders, compTicks };
  }
}

/** How many frames `LocalFire` keeps for a replay: any input lead plus a second of snapshot silence. */
const FRAME_CAP = msToTicks(NET_CONFIG.maxInputLeadMs + 1000);
