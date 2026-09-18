import { TICK_RATE_HZ } from "../constants.js";
import { DRIVE_CONFIG, perTickDecay } from "./drive-config.js";
import { msToTicks } from "./weapon-ticks.js";

/**
 * Ram control-and-knockback tuning, rewritten for the Unity ram rule (spec §7): nose-first above
 * `minRamSpeed` stops the attacker dead and locks it, flings the victim, spins it, and leaves it
 * reeling. This replaces revision 2's two-sided contest (`pushOf`/`impactOn`, `defencePushScale`,
 * the three `bonus*` face weights, `knockMaxSpeed`) outright, not by retuning it — the Unity model
 * has no contest to retune: the attacker's outcome is a rule ("you stop"), not a computed push.
 *
 * Every value here is read by the sim, so server tick and client prediction both depend on them
 * agreeing — this is networked balance, not render preference.
 *
 * **Durations are authored in milliseconds, angles in degrees, distances in world units — this
 * project's usual authoring units — and converted exactly once, at module load** (`ramTicks()`,
 * `inertiaRadiusSquared()`, `reelingSpinPerTick()`), the same principle `weapon-ticks.ts` uses for
 * `WEAPON_TICKS`. `reelingSpinDecayRate` is authored per SECOND rather than as a half-life —
 * `perTickDecay` converts it directly (`exp(-rate / TICK_RATE_HZ)`), the same shape the Unity
 * drive-model port (stage 1) uses for `dragRate` and `lateralGripRate`. The half-life-based
 * `spinHalfLifeSeconds`/`counterSteerHalfLifeSeconds` pair this file used to carry, and the
 * countersteer mechanism they fed, are gone: Unity has no countersteer skill-lever, and `reeling`'s
 * `grip` multiplier (spec §9.2) is the successor — a rammed car scrubs its shove through the
 * ordinary drag/grip pass every tick already runs, not a knock-specific decay.
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
   * Minimum drive-in speed, u/s, for a car to QUALIFY as an attacker (spec §7.1, U24) — a real change
   * of rule, not a threshold on an existing one. The deleted `minApproachSpeed` gated whether the old
   * contest fired at all; this gates who is even allowed to be the one throwing the punch. Below it,
   * a flank-first slide into someone is a plain bump — no `RamResolution` at all.
   *
   * Unity's 3 m/s, ported at this project's world scale (`forwardMaxSpeedOf`'s figures put Unity's
   * 25 m/s at roughly 322 u/s here — spec §9.1).
   */
  minRamSpeed: 39,

  /**
   * Half-angle, in degrees, between two cars' headings within which a front-on-front hit classifies
   * as `headOn` rather than `flank` (spec §7.1). Unity's own value, ported unchanged — an angle needs
   * no unit conversion.
   */
  headOnAngleDeg: 45,

  /**
   * Width, in world units, of the corner band where `regionOf` calls a hit `frontCorner`/
   * `rearCorner` instead of a plain face (spec §7.1, U23). Unity's 0.3 m, ported at this project's
   * world scale.
   */
  cornerBandUnits: 4,

  /**
   * The three `RamType` shove multipliers (spec §7.2). Unity's own values, ported unchanged — they
   * are dimensionless ratios, not measured units, so there is nothing to convert. `flankScale` is
   * the roster's hardest hit, `rearScale` next, `headOnScale` the gentlest: getting behind someone
   * pays, and ramming head-on is deliberately not the play.
   */
  headOnScale: 0.2,
  flankScale: 1.5,
  rearScale: 1.2,

  /**
   * The single calibration knob reconciling Unity's 1-vs-1 `strength`/`resistance` scale with this
   * roster's `ramAttack`/`ramDefence` (45-70 and 30-90) (spec §7.2, U25).
   *
   * Pitched, not derived: at 0.5, a Bastion flanking a stationary Bullseye at Bastion's own top
   * speed throws it roughly 237 u/s — about 4 car lengths of slide, not across the arena.
   *
   * **Re-measure in stage 5; do not re-derive.** This is a starting point for the new shove formula,
   * not yet the measured-through-the-composed-`serverTick`-then-`contactTick` figure the deleted
   * revision-2 `globalScale` demonstrated the importance of using.
   */
  globalScale: 0.5,

  /**
   * Calibration multiplier on the spin delta a shove imparts (spec §7.2's `spinDelta` formula).
   *
   * Pitched, not derived: at 0.3, a typical flank ram lands around 4 rad/s against the 6 rad/s
   * `spinMaxRate` ceiling — comfortably under it rather than hugging it, unlike the deleted
   * `inertiaCoefficient`-era value (12.5), which was calibrated for a very different torque shape.
   *
   * **Re-measure in stage 5; do not re-derive** — see `globalScale`.
   */
  spinScale: 0.3,

  /**
   * Ceiling on injected spin, so a corner contact cannot produce an absurd rotation. Unchanged
   * value, but a new role: Unity applies no such clamp at its own scale (U26) — here it stays a
   * playability guard, not a physical limit.
   *
   * `docs/turn-tuning.md` tabulates this value — an edit here owes that page one.
   */
  spinMaxRate: 6.0,

  /** Below this magnitude a knock snaps to exact rest, as `stopEpsilon` does for the drive model. */
  spinEpsilon: 0.01,

  /**
   * Per-second decay rate for a reeling car's free spin — `reelingSpinPerTick()` converts it through
   * `perTickDecay`, the same exponential-rate shape the Unity drive-model port uses for `dragRate`
   * and `lateralGripRate`, rather than the half-life shape `spinHalfLifeSeconds` used before it
   * (deleted along with the countersteer mechanism it fed — see the file header for the successor).
   *
   * Unity's `EffectsConfig.reelingSpinDecayRate`, ported unchanged: it is already a per-second rate,
   * so there is nothing to convert but the base of the exponent, `TICK_RATE_HZ`.
   */
  reelingSpinDecayRate: 2.0,

  /**
   * How long a ram's attacker is locked (`ramLock`, spec §8) after landing a flank or rear hit —
   * shorter than `ramUncontrolMs` on purpose (spec §7.2): the attacker chose to stop, the victim did
   * not, and a lock as long as the victim's own reeling would let a chain of attackers each get away
   * before their target recovers. Unity's own value, ported unchanged.
   */
  attackerLockMs: 500,

  /**
   * Full-strength `reeling` duration from a ram, before falloff. Weapons author their own (stage 4).
   * Unity's `reelSeconds` — ported unchanged, and unchanged from what this project shipped before
   * the port, since the two happen to already agree.
   */
  ramUncontrolMs: 1000,

  /**
   * How long "recently rammed" lasts. ROLLING: each ram pushes the window out from itself, so
   * protection never lapses under sustained pressure. A window measured from the FIRST ram would
   * let an attacker who counts to one second land full-strength rams forever, which is the exact
   * lock this exists to prevent. Unchanged by the Unity port (U5).
   */
  drWindowMs: 2000,

  /**
   * Each successive ram's duration, as a fraction of the last. 1.0 disables duration falloff.
   * Unchanged by the Unity port (U5).
   *
   * **This knob does LESS than it reads, and the reason is structural.** `reeling` is
   * `reapply: "refresh"`, which `applyStatus` implements as `endsTick = max(existing, now + duration)`
   * — the status system's D4 rule, "the clock is extended, never shortened", written so a weak short
   * source cannot cut a long one down. A scaled duration is by definition the shorter value, so a
   * re-ram landing while `reeling` is STILL RUNNING has its scaled duration discarded outright.
   *
   * What this value actually governs is the window between `ramUncontrolMs` and `drWindowMs`: a ram
   * landing after the previous `reeling` has lapsed but while the falloff stack is still counting.
   * There, and only there, does it shorten anything.
   *
   * Turning it down further will therefore do much less than the arithmetic suggests. **If a ram
   * chain feels like a lock, reach for `impulseDrScale` or `ramUncontrolMs` instead** — the impulse
   * half of falloff has no such caveat and bites on every re-ram.
   */
  durationDrScale: 0.5,
  /** Duration never falls below this, so a late ram in a chain never reads as a whiff. Unchanged (U5). */
  durationDrFloorMs: 150,
  /** Each successive ram's impulse, as a fraction of the last. 1.0 disables impulse falloff. Unchanged (U5). */
  impulseDrScale: 0.5,
  /** Impulse never falls below this fraction of full. Unchanged (U5). */
  impulseDrFloor: 0.25,
} as const;

/**
 * A half-life in seconds to the per-tick multiplier that realises it. `0` for a non-positive or
 * non-finite input, so a bad config value produces a knock that vanishes immediately rather than one
 * that NaNs the whole body and never recovers.
 *
 * No `RAM_CONFIG` knob is authored as a half-life any more — `reelingSpinDecayRate` above is a plain
 * per-second rate converted by `perTickDecay` instead — but the function survives, exported, because
 * the suite above still exercises it directly.
 */
export function halfLifeToPerTick(halfLifeSeconds: number): number {
  if (!Number.isFinite(halfLifeSeconds) || halfLifeSeconds <= 0) return 0;
  return 0.5 ** (1 / (halfLifeSeconds * TICK_RATE_HZ));
}

/**
 * The hull's squared radius of gyration, `(w² + l²) / 12` — the inertia a ram's spin divides by.
 * Unity's `PushMath.SpinDelta` computes the same quantity from the collider footprint.
 *
 * DERIVED from `DRIVE_CONFIG` rather than authored, so it cannot drift from the hull it describes.
 * `RAM_CONFIG.inertiaCoefficient` was the authored stand-in and is deleted (U29).
 */
export function inertiaRadiusSquared(): number {
  return (DRIVE_CONFIG.carWidth ** 2 + DRIVE_CONFIG.carHeight ** 2) / 12;
}

/** Per-tick factor for a reeling car's free spin. Unity's `EffectsConfig.reelingSpinDecayRate`. */
export function reelingSpinPerTick(): number {
  return perTickDecay(RAM_CONFIG.reelingSpinDecayRate);
}

/** The four ram durations, in the integer ticks the sim actually counts. */
interface RamTicks {
  uncontrol: number;
  drWindow: number;
  durationFloor: number;
  attackerLock: number;
}

function resolveRamTicks(): Readonly<RamTicks> {
  return Object.freeze({
    uncontrol: msToTicks(RAM_CONFIG.ramUncontrolMs),
    drWindow: msToTicks(RAM_CONFIG.drWindowMs),
    durationFloor: msToTicks(RAM_CONFIG.durationDrFloorMs),
    attackerLock: msToTicks(RAM_CONFIG.attackerLockMs),
  });
}

/**
 * Resolved once at module load and frozen, mirroring `WEAPON_TICKS`. Server and client both import
 * shared's built `dist`, so both compute identical tick counts or neither does.
 */
const DEFAULT_RAM_TICKS: Readonly<RamTicks> = resolveRamTicks();

/** `DEFAULT_RAM_TICKS` itself until playground tuning overrides a ram duration, and again once it clears. */
let ACTIVE_RAM_TICKS: Readonly<RamTicks> = DEFAULT_RAM_TICKS;

/** The ram durations in ticks. A FUNCTION, not a const: playground tuning may rebuild them. */
export function ramTicks(): Readonly<RamTicks> {
  return ACTIVE_RAM_TICKS;
}

/**
 * Re-resolve the ram durations after a tuning change (spec U40). Without this, every ram duration
 * knob in the playground moved its config value and changed nothing the sim read — a real bug that
 * predates this stage, since `RAM_TICKS` used to be a plain frozen `const` that `setTuning` never
 * rebuilt. With no overrides it reassigns the module-load object BY REFERENCE, so an untuned build
 * cannot drift by a float, exactly as `rebuildResolvedDrive` does.
 */
export function rebuildRamTicks(hasOverrides: boolean): void {
  ACTIVE_RAM_TICKS = hasOverrides ? resolveRamTicks() : DEFAULT_RAM_TICKS;
}
