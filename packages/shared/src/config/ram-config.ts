import { TICK_RATE_HZ } from "../constants.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { msToTicks } from "./weapon-ticks.js";

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
 * **There is no rating-to-anything scale here any more.** `massPerRating` used to convert a car's
 * `mass` rating into a physical mass; stage 3 removed `mass` from the game and the contest reads
 * `CarDef.ramAttack`/`ramDefence` as raw 0-100 ratings, unscaled, with `defencePushScale` and
 * `globalScale` below doing the only converting. Keeping the ram ratings out of the drive model
 * remains the rule they inherited (spec P7): a force-based drive would make solid imply sluggish and
 * collapse the roster to one axis, so they exist only as combat identity.
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
   * Minimum combined drive-in below which no ram fires. **Ships at 0 — deliberately inactive**
   * (spec R9), to be tuned later by feel.
   *
   * At 0, a gentle bump is simply a ram with a low drive-in, and linear scaling makes it come out
   * small on its own — which is why revision 2 needs no separate "baseline versus ram" path. The old
   * value of 60 was authored against a 449 u/s roster and means something different against 267, so
   * it cannot be carried across even when it is re-enabled.
   */
  minApproachSpeed: 0,

  /**
   * How much a STATIONARY car resists, as a multiplier on its `ramDefence` when building its push
   * (spec R2). The first knob to reach for when contact feels wrong: low and parked cars are nearly
   * free hits, high and everything feels like hitting a wall.
   *
   * At 35 a stationary mid-tier car brings roughly 12% of what a full-speed car brings. It is also
   * what makes T-boning a parked Bastion cost the attacker more than T-boning a parked Bullseye —
   * 0.675 vs 0.084 u/s, about 8x (the "~7x" an earlier draft of this comment quoted came from
   * rounding both figures to one decimal place, 0.7 vs 0.1, before dividing). Nobody authored that
   * ratio; it falls out of the contest.
   */
  defencePushScale: 35,
  /**
   * Converts a contest result into a Δv (spec R5). The one global constant the contest has, and it
   * CONVERTS rather than normalises — there is no ceiling here for a ram to be a fraction of (R9).
   *
   * **MEASURED, NOT DERIVED.** Revision 1's equivalent was derived from arithmetic and was wrong by
   * 5x — it threw every chassis backwards faster than its own top speed for landing a ram. This
   * value was measured instead: `serverTick` (drive + `resolveWorld`) then `contactTick`, the real
   * shipped order from `runPipeline`, swept across 24 sub-tick phases per scenario. Every scenario
   * below returned the IDENTICAL number on all 24 phases in every one of the five scenarios measured:
   * the contest reads the pre-collision velocity `TickResult.approachVelocities` carried in, and the
   * lever arm comes from hull geometry clamped by `contactPointOn` — clamped, in all five cases, on
   * the axis that actually carried the hit, which is WHY the result held constant across phase. On
   * the unclamped axis the recovered lever arm genuinely is penetration-dependent; it simply never
   * came up here. Re-check this if a future scenario lands on that axis instead.
   *
   * At 0.4, an attacker at its own top speed against a parked victim. Each row names who
   * `resolveRam` calls the attacker — the car with the higher drive-in — since that is not always
   * the car a plain-English description would call the one "doing the ramming":
   *
   * | scenario | attacker | victim | victim's Δv | as % of victim's top speed | attacker's contest cost |
   * |---|---|---|---|---|---|
   * | Bastion flanks a parked Bullseye | Bastion | Bullseye | 206.2 u/s | 92% (top 223) | **0.1 u/s** |
   * | Bullseye flanks a parked Bastion | Bullseye | Bastion | 38.4 u/s | 20% (top 190) | 2.8 u/s |
   * | Bastion flanks a parked Bastion | Bastion | Bastion | 61.4 u/s | 32% | 0.7 u/s |
   * | Bastion rear-ends a parked Bullseye (roster max) | Bastion | Bullseye | 268.0 u/s | 120% | 0.1 u/s |
   * | Bastion and Bullseye collide head-on, both at top speed (413 u/s closing) | Bullseye † | Bastion | 5.95 u/s | 3% (top 190) | **39.3 u/s** (18% of its own top 223) |
   *
   * † Bullseye, not Bastion, is `resolveRam`'s attacker in the head-on row: its own top speed (223)
   * beats Bastion's (190), and the rule is whichever car drives in harder, regardless of which one
   * the scenario's description names first. So the victim's-Δv column there (5.95 u/s, 3% of
   * BASTION's own top 190) is BASTION's Δv, and the attacker's-contest-cost column (39.3 u/s, 18% of
   * BULLSEYE's own top 223) is what BULLSEYE pays for hitting a much tankier car nose-first at full
   * combined speed — the LARGEST attacker cost in this table, not the smallest.
   *
   * That the nominal attacker comes off worse is the model working as designed, not a bug: Bastion's
   * push (70·190 + 90·35 = 16450) beats Bullseye's (45·223 + 30·35 = 11085) — Bastion is *winning*
   * the contest despite being the car driven into — and Bullseye's low `ramDefence` (30, against
   * Bastion's 90) divides its received impact far less. The row reads wrong at a glance until you see
   * that.
   *
   * Read the flank row and the head-on row together: a head-on at 2.2x the closing speed of the
   * Bastion-flanks-Bullseye row still moves its victim ~34.7x LESS (206.2 vs 5.95 u/s, the two rows'
   * VICTIM Δv figures — not the attacker's-cost column), which is `bonusFront` (0.3) doing the job it
   * exists for. That is gentler than revision 2's own illustrative worked example expected: the
   * spec's worked-outcomes table (R6) puts a head-on at roughly 12% of a T-bone (~8x gentler), and the
   * shipped roster instead lands at ~2.9% (a flank ram is the roster's T-bone-equivalent broadside
   * hit). That gap is a playground-pass observation, not a defect to correct here — the spec's own
   * "Flagged for confirmation" section already lists head-on violence as a feel question with
   * `bonusFront` as its lever, and nothing here recommends moving it.
   *
   * Read the right-hand column as the whole point of revision 2 — a car winning its contest
   * decisively takes almost nothing (R4/R5, P20): the largest cost any attacker pays across these
   * five scenarios is 39.3 u/s (Bullseye, above), nowhere near revision 1's 156-271 for the same kind
   * of hit.
   *
   * **What this constant does NOT control, and a reader will otherwise blame it for.** An attacker
   * still ends a dead-on ram travelling backwards — Bastion 190 -> -28.6 u/s above. All but 0.1 of
   * that is `resolveWorld`'s restitution reflection (`DRIVE_CONFIG.restitution`, 0.15), which lands
   * BEFORE contact runs and which no value here can reach. Stage 3 could only remove the contest's
   * share of the cost, and did: raising or lowering `globalScale` moves the victim's throw and the
   * head-on column, and leaves that -28.5 exactly where it is.
   *
   * Re-measure through the composed order, never through `contactTick` alone, if this is retuned:
   * `packages/server/src/sim/pipeline-order.test.ts` drives the sequence these numbers came from.
   */
  globalScale: 0.4,

  /**
   * The positional read, and the single most important balance lever in the feature. Front is cheap
   * so head-on ramming is deliberately not the play; rear is dear so getting behind someone pays.
   */
  bonusFront: 0.3,
  bonusFlank: 1.0,
  bonusRear: 1.3,

  /**
   * INERT — reads nothing since the 2026-09-06 vector-drive rework. Stage 3 did NOT delete it: the
   * `reeling` status that replaces this whole group moved to stage 3b, so the group outlives stage 3.
   *
   * Was the steering multiplier at maximum severity, the feel dial for how helpless a rammed victim
   * felt. `PlayerState.authority` no longer exists, and `ram-bridge.ts` drops `knock.authority` on
   * the floor entirely rather than writing it anywhere, so this value is computed by nobody and read
   * by nobody. Ram control-loss returns as the `reeling` status in stage 3b, which replaces this
   * knob (and the two authority half-lives below) outright rather than reviving them.
   */
  authorityFloor: 0.35,
  /**
   * INERT — reads nothing since stage 3 Task 2 (the ram contest, spec R2-R7/R9) landed.
   *
   * Was the peak knock impulse (expressed as a speed) at severity 1.0, before a victim mass factor.
   * The severity-graded model it belonged to — `severity * knockMaxSpeed * massFactor`, everything
   * normalised against one global maximum — is gone outright. `resolveRam` resolves an open-ended
   * contest between both cars' `ramAttack`/`ramDefence` pushes (`pushOf`/`impactOn` in `sim/ram.ts`),
   * and neither this value nor anything shaped like it reaches the ram path.
   *
   * `ram-config.test.ts` still pins it and it is not on the interfaces ledger's deletion list, so it
   * is not deleted here. A future task may retire it once nothing needs the historical comparison.
   *
   * **Why the historical comparison is worth keeping at all.** Revision 1 of this rework charged the
   * attacker a `reactionOf` recoil derived by ARITHMETIC rather than measured, and it was wrong by
   * 5x. Measured through the composed pipeline order (`serverTick` then `contactTick`, so the
   * `DRIVE_CONFIG.restitution` reflection lands FIRST and the recoil goes on top of it) against
   * stage 1's cut top speeds, a dead-on rear hit left every chassis travelling BACKWARDS — Bastion
   * 190 -> -184.5 u/s, Bullseye 223 -> -304.5, Mirage 267 -> -310.9 — two of the three past their own
   * top speed in reverse, for the crime of landing a ram. That is the defect this whole stage exists
   * to fix, and it is why `globalScale` below carries numbers measured through that same composed
   * order rather than a derivation. `packages/server/src/sim/pipeline-order.test.ts` is what pins the
   * order both sets of measurements were taken through.
   */
  knockMaxSpeed: 260,
  /**
   * Calibration multiplier on the torque-derived spin rate: it converts a speed-magnitude impulse
   * into a plausible angular rate.
   *
   * **Re-pitched 100 -> 10 by measurement in stage 3 Task 4 (spec P25b), and 10x is a coincidence,
   * not a ratio anyone applied.** Two things moved underneath this value at once and pulled opposite
   * ways: `nextSpin` (`sim/impulse.ts`) started dividing torque by `ramDefence` (30-90) instead of
   * `mass` (300-900), a ~10x SMALLER denominator, while `globalScale` above made the impulse feeding
   * the torque several times smaller. Neither ratio predicts the answer on its own, which is why it
   * was measured on the same composed `serverTick` -> `contactTick` sweep `globalScale` was.
   *
   * The calibration this value has always been written to, restored: an ordinary solid flank ram
   * lands around 1-2 rad/s, and the hardest ram in the game APPROACHES `spinMaxRate` without pinning
   * it. Measured, victim spin at an attacker's own top speed, by lever arm (the offset of the hit
   * from the victim's centre, which `contactPointOn` clamps at the 24 u hull half-length):
   *
   * | lever | Mirage flanks Mirage (ordinary) | Bastion flanks Bullseye (hardest) | Bullseye flanks Bastion (weakest) |
   * |---|---|---|---|
   * | 4 u | 0.34 rad/s | 0.99 | 0.06 |
   * | 12 u | 1.03 | 2.97 | 0.18 |
   * | 24 u (clamped max) | 2.06 | **5.95** | 0.37 |
   *
   * 5.95 against a 6.0 ceiling is the calibration working, not a near miss: the hardest ram the
   * roster can produce reaches 99% of the ceiling on its own and never clips. What still makes the
   * ceiling load-bearing is that `nextSpin` ACCUMULATES (`clamp(body.angVel + spin, ...)`), so a car
   * rammed twice does hit it.
   */
  spinScale: 10,
  /**
   * Ceiling on injected spin, so a corner contact cannot produce an absurd rotation.
   *
   * **Deliberately UNCHANGED by stage 3 Task 4's measurement (spec P25b), which is a decision, not
   * an omission.** `spinScale` was the free variable and this is the target it was pitched against:
   * at 10, the single hardest ram the roster can produce measures 5.95 rad/s across a 24-sub-tick-
   * phase sweep (see `spinScale`'s table) — 99% of this ceiling, approaching saturation without
   * clipping, which is exactly the relationship this pair is supposed to have. Moving this value
   * would have moved the target the other number was just solved for.
   *
   * It still binds, and is not decoration: `nextSpin` adds to the victim's EXISTING `angVel` rather
   * than replacing it, so a car rammed twice before its spin decays goes over.
   *
   * `docs/turn-tuning.md` tabulates this value — an edit here owes that page one.
   */
  spinMaxRate: 6.0,
  /**
   * The car hull's rotational-inertia shape factor, `(len^2 + wid^2) / 12` — the standard rectangular
   * plate formula, per unit of whatever `nextSpin` multiplies it by. That multiplier is the victim's
   * `ramDefence` since stage 3 Task 3 (it was the car's mass before), so a solid car resists being
   * spun for exactly the same reason it resists being shoved. Derived from the hull so it cannot
   * drift out of step with `carHullOf`.
   */
  inertiaCoefficient: (DRIVE_CONFIG.carWidth ** 2 + DRIVE_CONFIG.carHeight ** 2) / 12,

  /** Injected spin halves this often while the player is not fighting it. */
  spinHalfLifeSeconds: 0.35,
  /**
   * INERT — reads nothing since the 2026-09-06 vector-drive rework. Stage 3 did NOT delete it: the
   * `reeling` status that replaces this whole group moved to stage 3b, so the group outlives stage 3.
   *
   * Was "lateral knock halves this often" against the old separate `shoveX`/`shoveY` fields.
   * `RamDecay.shove` (below) is still computed from this value, but nothing in `sim/drive.ts` reads
   * `ramDecay().shove` any more — the knock lands straight in `vx`/`vy` and bleeds off through the
   * flat-rate `DRIVE_CONFIG.impactGripDecel` instead. Replaced by that knob for the shim's lifetime;
   * stage 3b deletes this one rather than reviving it.
   */
  shoveHalfLifeSeconds: 0.25,
  /**
   * INERT — reads nothing since the 2026-09-06 vector-drive rework. Stage 3 did NOT delete it: the
   * `reeling` status that replaces this whole group moved to stage 3b, so the group outlives stage 3.
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
   * INERT — reads nothing since the 2026-09-06 vector-drive rework. Stage 3 did NOT delete it: the
   * `reeling` status that replaces this whole group moved to stage 3b, so the group outlives stage 3.
   *
   * Paired with the now-unread `shoveHalfLifeSeconds` above; nothing computes a shove decay to snap.
   */
  shoveEpsilon: 1,
  /**
   * INERT — reads nothing since the 2026-09-06 vector-drive rework. Stage 3 did NOT delete it: the
   * `reeling` status that replaces this whole group moved to stage 3b, so the group outlives stage 3.
   *
   * Paired with the now-unread `authorityHalfLifeSeconds` above; nothing computes an authority decay
   * to snap.
   */
  authorityEpsilon: 0.01,

  /** Full-strength `reeling` duration from a ram, before falloff. Weapons author their own (stage 4). */
  ramUncontrolMs: 1000,
  /**
   * How long "recently rammed" lasts. ROLLING: each ram pushes the window out from itself, so
   * protection never lapses under sustained pressure. A window measured from the FIRST ram would
   * let an attacker who counts to one second land full-strength rams forever, which is the exact
   * lock this exists to prevent.
   */
  drWindowMs: 2000,
  /** Each successive ram's duration, as a fraction of the last. 1.0 disables duration falloff. */
  durationDrScale: 0.5,
  /** Duration never falls below this, so a late ram in a chain never reads as a whiff. */
  durationDrFloorMs: 150,
  /** Each successive ram's impulse, as a fraction of the last. 1.0 disables impulse falloff. */
  impulseDrScale: 0.5,
  /** Impulse never falls below this fraction of full. */
  impulseDrFloor: 0.25,
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
 * Stage 3b deletes both fields rather than reviving them — stage 3 left them, since the `reeling`
 * status that supersedes the authority half of the pair moved there.
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

/**
 * Ram control-loss durations, in the integer ticks the sim actually counts — authored milliseconds
 * converted exactly once, at module load, the same shape as `SLAM_TICKS`/`WEAPON_TICKS`.
 */
export const RAM_TICKS: Readonly<{ uncontrol: number; drWindow: number; durationFloor: number }> =
  Object.freeze({
    uncontrol: msToTicks(RAM_CONFIG.ramUncontrolMs),
    drWindow: msToTicks(RAM_CONFIG.drWindowMs),
    durationFloor: msToTicks(RAM_CONFIG.durationDrFloorMs),
  });
