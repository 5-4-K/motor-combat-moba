import type {
  ActiveStatus, CarId, FiredEvent, Aabb, WeaponId,
} from "@motor-combat-moba/shared";
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
  x: number; y: number; angle: number; speed: number;
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
  x: number; y: number; angle: number; speed: number;
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
   * Empty when the host does not collect combat events, which is every room today. A bot that needs
   * these is what turns the `fired` sink on in that room.
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
}
