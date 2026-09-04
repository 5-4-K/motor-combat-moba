import { DRIVE_CONFIG, TICK_RATE_HZ, weaponDefOf, type WeaponId } from "@motor-combat-moba/shared";
import type { BotProfile } from "../../config/bot-profiles.js";
import type { BotCarView, BotView } from "../types.js";
import { signedDelta } from "./aim.js";

/** How wide a shot's path must miss by to be ignored: the car's own half-diagonal, plus slack. */
const THREAT_LATERAL_UNITS = Math.hypot(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight) / 2 + 16;

export interface KnownCar {
  car: BotCarView;
  firstSeenTick: number;
  /** The tick this car actually registers — `firstSeenTick + acquireTicks` (TF2 recognition time). */
  noticedAtTick: number;
  lastSeenTick: number;
}

export interface KnownThreat {
  id: string;
  ownerSessionId: string;
  weaponId: WeaponId;
  noticedAtTick: number;
  /** When the bot's hands may move about it — `noticedAtTick + dodgeReactionTicks`. */
  reactAtTick: number;
  /** The result of this threat's ONE `dodgeChance` roll. Re-rolling per tick would dodge everything. */
  reacting: boolean;
  /** A heading that takes the car off this shot's line. */
  awayHeadingRad: number;
}

/**
 * What the bot has actually noticed (H7).
 *
 * `buildBotView` already answers "what may this bot see"; this answers "what has it taken in". The
 * two are different questions and the second is where a casual differs from a pro.
 */
export interface PerceptionState {
  cars: Map<string, KnownCar>;
  threats: Map<string, KnownThreat>;
  /** `${sessionId}:${weaponId}` -> the tick that press was watched (H22). */
  ultSeenTick: Map<string, number>;
  /** sessionId -> the last tick a shot of theirs was seen coming at us. Drives vengefulness (H23). */
  blameTick: Map<string, number>;
}

export function newPerception(): PerceptionState {
  return { cars: new Map(), threats: new Map(), ultSeenTick: new Map(), blameTick: new Map() };
}

/**
 * One tick of taking the world in. Mutates and returns `state` — perception is the bot's memory, and
 * copying it every tick for six bots at 30 Hz buys nothing.
 *
 * Draws no random numbers except the ONE `dodgeChance` roll per newly-noticed threat, which is drawn
 * unconditionally for stream alignment (H21) and discarded when the threat is already known.
 */
export function perceive(
  state: PerceptionState,
  view: BotView,
  profile: BotProfile,
): PerceptionState {
  const tick = view.tick;
  const self = view.self;

  for (const car of view.others) {
    if (!visible(self, car, profile)) continue;
    const existing = state.cars.get(car.sessionId);
    if (existing) {
      existing.car = car;
      existing.lastSeenTick = tick;
    } else {
      state.cars.set(car.sessionId, {
        car,
        firstSeenTick: tick,
        noticedAtTick: tick + profile.acquireTicks,
        lastSeenTick: tick,
      });
    }
  }

  for (const [sessionId, known] of state.cars) {
    if (tick - known.lastSeenTick > profile.memoryTicks) state.cars.delete(sessionId);
  }

  for (const fire of view.observedFires) {
    if (fire.shooterSessionId === self.sessionId) continue;
    state.ultSeenTick.set(`${fire.shooterSessionId}:${fire.weaponId}`, fire.tick);
  }

  const live = new Set<string>();
  for (const instance of view.instances) {
    if (instance.ownerSessionId === self.sessionId) continue;
    const away = threatHeading(self, instance, profile);
    if (away === undefined) continue;
    live.add(instance.id);
    state.blameTick.set(instance.ownerSessionId, tick);
    const existing = state.threats.get(instance.id);
    // Drawn every time, used only for a new threat: a conditional draw makes the stream depend on
    // the branch, and one seed would stop replaying (H21).
    const roll = view.rng();
    if (existing) {
      existing.awayHeadingRad = away;
      continue;
    }
    if (state.threats.size >= profile.trackedThreatLimit) continue;
    state.threats.set(instance.id, {
      id: instance.id,
      ownerSessionId: instance.ownerSessionId,
      weaponId: instance.weaponId,
      noticedAtTick: tick,
      reactAtTick: tick + profile.dodgeReactionTicks,
      reacting: roll < profile.dodgeChance,
      awayHeadingRad: away,
    });
  }
  for (const id of [...state.threats.keys()]) {
    if (!live.has(id)) state.threats.delete(id);
  }

  return state;
}

/** Cars the bot has actually registered — past the acquire delay, still inside memory. */
export function knownCars(state: PerceptionState, tick: number): BotCarView[] {
  const out: BotCarView[] = [];
  for (const known of state.cars.values()) {
    if (tick >= known.noticedAtTick) out.push(known.car);
  }
  // Sorted for the same reason `buildBotView` sorts: a tie must break identically every replay.
  out.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
  return out;
}

/** A visible car that has not registered yet — acquire delay, not a hunt (G13). */
export function acquiringUnnoticed(state: PerceptionState, tick: number): boolean {
  for (const known of state.cars.values()) {
    if (tick < known.noticedAtTick) return true;
  }
  return false;
}

/** Where a remembered car is expected to be, coasting on last seen velocity (G12). */
export function predictedPose(known: KnownCar, tick: number): { x: number; y: number } {
  const dt = (tick - known.lastSeenTick) / TICK_RATE_HZ;
  return {
    x: known.car.x + Math.cos(known.car.angle) * known.car.speed * dt,
    y: known.car.y + Math.sin(known.car.angle) * known.car.speed * dt,
  };
}

/**
 * Predicted pose of the most recently seen noticed car, or undefined when memory is empty.
 *
 * Phased cars still count: a human sees the respawn. Unnoticed cars (acquire delay) do not — using
 * them would skip G13.
 */
export function lastKnownAnchor(
  state: PerceptionState,
  tick: number,
): { x: number; y: number } | undefined {
  let best: KnownCar | undefined;
  for (const known of state.cars.values()) {
    if (tick < known.noticedAtTick) continue;
    if (!best || known.lastSeenTick > best.lastSeenTick) best = known;
  }
  return best ? predictedPose(best, tick) : undefined;
}

/** Nearest live instance not our own — a shot a human can see even without identifying the car. */
export function nearestHeardShot(
  self: { sessionId: string; x: number; y: number },
  instances: readonly BotView["instances"],
): { x: number; y: number } | undefined {
  let best: { x: number; y: number } | undefined;
  let bestDist = Infinity;
  for (const inst of instances) {
    if (inst.ownerSessionId === self.sessionId) continue;
    const d = Math.hypot(inst.x - self.x, inst.y - self.y);
    if (d < bestDist) {
      bestDist = d;
      best = { x: inst.x, y: inst.y };
    }
  }
  return best;
}

const SEARCH_FRACTIONS = [
  { fx: 0.25, fy: 0.25 },
  { fx: 0.75, fy: 0.25 },
  { fx: 0.75, fy: 0.75 },
  { fx: 0.25, fy: 0.75 },
] as const;

/** One of four quadrant waypoints. Never the arena centre (G12). */
export function searchWaypoint(
  index: number,
  arena: { width: number; height: number },
): { x: number; y: number } {
  const frac = SEARCH_FRACTIONS[((index % 4) + 4) % 4]!;
  return { x: arena.width * frac.fx, y: arena.height * frac.fy };
}

export function searchWaypointCount(): number {
  return SEARCH_FRACTIONS.length;
}

/** Threats the bot both rolled to react to and has had time to react to. */
export function activeThreats(state: PerceptionState, tick: number): KnownThreat[] {
  return [...state.threats.values()].filter((t) => t.reacting && tick >= t.reactAtTick);
}

/**
 * Was this car seen spending this weapon inside the last `withinTicks`? (H22, consumed by G22)
 *
 * `perceive` fills `ultSeenTick` from `observedFires`. `scoreGoals` reads this as a dump bonus so
 * a hard bot presses more boldly when it watched an enemy burn an ultimate.
 */
export function ultIsSpent(
  state: PerceptionState,
  sessionId: string,
  weaponId: WeaponId,
  tick: number,
  withinTicks: number,
): boolean {
  const seen = state.ultSeenTick.get(`${sessionId}:${weaponId}`);
  return seen !== undefined && tick - seen <= withinTicks;
}

/** Ticks since this car was last seen shooting our way, or `Infinity`. */
export function ticksSinceBlame(state: PerceptionState, sessionId: string, tick: number): number {
  const seen = state.blameTick.get(sessionId);
  return seen === undefined ? Infinity : tick - seen;
}

/**
 * Is this car inside the bot's attention at all — near enough, and not behind it?
 *
 * The rear arc is UT's field-of-view gate: Novice sees 30 degrees, Godlike sees 360. Here it is
 * expressed as the arc BEHIND the car that goes unwatched, so 0 means full awareness.
 */
function visible(self: BotView["self"], car: BotCarView, profile: BotProfile): boolean {
  if (!car.alive) return false;
  const dx = car.x - self.x;
  const dy = car.y - self.y;
  if (Math.hypot(dx, dy) > profile.awarenessRadiusUnits) return false;
  if (profile.rearBlindHalfAngleRad <= 0) return true;
  const off = Math.abs(signedDelta(self.angle, Math.atan2(dy, dx)));
  return off < Math.PI - profile.rearBlindHalfAngleRad;
}

/**
 * A heading that takes the car off this shot's line, or `undefined` when the shot is not a threat.
 *
 * The shot is projected along its own heading at its weapon's own speed — both drawn on screen, so
 * reading them is fair (H22). If its closest approach inside `dodgeHorizonTicks` misses by more than
 * a car's half-diagonal, it is ignored.
 */
function threatHeading(
  self: BotView["self"],
  instance: BotView["instances"][number],
  profile: BotProfile,
): number | undefined {
  const def = weaponDefOf(instance.weaponId);
  const horizonSeconds = profile.dodgeHorizonTicks / TICK_RATE_HZ;
  let speed = def.speed;
  // Attached beams aimed at the bot are threats even when authored speed is 0 (G17). Expansion
  // speed is used when present; otherwise the beam's range is covered across the dodge horizon.
  if (speed <= 0) {
    if (def.kind !== "beam" || !def.attached) return undefined;
    speed = def.range / Math.max(horizonSeconds, 1 / TICK_RATE_HZ);
  }

  const vx = Math.cos(instance.angle) * speed;
  const vy = Math.sin(instance.angle) * speed;
  const rx = self.x - instance.x;
  const ry = self.y - instance.y;

  const vv = vx * vx + vy * vy;
  const t = Math.min(Math.max((rx * vx + ry * vy) / vv, 0), horizonSeconds);
  const missX = rx - vx * t;
  const missY = ry - vy * t;
  if (Math.hypot(missX, missY) > THREAT_LATERAL_UNITS) return undefined;

  const perp = Math.atan2(vy, vx) + Math.PI / 2;
  const cross = vx * ry - vy * rx;
  return cross >= 0 ? perp : perp + Math.PI;
}
