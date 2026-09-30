/**
 * A headless match, driven through the EXACT pipeline `ArenaRoom.tick` runs:
 *
 *     statusTick -> serverTick -> contactTick -> runCombat (via the combat bridge)
 *
 * No Colyseus room, no sockets, no wall clock — but the same `ArenaState`, the same bridges, and
 * the same shared `dist` the LAN server bundles. Anything this reproduces, a real room reproduces.
 *
 * It exists so a scenario can be *placed*: cars at exact poses, at exact speeds, on an exact tick.
 * Driving a car into a corner case through the lobby and 3 seconds of countdown is not a test, it
 * is a coincidence waiting to not happen.
 */
import {
  ArenaState,
  DRIVE_CONFIG,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  TICK_RATE_HZ,
  boundsOf,
  getArena,
  hpOf,
  speedOf,
  toWorld,
  newTickInputBuffer,
  type CarId,
  type InputKeys,
  type TickInputBuffer,
} from "@motor-combat-moba/shared";
import { offerForTick } from "../../src/net/offer-input.js";
import { serverTick } from "../../src/sim/tick.js";
import { statusTick } from "../../src/sim/status-bridge.js";
import {
  contactTick,
  newContactMemory,
  type ContactMemory,
  type ContactTickResult,
} from "../../src/sim/ram-bridge.js";
import {
  applyCombatResult,
  newCombatMemory,
  runCombat,
  toCombatPlayers,
  toInstances,
  type CombatMemory,
} from "../../src/sim/combat-bridge.js";

export const DT = 1 / TICK_RATE_HZ;

export interface SpawnSpec {
  id: string;
  carId: CarId;
  x: number;
  y: number;
  angle: number;
  team?: 0 | 1;
  speed?: number;
  hp?: number;
}

/** The neutral input: no steer, no throttle, no fire. */
export const IDLE: InputKeys = { steer: 0, throttle: 0, fireSlots: 0 };

export class PlaytestWorld {
  readonly state = new ArenaState();
  /**
   * Mirrors `ArenaRoom.inputBuffers`: each player's inputs keyed by the tick they are for (NR22).
   * `serverTick` takes one per player per tick. A player a probe did not feed this tick runs the
   * buffer's fill — its last input repeated for `inputRepeatMs`, then neutral — exactly as a room's
   * car does when its owner's frame is late; it is no longer left unstepped.
   */
  readonly buffers = new Map<string, TickInputBuffer>();
  /**
   * Mirrors `ArenaRoom.prevFireMasks`: what each player's last simulated input had held down, so
   * `serverTick` can tell a press from a held key. A probe that presses on one tick and holds
   * thereafter fires ONCE — set the mask back to 0 on a tick to release the trigger.
   */
  readonly prevFireMasks = new Map<string, number>();
  readonly roster = new Set<string>();
  private combat: CombatMemory = newCombatMemory();
  private ram: ContactMemory = newContactMemory();

  constructor(
    spawns: readonly SpawnSpec[],
    readonly mode: "ffa" | "team" = "ffa",
    arenaId = "arena-01",
  ) {
    this.state.arenaId = arenaId;
    this.state.phase = RoomPhase.MATCH;
    this.state.mode = mode === "team" ? 1 : 0;
    for (const spec of spawns) this.add(spec);
  }

  add(spec: SpawnSpec): PlayerState {
    const p = new PlayerState();
    p.sessionId = spec.id;
    p.name = spec.id;
    p.carId = spec.carId;
    p.team = spec.team ?? 0;
    p.status = PlayerStatus.IN_MATCH;
    p.alive = true;
    p.hp = spec.hp ?? hpOf(spec.carId);
    p.x = spec.x;
    p.y = spec.y;
    p.angle = spec.angle;
    // `SpawnSpec.speed` has always meant "forward speed along the spawned heading" — every probe
    // calls it with `forwardMaxSpeedOf(carId)` or a plain forward magnitude, never a lateral one —
    // so it becomes a `toWorld` at zero lateral rather than a bare `vx`/`vy` split.
    const v = toWorld(spec.angle, spec.speed ?? 0, 0);
    p.vx = v.vx;
    p.vy = v.vy;
    // `authority` has no successor in stage 1 (ram control-loss returns as a `reeling` status in
    // stage 3b); the schema default of vx = vy = 0 already covers the "no motion" reset this used to
    // pair with, so nothing here replaces it.
    this.state.players.set(spec.id, p);
    this.buffers.set(spec.id, newTickInputBuffer());
    this.roster.add(spec.id);
    return p;
  }

  get(id: string): PlayerState {
    const p = this.state.players.get(id);
    if (!p) throw new Error(`no player ${id}`);
    return p;
  }

  /**
   * Offer this player's input for the NEXT tick (NR27, lead 0). One per tick: a second call before
   * the tick runs is a duplicate for the same tick and is dropped, exactly as the room drops one.
   */
  input(id: string, msg: Partial<InputKeys> = {}): void {
    const buffer = this.buffers.get(id);
    if (buffer) offerForTick(buffer, this.state.tick + 1, { ...IDLE, ...msg });
  }

  /** Live weapon instances, straight out of room memory (the schema is only a projection of it). */
  instances(): ReturnType<typeof toInstances> {
    return toInstances(this.combat);
  }

  /** One tick, in `ArenaRoom.tick`'s order. */
  tick(): void {
    this.state.tick += 1;
    const statusMods = statusTick(this.state, this.state.tick);
    const { masks, approachVelocities } = serverTick(
      this.state,
      this.buffers,
      DT,
      this.state.phase,
      statusMods,
      this.prevFireMasks,
    );
    let contact: ContactTickResult = { contactHits: [], statusRequests: [], spikeHits: [] };
    if (this.state.phase === RoomPhase.MATCH && this.roster.size > 0) {
      contact = contactTick(
        this.state,
        this.roster,
        this.ram,
        this.mode,
        statusMods,
        approachVelocities,
        this.combat.maneuverWeapons,
        this.state.tick,
      );
    }
    if (this.state.phase !== RoomPhase.MATCH || this.roster.size === 0) return;

    const arena = getArena(this.state.arenaId);
    const result = runCombat({
      world: {
        tick: this.state.tick,
        dt: DT,
        mode: this.mode,
        obstacles: arena.obstacles,
        bounds: boundsOf(arena),
      },
      players: toCombatPlayers(this.state, this.roster, masks, this.combat),
      instances: toInstances(this.combat),
      instanceSeq: this.combat.instanceSeq,
      contactHits: contact.contactHits,
      spikeHits: contact.spikeHits,
      statusRequests: contact.statusRequests,
    });
    applyCombatResult(this.state, result, this.combat);
    this.combat.instanceSeq = result.instanceSeq;
  }

  /** `n` ticks, calling `each` after every one. */
  run(n: number, each?: (tick: number) => void): void {
    for (let i = 0; i < n; i++) {
      this.tick();
      each?.(this.state.tick);
    }
  }

  /** Every player's pose, for a one-line snapshot in a report. */
  poses(): Record<string, { x: number; y: number; angle: number; speed: number; hp: number }> {
    const out: Record<string, { x: number; y: number; angle: number; speed: number; hp: number }> = {};
    this.state.players.forEach((p, id) => {
      // Unsigned magnitude: this is a generic snapshot with no fixed frame of reference, unlike the
      // scenario-specific reads elsewhere in these probes that pick `forwardOf`/`lateralOf` for a
      // reason.
      out[id] = { x: p.x, y: p.y, angle: p.angle, speed: speedOf(p.vx, p.vy), hp: p.hp };
    });
    return out;
  }
}

/** Hull overlap depth between two cars, in world units. 0 when they are apart. */
export function overlapDepth(
  a: { x: number; y: number; angle: number },
  b: { x: number; y: number; angle: number },
): number {
  // Cheap conservative measure: the deepest penetration along either box's face normals.
  const depthOn = (axis: { x: number; y: number }): number => {
    const spanA = project(a, axis);
    const spanB = project(b, axis);
    return Math.min(spanA.max - spanB.min, spanB.max - spanA.min);
  };
  const axes = [...facesOf(a), ...facesOf(b)];
  let min = Infinity;
  for (const axis of axes) min = Math.min(min, depthOn(axis));
  return min <= 0 ? 0 : min;
}

// STALE FIXED at 48x32 until this fix: the 2026-09-16 hull resize made every car 60x40, and
// `overlapDepth`/`project` below were still measuring the pre-resize hull, undercounting every
// overlap this file reports by up to 12u in width and 8u in height. Derived from `DRIVE_CONFIG` now
// so it cannot drift from the hull it describes again.
const CAR_W = DRIVE_CONFIG.carWidth;
const CAR_H = DRIVE_CONFIG.carHeight;

function facesOf(o: { angle: number }): { x: number; y: number }[] {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  return [
    { x: c, y: s },
    { x: -s, y: c },
  ];
}

function project(
  o: { x: number; y: number; angle: number },
  axis: { x: number; y: number },
): { min: number; max: number } {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const hw = CAR_W / 2;
  const hh = CAR_H / 2;
  let min = Infinity;
  let max = -Infinity;
  for (const [lx, ly] of [
    [hw, hh],
    [-hw, hh],
    [-hw, -hh],
    [hw, -hh],
  ] as const) {
    const px = o.x + lx * c - ly * s;
    const py = o.y + lx * s + ly * c;
    const d = px * axis.x + py * axis.y;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

/**
 * A player's live statuses as plain rows. `ArraySchema` spreads to `T | undefined` under strict
 * mode, so every probe would otherwise repeat the same non-null dance.
 */
export function statusesOf(player: PlayerState): { statusId: string; startTick: number; endsTick: number }[] {
  const out: { statusId: string; startTick: number; endsTick: number }[] = [];
  player.statuses.forEach((s) => {
    out.push({ statusId: s.statusId, startTick: s.startTick, endsTick: s.endsTick });
  });
  return out;
}
