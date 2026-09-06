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

  /**
   * INERT — reads nothing since the 2026-09-06 vector-drive rework; stage 3 deletes it.
   *
   * Was the steering multiplier at maximum severity, the feel dial for how helpless a rammed victim
   * felt. `PlayerState.authority` no longer exists, and `ram-bridge.ts` drops `knock.authority` on
   * the floor entirely rather than writing it anywhere, so this value is computed by nobody and read
   * by nobody. Ram control-loss returns as the `reeling` status in stage 3, which replaces this knob
   * (and the two authority half-lives below) outright rather than reviving them.
   */
  authorityFloor: 0.35,
  /**
   * **SUPERSEDED as of 2026-09-06.** The equal-and-opposite reaction this comment measures —
   * `reactionOf` negating and mass-scaling a copy of the victim's `Impulse` back onto the attacker —
   * is being replaced by a contest model: each car brings a push into the collision from its
   * `attack` rating times the speed it is driving into the impact, plus a scaled contribution from
   * its `defence` rating, and each car's received impact is computed directly from the *other*
   * car's push (scaled by its share of the contest, the face bonus, and divided by its own
   * `defence`) — never derived by negating its own. `mass` is being removed from the game entirely,
   * replaced by per-car `attack` and `defence` stats, so every mass figure below
   * (`massFactorMin`/`massFactorMax`, `RAM_REFERENCE_MASS`, the table's mass column) measures a
   * rating that is going away. `docs/superpowers/specs/2026-09-06-car-physics-rework-design.md` is
   * the authority for where this is headed; the measurements below stay accurate about the code as
   * it stands today and are kept for anyone debugging current behaviour.
   *
   * Peak knock impulse (expressed as a speed) at severity 1.0, before the victim mass factor.
   *
   * **Charged to the attacker as well as the victim since the 2026-09-06 equal-and-opposite change**
   * (stage 2 Task 4): `ram-bridge.ts` now applies `reactionOf` of the victim's own impulse back onto
   * the attacker, scaled by the ATTACKER's own mass factor. This value was tuned one-way, against a
   * model where the attacker paid nothing, and it has not been re-pitched for the new cost.
   *
   * **The attacker is charged in TWO layers, not one — an error in an earlier pass of this same
   * comment measured the reaction alone.** `runPipeline` (`tick-pipeline.ts:80`) runs `serverTick`
   * (drive + `resolveWorld`) BEFORE `contactTick`, so by the time this recoil lands, `resolveWorld`
   * has ALREADY reflected the attacker's whole pre-collision velocity by `DRIVE_CONFIG.restitution`
   * (0.15) — a car covers more per tick than `RAM_CONFIG.contactPad`'s touching band at every speed
   * on this roster, so that reflection fires on 40/40 sampled sub-tick phases, not merely most of
   * them. The reaction below is then applied ON TOP OF the already-reflected speed, not onto the
   * pre-collision speed a caller that only exercises `contactTick` in isolation would assume (exactly
   * what `ram-bridge.test.ts` alone shows, and exactly what misled the previous pass of this table).
   * `packages/server/src/sim/pipeline-order.test.ts` is what pins the composed order now.
   *
   * Measured through the real order — `stepSim`, then `resolveRam`, then
   * `applyImpulse(reactionOf(...))` — against stage 1's cut top speeds (`RAM_REFERENCE_MASS` 500,
   * `massFactorMin/Max` 0.6/1.6), a dead-on rear hit, swept across 40 sub-tick phases (identical
   * result on every one, since the reflection is a velocity-space operation, not depth-dependent):
   *
   * | attacker | scenario | after `resolveWorld` reflection | reaction Δv | speed after |
   * |---|---|---|---|---|
   * | Bastion (mass 900, top 190) | full-severity (severity 1) rear hit | `190 * -0.15 = -28.5` | `260 * clamp(500/900, 0.6, 1.6) = 260 * 0.6 = 156` | 190 → **-184.5 u/s** |
   * | Bullseye (mass 300, top 223) | rear hit, severity 0.651 | `223 * -0.15 = -33.45` | `(0.651 * 260) * clamp(500/300, 0.6, 1.6) = 169.4 * 1.6 = 271.0` | 223 → **-304.5 u/s** |
   * | Mirage (mass 480, top 267) | full-severity (severity 1) rear hit | `267 * -0.15 = -40.05` | `260 * clamp(500/480, 0.6, 1.6) = 260 * 1.0417 = 270.8` | 267 → **-310.9 u/s** |
   *
   * All three end up travelling BACKWARDS, past their own top speed in two of three cases — not
   * merely "barely slowed." Both numbers only get bigger once stage 3 grades severity from RELATIVE
   * closing velocity rather than the attacker's speed alone (a fleeing victim currently softens the
   * hit; an oncoming one will harden it past what these rows show). Stage 2's own exit criterion —
   * "Ram a Bullseye as Bastion, then the reverse. The Bastion barely slows" — is CONTRADICTED more
   * severely than an isolated-`contactTick` measurement would suggest: the Bastion above does not
   * merely slow to 18% of its top speed, it reverses past its OWN top speed backwards (97%). A hand
   * playtest before the re-pitch below will read as badly wrong; that is expected, not a regression
   * to chase.
   *
   * Stage 3 owns re-pitching this value against the new momentum-derived scale — see
   * `docs/superpowers/plans/2026-09-06-car-physics/03-ram.md`, Task 5 ("Re-pitch the constants the
   * new impulse scale invalidated"). Do not raise or lower this number outside that task without
   * also updating the table above.
   */
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
  /**
   * INERT — reads nothing since the 2026-09-06 vector-drive rework; stage 3 deletes it.
   *
   * Was "lateral knock halves this often" against the old separate `shoveX`/`shoveY` fields.
   * `RamDecay.shove` (below) is still computed from this value, but nothing in `sim/drive.ts` reads
   * `ramDecay().shove` any more — the knock lands straight in `vx`/`vy` and bleeds off through the
   * flat-rate `DRIVE_CONFIG.impactGripDecel` instead. Replaced by that knob for the shim's lifetime;
   * stage 3 deletes this one rather than reviving it.
   */
  shoveHalfLifeSeconds: 0.25,
  /**
   * INERT — reads nothing since the 2026-09-06 vector-drive rework; stage 3 deletes it.
   *
   * Was "the gap between current authority and full control halves this often." `PlayerState`
   * carries no `authority` field to decay. See `authorityFloor` above.
   */
  authorityHalfLifeSeconds: 0.3,
  /**
   * Spin half-life while the player steers AGAINST it. Shorter than `spinHalfLifeSeconds` on
   * purpose: without this, steering only offsets the visible rotation and recovery time is fixed by
   * decay alone, so skill cannot shorten a spin. This one constant is what makes countersteering a
   * skill rather than a cosmetic.
   */
  counterSteerHalfLifeSeconds: 0.15,

  /** Below this magnitude a knock snaps to exact rest, as `stopEpsilon` does for the drive model. */
  spinEpsilon: 0.01,
  /**
   * INERT — reads nothing since the 2026-09-06 vector-drive rework; stage 3 deletes it.
   *
   * Paired with the now-unread `shoveHalfLifeSeconds` above; nothing computes a shove decay to snap.
   */
  shoveEpsilon: 1,
  /**
   * INERT — reads nothing since the 2026-09-06 vector-drive rework; stage 3 deletes it.
   *
   * Paired with the now-unread `authorityHalfLifeSeconds` above; nothing computes an authority decay
   * to snap.
   */
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

/**
 * Four per-tick multipliers, but `stepDrive` only reads two of them (`spin`, `counterSteer`) since
 * the 2026-09-06 vector-drive rework. `shove` and `authority` are still computed here — deleting the
 * shape would ripple further than this stage's scope — but nothing in the sim reads either; they are
 * inert alongside `RAM_CONFIG.shoveHalfLifeSeconds`/`authorityHalfLifeSeconds`, which produce them.
 * Stage 3 deletes both fields rather than reviving them.
 */
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
 * What the sim actually decays by. `stepDrive` reads this rather than `RAM_DECAY` so the half-life
 * knobs it actually uses (`spinHalfLifeSeconds`, `counterSteerHalfLifeSeconds`) are reachable by
 * playground tuning at all — they are authored in seconds and nothing in the sim reads them
 * directly. `shove`/`authority` ride along in the same struct but reach nothing (see `RamDecay`).
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
