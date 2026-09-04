import { weaponDefOf, type BotDifficulty } from "@motor-combat-moba/shared";
import { BOT_PROFILES, BRAIN_CONSTANTS, type BotProfile } from "../../config/bot-profiles.js";
import type { BotCarView, BotController, BotDebug, BotIntent, BotView, StanceId } from "../types.js";
import { interceptPoint, newAimErrorState, signedDelta, stepAimError, type AimErrorState } from "./aim.js";
import { chooseSlot, preferredRangeOf, slotIsReady } from "./firing.js";
import { blendHeading, dodgeDesires, orbitDesire, reduceToIntent, wallDesire, type Desire } from "./movement.js";
import { activeThreats, knownCars, newPerception, perceive, type PerceptionState } from "./perception.js";
import { newStanceState, pickStance, scoreStances, scoreTargets, type StanceState } from "./stance.js";

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
   * What the brain actually reads. Identical to `profile` until Task 7's personality roll replaces
   * it with a shifted-and-clamped copy — declared here so every layer reads one field from the
   * start and no later task has to rename its reads.
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
   * Per-slot preference, rolled per bot by a future personality task (H47). `[1, 1, 1]` is neutral
   * — every slot weighted equally — until that task replaces it.
   */
  private slotWeights: readonly number[] = [1, 1, 1];
  /**
   * The range `plan` last computed, threaded into `debug()` (H12). Reset to 0 on the no-target
   * path in `decide()` — `plan()` does not run that tick, so nothing would otherwise overwrite a
   * stale value left over from when the bot last had a target.
   */
  private lastPreferredRange = 0;
  /** Which way `orbitDesire` circles. Rolled once from personality in Task 7; `1` until then. */
  private orbitSide: 1 | -1 = 1;
  /** The stance and when it was entered (H9/H10). */
  private stance: StanceState = newStanceState();
  /** Tick the current target started being held, for `scoreTargets`'s stickiness bonus. */
  private heldSinceTick = 0;
  /** Whether this bot has committed to ramming its current target (H40). */
  private wantsRam = false;
  /** Which target the ram roll above was already made for — so it happens once per target. */
  private ramRolledForTargetId: string | undefined;
  // Carried out of `plan` for `debug()`, which runs after it.
  private lastStanceScores: Record<StanceId, number> | undefined;
  private lastFiredSlot: number | undefined;

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
    // LAYER 1 — perceive. Runs every tick, not on the recompute cadence below (H21 draw order): a
    // memory that only updates every twelfth tick is not a memory.
    this.perception = perceive(this.perception, view, this.effectiveProfile);
    this.aimError = stepAimError(this.aimError, view.tick, this.effectiveProfile, view.rng);

    const target = this.pickTarget(view);
    if (target?.sessionId !== this.target) this.heldSinceTick = view.tick;
    this.target = target?.sessionId;

    // LAYER 2/3/4 — assess, move, shoot, on the recompute cadence (Tasks 4-6)
    if (this.shouldRecompute(view.tick)) {
      this.held = this.plan(view, target);
    }

    this.lastDebug = {
      tick: view.tick,
      stance: this.stance.current,
      stanceScores: this.lastStanceScores ?? {},
      targetSessionId: this.target,
      preferredRange: this.lastPreferredRange,
      personality: "brawler",
      firedSlot: this.lastFiredSlot,
    };

    // LAYER 5 — humanize (Task 7 replaces this with `applyHumanize()`)
    return this.held;
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

    const preferred = preferredRangeOf(self, profile, this.slotWeights, tick);
    const distance = target ? Math.hypot(target.x - self.x, target.y - self.y) : Infinity;
    const wall = wallDesire(self, view.arena, profile.wallLookaheadUnits);
    const hasReadyContactWeapon = self.slots.some((s) => s.range === 0 && slotIsReady(s, tick));

    // The ram roll happens ONCE per target, not per tick: re-rolling every tick would ram
    // everything eventually, the same trap the dodge roll avoids (H25, H40).
    const ramRoll = view.rng();
    if (target && this.ramRolledForTargetId !== target.sessionId) {
      this.ramRolledForTargetId = target.sessionId;
      this.wantsRam = ramRoll < profile.ramIntentChance;
    }
    if (!target) this.wantsRam = false;

    const scores = scoreStances({
      self, target, distance, preferredRange: preferred, profile, tick,
      hasReadyContactWeapon, wantsRam: this.wantsRam,
      pinnedOnWall: wall !== undefined, rng: view.rng,
    });
    this.stance = pickStance(this.stance, scores, tick, profile, this.preemption(view, target));

    this.lastStanceScores = scores;
    // Threaded into `debug()` (H12), NOT the `preferred` value used below for the movement math:
    // with no target, `preferred` is still a real number derived from the bot's own ready weapons,
    // but the overlay must read 0 — a range for a fight that does not exist is stale information,
    // exactly the cached-field staleness the no-target path used to reintroduce before the review
    // fix that added this test.
    this.lastPreferredRange = target ? preferred : 0;

    if (this.stance.current === "recover") return COAST;

    // Aim stays on the TARGET even while the body leans elsewhere: a human dodging is still
    // pointing their gun at you.
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

    const centreHeading = Math.atan2(view.arena.height / 2 - self.y, view.arena.width / 2 - self.x);
    const bearing = target ? Math.atan2(target.y - self.y, target.x - self.x) : centreHeading;

    const desires: Desire[] = [];
    let range = preferred;
    let closing = true;
    let mayFire = target !== undefined;

    switch (this.stance.current) {
      case "engage":
        desires.push({ headingRad: aimHeading, weight: 1 });
        break;
      case "brawl":
        desires.push({ headingRad: bearing, weight: 1.5 });
        range = BRAIN_CONSTANTS.contactTriggerUnits;
        break;
      case "kite":
        desires.push({ headingRad: aimHeading, weight: 1 });
        range = preferred * 1.3;
        break;
      case "disengage":
        // Kites rather than flees (H38): still facing, still able to shoot, backing away. Turning
        // tail is a blunder outcome, not a plan.
        desires.push({ headingRad: aimHeading, weight: 1 });
        range = profile.awarenessRadiusUnits;
        break;
      case "reposition":
        desires.push({ headingRad: centreHeading, weight: 1 });
        closing = false;
        mayFire = false;
        break;
      case "hunt":
        desires.push({ headingRad: centreHeading, weight: 1 });
        closing = false;
        mayFire = false;
        break;
    }

    const orbit = this.stance.current === "engage" || this.stance.current === "kite"
      ? orbitDesire(bearing, profile.orbitBias, this.orbitSide)
      : undefined;
    if (orbit) desires.push(orbit);
    if (wall) desires.push(wall);
    desires.push(...dodgeDesires(activeThreats(this.perception, tick)));

    const heading = blendHeading(desires, self.angle);
    const { steer, throttle } = reduceToIntent({
      headingError: signedDelta(self.angle, heading),
      distance: Number.isFinite(distance) ? distance : range,
      preferredRange: range,
      deadband: range * profile.deadbandFraction,
      aimToleranceRad: profile.aimToleranceRad,
      closing,
    });

    // `chooseSlot` draws whether or not it may fire, so the stream does not depend on the stance.
    const decision = chooseSlot({
      self, target: target ?? ABSENT_TARGET, distance, aimDelta, profile,
      weights: this.slotWeights, tick, lastPressTick: this.lastPressTick, rng: view.rng,
    });
    const slot = mayFire ? decision.slot : undefined;
    if (slot !== undefined) this.lastPressTick = tick;
    this.lastFiredSlot = slot;

    return { steer, throttle, fireSlots: slot === undefined ? 0 : 1 << slot };
  }

  /**
   * The three cases a stance may be cut short for (H10). Dodging is NOT one of them — it is a
   * steering desire, which is what lets the bot dodge without stopping fighting (H26).
   */
  private preemption(view: BotView, target: BotCarView | undefined): StanceId | undefined {
    const profile = this.effectiveProfile;
    const self = view.self;
    if (!self.alive) return "recover";
    const hpFraction = self.maxHp > 0 ? self.hp / self.maxHp : 1;
    if (profile.retreatHpFraction > 0 && hpFraction < profile.retreatHpFraction) return "disengage";
    if (!target && this.stance.current !== "hunt") return "hunt";
    return undefined;
  }
}
