/**
 * Every status in the game. Add an id here and a row in `STATUS_TABLE`.
 *
 * A **status** is a named, timed condition a car can be in, and a row here says what being in it
 * does. It is the sim's duration layer: ramming is the impulse layer (one tick, then decay) and
 * weapons are the damage layer, and a status is neither — it is a window of altered rules that opens
 * on one car and closes by itself.
 *
 * **A status does not own its duration.** How long it lasts is decided by whatever applied it — a
 * weapon's `applies` entry today, a pickup later. The same status can therefore be a flicker from
 * one source and a real window from another, which is what lets one status serve several weapons
 * without the table growing a near-duplicate row per duration.
 */
export type StatusId =
  | "overheated"
  | "corroded"
  | "stunned"
  | "spiked"
  | "fortified"
  | "overhauled";

/**
 * Every number in the sim a status may scale. One channel per thing the sim already reads, and a
 * channel exists only where a single named call site consumes it — that is what keeps "what can a
 * status do" answerable by reading this union rather than by grepping the tick.
 *
 * Every channel is a MULTIPLIER with 1 as neutral, never an additive term and never an absolute
 * value. Three consequences, all of them wanted:
 *
 *  - Neutral is exactly reproducible. A car in no status multiplies every channel by 1, so
 *    `NEUTRAL_MODIFIERS` reproduces the pre-status sim bit for bit — the same property the ram work
 *    bought with `angVel: 0` and `authority: 1`, and `golden.test.ts` pins it the same way.
 *  - Sources compose without an order. Multiplication commutes, so two statuses landing in either
 *    order give the same number and no source has to know about any other.
 *  - Stacking diminishes on its own. A 5% slow and a 10% slow are 14.5% together, not 15% — each
 *    further source buys strictly less than the last, so a focus-fired car degrades toward a floor
 *    rather than through it. `STATUS_LIMITS` is the hard backstop under that.
 */
export type StatusChannel =
  /** Forward and reverse top speed (`forwardMaxSpeedOf` / `reverseMaxSpeedOf`). */
  | "topSpeed"
  /** Engine push: `accelOf` and `reverseAccelOf`. Drag is NOT scaled. */
  | "accel"
  /** Steering rate, alongside — never instead of — the ram's `authority`. Above 1 corners tighter. */
  | "turnRate"
  /**
   * `DRIVE_CONFIG.brakeDecel`. The one "make the car harder to control" channel that is not about
   * pace: brake fade makes a driver misjudge a corner rather than merely arrive at it later.
   *
   * Floored by `STATUS_LIMITS` at a value that keeps scaled braking above `DRIVE_CONFIG.drag`, so
   * the brake is always at least as good as lifting off. `status-config.test.ts` asserts that
   * against the live drive numbers rather than trusting the constant.
   */
  | "brakeDecel"
  /** Outgoing weapon damage, applied once and frozen into the instance at spawn. */
  | "damageDealt"
  /** Incoming weapon damage, applied at the moment of impact. */
  | "damageTaken"
  /**
   * The three "when may I shoot again" clocks: `cooldown`, `refireDelay`, `recovery`. Below 1 is
   * faster. Wind-up (`startUp`) and the gap between volleys are deliberately NOT scaled — those are
   * the shape of one press, not the rate of pressing.
   */
  | "weaponCooldown"
  /** Effective ram mass, both as an attacker and as a victim (`massOf`). */
  | "ramMass";

/**
 * Rule switches a status may flip. Booleans, OR-ed across every source: one jam is a jam, and a
 * second one changes nothing but the clock.
 *
 * Each is deliberately ONE thing, so a status composes the condition it wants rather than inheriting
 * a bundle. `stunned` is all three; nothing else uses any of them.
 *
 * Boolean state is where a debuff stops being a disadvantage and starts being a spectator: it has no
 * counterplay gradient, so the only dial left is duration. Every row that flips one is therefore
 * required to be `reapply: "ignore"` — see `status-config.test.ts`.
 */
export type StatusFlag =
  /** Throttle forced to neutral. The car still steers, still brakes, still coasts down through drag. */
  | "immobilised"
  /** Steer input forced to 0. Injected ram spin is untouched — a stunned car still spins when hit. */
  | "steeringLocked"
  /** No NEW press may be committed. A press already committed still finishes. */
  | "disarmed";

/**
 * What happens when a status that is already running is applied again.
 *
 * - `ignore` — nothing happens at all. Not even the clock moves. The default, and the rule for
 *   anything strong enough that refreshing it would be a lock: it must expire before it can be
 *   re-armed, so two attackers cannot hold one car in it between them.
 * - `refresh` — the clock is extended, never shortened: `endsTick = max(existing, now + duration)`.
 *   For anything applied repeatedly by a lingering source. An aura wants this — with `ignore` a car
 *   sitting inside one would watch the status lapse and re-arm on a loop, which reads as a flicker
 *   rather than as a condition.
 *
 * There is no third option that compounds magnitude. A status cannot stack with itself: the same id
 * on one car is always exactly one instance at exactly the strength its row states. Different
 * statuses touching the same channel still stack, by multiplication.
 */
export type StatusReapply = "ignore" | "refresh";

/**
 * Buff or debuff.
 *
 * **Load-bearing, not display.** `onApply.cleanse` names a kind, so this decides what a repair
 * strips. A row whose kind is wrong is a rule bug, not a cosmetic one.
 */
export type StatusKind = "buff" | "debuff";

/**
 * Periodic hp change while the status runs — burn, bleed, repair.
 *
 * Authored as **an amount per pulse plus an interval**, deliberately not as a rate per second. It
 * mirrors `WeaponDef.damageFrequencyMs`, which is how every other repeating thing in this game is
 * authored, and it means the number in the table is the number the player sees. A `damagePerSecond`
 * field would have to be divided by the tick rate and rounded to whole hp, so the authored figure
 * and the delivered one would quietly disagree.
 *
 * Pulses are counted from the status's own `startTick`, so two cars hit a tick apart pulse a tick
 * apart rather than in lockstep, and no per-status accumulator has to exist (or be networked).
 */
export interface StatusPulse {
  /** Gap between pulses. Converted to whole ticks once, in `STATUS_TICKS`. */
  intervalMs: number;
  /** Hp removed per pulse. Routed through `applyDamage`, so it can wreck a car. */
  damage?: number;
  /** Hp restored per pulse, capped at the chassis's `hpOf`. Never revives a wreck. */
  heal?: number;
}

/** One-shot work done the moment a status is applied, before any of its ongoing rules run. */
export interface StatusOnApply {
  /**
   * Strip every running status of this kind from the car.
   *
   * Cleansing a damage-over-time status stops the bleeding; it does **not** give back hp already
   * lost. That is the whole difference between a repair and a heal, and it is why a cleanse can be
   * generous with its duration without being a second health bar.
   *
   * A status never cleanses itself: the strip runs before it is added.
   */
  cleanse?: StatusKind;
}

export interface StatusDef {
  id: StatusId;
  /** Display name, shown on the HUD badge. Render-only: `stepSim` never reads it. */
  name: string;
  kind: StatusKind;
  /** The HUD badge colour, `#rrggbb`. Render-only, like `WeaponDef.color`. */
  color: string;
  reapply: StatusReapply;
  /**
   * Per-channel multipliers. An absent channel is 1 — a row states only what it changes, so reading
   * a row tells you its whole effect.
   */
  modifiers: Partial<Record<StatusChannel, number>>;
  /** Rule switches this status flips. Absent is none. */
  flags?: readonly StatusFlag[];
  /** Periodic hp change while it runs. Absent is none. */
  pulse?: StatusPulse;
  /** One-shot work at application time. Absent is none. */
  onApply?: StatusOnApply;
}
