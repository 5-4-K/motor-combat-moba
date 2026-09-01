import { TICK_RATE_HZ } from "../constants.js";
import { DRIVE_CONFIG } from "./drive-config.js";

/**
 * Ram control-and-knockback tuning. Every value here is read by the sim, so server tick and client
 * prediction both depend on them agreeing — this is networked balance, not render preference.
 *
 * **Decays are authored as half-lives in SECONDS, never as per-tick multipliers.** The design this
 * implements was written against a 60 Hz sim and this project runs at 30; a per-tick decay copied
 * across unchanged would silently halve every recovery time. Authoring in seconds and converting
 * once, here, makes the table tick-rate independent. Same principle as `weapon-ticks.ts` converting
 * authored milliseconds to ticks exactly once at module load.
 *
 * `massPerRating` lives here rather than in `COMBAT_CONFIG` because mass affects ramming and nothing
 * else — never acceleration, never top speed. That is deliberate: a force-based drive would make
 * heavy imply sluggish and collapse the roster to one axis, so mass stays out of the drive model
 * entirely and exists only as combat identity.
 */
export const RAM_CONFIG = {
  /**
   * World units each hull is inflated by when testing for ram contact.
   *
   * A ram must be detected as contact, not interpenetration: `resolveWorld` runs first and pushes
   * cars out to *exactly* the separation boundary, and SAT treats "just touching" as separated. A
   * strict overlap test is therefore false on every tick of a real ram. Kept small — cars rebound to
   * a 2-8 unit gap on following ticks, and a pad reaching those would fire on near-misses.
   */
  contactPad: 1,
  /**
   * Below this closing speed along the attacker's nose, a contact is a nudge and no ram is written.
   * About 11% of the roster's top speed. This is also what stops a pair chattering in and out of
   * contact from re-triggering: after impact the attacker has already been rebounded to roughly
   * -35% of its impact speed by `applyContact`, so its approach term is negative.
   */
  minApproachSpeed: 60,
  /** Rating-to-mass scale, mirroring `COMBAT_CONFIG.hpPerRating`. Ratings are 0-100. */
  massPerRating: 10,

  /**
   * The positional read, and the single most important balance lever in the feature. Front is cheap
   * so head-on ramming is deliberately not the play; rear is dear so getting behind someone pays.
   */
  bonusFront: 0.3,
  bonusFlank: 1.0,
  bonusRear: 1.3,

  /** Steering multiplier at maximum severity. The feel dial: too low and the victim is a passenger. */
  authorityFloor: 0.35,
  /** Peak knock impulse (expressed as a speed) at severity 1.0, before the victim mass factor. */
  knockMaxSpeed: 260,
  /** Bounds on `referenceMass / victimMass`, so neither the heaviest nor the lightest car degenerates. */
  massFactorMin: 0.6,
  massFactorMax: 1.6,
  /**
   * Calibration multiplier on the torque-derived spin rate. Tuned by feel, not derived: it converts
   * a speed-magnitude impulse into a plausible angular rate, and 100 was chosen so a solid flank ram
   * (moderate severity, a lever arm off centre but short of the hull edge) lands near 2 rad/s while
   * the hardest possible ram saturates `spinMaxRate`.
   */
  spinScale: 100,
  /** Ceiling on injected spin, so a corner contact cannot produce an absurd rotation. */
  spinMaxRate: 6.0,
  /**
   * Rotational inertia per unit mass for the car hull, `(len^2 + wid^2) / 12`. Derived from the hull
   * so it cannot drift out of step with `carHullOf`.
   */
  inertiaCoefficient: (DRIVE_CONFIG.carWidth ** 2 + DRIVE_CONFIG.carHeight ** 2) / 12,

  /** Injected spin halves this often while the player is not fighting it. */
  spinHalfLifeSeconds: 0.35,
  /** Lateral knock halves this often. */
  shoveHalfLifeSeconds: 0.25,
  /** The gap between current authority and full control halves this often. */
  authorityHalfLifeSeconds: 0.3,
  /**
   * Spin half-life while the player steers AGAINST it. Shorter than `spinHalfLifeSeconds` on
   * purpose: without this, steering only offsets the visible rotation and recovery time is fixed by
   * decay alone, so skill cannot shorten a spin. This one constant is what makes countersteering a
   * skill rather than a cosmetic.
   */
  counterSteerHalfLifeSeconds: 0.15,

  /** Below these magnitudes a knock snaps to exact rest, as `stopEpsilon` does for `speed`. */
  spinEpsilon: 0.01,
  shoveEpsilon: 1,
  authorityEpsilon: 0.01,
} as const;

/**
 * A half-life in seconds to the per-tick multiplier that realises it. `0` for a non-positive or
 * non-finite input, so a bad config value produces a knock that vanishes immediately rather than one
 * that NaNs the whole body and never recovers.
 */
export function halfLifeToPerTick(halfLifeSeconds: number): number {
  if (!Number.isFinite(halfLifeSeconds) || halfLifeSeconds <= 0) return 0;
  return 0.5 ** (1 / (halfLifeSeconds * TICK_RATE_HZ));
}

/** The four decays `stepDrive` applies, as per-tick multipliers. */
export interface RamDecay {
  spin: number;
  shove: number;
  authority: number;
  counterSteer: number;
}

function resolveRamDecay(): Readonly<RamDecay> {
  return Object.freeze({
    spin: halfLifeToPerTick(RAM_CONFIG.spinHalfLifeSeconds),
    shove: halfLifeToPerTick(RAM_CONFIG.shoveHalfLifeSeconds),
    authority: halfLifeToPerTick(RAM_CONFIG.authorityHalfLifeSeconds),
    counterSteer: halfLifeToPerTick(RAM_CONFIG.counterSteerHalfLifeSeconds),
  });
}

/**
 * The per-tick multipliers, derived once at module load and frozen. Server and client both import
 * shared's built `dist`, so both compute identical decays or neither does.
 */
export const RAM_DECAY: Readonly<RamDecay> = resolveRamDecay();

/** `RAM_DECAY` itself until playground tuning overrides a half-life, and again once it clears. */
let ACTIVE_DECAY: Readonly<RamDecay> = RAM_DECAY;

/**
 * What the sim actually decays by. `stepDrive` reads this rather than `RAM_DECAY` so the four
 * half-life knobs are reachable by tuning at all — they are authored in seconds and nothing in the
 * sim reads them directly.
 */
export function ramDecay(): Readonly<RamDecay> {
  return ACTIVE_DECAY;
}

/**
 * Playground tuning only (spec PG12) — see `rebuildResolvedDrive` for why `hasOverrides` is passed
 * in rather than read back from the tuning store.
 */
export function rebuildRamDecay(hasOverrides: boolean): void {
  ACTIVE_DECAY = hasOverrides ? resolveRamDecay() : RAM_DECAY;
}
