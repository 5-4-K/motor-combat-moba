import {
  TICK_RATE_HZ,
  drive,
  weaponDefOf,
  weaponTicksOf,
  type WeaponId,
} from "@motor-combat-moba/shared";
import type { BotProfile } from "../../config/bot-profiles.js";
import type { BotCarView, BotView } from "../types.js";
import { signedDelta } from "./aim.js";

/**
 * How wide a shot's path must miss by to be ignored: the car's own half-diagonal, plus slack.
 * Computed per call, not hoisted to module scope — the hull is mode-invariant today, but the
 * accessor must still be read live rather than captured once at import time.
 */
function threatLateralUnits(): number {
  const d = drive();
  return Math.hypot(d.carWidth, d.carHeight) / 2 + 16;
}

export interface KnownCar {
  car: BotCarView;
  firstSeenTick: number;
  /** The tick this car actually registers — `firstSeenTick + acquireTicks` (TF2 recognition time). */
  noticedAtTick: number;
  lastSeenTick: number;
  /**
   * The pose before the current one, so turn rate is observable (P18).
   *
   * A person watching a car sees it rotating; they do not see its `angVel` field, and `BotCarView`
   * deliberately does not carry one. Differencing two observed angles is the honest reconstruction.
   */
  previous: { angle: number; tick: number } | undefined;
}

export interface KnownThreat {
  id: string;
  ownerSessionId: string;
  weaponId: WeaponId;
  noticedAtTick: number;
  /** When the bot's hands may move about it — `noticedAtTick + dodgeReactionTicks`. */
  reactAtTick: number;
  /** Whether the shot was far enough away to react to (BB19): its ETA exceeded `dodgeReactionTicks` when first noticed. */
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
  /**
   * `${sessionId}:${weaponId}` -> the tick that press was watched (H22, P21).
   *
   * EVERY weapon, not only ults — the old name `ultSeenTick` said otherwise and was wrong about its
   * own contents. `seenWeapons` lists a car's entries; `readinessOf` reads one weapon's age.
   */
  firedSeenTick: Map<string, number>;
  /** sessionId -> the last tick a shot of theirs was seen coming at us. Drives vengefulness (H23). */
  blameTick: Map<string, number>;
}

export function newPerception(): PerceptionState {
  return { cars: new Map(), threats: new Map(), firedSeenTick: new Map(), blameTick: new Map() };
}

/**
 * One tick of taking the world in. Mutates and returns `state` — perception is the bot's memory, and
 * copying it every tick for six bots at 60 Hz buys nothing.
 *
 * Draws no random numbers: whether a shot is reacted to is a timing fact (BB19), not a roll.
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
      existing.previous = { angle: existing.car.angle, tick: existing.lastSeenTick };
      existing.car = car;
      existing.lastSeenTick = tick;
    } else {
      state.cars.set(car.sessionId, {
        car,
        firstSeenTick: tick,
        noticedAtTick: tick + profile.acquireTicks,
        lastSeenTick: tick,
        previous: undefined,
      });
    }
  }

  for (const [sessionId, known] of state.cars) {
    if (tick - known.lastSeenTick > profile.memoryTicks) state.cars.delete(sessionId);
  }

  for (const fire of view.observedFires) {
    if (fire.shooterSessionId === self.sessionId) continue;
    state.firedSeenTick.set(`${fire.shooterSessionId}:${fire.weaponId}`, fire.tick);
  }

  const live = new Set<string>();
  for (const instance of view.instances) {
    if (instance.ownerSessionId === self.sessionId) continue;
    const away = threatHeading(self, instance, profile);
    if (away === undefined) continue;
    live.add(instance.id);
    state.blameTick.set(instance.ownerSessionId, tick);
    const existing = state.threats.get(instance.id);
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
      reacting: threatEtaTicks(self, instance) > profile.dodgeReactionTicks,
      awayHeadingRad: away,
    });
  }
  for (const id of [...state.threats.keys()]) {
    if (!live.has(id)) state.threats.delete(id);
  }

  return state;
}

/** Ticks until this shot reaches the bot (BB19). A weapon with no travel speed arrives at once. */
export function threatEtaTicks(
  self: { x: number; y: number },
  instance: { x: number; y: number; weaponId: WeaponId },
): number {
  const speed = weaponDefOf(instance.weaponId).speed;
  if (speed <= 0) return 0;
  return (Math.hypot(self.x - instance.x, self.y - instance.y) / speed) * TICK_RATE_HZ;
}

/**
 * How fast this car was observed to be turning, radians per second, or 0 when unknown (P18).
 *
 * `signedDelta` rather than a raw subtraction: a car crossing the +-pi seam differs by nearly 2*pi
 * in raw terms, which would read as a violent spin and send every prediction built on it sideways.
 */
export function observedAngVelOf(state: PerceptionState, sessionId: string): number {
  const known = state.cars.get(sessionId);
  if (!known?.previous) return 0;
  const ticks = known.lastSeenTick - known.previous.tick;
  if (ticks <= 0) return 0;
  return (signedDelta(known.previous.angle, known.car.angle) * TICK_RATE_HZ) / ticks;
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
    x: known.car.x + known.car.vx * dt,
    y: known.car.y + known.car.vy * dt,
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
  instances: BotView["instances"],
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

/** Threats the bot had time to react to (BB19) and whose reaction delay has now elapsed. */
export function activeThreats(state: PerceptionState, tick: number): KnownThreat[] {
  return [...state.threats.values()].filter((t) => t.reacting && tick >= t.reactAtTick);
}

/**
 * The weapons this car has been seen firing (`firedSeenTick`, keyed `session:weapon`), which widen
 * what the bot believes its kit reaches (BB44). Lives beside the map because it parses its key.
 */
export function seenWeapons(state: PerceptionState, sessionId: string | undefined): WeaponId[] {
  if (!sessionId) return [];
  const prefix = `${sessionId}:`;
  const out: WeaponId[] = [];
  for (const key of state.firedSeenTick.keys()) {
    if (key.startsWith(prefix)) out.push(key.slice(prefix.length) as WeaponId);
  }
  return out;
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
  if (Math.hypot(missX, missY) > threatLateralUnits()) return undefined;

  const perp = Math.atan2(vy, vx) + Math.PI / 2;
  const cross = vx * ry - vy * rx;
  return cross >= 0 ? perp : perp + Math.PI;
}

/**
 * How loaded this bot BELIEVES an opponent's weapon is (P21), 0..1.
 *
 * Built only from the press log — a human tracks availability approximately, which the user's
 * fairness ruling calls fair, and `BotCarView` deliberately carries no slot state so there is
 * nothing else to read. Two ways this is honestly wrong, both of them the point: a press seen
 * through a shorter `memoryTicks` is forgotten and the gun is assumed loaded, and a press never
 * logged at all is assumed loaded.
 *
 * What it is NOT is viewport-filtered. `buildBotView` applies the fairness filter to `others` and
 * `instances` only; `observedFires` passes through verbatim, and `perceive` records every non-self
 * fire unconditionally — so a press made across the map, out of sight, still reaches this function.
 * That leak predates this work: `seenWeapons` reads the same unfiltered log. It is moot on both
 * shipped arenas, which fit inside the viewport. Closing it means filtering at the seam, which is a
 * behaviour change, not a comment fix.
 */
export function readinessOf(
  state: PerceptionState,
  sessionId: string,
  weaponId: WeaponId,
  tick: number,
  profile: BotProfile,
): number {
  const seen = state.firedSeenTick.get(`${sessionId}:${weaponId}`);
  if (seen === undefined) return 1;
  const since = tick - seen;
  if (since > profile.memoryTicks) return 1;
  const cooldown = weaponTicksOf(weaponId).cooldown;
  // Unreachable on today's roster — the shortest `cooldownMs` is 1000 (30 ticks) — and kept only so
  // a future zero-cooldown row cannot turn the division below into `0 / 0` -> NaN (R-C-M2).
  if (cooldown <= 0) return 1;
  return Math.min(1, since / cooldown);
}
