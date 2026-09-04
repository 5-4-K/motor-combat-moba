import { hasStatus, WEAPON_TABLE, weaponDefOf, type BotDifficulty, type WeaponId } from "@motor-combat-moba/shared";
import { BOT_PROFILES, BRAIN_CONSTANTS, type BotProfile } from "../../config/bot-profiles.js";
import type {
  BotCarView, BotController, BotDebug, BotIntent, BotPersonality, BotView, GoalId,
} from "../types.js";
import { interceptPoint, newAimErrorState, signedDelta, stepAimError, type AimErrorState } from "./aim.js";
import { chooseSlot, preferredRangeOf, slotIsReady, type UltHoldEntry } from "./firing.js";
import { newGoalState, pickGoal, scoreGoals, scoreTargets, type GoalState } from "./goals.js";
import { applyHumanize, newHumanizeState, type HumanizeState } from "./humanize.js";
import {
  blendHeading, dodgeDesires, goalDesire, nearBound, orbitDesire, reduceToIntent, wallDesire,
  type Desire,
} from "./movement.js";
import {
  acquiringUnnoticed, activeThreats, knownCars, lastKnownAnchor, nearestHeardShot, newPerception,
  perceive, searchWaypoint, ultIsSpent, type PerceptionState,
} from "./perception.js";
import { rollPersonality } from "./personality.js";
import { rolesOf } from "./roles.js";

const COAST: BotIntent = { steer: 0, throttle: 0, fireSlots: 0 };

/** A target-shaped nothing, so `chooseSlot` can draw on a targetless tick without firing (H21). */
const ABSENT_TARGET: BotCarView = {
  sessionId: "", carId: "bullseye", team: 0, x: 0, y: 0, angle: 0, speed: 0,
  hp: 1, maxHp: 1, alive: false, phased: true, statuses: [], maneuver: 0,
};

/**
 * The bot (H5). Five layers, one `decide` call: perceive, assess, move, shoot, humanize.
 *
 * Perception and humanization run EVERY tick; assess/move/shoot run on `recomputeTicks` (H6). A
 * memory that only updates every twelfth tick is not a memory, and a delay line that only shifts
 * every twelfth tick delays by a multiple of the cadence rather than by its own value.
 */
export class HumanController implements BotController {
  readonly profileId: BotDifficulty;
  /** The tier row as authored. Kept un-personalised so `debug()` can show what was rolled from. */
  private readonly profile: BotProfile;
  /**
   * What the brain actually reads. Identical to `profile` until the personality roll on the first
   * `decide` call replaces it with a shifted-and-clamped copy (H20/H47).
   */
  private effectiveProfile: BotProfile;
  private fixedTarget: string | undefined;
  private target: string | undefined;
  private held: BotIntent = COAST;
  private lastDebug: BotDebug | undefined;
  private aimError: AimErrorState = newAimErrorState();
  private perception: PerceptionState = newPerception();
  /** Tick of the last press this bot actually made, so `chooseSlot` can enforce `burstGapTicks`. */
  private lastPressTick = -999;
  /**
   * Per-slot ult discipline memo, owned here and mutated in place by `chooseSlot` (H30). Rolled once
   * per (target, ready) episode rather than every recompute — see `UltHoldEntry`'s doc for why a
   * per-tick reroll would make even a disciplined tier's "hold" decay to a certainty of firing.
   */
  private ultHold = new Map<number, UltHoldEntry>();
  /**
   * Per-slot preference, rolled per bot from personality (H47). `[1, 1, 1]` is neutral — every slot
   * weighted equally — until the first `decide` call replaces it.
   */
  private slotWeights: readonly number[] = [1, 1, 1];
  /**
   * The range `plan` last computed, threaded into `debug()` (H12). Hunt / recover set this to 0
   * because there is no live target to stand off from.
   */
  private lastPreferredRange = 0;
  /** Which way `orbitDesire` circles. Rolled once from personality on the first `decide` call. */
  private orbitSide: 1 | -1 = 1;
  /** The goal and when it was entered (G4/G7). */
  private goal: GoalState = newGoalState();
  /** Tick the current target started being held, for `scoreTargets`'s stickiness bonus. */
  private heldSinceTick = 0;
  /** Whether this bot has committed to ramming its current target (H40). */
  private wantsRam = false;
  /** Which target the ram roll above was already made for — so it happens once per target. */
  private ramRolledForTargetId: string | undefined;
  /** Hear-toward-shot, rolled once per hunt episode (G12). */
  private huntHear: boolean | undefined;
  /** Which quadrant search waypoint the current hunt is committed to. */
  private searchIndex = 0;
  // Carried out of `plan` for `debug()`, which runs after it.
  private lastGoalScores: Record<GoalId, number> | undefined;
  private lastFiredSlot: number | undefined;
  /** Humanization state — delay line, blunder window (Task 7). Runs every tick. */
  private humanize: HumanizeState = newHumanizeState();
  /** Rolled lazily on the first `decide` call (H20), before any other draw that tick. */
  private personality: BotPersonality | undefined;

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

  /** Point the bot at one car, or `undefined` to choose for itself. */
  setTarget(sessionId: string | undefined): void {
    this.fixedTarget = sessionId;
  }

  debug(): BotDebug | undefined {
    return this.lastDebug;
  }

  decide(view: BotView): BotIntent {
    // LAYER 0 — personality. Rolled once, lazily, on the first tick this bot ever decides — before
    // any other draw that tick (H20), so no host has to know personalities exist.
    if (!this.personality) {
      const rolled = rollPersonality(view.rng, this.profileId, this.profile);
      this.personality = rolled.personality;
      this.effectiveProfile = rolled.profile;
      this.slotWeights = rolled.personality.slotWeights;
      this.orbitSide = rolled.personality.slotWeights[0]! > 1 ? 1 : -1;
    }

    // LAYER 1 — perceive. Runs every tick, not on the recompute cadence below (H21 draw order): a
    // memory that only updates every twelfth tick is not a memory.
    this.perception = perceive(this.perception, view, this.effectiveProfile);
    this.aimError = stepAimError(this.aimError, view.tick, this.effectiveProfile, view.rng);

    const target = this.pickTarget(view);
    if (target?.sessionId !== this.target) this.heldSinceTick = view.tick;
    this.target = target?.sessionId;

    // LAYER 2/3/4 — assess, move, shoot, on the recompute cadence (Tasks 4-6)
    const decisionWindow = this.shouldRecompute(view.tick);
    if (decisionWindow) {
      this.held = this.plan(view, target);
    }

    this.lastDebug = {
      tick: view.tick,
      goal: this.goal.current,
      goalScores: this.lastGoalScores ?? {},
      targetSessionId: this.target,
      preferredRange: this.lastPreferredRange,
      personality: this.personality.id,
      firedSlot: this.lastFiredSlot,
    };

    const idle = this.goal.current === "recover";
    return applyHumanize(
      this.humanize, this.held, view.tick, this.effectiveProfile, view.rng, idle, decisionWindow,
    );
  }

  private shouldRecompute(tick: number): boolean {
    const cadence = this.effectiveProfile.recomputeTicks;
    return cadence <= 1 || tick % cadence === 0;
  }

  private pickTarget(view: BotView): BotCarView | undefined {
    const candidates = knownCars(this.perception, view.tick);
    if (this.fixedTarget !== undefined) {
      // Both rooms name the bot's opponent. A fixed target the bot has NOT noticed yet is absent
      // here on purpose: that is the acquire delay doing its job, not a lookup failure.
      const fixed = candidates.find((o) => o.sessionId === this.fixedTarget);
      return fixed?.alive && !fixed.phased ? fixed : undefined;
    }
    const chosen = scoreTargets({
      self: view.self, candidates, perception: this.perception, profile: this.effectiveProfile,
      tick: view.tick, heldTargetId: this.target, heldSinceTick: this.heldSinceTick, rng: view.rng,
    });
    return candidates.find((c) => c.sessionId === chosen.targetSessionId);
  }

  private plan(view: BotView, target: BotCarView | undefined): BotIntent {
    const profile = this.effectiveProfile;
    const self = view.self;
    const tick = view.tick;
    const roles = rolesOf(self.slots);

    const preferred = preferredRangeOf(self, profile, this.slotWeights, tick);
    const distance = target ? Math.hypot(target.x - self.x, target.y - self.y) : Infinity;
    const wall = wallDesire(self, view.arena, profile.wallLookaheadUnits);
    const hasReadyContactWeapon = roles.contactSlot !== undefined
      && slotIsReady(self.slots[roles.contactSlot]!, tick);

    const ramRoll = view.rng();
    if (target && this.ramRolledForTargetId !== target.sessionId) {
      this.ramRolledForTargetId = target.sessionId;
      this.wantsRam = ramRoll < profile.ramIntentChance;
    }
    if (!target) {
      this.wantsRam = false;
      this.ramRolledForTargetId = undefined;
    }

    const hearRoll = view.rng();
    if (target) {
      this.huntHear = undefined;
    } else if (this.huntHear === undefined) {
      this.huntHear = hearRoll < profile.hearChance;
    }

    const ultSpent = target
      ? enemyUltSpent(this.perception, target.sessionId, tick, profile.memoryTicks)
      : false;

    const scores = scoreGoals({
      self, target, distance, preferredRange: preferred, profile, tick, roles,
      hasReadyContactWeapon, wantsRam: this.wantsRam,
      pinnedOnWall: wall !== undefined,
      targetNearWall: target
        ? nearBound(target.x, target.y, view.arena, profile.wallLookaheadUnits)
        : false,
      ultSpent, rng: view.rng,
    });
    this.goal = pickGoal(this.goal, scores, tick, profile, this.preemption(view, target));
    this.lastGoalScores = scores;
    this.lastPreferredRange = target ? preferred : 0;

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
    let range = preferred;
    let closing = true;
    let mayFire = target !== undefined && this.goal.current !== "recover"
      && this.goal.current !== "huntLastKnown";

    switch (this.goal.current) {
      case "recover":
        break;
      case "huntLastKnown": {
        const hunt = this.huntHeading(view, self.angle);
        desires.push(goalDesire(hunt.headingRad));
        range = hunt.range;
        closing = hunt.closing;
        mayFire = false;
        break;
      }
      case "rush":
        desires.push(goalDesire(bearing));
        range = BRAIN_CONSTANTS.minEngageUnits;
        closing = false;
        break;
      case "holdRange":
        desires.push(goalDesire(aimHeading));
        {
          const orbit = orbitDesire(bearing, profile.orbitBias, this.orbitSide);
          if (orbit) desires.push(orbit);
        }
        break;
      case "intercept":
        desires.push(goalDesire(interceptHeading));
        closing = false;
        break;
      case "setupCc": {
        const slot = roles.setupCcSlot !== undefined ? self.slots[roles.setupCcSlot] : undefined;
        const isManeuver = slot !== undefined && weaponDefOf(slot.weaponId).kind === "maneuver";
        desires.push(goalDesire(isManeuver ? bearing : aimHeading));
        range = slot && slot.range > 0 ? slot.range * 0.8 : preferred;
        closing = !isManeuver;
        break;
      }
      case "dump":
        desires.push(goalDesire(bearing));
        range = Math.max(BRAIN_CONSTANTS.minEngageUnits, preferred * 0.5);
        closing = false;
        break;
      case "contact":
        desires.push(goalDesire(bearing));
        range = BRAIN_CONSTANTS.contactTriggerUnits;
        closing = false;
        break;
      case "reset":
        desires.push(goalDesire(aimHeading));
        range = Math.max(preferred * 1.3, BRAIN_CONSTANTS.minEngageUnits);
        break;
      case "pinWall":
        desires.push(goalDesire(bearing));
        range = BRAIN_CONSTANTS.minEngageUnits;
        closing = false;
        break;
      case "unpin":
        desires.push(goalDesire(
          Math.atan2(view.arena.height / 2 - self.y, view.arena.width / 2 - self.x),
        ));
        closing = false;
        break;
    }

    if (wall) desires.push(wall);
    desires.push(...dodgeDesires(activeThreats(this.perception, tick), profile.dodgeWeight));

    const heading = blendHeading(desires, self.angle);
    const { steer, throttle } = reduceToIntent({
      headingError: signedDelta(self.angle, heading),
      distance: Number.isFinite(distance) ? distance : range,
      preferredRange: range,
      deadband: this.goal.current === "holdRange" ? range * profile.deadbandFraction : 0,
      aimToleranceRad: profile.aimToleranceRad,
      closing,
    });

    const decision = chooseSlot({
      self, target: target ?? ABSENT_TARGET, distance, aimDelta, profile,
      weights: this.slotWeights, tick, lastPressTick: this.lastPressTick, rng: view.rng,
      ultHold: this.ultHold, goal: this.goal.current, roles,
    });
    const slot = mayFire ? decision.slot : undefined;
    if (slot !== undefined) this.lastPressTick = tick;
    this.lastFiredSlot = slot;

    if (this.goal.current === "recover") return COAST;
    return { steer, throttle, fireSlots: slot === undefined ? 0 : 1 << slot };
  }

  /**
   * Hunt heading (G12/G13). Never the arena centre.
   *
   * Acquire delay continues the previous heading. Last-known (noticed memory) wins over heard
   * shots. Heard shots are gated on the once-per-episode `huntHear` roll. Otherwise a quadrant
   * waypoint, advanced when the bot arrives.
   */
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

  /**
   * The three cases a goal may be cut short for (G7). Dodging is NOT one of them.
   *
   * `controlLost` mirrors `scoreGoals` (dead OR `phased`).
   */
  private preemption(view: BotView, target: BotCarView | undefined): GoalId | undefined {
    const profile = this.effectiveProfile;
    const self = view.self;
    const controlLost = !self.alive || hasStatus(self.statuses, "phased", view.tick);
    if (controlLost) return "recover";
    const hpFraction = self.maxHp > 0 ? self.hp / self.maxHp : 1;
    if (profile.retreatHpFraction > 0 && hpFraction < profile.retreatHpFraction) return "reset";
    if (!target && this.goal.current !== "huntLastKnown") return "huntLastKnown";
    return undefined;
  }
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
