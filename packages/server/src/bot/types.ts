import type {
  ActiveStatus, CarId, FiredEvent, Aabb, WeaponId,
} from "@motor-combat-moba/shared";
import type { PlanWeights } from "./brain/planner.js";
import type { Rng } from "./rng.js";

/** What the bot asks for. Deliberately NOT an `InputMessage`: `seq` is the host's business. */
export interface BotIntent {
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  fireSlots: number;
}

/** One of this car's weapon slots, as its own HUD draws it. */
export interface BotSlotView {
  weaponId: WeaponId;
  stocks: number;
  rechargeEndsTick: number;
  refireLockUntilTick: number;
  /** `WeaponDef.range` — how far this slot reaches. */
  range: number;
}

/**
 * The bot's own car, in full. Everything here is on the player's own HUD, so all of it is fair
 * (B16).
 */
export interface BotSelfView {
  sessionId: string;
  carId: CarId;
  team: 0 | 1;
  x: number; y: number; angle: number; vx: number; vy: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  statuses: readonly ActiveStatus[];
  slots: readonly BotSlotView[];
  switchLockUntilTick: number;
  lockTargetSessionId: string;
  maneuver: number;
  maneuverTicksLeft: number;
}

/**
 * Another car, as it is drawn on screen.
 *
 * NO weapon slot state (B18). `stocks` / `rechargeEndsTick` / `refireLockUntilTick` are networked
 * for every player but the HUD draws only your own, so a bot reading an enemy's recharge timer
 * would be inside the wire and outside what a human can see — clairvoyance, and it would inflate
 * the measured value of cooldown-punishing play. What a human gets is `observedFires` below: they
 * watch the ult go off and remember it. The remembering is the bot's own state, and is exactly one
 * of the things separating a pro from a casual.
 */
export interface BotCarView {
  sessionId: string;
  carId: CarId;
  team: 0 | 1;
  x: number; y: number; angle: number; vx: number; vy: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Spawn-protected: driveable, not solid, not targetable. Visibly translucent on screen. */
  phased: boolean;
  statuses: readonly ActiveStatus[];
  /** `ManeuverKind` value — a dash or a charge is drawn in the world, so it is visible. */
  maneuver: number;
}

/** A shot in flight, as drawn. */
export interface BotInstanceView {
  id: string;
  ownerSessionId: string;
  weaponId: WeaponId;
  x: number; y: number; angle: number;
}

export interface BotArenaView {
  width: number;
  height: number;
  obstacles: readonly Aabb[];
}

/**
 * Everything a bot may know, and nothing else (B15).
 *
 * A CONSTRUCTED PROJECTION, never a handle on `ArenaState`. That is the structural form of "the bot
 * never cheats": `inputQueues` and `prevFireMasks` — the actual keypresses — are not reachable from
 * inside `decide`, because they are not in the type. A promise decays; a type does not.
 *
 * `others`/`instances` carry a vision limit as of B17: `arena-01` (1280x720) is authored to fit the
 * viewport exactly, so a human sees every car all the time and `buildBotView` filters nothing there
 * — but `arena-02` (2000x2000) does not fit, and on an arena larger than the viewport `buildBotView`
 * restricts both to what falls inside the viewport rectangle centred on the viewing car, the same
 * as `arena-01` always effectively did by being small enough that the check never mattered. The
 * limit lives in `buildBotView` and nowhere else.
 */
export interface BotView {
  tick: number;
  self: BotSelfView;
  others: readonly BotCarView[];
  instances: readonly BotInstanceView[];
  arena: BotArenaView;
  /**
   * Presses observed this tick — who fired what (B18). The observable half of enemy resource
   * tracking: a human sees the shot, and remembers.
   *
   * Every host that runs a bot already collects these and passes them: `PlaygroundRoom`,
   * `PracticeRoom` and the balance harness. `ArenaRoom` passes nothing and correctly so — it hosts
   * no bots. An earlier version of this comment claimed no room collected them, which was wrong and
   * hid the fact that cooldown tracking was already possible.
   */
  observedFires: readonly FiredEvent[];
  /** This bot's own seeded stream (B20). Never `Math.random()`. */
  rng: Rng;
}

/**
 * One bot, alive for one match.
 *
 * An INSTANCE, not a pure function (B10). It owns the reaction clock, the held intent, the fire
 * pulse, target selection, and — when the bot session lands — the memory of what it has seen. A
 * pure function could not remember an ult being spent, which is the whole of B18.
 *
 * A deathmatch respawn does NOT reset it: a human does not forget what they learned when they
 * respawn (B21).
 */
export interface BotController {
  readonly profileId: string;
  decide(view: BotView): BotIntent;
  /** Optional introspection for dev tools (H12). Never required by a host. */
  debug?(): BotDebug | undefined;
}

/** Tactical tasks the assess layer names (S13). */
export type SituationId =
  | "recover" | "waitOut" | "evade" | "unpin" | "punish" | "reset" | "fight" | "close";

/** The five personality archetypes (H47). */
export type PersonalityId = "brawler" | "kiter" | "sprayer" | "grudge" | "opportunist";

export interface BotPersonality {
  readonly id: PersonalityId;
  /** Preference weight per slot index, rolled per bot. Biases both firing and the range model. */
  readonly slotWeights: readonly number[];
}

/**
 * What the bot was thinking, for the playground overlay (H12).
 *
 * The deliberate answer to a scored decision layer's one weakness — that "why did it do that?" is
 * answered by reading a scoreboard. Never read by the sim, never on the wire from the bot's side.
 */
export interface BotDebug {
  tick: number;
  situation: SituationId;
  targetSessionId: string | undefined;
  preferredRange: number;
  personality: PersonalityId;
  /** The slot pressed this tick, or `undefined` when the bot held fire. */
  firedSlot: number | undefined;
  /** Damage per second the bot believes it is standing in front of (P16). Overlay only. */
  dangerEv: number;
  /** The action the planner chose, and what it scored. Overlay only (P45). */
  plan: { steer: -1 | 0 | 1; throttle: -1 | 0 | 1; score: number } | undefined;
  /**
   * Per-term contributions of the winning candidate (P45). Keyed off `PlanWeights` itself — not
   * retyped by hand — so a term added to the planner's weight vector cannot silently go unreported
   * here. Overlay only.
   *
   * The WIRE inherits that derivation rather than re-declaring it: `BotDebugPayload.terms` is an
   * open `Record<string, number>` and `PlaygroundRoom` copies this map's entries wholesale. It used
   * to flatten to six named fields, which meant this comment's guarantee stopped at the room's
   * broadcast — see that field's doc for why the mirror was deleted instead of guarded.
   */
  planTerms: Record<keyof PlanWeights, number> | undefined;
  /**
   * The best EV/s this bot's own kit could deal from its current pose, against the tier's resolved
   * absolute threshold — `profile.minShotValueFraction * bestAchievableValueOf(...)`, NOT the raw
   * fraction, so the overlay's `best/threshold` reads as a like-for-like ratio (R-V2). The primary
   * tuning diagnostic (P45).
   */
  shotEv: { best: number; threshold: number };
}
