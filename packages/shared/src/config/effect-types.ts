/**
 * Every timed effect in the game. Add an id here and a row in `EFFECT_TABLE`.
 *
 * Effects are the game's DURATION layer. The ram knock is the impulse layer — it lands in one tick
 * and decays on its own — and weapons are the damage layer. An effect is neither: it is a window of
 * altered rules that opens on one car and closes by itself. Nothing here deals damage, and nothing
 * here moves a car; an effect only ever scales a number the sim was already reading.
 *
 * The rows below are the reference set the mechanism ships with. **No weapon and no pickup applies
 * any of them yet** — the two seams that will (`WeaponDef.onHit`, and the room's effect request
 * queue) exist and are wired, and are simply unused. They are deliberately tuned as plausible
 * starting values rather than as balance: retuning a row, renaming one, or deleting one that no
 * future weapon wants costs nothing while nothing applies it.
 */
export type EffectId =
  | "overdrive"
  | "tarred"
  | "rattled"
  | "primed"
  | "exposed"
  | "hardened"
  | "stoked"
  | "jammed";

/**
 * Every number in the sim an effect may scale. One channel per thing the sim already reads, and a
 * channel exists only where a single named call site consumes it — that is what keeps "what can a
 * buff do" answerable by reading this union rather than by grepping the tick.
 *
 * Every channel is a MULTIPLIER with 1 as neutral, never an additive term and never an absolute
 * value. Three consequences, all of them wanted:
 *
 *  - Neutral is exactly reproducible. A car carrying no effects multiplies every channel by 1, so
 *    `NEUTRAL_MODIFIERS` reproduces the pre-effect sim bit for bit — the same property the ram work
 *    bought with `angVel: 0` and `authority: 1`, and `golden.test.ts` pins it the same way.
 *  - Sources compose without an order. Multiplication commutes, so two effects landing in either
 *    order give the same number and no source has to know about any other.
 *  - Stacking diminishes on its own. Two 0.7 slows are 0.49, not 0.4 — each further source buys
 *    strictly less than the last, so a focus-fired car degrades toward a floor rather than through
 *    it. `EFFECT_LIMITS` is the hard backstop under that.
 */
export type EffectChannel =
  /** Forward and reverse top speed (`forwardMaxSpeedOf` / `reverseMaxSpeedOf`). */
  | "topSpeed"
  /** Engine push: `DRIVE_CONFIG.accel` and `reverseAccel`. Braking and drag are NOT scaled. */
  | "accel"
  /** Steering rate, alongside — never instead of — the ram's `authority`. */
  | "turnRate"
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
 * Rule switches an effect may flip. Booleans, OR-ed across every source: one jam is a jam, and a
 * second one changes nothing but the clock.
 *
 * Deliberately only two, and only one of them used. Boolean state is where a debuff stops being a
 * disadvantage and starts being a spectator: it has no counterplay gradient, so every one added
 * here is a decision about how much of the game a player may lose. See the design note on
 * `immobilised` in `effect-config.ts`.
 */
export type EffectFlag = "disarmed" | "immobilised";

/**
 * What happens when an effect that is already running is applied again.
 *
 * - `refresh` — the clock restarts, the magnitude does not change. The default, and the legible
 *   one: a car is either under an effect or it is not, and re-applying only buys time.
 * - `stack` — the clock restarts AND the magnitude compounds, to `maxStacks`. Each stack multiplies,
 *   so the third is worth less than the first. For effects that should reward sustained pressure.
 * - `ignore` — a running effect is not re-applied at all: it must expire before it can be re-armed.
 *   The anti-perma-lock rule, for anything strong enough that refreshing it would be a lock.
 */
export type EffectStacking = "refresh" | "stack" | "ignore";

/** Display bucket. Render-only — the sim never reads it, so it is not a schema field. */
export type EffectKind = "buff" | "debuff";

export interface EffectDef {
  id: EffectId;
  /** Display name. Render-only, like `WeaponDef.name`. */
  name: string;
  /**
   * Buff or debuff, for the HUD to colour and sort by. Render-only, and NOT derived from the
   * modifiers: whether `ramMass` up is good for you depends on the fight, and the player wants one
   * answer, not an argument.
   */
  kind: EffectKind;
  /** The HUD badge colour, `#RRGGBB`. Render-only, like `WeaponDef.color`. */
  color: string;
  /** How long one application lasts. Authored in ms and converted to ticks once, in `EFFECT_TICKS`. */
  durationMs: number;
  stacking: EffectStacking;
  /** Stacks one application may reach. Must be 1 unless `stacking` is `"stack"`. */
  maxStacks: number;
  /**
   * Per-stack multipliers. An absent channel is 1 — a row states only what it changes, so reading a
   * row tells you its whole effect.
   */
  modifiers: Partial<Record<EffectChannel, number>>;
  /** Rule switches this effect flips. Absent is none. */
  flags?: readonly EffectFlag[];
}
