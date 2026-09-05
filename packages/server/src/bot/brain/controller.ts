import {
  DRIVE_CONFIG, hasStatus, TICK_RATE_HZ, turnRateAtStopOf, turnRateOf, WEAPON_TABLE, weaponDefOf,
  type BotDifficulty, type WeaponId,
} from "@motor-combat-moba/shared";
import { BOT_PROFILES, BRAIN_CONSTANTS, type BotProfile } from "../../config/bot-profiles.js";
import type {
  BotCarView, BotController, BotDebug, BotIntent, BotPersonality, BotView, SituationId,
} from "../types.js";
import { interceptPoint, newAimErrorState, signedDelta, stepAimError, type AimErrorState } from "./aim.js";
import { chooseSlot, preferredRangeOf, slotIsReady, type UltHoldEntry } from "./firing.js";
import { scoreTargets } from "./goals.js";
import { applyHumanize, newHumanizeState, type HumanizeState } from "./humanize.js";
import {
  blendHeading, compensateForLag, goalDesire, openFloorHeading, reduceToIntent,
  reverseWouldHitBound, wallDesire, type Desire,
} from "./movement.js";
import {
  acquiringUnnoticed, activeThreats, knownCars, lastKnownAnchor, nearestHeardShot, newPerception,
  perceive, searchWaypoint, ultIsSpent, type PerceptionState,
} from "./perception.js";
import { rollPersonality } from "./personality.js";
import { kitReachOf, weaponReachOf } from "./reach.js";
import { rolesOf } from "./roles.js";
import { classifySituation, newSituationState, pickSituation, type SituationState } from "./situation.js";

const COAST: BotIntent = { steer: 0, throttle: 0, fireSlots: 0 };

const ABSENT_TARGET: BotCarView = {
  sessionId: "", carId: "bullseye", team: 0, x: 0, y: 0, angle: 0, speed: 0,
  hp: 1, maxHp: 1, alive: false, phased: true, statuses: [], maneuver: 0,
};

/**
 * The bot (H5). Five layers, one `decide` call: perceive, assess, move, shoot, humanize.
 *
 * Perception and humanization run EVERY tick; assess/move/shoot run on `recomputeTicks` (H6).
 */
export class HumanController implements BotController {
  readonly profileId: BotDifficulty;
  private readonly profile: BotProfile;
  private effectiveProfile: BotProfile;
  private fixedTarget: string | undefined;
  private target: string | undefined;
  private held: BotIntent = COAST;
  private lastDebug: BotDebug | undefined;
  private aimError: AimErrorState = newAimErrorState();
  private perception: PerceptionState = newPerception();
  private lastPressTick = -999;
  private ultHold = new Map<number, UltHoldEntry>();
  private slotWeights: readonly number[] = [1, 1, 1];
  private lastPreferredRange = 0;
  private situation: SituationState = newSituationState();
  private heldSinceTick = 0;
  private wantsRam = false;
  private ramRolledForTargetId: string | undefined;
  private huntHear: boolean | undefined;
  private searchIndex = 0;
  private lastFiredSlot: number | undefined;
  private stuckSlot: number | undefined;
  private stuckSinceTick = 0;
  private pinEpisode = false;
  private willUnpin = false;
  private deadEpisodeId: string | undefined;
  private respectDead = true;
  private carApproachId: string | undefined;
  private willEvadeCar = false;
  private humanize: HumanizeState = newHumanizeState();
  private personality: BotPersonality | undefined;
  /** The steer this controller most recently emitted from `decide` — R10's lag-compensation input. */
  private lastSteer: -1 | 0 | 1 = 0;

  constructor(
    profileId: BotDifficulty,
    options: { targetSessionId?: string; profile?: BotProfile } = {},
  ) {
    this.profileId = profileId;
    this.profile = options.profile ?? BOT_PROFILES[profileId];
    this.effectiveProfile = this.profile;
    this.fixedTarget = options.targetSessionId;
  }

  get currentTargetSessionId(): string | undefined {
    return this.target;
  }

  setTarget(sessionId: string | undefined): void {
    this.fixedTarget = sessionId;
  }

  debug(): BotDebug | undefined {
    return this.lastDebug;
  }

  decide(view: BotView): BotIntent {
    if (!this.personality) {
      const rolled = rollPersonality(view.rng, this.profileId, this.profile);
      this.personality = rolled.personality;
      this.effectiveProfile = rolled.profile;
      this.slotWeights = rolled.personality.slotWeights;
    }

    this.perception = perceive(this.perception, view, this.effectiveProfile);
    this.aimError = stepAimError(this.aimError, view.tick, this.effectiveProfile, view.rng);

    const target = this.pickTarget(view);
    if (target?.sessionId !== this.target) this.heldSinceTick = view.tick;
    this.target = target?.sessionId;

    const decisionWindow = this.shouldRecompute(view.tick);
    if (decisionWindow) {
      this.held = this.plan(view, target);
    }

    this.lastDebug = {
      tick: view.tick,
      situation: this.situation.current,
      targetSessionId: this.target,
      preferredRange: this.lastPreferredRange,
      personality: this.personality.id,
      firedSlot: this.lastFiredSlot,
    };

    const idle = this.situation.current === "recover";
    const out = applyHumanize(
      this.humanize, this.held, view.tick, this.effectiveProfile, view.rng, idle, decisionWindow,
    );
    this.lastSteer = out.steer;
    return out;
  }

  private shouldRecompute(tick: number): boolean {
    const cadence = this.effectiveProfile.recomputeTicks;
    return cadence <= 1 || tick % cadence === 0;
  }

  private pickTarget(view: BotView): BotCarView | undefined {
    const noticed = knownCars(this.perception, view.tick);
    const hittable = noticed.filter((o) => o.alive && !o.phased);
    if (this.fixedTarget !== undefined) {
      const fixed = noticed.find((o) => o.sessionId === this.fixedTarget)
        ?? view.others.find((o) => o.sessionId === this.fixedTarget);
      if (!fixed) return undefined;
      if (fixed.alive && !fixed.phased) {
        this.deadEpisodeId = undefined;
        return hittable.find((o) => o.sessionId === fixed.sessionId) ?? (
          noticed.some((o) => o.sessionId === fixed.sessionId) ? fixed : undefined
        );
      }
      return this.ghostIfUnrespected(fixed, view);
    }
    const chosen = scoreTargets({
      self: view.self, candidates: hittable, perception: this.perception,
      profile: this.effectiveProfile, tick: view.tick, heldTargetId: this.target,
      heldSinceTick: this.heldSinceTick, rng: view.rng,
    });
    const live = hittable.find((c) => c.sessionId === chosen.targetSessionId);
    if (live) {
      this.deadEpisodeId = undefined;
      return live;
    }
    const ghost = noticed.find((o) => !o.alive || o.phased);
    return ghost ? this.ghostIfUnrespected(ghost, view) : undefined;
  }

  private ghostIfUnrespected(car: BotCarView, view: BotView): BotCarView | undefined {
    if (this.deadEpisodeId !== car.sessionId) {
      this.deadEpisodeId = car.sessionId;
      this.respectDead = view.rng() < this.effectiveProfile.deadRespect;
    }
    return this.respectDead ? undefined : { ...car, alive: true, phased: false };
  }

  private plan(view: BotView, target: BotCarView | undefined): BotIntent {
    const profile = this.effectiveProfile;
    const self = view.self;
    const tick = view.tick;
    const roles = rolesOf(self.slots);
    const ownComfort = preferredRangeOf(self, profile, this.slotWeights, tick);
    const extraIds = seenWeapons(this.perception, target?.sessionId);
    const theirKeepOut = target
      ? kitReachOf(target.carId, extraIds).shortest * profile.opponentRangeRespect
      : 0;
    const fightRange = Math.max(ownComfort, theirKeepOut);
    const distance = target ? Math.hypot(target.x - self.x, target.y - self.y) : Infinity;
    const wall = wallDesire(self, view.arena, profile.wallLookaheadUnits);
    const pinned = wall !== undefined || inCorner(self, view.arena);

    if (target && this.ramRolledForTargetId !== target.sessionId) {
      this.ramRolledForTargetId = target.sessionId;
      this.wantsRam = view.rng() < profile.ramIntentChance;
    }
    if (!target) {
      this.wantsRam = false;
      this.ramRolledForTargetId = undefined;
    }

    const hearRoll = view.rng();
    if (target) this.huntHear = undefined;
    else if (this.huntHear === undefined) this.huntHear = hearRoll < profile.hearChance;

    if (pinned) {
      if (!this.pinEpisode) {
        this.pinEpisode = true;
        this.willUnpin = view.rng() < profile.cornerRespect;
      }
    } else {
      this.pinEpisode = false;
      this.willUnpin = false;
    }

    const shotThreats = activeThreats(this.perception, tick);
    const carIncoming = target ? isIncomingCar(self, target, profile) : false;
    if (carIncoming && target) {
      if (this.carApproachId !== target.sessionId) {
        this.carApproachId = target.sessionId;
        this.willEvadeCar = view.rng() < profile.incomingCarChance;
      }
    } else {
      this.carApproachId = undefined;
      this.willEvadeCar = false;
    }

    const ultSpent = target
      ? enemyUltSpent(this.perception, target.sessionId, tick, profile.memoryTicks)
      : false;
    const hpFraction = self.maxHp > 0 ? self.hp / self.maxHp : 1;
    const targetHpFraction = target && target.maxHp > 0 ? target.hp / target.maxHp : 1;
    const targetStunned = target ? hasStatus(target.statuses, "stunned", tick) : false;
    const inOwnReach = target
      ? self.slots.some((s) => slotIsReady(s, tick) && distance <= weaponReachOf(s.weaponId))
      : false;
    const trulyHittable = target !== undefined && target.alive && !target.phased;

    const classified = classifySituation({
      selfControlLost: !self.alive || hasStatus(self.statuses, "phased", tick),
      hittable: trulyHittable,
      evade: shotThreats.length > 0 || (carIncoming && this.willEvadeCar),
      unpin: pinned && trulyHittable && this.willUnpin,
      punish: trulyHittable && (targetStunned || ultSpent
        || targetHpFraction <= profile.ultWindowHpFraction),
      reset: profile.retreatHpFraction > 0 && hpFraction < profile.retreatHpFraction,
      inOwnReach,
    });
    this.situation = pickSituation(this.situation, classified, tick, profile);

    const leadSlot = self.slots[0];
    const aimPoint = target
      ? interceptPoint(
          self,
          { x: target.x, y: target.y, speed: target.speed, angle: target.angle },
          leadSlot ? weaponDefOf(leadSlot.weaponId).speed : 0,
          profile.leadFactor,
        )
      : undefined;
    const aimHeading = aimPoint
      ? Math.atan2(aimPoint.y - self.y, aimPoint.x - self.x) + this.aimError.offsetRad
      : self.angle;
    const aimDelta = signedDelta(self.angle, aimHeading);
    const bodyIntercept = target
      ? interceptPoint(
          self,
          { x: target.x, y: target.y, speed: target.speed, angle: target.angle },
          Math.max(self.speed, 1),
          profile.leadFactor,
        )
      : undefined;
    const interceptHeading = bodyIntercept
      ? Math.atan2(bodyIntercept.y - self.y, bodyIntercept.x - self.x)
      : self.angle;
    const bearing = target ? Math.atan2(target.y - self.y, target.x - self.x) : self.angle;

    const desires: Desire[] = [];
    let range = fightRange;
    let closing = true;
    let mayFire = false;
    const sit: SituationId = this.situation.current;

    switch (sit) {
      case "recover":
        break;
      case "waitOut": {
        const hunt = this.huntHeading(view, self.angle);
        desires.push(goalDesire(hunt.headingRad));
        range = hunt.range;
        closing = hunt.closing;
        this.lastPreferredRange = 0;
        break;
      }
      case "evade": {
        const away = shotThreats[0]?.awayHeadingRad ?? bearing + Math.PI / 2;
        desires.push(goalDesire(away));
        closing = false;
        mayFire = trulyHittable;
        break;
      }
      case "unpin":
        desires.push(goalDesire(openFloorHeading(self, view.arena)));
        closing = false;
        mayFire = trulyHittable;
        break;
      case "punish":
        desires.push(goalDesire(bearing));
        range = Math.max(BRAIN_CONSTANTS.minEngageUnits, ownComfort * 0.5);
        closing = false;
        mayFire = trulyHittable;
        break;
      case "reset":
        desires.push(goalDesire(aimHeading));
        range = Math.max(fightRange * 1.15, BRAIN_CONSTANTS.minEngageUnits);
        closing = true;
        mayFire = trulyHittable;
        break;
      case "fight":
        desires.push(goalDesire(aimHeading));
        range = fightRange;
        closing = true;
        mayFire = trulyHittable;
        break;
      case "close":
        desires.push(goalDesire(interceptHeading));
        range = BRAIN_CONSTANTS.minEngageUnits;
        closing = false;
        break;
    }

    if (sit !== "waitOut" && sit !== "recover") this.lastPreferredRange = range;

    if (wall) desires.push(wall);
    const inDeadband = sit === "fight"
      && Math.abs((Number.isFinite(distance) ? distance : range) - range)
        <= range * profile.deadbandFraction;
    const heading = blendHeading(desires, self.angle);

    const reverseBlocked = reverseWouldHitBound(self, view.arena, profile.wallLookaheadUnits);
    // R10: the sim only uses the stopped turn rate while not moving (`stepDrive`'s `isMoving`
    // gate), so pick the rate that matches the bot's actual current speed rather than always the
    // stopped one — otherwise the lag PROJECTION below is tuned for a car that isn't rolling.
    const turnRate = Math.abs(self.speed) > DRIVE_CONFIG.stopEpsilon
      ? turnRateOf(self.carId)
      : turnRateAtStopOf(self.carId);
    const { projectedError, effectiveDeadzone } = compensateForLag({
      headingError: signedDelta(self.angle, heading),
      lastSteer: this.lastSteer,
      turnRate,
      // R12: the deadzone FLOOR always uses the moving rate, never the speed-dependent one above —
      // it is the finest correction the car can ever make, not the one it can make on this tick.
      // See `compensateForLag`'s doc comment and `BRAIN_CONSTANTS.deadzoneFloorFraction`'s.
      floorTurnRate: turnRateOf(self.carId),
      aimToleranceRad: profile.aimToleranceRad,
      fireConeRad: profile.fireConeRad,
      reactionDelayTicks: profile.reactionDelayTicks,
      recomputeTicks: profile.recomputeTicks,
    });
    const { steer, throttle } = reduceToIntent({
      headingError: projectedError,
      distance: Number.isFinite(distance) ? distance : range,
      preferredRange: range,
      deadband: sit === "fight" ? range * profile.deadbandFraction : 0,
      aimToleranceRad: effectiveDeadzone,
      closing,
      reverseBlocked: sit === "fight" || sit === "reset" ? reverseBlocked : false,
    });

    const stuckOk = this.stuckSlot !== undefined
      && tick - this.stuckSinceTick < profile.slotStickTicks;
    const decision = chooseSlot({
      self, target: target ?? ABSENT_TARGET, distance, aimDelta, profile,
      weights: this.slotWeights, tick, lastPressTick: this.lastPressTick, rng: view.rng,
      ultHold: this.ultHold, situation: sit, roles,
      stuckSlot: stuckOk ? this.stuckSlot : undefined,
    });
    const slot = mayFire ? decision.slot : undefined;
    if (slot !== undefined) {
      this.lastPressTick = tick;
      this.stuckSlot = slot;
      this.stuckSinceTick = tick;
    }
    this.lastFiredSlot = slot;
    void this.wantsRam;

    if (sit === "recover") return COAST;
    return { steer, throttle, fireSlots: slot === undefined ? 0 : 1 << slot };
  }

  private huntHeading(
    view: BotView,
    fallbackHeading: number,
  ): { headingRad: number; range: number; closing: boolean } {
    const self = view.self;
    const tick = view.tick;
    if (acquiringUnnoticed(this.perception, tick) && !lastKnownAnchor(this.perception, tick)) {
      return { headingRad: fallbackHeading, range: BRAIN_CONSTANTS.minEngageUnits, closing: true };
    }
    const known = lastKnownAnchor(this.perception, tick);
    if (known) {
      return {
        headingRad: Math.atan2(known.y - self.y, known.x - self.x),
        range: BRAIN_CONSTANTS.minEngageUnits,
        closing: false,
      };
    }
    const heard = this.huntHear ? nearestHeardShot(self, view.instances) : undefined;
    if (heard) {
      return {
        headingRad: Math.atan2(heard.y - self.y, heard.x - self.x),
        range: BRAIN_CONSTANTS.minEngageUnits,
        closing: false,
      };
    }
    let waypoint = searchWaypoint(this.searchIndex, view.arena);
    if (Math.hypot(waypoint.x - self.x, waypoint.y - self.y) < BRAIN_CONSTANTS.minEngageUnits) {
      this.searchIndex += 1;
      waypoint = searchWaypoint(this.searchIndex, view.arena);
    }
    return {
      headingRad: Math.atan2(waypoint.y - self.y, waypoint.x - self.x),
      range: BRAIN_CONSTANTS.minEngageUnits,
      closing: false,
    };
  }
}

function seenWeapons(perception: PerceptionState, sessionId: string | undefined): WeaponId[] {
  if (!sessionId) return [];
  const prefix = `${sessionId}:`;
  const out: WeaponId[] = [];
  for (const key of perception.ultSeenTick.keys()) {
    if (key.startsWith(prefix)) out.push(key.slice(prefix.length) as WeaponId);
  }
  return out;
}

function inCorner(self: { x: number; y: number }, arena: BotView["arena"]): boolean {
  const m = BRAIN_CONSTANTS.minEngageUnits;
  const onX = self.x < m || self.x > arena.width - m;
  const onY = self.y < m || self.y > arena.height - m;
  return onX && onY;
}

function isIncomingCar(
  self: { x: number; y: number },
  target: BotCarView,
  profile: BotProfile,
): boolean {
  const dx = self.x - target.x;
  const dy = self.y - target.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return true;
  const vx = Math.cos(target.angle) * target.speed;
  const vy = Math.sin(target.angle) * target.speed;
  const closing = (vx * dx + vy * dy) / dist;
  if (closing <= 0) return false;
  const eta = (dist - BRAIN_CONSTANTS.contactTriggerUnits) / closing;
  const horizon = profile.dodgeHorizonTicks / TICK_RATE_HZ;
  return eta >= 0 && eta <= horizon;
}

function enemyUltSpent(
  perception: PerceptionState,
  sessionId: string,
  tick: number,
  withinTicks: number,
): boolean {
  for (const id of Object.keys(WEAPON_TABLE) as WeaponId[]) {
    if (weaponDefOf(id).cooldownMs < BRAIN_CONSTANTS.ultCooldownMs) continue;
    if (ultIsSpent(perception, sessionId, id, tick, withinTicks)) return true;
  }
  return false;
}
