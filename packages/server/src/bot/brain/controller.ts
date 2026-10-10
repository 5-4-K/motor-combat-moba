import {
  DEFAULT_GAME_MODE, TICK_RATE_HZ, forwardMaxSpeedOf, hasStatus, wrapAngle,
  type BotDifficulty, type WeaponId,
} from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS, resolveBrainConstants, type BotProfile } from "../../config/bot-profiles.js";
import { botConfigOf, type BotModeConfig } from "../../config/mode-bot.js";
import type { BotCarView, BotController, BotDebug, BotIntent, BotView, SituationId } from "../types.js";
import { newAimErrorState, stepAimError, type AimErrorState } from "./aim.js";
import { applyHumanize, newHumanizeState, type HumanizeState } from "./humanize.js";
import { wallPush, type Push } from "./movement.js";
import { avoidWalls, newNavState, steerToward, type Goal, type NavState } from "./navigate.js";
import {
  activeThreats, acquiringUnnoticed, knownCars, lastKnownAnchor, nearestHeardShot, newPerception,
  observedAngVelOf, perceive, searchWaypoint, type KnownThreat, type PerceptionState,
} from "./perception.js";
import { physicsPredictor, type DriveAction } from "./predict.js";
import { fightRangeOf, ownComfortOf, slotIsReady, usableSlots, type UsableSlot } from "./ranges.js";
import { weaponReachOf } from "./reach.js";
import { chooseShot, type ShotDecision } from "./shooter.js";
import { classifySituation, isIncomingCar, newSituationState, pickSituation, type SituationState } from "./situation.js";
import { readyInTicksOf, solve, type FiringSolution, type PosePredictor } from "./solution.js";
import { chooseTarget } from "./target.js";

const COAST: BotIntent = { steer: 0, throttle: 0, fireSlots: 0 };
const COAST_ACTION: DriveAction = { steer: 0, throttle: 0 };

/** Situations in which a trigger may be pulled (BB41). */
const FIRING_SITUATIONS: ReadonlySet<SituationId> = new Set<SituationId>([
  "evade", "unpin", "punish", "reset", "ram", "fight",
]);

/** Own statuses that take the car out of the bot's hands (BB17). */
const CONTROL_LOST_STATUSES = ["phased", "stunned", "reeling", "ramLock"] as const;

/** Stands in for the target when there is none, so the predictor's four draws still happen (BB14). */
const ABSENT_TARGET: BotCarView = {
  sessionId: "", carId: "bullseye", team: 0, x: 0, y: 0, angle: 0, vx: 0, vy: 0,
  hp: 1, maxHp: 1, alive: false, phased: true, statuses: [], maneuver: 0,
};

interface Facts {
  ownComfort: number;
  fightRange: number;
  distance: number;
  shotThreats: readonly KnownThreat[];
  carIncoming: boolean;
  usable: readonly UsableSlot[];
  wantsNose: boolean;
}

/**
 * The bot (BB1): perceive -> predict -> solve -> assess -> navigate -> shoot -> humanize.
 * Perception, the aim error and the delay line run every tick; the rest on `recomputeTicks`.
 */
export class HumanController implements BotController {
  readonly profileId: BotDifficulty;
  private readonly profile: BotProfile;
  private readonly botConfig: BotModeConfig;
  private fixedTarget: string | undefined;
  private target: string | undefined;
  private heldSinceTick = 0;
  private held: BotIntent = COAST;
  private lastDebug: BotDebug | undefined;
  private aimError: AimErrorState = newAimErrorState();
  private perception: PerceptionState = newPerception();
  private situation: SituationState = newSituationState();
  private nav: NavState = newNavState();
  private humanize: HumanizeState = newHumanizeState();
  private lastPressTick = -999;
  private searchIndex = 0;
  private lastPush: Push | undefined;
  private lastGoal: Goal | undefined;
  private lastShot: ShotDecision | undefined;
  private lastAction: DriveAction = COAST_ACTION;
  private lastFiredSlot: number | undefined;
  /** The last live dodge direction, held while `evade` outlives its threats (BB35). */
  private lastDodge: { x: number; y: number } | undefined;

  constructor(
    profileId: BotDifficulty,
    options: { targetSessionId?: string; profile?: BotProfile; botConfig?: BotModeConfig } = {},
  ) {
    this.profileId = profileId;
    this.botConfig = options.botConfig ?? botConfigOf(DEFAULT_GAME_MODE);
    this.profile = options.profile ?? this.botConfig.profiles[profileId];
    this.fixedTarget = options.targetSessionId;
  }

  get currentTargetSessionId(): string | undefined { return this.target; }
  setTarget(sessionId: string | undefined): void { this.fixedTarget = sessionId; }
  debug(): BotDebug | undefined { return this.lastDebug; }

  decide(view: BotView): BotIntent {
    this.perception = perceive(this.perception, view, this.profile);
    this.aimError = stepAimError(this.aimError, view.tick, this.profile, view.rng);
    if (this.shouldRecompute(view.tick)) this.held = this.plan(view);
    this.lastDebug = {
      tick: view.tick,
      situation: this.situation.current,
      targetSessionId: this.target,
      goalRange: this.lastGoal?.range ?? 0,
      goalFacing: this.lastGoal?.facing ?? "none",
      firedSlot: this.lastFiredSlot,
      bestHitChance: this.lastShot?.bestHitChance ?? 0,
      hitChanceBar: this.profile.hitChanceBar,
      steer: this.lastAction.steer,
      throttle: this.lastAction.throttle,
    };
    return applyHumanize(this.humanize, this.held, this.profile);
  }

  private shouldRecompute(tick: number): boolean {
    const cadence = this.profile.recomputeTicks;
    return cadence <= 1 || tick % cadence === 0;
  }

  /** Hittable cars only (BB18): alive, not phased, noticed. */
  private pickTarget(view: BotView): BotCarView | undefined {
    const hittable = knownCars(this.perception, view.tick).filter((o) => o.alive && !o.phased);
    if (this.fixedTarget !== undefined) return hittable.find((o) => o.sessionId === this.fixedTarget);
    const chosen = chooseTarget({
      self: view.self, candidates: hittable, perception: this.perception, profile: this.profile,
      tick: view.tick, heldTargetId: this.target, heldSinceTick: this.heldSinceTick,
    });
    return hittable.find((o) => o.sessionId === chosen);
  }

  private plan(view: BotView): BotIntent {
    const profile = this.profile;
    const consts = resolveBrainConstants();
    const self = view.self;
    const tick = view.tick;

    const target = this.pickTarget(view);
    if (target?.sessionId !== this.target) {
      this.heldSinceTick = tick;
      this.nav = newNavState(); // a new target starts a fresh orbit side and back-out flag
    }
    this.target = target?.sessionId;

    // --- facts ---
    const selfControlLost = !self.alive
      || CONTROL_LOST_STATUSES.some((id) => hasStatus(self.statuses, id, tick));
    const push = wallPush(self, view.arena, profile.wallLookaheadUnits);
    if (push) this.lastPush = push;
    const shotThreats = activeThreats(this.perception, tick);
    const carIncoming = target ? isIncomingCar(self, target, profile) : false;
    const distance = target ? Math.hypot(target.x - self.x, target.y - self.y) : Infinity;
    const usable = usableSlots(self.slots);
    // Raw reach of ANY usable slot, ready or not (BB15): a bot reloading inside its kit's reach is in
    // `fight`, whose goal reads `ownComfortOf`'s stand-off branch while nothing is soon-ready (BB43).
    // The shooter still presses nothing until a slot is ready.
    const inOwnReach = target !== undefined
      && usable.some(({ slot }) => distance <= weaponReachOf(slot.weaponId));
    // BB21: a car with nothing to fire is dry by definition.
    const kitDry = usable.length === 0
      || usable.every(({ slot }) => readyInTicksOf(slot, tick) > consts.ramDryWindowTicks);
    const hpFraction = self.maxHp > 0 ? self.hp / self.maxHp : 1;
    const targetHpFraction = target && target.maxHp > 0 ? target.hp / target.maxHp : 1;
    const targetHeld = target !== undefined
      && (hasStatus(target.statuses, "stunned", tick) || hasStatus(target.statuses, "reeling", tick));

    const previous = this.situation.current;
    this.situation = pickSituation(this.situation, classifySituation({
      selfControlLost,
      hittable: target !== undefined,
      evade: shotThreats.length > 0 || carIncoming,
      pinned: push !== undefined,
      punish: target !== undefined && (targetHeld || targetHpFraction <= profile.punishHpFraction),
      reset: profile.retreatHpFraction > 0 && hpFraction < profile.retreatHpFraction,
      kitDry,
      inRamRange: distance <= consts.ramRangeUnits,
      inOwnReach,
    }), tick, profile);
    const sit = this.situation.current;
    // A fresh situation starts a fresh navigator: a stale orbit side or back-out flag would steer
    // the new goal by the old one's state.
    if (sit !== previous) {
      this.nav = newNavState();
      if (previous === "evade") this.lastDodge = undefined;
    }

    // --- predict (unconditional draws, BB14) ---
    const predictTarget = target ?? ABSENT_TARGET;
    const targetAt: PosePredictor = physicsPredictor(
      predictTarget, observedAngVelOf(this.perception, predictTarget.sessionId),
      target ? consts.predictionHorizonTicks : 0, profile.stateEstimationSigma, view.rng,
    );

    // --- solve + shoot ---
    const solutions = new Map<number, FiringSolution>();
    if (target) {
      for (const { slot, index } of usable) {
        if (!slotIsReady(slot, tick)) continue;
        solutions.set(index, solve({
          shooter: {
            sessionId: self.sessionId, carId: self.carId, team: self.team,
            x: self.x, y: self.y, angle: self.angle, vx: self.vx, vy: self.vy, turretAngle: self.turretAngle,
          },
          slot, slotIndex: index, target, targetAt, aimSigmaRad: profile.aimErrorSigmaRad, tick, arena: view.arena,
        }));
      }
    }
    const shot: ShotDecision = target
      ? chooseShot({ self, target, profile, tick, lastPressTick: this.lastPressTick, solutions })
      : { slot: undefined, wantsNose: false, bestHitChance: 0 };
    this.lastShot = shot;

    // --- navigate ---
    const ownComfort = ownComfortOf(self.slots, profile, tick);
    const fightRange = fightRangeOf(ownComfort, target, seenWeapons(this.perception, target?.sessionId), profile);
    const goal = this.goalFor(sit, view, target, targetAt, {
      ownComfort, fightRange, distance, shotThreats, carIncoming, usable, wantsNose: shot.wantsNose,
    });
    this.lastGoal = goal;
    let action = goal
      ? steerToward({ self, goal, aimOffsetRad: this.aimError.offsetRad, state: this.nav })
      : COAST_ACTION;
    if (sit !== "recover" && sit !== "unpin") action = avoidWalls(self, action, push, this.nav);
    this.lastAction = action;

    // --- fire ---
    const mayFire = FIRING_SITUATIONS.has(sit) && target !== undefined;
    const slot = mayFire ? shot.slot : undefined;
    if (slot !== undefined) this.lastPressTick = tick;
    this.lastFiredSlot = slot;

    if (sit === "recover") return COAST;
    const intent: BotIntent = {
      steer: action.steer, throttle: action.throttle, fireSlots: slot === undefined ? 0 : 1 << slot,
    };
    const turretBearing = slot === undefined ? undefined : solutions.get(slot)?.turretBearingRad;
    if (turretBearing !== undefined) intent.aimAngle = wrapAngle(turretBearing + this.aimError.offsetRad);
    return intent;
  }

  /** The situation's goal (BB23). */
  private goalFor(
    sit: SituationId, view: BotView, target: BotCarView | undefined, targetAt: PosePredictor, f: Facts,
  ): Goal | undefined {
    const self = view.self;
    const profile = this.profile;
    const c = BRAIN_CONSTANTS;
    const consts = resolveBrainConstants();
    const lag = profile.reactionDelayTicks;
    const at = (ticks: number) => { const p = targetAt(ticks); return { x: p.x, y: p.y }; };
    const ahead = (heading: number, units: number) =>
      ({ x: self.x + Math.cos(heading) * units, y: self.y + Math.sin(heading) * units });

    switch (sit) {
      case "recover":
        return undefined;
      case "waitOut": {
        const heading = this.huntHeading(view, self.angle);
        return { ...ahead(heading, profile.awarenessRadiusUnits), range: 0, facing: "nose", reverseOk: false };
      }
      case "evade": {
        // `evade` is held for its commit window after its facts end (BB35), and a threat leaves
        // perception the moment the shot stops heading at the bot: keep the last live dodge rather
        // than let an empty sum snap the heading to 0. With none, back up.
        let dir: { x: number; y: number };
        if (f.shotThreats.length > 0 || (f.carIncoming && target)) {
          const carAway = f.carIncoming && target ? awayFromCarHeading(self, target) : undefined;
          dir = dodgeDirection(f.shotThreats, carAway);
          this.lastDodge = dir;
        } else {
          dir = this.lastDodge ?? { x: -Math.cos(self.angle), y: -Math.sin(self.angle) };
        }
        return {
          x: self.x + dir.x * c.dodgeDistanceUnits, y: self.y + dir.y * c.dodgeDistanceUnits,
          range: 0, facing: "free", reverseOk: true,
        };
      }
      case "unpin": {
        const p = this.lastPush;
        const len = p ? Math.hypot(p.x, p.y) : 0;
        const dir = p && len > 0 ? { x: p.x / len, y: p.y / len } : { x: Math.cos(self.angle), y: Math.sin(self.angle) };
        return {
          x: self.x + dir.x * c.unpinDistanceUnits, y: self.y + dir.y * c.unpinDistanceUnits,
          range: 0, facing: "free", reverseOk: true,
        };
      }
      case "punish":
        return { ...at(lag), range: Math.max(c.minEngageUnits, f.ownComfort * c.punishRangeFraction), facing: "nose", reverseOk: true };
      case "reset":
        return { ...at(lag), range: Math.max(f.fightRange * c.resetRangeMultiplier, c.minEngageUnits), facing: "nose", reverseOk: true };
      case "ram": {
        const speed = Math.max(forwardMaxSpeedOf(self.carId), 1);
        const eta = Math.min(consts.predictionHorizonTicks, Math.round((f.distance / speed) * TICK_RATE_HZ));
        return { ...at(eta), range: 0, facing: "nose", reverseOk: false, forwardOnly: true };
      }
      case "fight":
        return { ...at(lag), range: f.fightRange, facing: f.wantsNose ? "nose" : "orbit", reverseOk: true };
      case "close": {
        const soon = f.usable.filter(({ slot }) => readyInTicksOf(slot, view.tick) <= consts.soonReadyTicks);
        const pool = soon.length > 0 ? soon : f.usable;
        const reach = pool.length > 0 ? Math.max(...pool.map(({ slot }) => weaponReachOf(slot.weaponId))) : c.minEngageUnits;
        // Capped at the current distance: `close` never asks to be farther away than it is (BB23).
        return { ...at(lag), range: Math.min(0.9 * reach, f.distance), facing: "nose", reverseOk: false };
      }
    }
  }

  /** Where to drive when nobody is hittable (BB36): last known, heard, then the search waypoints. */
  private huntHeading(view: BotView, fallbackHeading: number): number {
    const self = view.self;
    const tick = view.tick;
    const known = lastKnownAnchor(this.perception, tick);
    if (acquiringUnnoticed(this.perception, tick) && !known) return fallbackHeading;
    if (known) return Math.atan2(known.y - self.y, known.x - self.x);
    const heard = nearestHeardShot(self, view.instances);
    if (heard) return Math.atan2(heard.y - self.y, heard.x - self.x);
    let waypoint = searchWaypoint(this.searchIndex, view.arena);
    if (Math.hypot(waypoint.x - self.x, waypoint.y - self.y) < BRAIN_CONSTANTS.minEngageUnits) {
      this.searchIndex += 1;
      waypoint = searchWaypoint(this.searchIndex, view.arena);
    }
    return Math.atan2(waypoint.y - self.y, waypoint.x - self.x);
  }
}

/** Unit vector of the summed away headings; the first threat alone when they cancel (BB34). */
function dodgeDirection(threats: readonly KnownThreat[], carAway: number | undefined): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const t of threats) { x += Math.cos(t.awayHeadingRad); y += Math.sin(t.awayHeadingRad); }
  if (carAway !== undefined) { x += Math.cos(carAway); y += Math.sin(carAway); }
  const len = Math.hypot(x, y);
  if (len < 1e-3) {
    const h = threats[0]?.awayHeadingRad ?? carAway ?? 0;
    return { x: Math.cos(h), y: Math.sin(h) };
  }
  return { x: x / len, y: y / len };
}

/** Perpendicular to an incoming car's velocity, on the side the bot is already on (BB20). */
function awayFromCarHeading(self: { x: number; y: number }, car: BotCarView): number {
  const perp = Math.atan2(car.vy, car.vx) + Math.PI / 2;
  const cross = car.vx * (self.y - car.y) - car.vy * (self.x - car.x);
  return cross >= 0 ? perp : perp + Math.PI;
}

/** The opponent's weapons the bot has seen fired (`perception.firedSeenTick`, keyed `session:weapon`). */
function seenWeapons(perception: PerceptionState, sessionId: string | undefined): WeaponId[] {
  if (!sessionId) return [];
  const prefix = `${sessionId}:`;
  const out: WeaponId[] = [];
  for (const key of perception.firedSeenTick.keys()) {
    if (key.startsWith(prefix)) out.push(key.slice(prefix.length) as WeaponId);
  }
  return out;
}

export { inCorner } from "./movement.js";
