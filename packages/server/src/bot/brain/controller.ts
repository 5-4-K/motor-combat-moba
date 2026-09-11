import {
  hasStatus, TICK_RATE_HZ, WEAPON_TABLE, weaponDefOf,
  type BotDifficulty, type WeaponId,
} from "@motor-combat-moba/shared";
import { BOT_PROFILES, BRAIN_CONSTANTS, type BotProfile } from "../../config/bot-profiles.js";
import type {
  BotCarView, BotController, BotDebug, BotIntent, BotPersonality, BotView, SituationId,
} from "../types.js";
import { newAimErrorState, stepAimError, type AimErrorState } from "./aim.js";
import { chooseSlot, preferredRangeOf, slotIsReady, type UltHoldEntry } from "./firing.js";
import { scoreTargets } from "./goals.js";
import { applyHumanize, newHumanizeState, type HumanizeState } from "./humanize.js";
import { spikesAhead, wallAhead } from "./movement.js";
import { weightsFor } from "./objectives.js";
import {
  acquiringUnnoticed, activeThreats, knownCars, lastKnownAnchor, nearestHeardShot, newPerception,
  observedAngVelOf, perceive, readinessOf, searchWaypoint, ultIsSpent, type PerceptionState,
} from "./perception.js";
import { rollPersonality } from "./personality.js";
// Aliased on purpose: `HumanController` already has a `private plan(view, target)` method, and
// `this.plan` vs `plan` INSIDE that very method is the confusion this avoids. The controller's own
// method keeps its name — it is called from `decide` and the name is accurate.
import { plan as planMotion, type PlanResult } from "./planner.js";
import { physicsPredictor, selfPredictor, type DriveAction } from "./predict.js";
import { kitReachOf, weaponReachOf } from "./reach.js";
import { rolesOf } from "./roles.js";
import { classifySituation, newSituationState, pickSituation, type SituationState } from "./situation.js";
import {
  bestAchievableValueOf, dangerEvAgainst, solve, type FiringSolution, type PosePredictor,
} from "./solution.js";

const COAST: BotIntent = { steer: 0, throttle: 0, fireSlots: 0 };

/**
 * The situations in which the bot is allowed to press a trigger (R-O3).
 *
 * This is the `mayFire` half of the eight-case switch P27 deleted, kept verbatim: `recover`,
 * `waitOut` and `close` held fire; the other five fired whenever the target was `trulyHittable`.
 * P27 replaced how a situation chooses a HEADING, and nothing else — losing this set would quietly
 * make `close` a firing situation, which is a behaviour change nobody asked for.
 */
const FIRING_SITUATIONS: ReadonlySet<SituationId> = new Set<SituationId>([
  "evade", "unpin", "punish", "reset", "fight",
]);

const ABSENT_TARGET: BotCarView = {
  sessionId: "", carId: "bullseye", team: 0, x: 0, y: 0, angle: 0, vx: 0, vy: 0,
  hp: 1, maxHp: 1, alive: false, phased: true, statuses: [], maneuver: 0,
};

/**
 * The bot (H5). One `decide` call: perceive -> predict -> assess -> plan -> fire -> humanize.
 * The `move` layer this class used to run was replaced by the planner in phase D.
 *
 * Perception and humanization run EVERY tick; predict/assess/plan/fire run on `recomputeTicks` (H6).
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
  /** Damage per second the bot believes it is standing in front of (P16). Overlay only. */
  private lastDangerEv = 0;
  /**
   * The best EV/s the bot's own kit could deal from its CURRENT pose, across every ready slot's
   * exact `solve()` (R-P27b). Overlay only, and rendered beside `dangerEv` as the primary tuning
   * diagnostic (P45) — "am I winning this exchange from here" is the pair, and either number alone
   * answers nothing.
   */
  private lastBestEv = 0;
  /** Last tick's emitted input — the planner's anti-chatter anchor (P30). */
  private lastAction: DriveAction | undefined;
  /**
   * The plan that produced it, terms and runner-up included (P45). Overlay only; `decide` renders
   * its action, score and per-term breakdown onto `BotDebug` every tick.
   */
  private lastPlan: PlanResult | undefined;
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
      dangerEv: this.lastDangerEv,
      plan: this.lastPlan
        ? { ...this.lastPlan.action, score: this.lastPlan.score }
        : undefined,
      planTerms: this.lastPlan?.terms,
      shotEv: {
        best: this.lastBestEv,
        // R-V2: `minShotValueFraction` is a FRACTION of the shooter's own kit ceiling, not an
        // absolute EV — resolve it the same way `firing.ts`'s real gate does, so `best/threshold`
        // on the overlay is a like-for-like ratio rather than a number divided by a fraction.
        // `bestAchievableValueOf` is memoised per (carId, sigma), so this costs nothing beyond the
        // first call.
        threshold: this.effectiveProfile.minShotValueFraction
          * bestAchievableValueOf(view.self.carId, this.effectiveProfile.aimErrorSigmaRad),
      },
    };

    const idle = this.situation.current === "recover";
    return applyHumanize(
      this.humanize, this.held, view.tick, this.effectiveProfile, view.rng, idle, decisionWindow,
      // P41's `second-best` blunder: the line this bot rated second, so a mistake is a plausible
      // alternative rather than an inverted control. Threaded state, never a draw — `lastPlan` is
      // written by `plan()` above and this argument is passed on every branch, `undefined`
      // included, so the rng stream is unmoved (H21).
      this.lastPlan?.runnerUp,
    );
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
    // R-O2: the same predicate as before, minus the heading it used to be spelled as. This was
    // `wallDesire(...) !== undefined`; `wallAhead` shares that function's geometry outright, so
    // `unpin` still fires on exactly the ticks it used to. It is deliberately NOT a bound test on
    // the current POSITION, which ignores which way the nose is pointed — that would be a different
    // predicate firing on different ticks. (`movement.ts` carries the same sentence; this one used
    // to name the deleted `nearBound` and now matches it.)
    // Task 12: a spiked wall must register as "pinned" earlier than a bare one, or the easy-tier
    // pin-on-walls behaviour above (deliberate, and still deliberate) grinds HP off on spike strips
    // instead of a harmless corner. `spikesAhead` cannot push harder — there is no push vector left
    // by the time `wallAhead` returns a boolean — so "avoid spikes harder" is spent entirely on
    // noticing them sooner, via a longer lookahead (`BRAIN_CONSTANTS.spikeLookaheadFactor`, AS28).
    const pinned = wallAhead(self, view.arena, profile.wallLookaheadUnits)
      || spikesAhead(self, view.arena, profile.wallLookaheadUnits * BRAIN_CONSTANTS.spikeLookaheadFactor)
      || inCorner(self, view.arena);

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
    // Hoisted above the danger term (R-C-I1). The gate it was originally hoisted for — the
    // anticipatory evade — was deleted by P27; what still reads it up here is the `me` view built
    // just below, whose `alive: true, phased: false` literals are only honest because this flag is
    // what stops the bot acting on that answer. It then goes on to `classifySituation` as
    // `selfControlLost` further down — computed once, used twice. Draws no `rng()`.
    const selfControlLost = !self.alive || hasStatus(self.statuses, "phased", tick);
    // The bot's own pose as a `BotCarView`, so the danger solve takes us in the shape `solve()`
    // takes a target in, instead of re-deriving dead reckoning inline (R-C-M1).
    // `alive: true, phased: false` are deliberate literals: this is the OPPONENT'S view of
    // this bot for the purpose of "how much would that hurt me", which is asked of a live, solid
    // body — `selfControlLost` above is what stops the bot acting on the answer while it is neither.
    const me: BotCarView = {
      sessionId: self.sessionId, carId: self.carId, team: self.team,
      x: self.x, y: self.y, angle: self.angle, vx: self.vx, vy: self.vy,
      hp: self.hp, maxHp: self.maxHp, alive: true, phased: false,
      statuses: self.statuses, maneuver: self.maneuver,
    };
    const danger = target
      ? dangerEvAgainst({
          threat: target,
          me,
          // Where WE will be while their shot is in the air, rolled through the real drive model
          // rather than a straight line (P17). `selfPredictor`, not `physicsPredictor`: every field
          // it reads is on this bot's own HUD, so it draws no `rng()` at all and is safe inside this
          // ternary — a conditional draw here would make the stream depend on having a target (H21).
          // `throttle: 1`, under `selfPredictor`'s `OBSERVATION_MODIFIERS`, is what HOLDS the
          // current speed: `throttle: 0` coasts, which still lands SHORT; `accel: 0` in those
          // modifiers stops the other error, a rollout that assumes we floor it to the chassis
          // maximum. (This used to cite `DRIVE_CONFIG.drag` at 900 u/s^2 — a car to rest in 0.32 s,
          // 80 units against 400. That global knob was deleted by the 2026-09-06 car-physics
          // rework for per-car proportional coast, and at Mirage's 36-tick half-life a coasting
          // rollout covers 219 units against the 267 a held speed does. Same direction, much
          // smaller margin.) Either way the answer is the danger of a pose we
          // never hold. The bot is driving, at the speed it is driving at.
          meAt: selfPredictor(
            self, { steer: 0, throttle: 1 }, BRAIN_CONSTANTS.predictionHorizonTicks,
          ),
          readiness: (weaponId) =>
            readinessOf(this.perception, target.sessionId, weaponId, tick, profile),
          assumedAimSigmaRad: BRAIN_CONSTANTS.assumedOpponentAimSigmaRad,
          tick,
          arena: view.arena,
        })
      : 0;
    this.lastDangerEv = danger;

    // Where the target will be, rolled through the REAL drive model (P22). The held input and the
    // steer reconstruction both live INSIDE `physicsPredictor` now (final review, finding 1): the
    // steer has to be derived from the NOISED turn rate, after `stateEstimationSigma`'s draws, or the
    // turn half of that knob reaches nothing — reconstructed out here from the raw observation, every
    // tier read a curve perfectly and the noise only ever scaled a residual spin a steering car does
    // not have. See that function for the attribution rule (one cause: a held wheel or a ram's spin,
    // never both) and for why the rollout holds `throttle: 1`.
    //
    // What is left here is the raw observation and the horizon. `observedAngVelOf` is inferred from
    // two observed poses; everything downstream of it is `physicsPredictor`'s business.
    //
    // Constructed UNCONDITIONALLY: `physicsPredictor` draws four rng() calls — two gaussians, and
    // `gaussian` is Box-Muller, which draws a PAIR — and a draw that happened only when this bot had
    // a target would make the stream depend on the scene (H21). The predictor built on the
    // absent-target sentinel is discarded; its draws are not. Same discard `hearRoll` above already
    // performs. Only the DRAWS have to be unconditional, though — they are taken before the rollout —
    // so the sentinel's horizon is 0 and a searching bot does not run 90 discarded `stepDrive` steps
    // against a car that is not there on every decision tick.
    const predictTarget = target ?? ABSENT_TARGET;
    const targetPredictor = physicsPredictor(
      predictTarget,
      observedAngVelOf(this.perception, predictTarget.sessionId),
      target ? BRAIN_CONSTANTS.predictionHorizonTicks : 0,
      profile.stateEstimationSigma,
      view.rng,
    );
    const predictor = target ? targetPredictor : undefined;

    // One firing solution per ready slot (P7), fed to `chooseSlot` below AND to `bestValue` just
    // below, which no longer gates anything but is published as `BotDebug.shotEv.best` for the playground
    // overlay (R-C7 originally routed it to the anticipatory evade gate; P27 deleted that gate and
    // kept the reading). Built from the shooter's ACTUAL current pose, not the heading
    // it is steering toward — `solve` mirrors the real sim, which fires along `self.angle` (or the
    // aim-assist bearing), never along a desired heading. Moved above `classifySituation` (was
    // originally computed just before `chooseSlot`, far below): it depends on nothing the situation
    // decides, only `target`, `self.slots`, `slotIsReady`, `profile.aimErrorSigmaRad`, `tick`,
    // `view.arena` and the predictor above — all already known at this point — and `solve()` draws
    // no `rng()` (H21), so moving it earlier changes no draw's position in the stream.
    const solutions = new Map<number, FiringSolution>();
    if (target && predictor) {
      for (let i = 0; i < self.slots.length; i++) {
        const candidate = self.slots[i]!;
        if (!slotIsReady(candidate, tick)) continue;
        solutions.set(i, solve({
          shooter: {
            sessionId: self.sessionId, carId: self.carId, team: self.team,
            x: self.x, y: self.y, angle: self.angle, vx: self.vx, vy: self.vy,
            lockTargetSessionId: self.lockTargetSessionId,
          },
          slot: candidate, slotIndex: i, target, targetAt: predictor,
          aimSigmaRad: profile.aimErrorSigmaRad, tick, arena: view.arena,
        }));
      }
    }
    /**
     * The best EV/s this bot could itself deal from its CURRENT pose — 0 when no slot is ready or
     * nothing is aimed at the target.
     *
     * R-P27b: this survived the anticipatory evade's deletion (P27) on purpose. It no longer gates
     * anything — danger is a continuously-weighted score term now, not a trip threshold — but it is
     * half of the only honest reading of "am I winning this exchange from here", the other half
     * being `lastDangerEv`. A later task renders the pair on the playground overlay as the primary
     * tuning diagnostic. Not dead code: read it there before deleting it here.
     */
    let bestValue = 0;
    for (const solution of solutions.values()) {
      if (solution.value > bestValue) bestValue = solution.value;
    }
    this.lastBestEv = bestValue;

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
      selfControlLost,
      hittable: trulyHittable,
      // A shot already in flight, or a car bearing down. BOTH ARE EVENTS, which is the whole
      // content of this input now (P27, 2026-09-06): the third clause used to be an ANTICIPATORY
      // term — "I am standing in a loaded gun's firing solution" — with four gates and a 120-tick
      // refractory period bolted on to stop a STANDING condition from occupying an event's priority
      // slot. That apparatus is deleted, gates and all. Danger is scored continuously now, as
      // `objectives.ts`'s `theirEv` weight on every candidate the planner rolls, so the bot leans
      // off a line by degrees on every tick instead of declaring an excursion once every four
      // seconds. Do not port the gates back: they were scaffolding for a shape that no longer
      // exists.
      evade: shotThreats.length > 0 || (carIncoming && this.willEvadeCar),
      unpin: pinned && trulyHittable && this.willUnpin,
      punish: trulyHittable && (targetStunned || ultSpent
        || targetHpFraction <= profile.ultWindowHpFraction),
      reset: profile.retreatHpFraction > 0 && hpFraction < profile.retreatHpFraction,
      inOwnReach,
    });
    this.situation = pickSituation(this.situation, classified, tick, profile);
    const sit: SituationId = this.situation.current;

    /**
     * R-O5: the realized aim error steers the BODY now.
     *
     * `stepAimError` still draws its `rng()` every tick in `decide` (H21 — that draw may not move),
     * and `this.aimError.offsetRad` used to be added to `aimHeading`, the thing the deleted switch
     * pointed the wheels at. With the heading gone, the offset had no consumer at all, and dropping
     * it would have deleted "shaky hands wander the nose" as a steering behaviour. So the target
     * predictor is wrapped in a RIGID ROTATION of the world about the bot's own position: the bot
     * plans against where it believes the target is, which is off by its hands.
     *
     * THE RAW PREDICTOR STILL GOES TO `solve()` (below, unchanged). `solve` integrates over
     * `aimErrorSigmaRad` STATISTICALLY — it asks "what fraction of my shots land given hands this
     * shaky" — so feeding it the realized offset as well would count the same error twice, once as
     * a distribution and once as a sample. The trigger sees the distribution; the wheels see the
     * sample.
     */
    const offset = this.aimError.offsetRad;
    const cosOffset = Math.cos(offset);
    const sinOffset = Math.sin(offset);
    const believedTargetAt: PosePredictor | undefined = predictor
      ? (ticksAhead) => {
          const pose = predictor(ticksAhead);
          const dx = pose.x - self.x;
          const dy = pose.y - self.y;
          return {
            x: self.x + dx * cosOffset - dy * sinOffset,
            y: self.y + dx * sinOffset + dy * cosOffset,
            angle: pose.angle + offset,
          };
        }
      : undefined;

    /**
     * R-O6: the hunt drives THROUGH the planner, not around it.
     *
     * `waitOut` has no target to aim at, so it supplies a synthetic one — a waypoint FAR along the
     * hunt heading — and a `preferredRange` of 0, which makes the planner's `rangeError` term read
     * "get to that point". `planner.ts` was built for exactly this: `scoreCandidate` deliberately
     * does NOT early-return when `target` is undefined, and still scores `rangeError` and
     * `wallPenalty` off `targetAt`. Verified against the committed planner before relying on it. A
     * parallel mover here is what P27 exists to prevent.
     *
     * R-P13 (residuals round): the projection is `profile.awarenessRadiusUnits`, NOT
     * `minEngageUnits`. A HUNTING BOT HEADS IN A DIRECTION; it does not drive to a point one
     * car-length away and stop. The 70 was inherited from the old `huntHeading`, which returned a
     * `range` alongside its heading for a mover that no longer exists, and the planner rewrite
     * reused the number for a different job. It broke G12: with the waypoint 70 units along the
     * hunt heading, a candidate that reverses ends up SEVEN UNITS closer to it than one that turns
     * and drives (measured at the failing tick, `rangeError` 48.65 vs 55.70), because 70 units is
     * well inside the ~120-unit arc a hard bot traces over its commitment window. So the bot
     * moonwalked toward what it was hunting. Projecting at the awareness radius makes every
     * candidate's error monotone in "did I close on the heading", which is the whole content of a
     * hunt. Nothing depends on the waypoint being reachable: `huntHeading` is re-evaluated on every
     * recompute, so the bot never arrives at a stale point — it only ever follows the current one.
     */
    const hunt = sit === "waitOut" ? this.huntHeading(view, self.angle) : undefined;
    const preferredRange = preferredRangeFor(sit, ownComfort, fightRange);
    this.lastPreferredRange = preferredRange;

    const targetAt: PosePredictor = hunt
      ? () => ({
          x: self.x + Math.cos(hunt.headingRad) * profile.awarenessRadiusUnits,
          y: self.y + Math.sin(hunt.headingRad) * profile.awarenessRadiusUnits,
          angle: hunt.headingRad,
        })
      : believedTargetAt ?? (() => ({ x: self.x, y: self.y, angle: self.angle }));

    // P27: the ONE place an objective becomes `steer` and `throttle`. The situation supplied a
    // weight vector; the planner rolls the real drive model and picks the input. There is nowhere
    // left for a second heading to be averaged in — that averaging was spec section 1.1.
    const result = planMotion({
      self,
      target,
      targetAt,
      readiness: (weaponId) => (target
        ? readinessOf(this.perception, target.sessionId, weaponId, tick, profile)
        : 1),
      aimSigmaRad: profile.aimErrorSigmaRad,
      preferredRange,
      // R-P8, P40: the reactive dodge, restored as a score term. `shotThreats` was computed above
      // for `classifySituation`'s `evade` clause and is passed straight through — the same list,
      // already filtered by `dodgeChance` and `dodgeReactionTicks` inside `perceive`/`activeThreats`,
      // so those three knobs still decide WHETHER the bot reacts and this only decides HOW. Passing
      // it moves no `rng()` draw: `activeThreats` is a filter over already-drawn state and this call
      // site takes the same argument on every branch, empty list included (H21).
      shotThreats,
      weights: weightsFor(sit, profile),
      horizonTicks: profile.planHorizonTicks,
      // R-P12 (fix round 5): the commitment window is NOT passed. It used to be
      // `profile.recomputeTicks`, on the reasoning that a candidate should model the window the
      // hands really hold — but the sweep says the window is a property of the PLAN, not of the
      // recompute cadence, so `plan` derives it from its own horizon and
      // `BRAIN_CONSTANTS.commitWindowFraction`. That also makes it unbreakable: a caller cannot
      // hand the planner a window its horizon cannot contain.
      depth: profile.planDepth,
      targetBranches: profile.targetBranches,
      commitPenalty: profile.commitPenalty,
      lastAction: this.lastAction,
      // R-P7c: `applyHumanize`'s delay line holds this decision for `reactionDelayTicks` before it
      // reaches the wheels, so the planner rolls from the pose the bot will be in by then. The
      // profile field is the single source of that number — the planner never learns which tier it
      // is, only how much dead time it has (H8).
      actuationDelayTicks: profile.reactionDelayTicks,
      // R-P10b: the actions already in the delay line, oldest first — what the wheels will
      // actually see over the dead time. Reading the queue moves no `rng()` draw: it is state
      // `applyHumanize` already wrote, and this call site passes it on every branch (H21).
      pending: this.humanize.delayLine.map((i) => ({ steer: i.steer, throttle: i.throttle })),
      tick,
      arena: view.arena,
    });
    this.lastAction = result.action;
    this.lastPlan = result;
    const { steer, throttle } = result.action;

    const stuckOk = this.stuckSlot !== undefined
      && tick - this.stuckSinceTick < profile.slotStickTicks;
    const decision = chooseSlot({
      self, target: target ?? ABSENT_TARGET, profile,
      weights: this.slotWeights, tick, lastPressTick: this.lastPressTick, rng: view.rng,
      ultHold: this.ultHold, situation: sit, roles,
      stuckSlot: stuckOk ? this.stuckSlot : undefined,
      solutions,
    });
    // R-O3: the fire gate is the deleted switch's `mayFire`, unchanged. P27 replaced heading
    // selection; it said nothing about who may pull a trigger.
    const mayFire = FIRING_SITUATIONS.has(sit) && trulyHittable;
    const slot = mayFire ? decision.slot : undefined;
    if (slot !== undefined) {
      this.lastPressTick = tick;
      this.stuckSlot = slot;
      this.stuckSinceTick = tick;
    }
    this.lastFiredSlot = slot;
    void this.wantsRam;
    // `lastBestEv` and `lastPlan`, written above, are read by `decide` when it builds `lastDebug`
    // (P45) — no `void` placeholder needed here any more; both are genuinely consumed now.

    if (sit === "recover") return COAST;
    return { steer, throttle, fireSlots: slot === undefined ? 0 : 1 << slot };
  }

  /**
   * WHERE TO DRIVE WHEN NOBODY IS HITTABLE: a heading, and ONLY a heading (M5, fix wave 3,
   * 2026-09-07).
   *
   * It used to return `range` and `closing` alongside it. `closing` never had a reader, and
   * R-P13 removed the last use of `range` when it stopped projecting the hunt waypoint at
   * `minEngageUnits` and started projecting it at `profile.awarenessRadiusUnits` — see the comment
   * on `targetAt`'s `hunt` branch above for why the 70 was a defect. Four call sites returning
   * `range: BRAIN_CONSTANTS.minEngageUnits` is an invitation to re-derive exactly that bug, so they
   * are gone. The `minEngageUnits` still read below is a different use: it is how close the bot has
   * to get before a search waypoint counts as visited.
   *
   * Draws no `rng()` (H21); nothing here or in its helpers touches the stream.
   */
  private huntHeading(
    view: BotView,
    fallbackHeading: number,
  ): { headingRad: number } {
    const self = view.self;
    const tick = view.tick;
    if (acquiringUnnoticed(this.perception, tick) && !lastKnownAnchor(this.perception, tick)) {
      return { headingRad: fallbackHeading };
    }
    const known = lastKnownAnchor(this.perception, tick);
    if (known) {
      return { headingRad: Math.atan2(known.y - self.y, known.x - self.x) };
    }
    const heard = this.huntHear ? nearestHeardShot(self, view.instances) : undefined;
    if (heard) {
      return { headingRad: Math.atan2(heard.y - self.y, heard.x - self.x) };
    }
    let waypoint = searchWaypoint(this.searchIndex, view.arena);
    if (Math.hypot(waypoint.x - self.x, waypoint.y - self.y) < BRAIN_CONSTANTS.minEngageUnits) {
      this.searchIndex += 1;
      waypoint = searchWaypoint(this.searchIndex, view.arena);
    }
    return { headingRad: Math.atan2(waypoint.y - self.y, waypoint.x - self.x) };
  }
}

/**
 * The distance this play wants to hold, in units (R-O4).
 *
 * The deleted eight-case switch shaped a `range` per situation alongside its heading, and P27 only
 * replaced the HEADING half. Collapsing every play onto `preferredRangeOf` would delete four real
 * behaviours at once — `punish` walking into a stunned target, `reset` giving up ground, `close`
 * driving to contact, and `fightRange`'s respect for the opponent's shortest reach — and would
 * leave the planner's `rangeError` term scoring against a target that means nothing in five of the
 * eight plays. These are the switch's own values, verbatim.
 *
 * `fightRange` is `max(ownComfort, theirKeepOut)`: stand where MY kit works, but never inside the
 * range their shortest gun keeps me out of.
 */
function preferredRangeFor(sit: SituationId, ownComfort: number, fightRange: number): number {
  switch (sit) {
    // Coasts. The range term is scored but nothing acts on it, and the overlay reads 0.
    case "recover":
      return 0;
    // Drives at a hunt waypoint through a synthetic `targetAt` (R-O6), so "hold this range from the
    // thing I am driving at" is exactly 0: arrive.
    case "waitOut":
      return 0;
    case "punish":
      return Math.max(
        BRAIN_CONSTANTS.minEngageUnits, ownComfort * BRAIN_CONSTANTS.punishRangeFraction,
      );
    case "reset":
      return Math.max(
        fightRange * BRAIN_CONSTANTS.resetRangeMultiplier, BRAIN_CONSTANTS.minEngageUnits,
      );
    case "close":
      return BRAIN_CONSTANTS.minEngageUnits;
    case "evade":
    case "unpin":
    case "fight":
      return fightRange;
  }
}

function seenWeapons(perception: PerceptionState, sessionId: string | undefined): WeaponId[] {
  if (!sessionId) return [];
  const prefix = `${sessionId}:`;
  const out: WeaponId[] = [];
  for (const key of perception.firedSeenTick.keys()) {
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
  const closing = (target.vx * dx + target.vy * dy) / dist;
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
