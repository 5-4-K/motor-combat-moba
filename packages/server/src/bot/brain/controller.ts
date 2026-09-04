import { weaponDefOf, type BotDifficulty } from "@motor-combat-moba/shared";
import { BOT_PROFILES, type BotProfile } from "../../config/bot-profiles.js";
import type { BotCarView, BotController, BotDebug, BotIntent, BotView } from "../types.js";
import { interceptPoint, newAimErrorState, signedDelta, stepAimError, type AimErrorState } from "./aim.js";
import { chooseSlot, preferredRangeOf } from "./firing.js";
import { knownCars, newPerception, perceive, type PerceptionState } from "./perception.js";

const COAST: BotIntent = { steer: 0, throttle: 0, fireSlots: 0 };

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
  /** The range and slot `chase` last computed, threaded into `debug()` (H12). */
  private lastPreferredRange = 0;
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
    this.target = target?.sessionId;

    // LAYER 2/3/4 — assess, move, shoot, on the recompute cadence (Tasks 4-6)
    if (this.shouldRecompute(view.tick)) {
      this.held = target ? this.chase(view, target) : COAST;
    }

    this.lastDebug = {
      tick: view.tick,
      stance: target ? "engage" : "hunt",
      stanceScores: {},
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

  /**
   * Placeholder stance/movement, replaced layer by layer over Tasks 5-7. Steers at the target,
   * holds a range derived from the bot's own ready weapons (Task 4's `preferredRangeOf`), and
   * presses at most ONE ranked slot (H27) via `chooseSlot` — `beginFire` resolves one press per
   * tick and takes the lowest set bit, so an OR of every in-range slot fires slot 0 and nothing
   * else.
   */
  private chase(view: BotView, target: BotCarView): BotIntent {
    // Lead against slot 0 rather than the slot `chooseSlot` will actually rank highest: which slot
    // that is depends on distance and aim fit, both computed below from this very bearing, so there
    // is no slot to rank yet at the point the lead is needed. A weapon's own `speed` is public
    // knowledge, so leading with any one slot is fair (H22); slot 0 is simply the stand-in.
    const leadSpeed = view.self.slots[0] ? weaponDefOf(view.self.slots[0].weaponId).speed : 0;
    const aimPoint = interceptPoint(
      { x: view.self.x, y: view.self.y },
      { x: target.x, y: target.y, speed: target.speed, angle: target.angle },
      leadSpeed,
      this.effectiveProfile.leadFactor,
    );
    const bearing = Math.atan2(aimPoint.y - view.self.y, aimPoint.x - view.self.x)
      + this.aimError.offsetRad;
    const delta = signedDelta(view.self.angle, bearing);
    const distance = Math.hypot(target.x - view.self.x, target.y - view.self.y);

    const steer: -1 | 0 | 1 =
      delta > this.effectiveProfile.aimToleranceRad ? 1 : delta < -this.effectiveProfile.aimToleranceRad ? -1 : 0;

    const preferred = preferredRangeOf(view.self, this.effectiveProfile, this.slotWeights, view.tick);
    this.lastPreferredRange = preferred;
    const band = preferred * this.effectiveProfile.deadbandFraction;
    const throttle: -1 | 0 | 1 =
      Math.abs(distance - preferred) <= band ? 0 : distance > preferred ? 1 : -1;

    const decision = chooseSlot({
      self: view.self, target, distance, aimDelta: delta, profile: this.effectiveProfile,
      weights: this.slotWeights, tick: view.tick, lastPressTick: this.lastPressTick, rng: view.rng,
    });
    if (decision.slot !== undefined) this.lastPressTick = view.tick;
    this.lastFiredSlot = decision.slot;
    const fireSlots = decision.slot === undefined ? 0 : 1 << decision.slot;

    return { steer, throttle, fireSlots };
  }

  private pickTarget(view: BotView): BotCarView | undefined {
    // What the bot has actually noticed, not everything `buildBotView` handed it (Task 3). A fixed
    // target that has not cleared its acquire delay yet is simply not here, and `decide` coasts —
    // that is the acquire delay doing its job rather than a bug to special-case around.
    const known = knownCars(this.perception, view.tick);
    if (this.fixedTarget !== undefined) {
      const fixed = known.find((o) => o.sessionId === this.fixedTarget);
      return fixed?.alive ? fixed : undefined;
    }
    let best: BotCarView | undefined;
    let bestDistance = Infinity;
    for (const other of known) {
      if (!other.alive || other.phased) continue;
      if (other.team === view.self.team && known.some((o) => o.team !== view.self.team)) continue;
      const distance = Math.hypot(other.x - view.self.x, other.y - view.self.y);
      if (distance < bestDistance) { bestDistance = distance; best = other; }
    }
    return best;
  }
}
