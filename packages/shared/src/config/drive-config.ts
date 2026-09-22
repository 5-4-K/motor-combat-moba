import { TICK_RATE_HZ } from "../constants.js";

/**
 * Arcade drive tuning. Every value here is read by `stepSim`, so server tick and client prediction
 * both depend on them agreeing — these are networked balance, not render preferences.
 *
 * **What is coupled to what.** These knobs are not independent, and changing one in isolation is
 * how the feel regresses:
 *
 * - *Turn radius* is `speed / turnRate`, and both halves are now per-car (`forwardMaxSpeedOf`,
 *   `turnRateOf`). Raising a chassis's speed rating without raising its handling widens its corners,
 *   so a faster car reads as a *less* agile one — reason per chassis, not for "the fastest car".
 * - *Time to top speed* is asymptotic under the Unity drag model (U4) — a car never truly arrives,
 *   only decays toward `engineAccelOf(id) / dragRateOf(id)` (== `forwardMaxSpeedOf(id)`) — so the
 *   number worth reasoning about is `Math.log(10) / dragRateOf(id)`, seconds to 90% of the ceiling.
 *   Raising a chassis's speed rating alone (without raising `accel` to match) stretches this, and
 *   that car feels sluggish off the line despite the higher ceiling.
 * - Each chassis's `CarDef.brakeDecel` **must** beat its own coasting, measured where proportional
 *   drag is strongest — at that chassis's top speed — or holding Down stops it slower than lifting
 *   off and the brake button stops meaning anything. `config.test.ts` enforces the ordering per car.
 * - `CAMERA_CONFIG.freeRoamSpeed` **must** exceed `forwardMaxSpeedOf` of the fastest car, or a
 *   spectator can never get ahead of the fight. `config.test.ts` enforces this against `CAR_TABLE`,
 *   so raising `baseMaxSpeed` or `speedPerRating` past it fails the suite rather than shipping.
 *
 * `baseMaxSpeed` and `speedPerRating` scale together deliberately: the ratio between them is what
 * decides how much the per-car `speed` rating matters. Moving only one re-balances the roster.
 * `baseTurnRate`/`turnRatePerRating` are anchored the same way: at rating 50 the pair reproduces one
 * global `turnRate`, so retuning `handling` per car is a driving change, never accidentally a
 * re-anchor of the whole roster. Moving the whole roster is the other edit, and it means scaling a
 * pair together — as the 1.5x turn-rate raise on 2026-08-31 did. `baseDrag`/`dragPerRating` are the
 * `accel` rating's equivalent pair under the Unity model (U4): the single number that sets top
 * speed, wind-up time AND coast-off roll, since `accel` no longer authors a push independently of
 * `speed` — see `engineAccelOf`.
 *
 * **`docs/turn-tuning.md` tabulates every turn number this file produces, by hand**, and
 * `scripts/turn-tuning-doc.test.mjs` holds those tables to this config. Editing `baseTurnRate`,
 * `turnRatePerRating`, `baseMaxSpeed`, `speedPerRating`, `baseDrag`, `dragPerRating` or
 * `reverseAccelFactor` fails that test until the page is updated with it. Its "Keeping this page
 * honest" section carries the field list and a snippet that prints the new values.
 */

/**
 * A per-second decay rate as the factor one tick multiplies by: `exp(-rate / TICK_RATE_HZ)`.
 *
 * Every rate in the Unity drive model is authored per SECOND and converted here exactly once, which
 * is what makes the model tick-rate independent (U7): raising `TICK_RATE_HZ` re-derives every factor
 * and changes no behaviour. Never type a per-tick number into config.
 */
export function perTickDecay(ratePerSecond: number): number {
  return Math.exp(-ratePerSecond / TICK_RATE_HZ);
}

export type DriveConfig = typeof DRIVE_CONFIG;

export const DRIVE_CONFIG = {
  /**
   * Halved from 180 together with `speedPerRating` (4.5 -> 2.25) on 2026-09-01 — a roster-wide 50%
   * top-speed cut, scaled as a pair so the per-car `speed` rating kept its relative weight. Raised
   * 1.5x again on 2026-09-02, to 135, alongside a same-day rating rewrite (see `CAR_TABLE`) — this
   * half of the pair alone would have kept every car's top speed at exactly 1.5x its prior value.
   * Cut again on 2026-09-06 (stage 1 of the vector-drive rework), to 80, alongside `speedPerRating`
   * dropping to 2.2 — together a roughly 40% roster-wide top-speed cut so cars read as heavy, and
   * (with turn rate untouched) a turn radius cut to comfortably under one car length per chassis.
   * Cut to 60 on 2026-09-16 alongside `speedPerRating` dropping to 1.518 — a further ~29% roster-wide
   * top-speed cut. NOT a uniform pair scale: this half fell to 0.75x and the per-rating half to
   * 0.69x, so a point of `speed` buys slightly less than it did, narrowing the roster's spread.
   *
   * Raised to 90 on 2026-09-19 (stage 5 Task 5), from the user's own hands-on playground pass. THIS
   * time it is a uniform 1.5x, together with `speedPerRating` (1.518 -> 2.277) — unlike every prior
   * pass on this pair, which each changed the ratio between the two halves. Turn rate was scaled the
   * same 1.5x in the same pass (see `baseTurnRate`/`turnRatePerRating`), which is why turn radius
   * (`maxSpeed / turnRate`) holds at exactly the same ~89.9 u it was before this change — this pass
   * raises the ceiling and how fast a car gets there, not how tightly it corners. Drag was
   * deliberately left untouched, so wind-up time (`Math.log(10) / dragRateOf(id)`) is unchanged while
   * coast-off roll distance grows the same 1.5x as top speed.
   */
  baseMaxSpeed: 90,
  /**
   * Ratings are 0-100 (see `CAR_TABLE`), so this is a tenth of what it would be on a 0-10 scale.
   * It was 45 against 0-10 ratings and became 4.5 when they widened, precisely so that every car's
   * top speed stayed where it was. 2.25 since the 2026-09-01 half-speed cut — see `baseMaxSpeed`.
   * Raised again on 2026-09-02, but not to the pair-preserving 3.375 (2.25 x 1.5) — 3.7 was a
   * deliberate extra push on top of the uniform 1.5x, so a point of `speed` now buys more than it did
   * before the 2026-09-01 cut, not merely 1.5x more. Cut to 2.2 on 2026-09-06 alongside
   * `baseMaxSpeed`'s drop to 80, for the heavy-car top-speed cut described there. Cut to 1.518 on
   * 2026-09-16 alongside `baseMaxSpeed`'s drop to 60 — see there for why the pair did not scale
   * uniformly.
   *
   * Raised to 2.277 on 2026-09-19 (stage 5 Task 5), from the user's own hands-on playground pass —
   * exactly 1.5x, together with `baseMaxSpeed`'s uniform 1.5x raise (60 -> 90). See that field's
   * comment for what a uniform pair-scale means here and why it leaves turn radius unchanged.
   */
  speedPerRating: 2.277,
  /**
   * Turn rate is `baseTurnRate + handling * turnRatePerRating`, resolved per car by `turnRateOf`.
   *
   * PORTED to the Unity drive model's own turn-rate anchors on 2026-09-18 (drive-model port stage 1
   * Task 6, spec §9.2): `baseTurnRate` 3.6 -> **0.667**, `turnRatePerRating` 0.054 -> **0.0169**. The
   * old pair anchored an exactly-average chassis (rating 50) at 6.3 rad/s — the pre-2026-08-30 global
   * turn rate raised 1.5x on 2026-08-31. Yaw under the Unity model is a different quantity (`stepDrive`
   * rebuilds the velocity vector toward the new heading at this rate every tick, rather than the old
   * model's speed-independent-at-rest split), so the old pivot was never re-derived for it — it was
   * simply left in place while the rest of the model ported around it, which is why every chassis was
   * turning roughly 5x faster than the Unity original until this retune. Rating 50 now yields 1.512
   * rad/s (`config.test.ts` pins the anchor); the pre-2026-08-30 global was 4.2, so this is well below
   * that too, not merely below the 1.5x-raised figure.
   *
   * Raised again on 2026-09-19 (stage 5 Task 5), from the user's own hands-on playground pass:
   * `baseTurnRate` 0.667 -> **1.0005**, `turnRatePerRating` 0.0169 -> **0.02535** — a uniform 1.5x on
   * BOTH halves, the same factor `baseMaxSpeed`/`speedPerRating` took in the same pass. Rating 50 now
   * yields 2.268 rad/s (`config.test.ts`'s anchor moved with it). Scaling speed and turn rate by the
   * same 1.5x is what holds turn radius (`maxSpeed / turnRate`) at its prior ~89.9 u instead of
   * widening or tightening it — see `baseMaxSpeed`. One tradeoff the user was shown and chose to
   * accept rather than correct here: `lateralGripRate` (this file's `lateralGripRate`, unchanged) did
   * NOT scale with turn rate, so slip angle at full lock rose with it (Mirage ~26.1° -> ~36.4°) — the
   * user wants player feedback on the raised turn rate before touching grip to bring slip back down.
   */
  baseTurnRate: 1.0005,
  turnRatePerRating: 0.02535,
  /**
   * Reverse push as a fraction of forward. Below 1: a car pulls away harder in its forward gear than
   * in reverse, which is the whole content of this number.
   *
   * IT USED TO BE 1.41, AND THAT WAS A SURVIVING ARTEFACT RATHER THAN A CHOICE. The figure was
   * historical: when rating 50 yielded exactly 780 forward (under the old global `baseAccel`/
   * `accelPerRating` pair, since deleted), 1.41 gave 1099.8 against the 1100 that shipped — a 0.02%
   * rounding of the exact 1100/780. Under those numbers a car reached BOTH caps well inside any
   * horizon anyone cared about (forward 0.44-0.57 s roster-wide), so the reverse cap — the old
   * `reverseSpeedRatio` knob, 0.65 of forward, also since deleted — was what a driver actually felt,
   * and the accel factor exceeding 1 never surfaced.
   *
   * The 2026-09-06 heavy-car pass cut that old accel pair 420/7.2 -> 60/1.4 without touching this
   * factor, and that removed the cover. Time to the forward cap went to 1.49-2.16 s, which is longer
   * than most things that sample the drive model look ahead, so cars now spend the part of a
   * manoeuvre anyone observes in the ACCELERATION-limited regime rather than the speed-limited one —
   * and in that regime this factor, not the old speed ratio, is what governs. At 1.41 every chassis
   * covered 1.29x more ground reversing than driving forward over hard's 22-tick plan (Bullseye 44.5
   * u against 34.6, Mirage 64.7 against 50.3, Bastion 31.8 against 24.7), which is backwards as a
   * statement about a car and was measurably steering the bot: the planner scores candidates on
   * where they END UP, so `throttle: -1` beat `throttle: 1` on every chassis unconditionally and the
   * bot moonwalked. See `bot/brain/planner.ts`.
   *
   * PORTED to the Unity drive model's own value on 2026-09-18 (drive-model port stage 1 Task 6, spec
   * §9.2): 0.6 -> **0.4**. 0.6 was chosen against the old `reverseSpeedRatio` (0.65) rather than
   * derived — reverse the weaker gear in both terms, slightly weaker in push than in top speed — and
   * that anchor is gone along with the knob it was chosen against. 0.4 is the Unity original's own
   * figure. Both values keep the one property that actually mattered: reverse push under forward
   * push, so the ordering bug above stays fixed. Retune it freely; keep it under 1.
   *
   * Raised back to 0.6 on 2026-09-19 (stage 5 Task 5), from the user's own hands-on playground pass —
   * the Unity original's 0.4 read as too weak in reverse once played by hand. This is NOT a
   * `baseMaxSpeed`/`speedPerRating`-style uniform pair-scale; it stands alone, and it compounds with
   * this same pass's 1.5x speed raise: reverse top speed (`maxSpeed x reverseAccelFactor`) is now
   * 2.25x what it was two passes ago (1.5x from the speed raise x 1.5x from 0.4 -> 0.6), which the
   * user was shown (Mirage 75.6 -> 170.1 u/s) and kept rather than correcting — reverse push under
   * forward push (the property that matters, see above) still holds at 0.6.
   */
  reverseAccelFactor: 0.6,
  /**
   * Below this |speed| with the throttle neutral, `atRest` (`drive.ts`) snaps the velocity to exact
   * rest instead of leaving the car creeping forever on an exponential decay that never truly
   * reaches zero. Yaw itself is speed-independent under the Unity model — there is no separate
   * at-rest turn rate any more, and `turnRateAtStopOf` and the `reverseHoldTicks` accumulator it
   * used to gate are both gone — so this epsilon's only remaining job is the rest/creep snap. It
   * gates a sim branch, so it lives here rather than as a literal in `drive.ts`.
   */
  stopEpsilon: 1e-3,
  carWidth: 60,
  carHeight: 40,
  /**
   * Max world units a DASH may translate between collision checks. At most half the car's SHORT
   * axis (20 at the 60x40 hull, since 2026-09-16); 16 predates that resize and is kept as a
   * tighter, still-valid value.
   *
   * `mtvBetween` answers "what is the shortest way out of this overlap", which is the way the car
   * came in only while the overlap is shallow. For two axis-aligned cars the backwards push wins
   * only while the centres are more than 20u apart on the dash axis, so there is a 40-unit-wide
   * band in which the resolver is already right — and `thunderclap` at 1600 u/s covers 53.3u per
   * tick, jumping clean over it. Capping the travel per check at no more than half the 40-unit face
   * (20 — the shipped 16 sits inside that bound) keeps every sample inside that band from any
   * approach angle; the 60-unit face is the wrong one to size
   * against, because a rotated car can always present the thin one as the competing escape axis.
   *
   * It lives here rather than on a weapon row because it is a property of the collision resolver's
   * correct band, not of any one weapon — a second dash weapon inherits it. `config.test.ts` pins
   * it to the hull rather than to 16, so shrinking a car fails the suite instead of quietly
   * reopening the tunnelling bug.
   *
   * At 16 the dasher still advances 13.3u between collision checks (four substeps of `thunderclap`'s
   * 53.3u/tick) — that gap always existed, but before the 2026-09-06 weighted-separation change
   * (car-car `resolveWorld` taking a `selfRamDefence` and each side conceding only
   * `shareOf(selfRamDefence, otherRamDefence)`, see `collide.ts` — `mass`-weighted at the time, now
   * `ramDefence`-weighted since stage 3 Task 3) the pre-rework always-full-push rule ejected the dasher back out
   * in the same tick it landed, so nobody saw it. Now the dasher only claims its own share on the
   * contact tick and the arrival gap surfaces as momentary penetration instead. `thunderclap`
   * (Mirage's slot 2, `maneuver: { type: "dash" }`) is the only dash in the game — `wildcharge` is a
   * `type: "charge"` and never substeps this way — so Mirage is the only chassis that can produce
   * this. Measured worst case (sweeping approach angle, target orientation and the sub-tick phase
   * against a 60x40 hull): Mirage dashing into a Bullseye, T-boning its side at 90° approach against
   * 0° target orientation, penetrates **18.49u** (exact: `18.492296006944457`, `step.test.ts`'s
   * `MEASURED_WORST_REACHABLE`). This moved from 17.96u under stage 3 Task 3: the separation split
   * above went from `mass`-weighted (Mirage 480, Bullseye 300 at the time — a 0.3846 share for
   * Mirage) to `ramDefence`-weighted (Mirage 50, Bullseye 30 — a 0.375 share), and the two ratings
   * are not quite proportional (Mirage's `mass` rating, 48, and `ramDefence` rating, 50, differ,
   * unlike Bullseye's and Bastion's, where the two coincide), so the worst-case geometry re-measures
   * slightly larger. It clears in about three ticks (~100ms) once both cars are resolving their own
   * share — the decay factor per tick is `shareOf(mirage,bullseye) * shareOf(bullseye,mirage) =
   * 0.375 * 0.625 = 0.234375` (was `0.3846 * 0.6154 ≈ 0.2367`), applied to the 18.49u base:
   * `18.49 → 4.33 → 1.02 → 0.24 → 0.06 → gone`; a silent or backgrounded victim that never runs its
   * own `resolveWorld` call decays by `1 - shareOf(mirage,bullseye) = 0.625` per tick instead (was
   * `0.6154`) and clears more slowly but still monotonically:
   * `18.49 → 11.56 → 7.22 → 4.51 → 2.82 → 1.76 → 1.10 …`. Re-measured 2026-09-16 for the hull resize:
   * both the base figure and every decayed term above came back byte-for-byte identical to the
   * pre-resize (48x32) measurement, because this figure tracks `dashSubstepMaxUnits` (unscaled by
   * the hull, still 16) and the ramDefence-weighted shares, neither of which the resize touched.
   *
   * Tightening this knob trades substep count for granularity (measured, Mirage-into-Bullseye; all
   * five rows re-measured under stage 3 Task 3's `ramDefence`-weighted split, same method as the
   * headline figure above — this table is not a simple rescale of the pre-Task-3 numbers; re-measured
   * again 2026-09-16 against the 60x40 hull, same method, and every row came back unchanged for the
   * same reason as the headline figure):
   *
   * | `dashSubstepMaxUnits` | substeps/tick | worst penetration |
   * |---|---|---|
   * | 16 (current) | 4 (13.3u each) | 18.49u |
   * | 12 | 5 (10.7u each) | 15.87u |
   * | 8 | 7 (7.6u each) | 12.14u |
   * | 6 | 9 (5.9u each) | 9.70u |
   * | 4 | 14 (3.8u each) | 6.34u |
   *
   * Lowering it to 8 is the deferred fix: it roughly halves the visible penetration for a doubled
   * substep count, and stage 5 (tune-and-reconcile) owns deciding whether that trade is worth the
   * extra collision checks — see
   * `docs/superpowers/plans/2026-09-06-car-physics/05-tune-and-reconcile.md`. Left at 16 for now;
   * this comment exists so the trade is not re-derived from scratch. A future `TICK_RATE_HZ` bump
   * (netcode phase 1 raises it to 60) does **not** shrink the gap on its own: this knob is denominated
   * in world units, not ticks, so `thunderclap`'s 13.3u-per-substep arrival depth is unchanged by
   * tick rate alone.
   */
  dashSubstepMaxUnits: 16,
  /**
   * Coefficient of restitution for every contact — walls, obstacles and cars alike.
   *
   * **0: nothing in this game bounces.** Unity's cars carry a zero-friction, zero-bounce contact
   * material (`CarFactory.Frictionless`), and this is that material: `applyContact` removes the
   * velocity INTO a surface and leaves the velocity ALONG it, so a car angled at a wall slides down
   * it instead of rebounding. It was 0.35, then 0.15 from 2026-09-06, on the argument that real cars
   * crush rather than bounce — the Unity port finishes that argument.
   *
   * Two things follow. The reflection is now idempotent, so the relaxation passes cannot compound a
   * rebound. And knockback in this game comes from ramming alone (`sim/ram.ts`), never from
   * springiness here — raising this to get bigger knocks is reaching for the wrong knob.
   */
  restitution: 0,
  /**
   * Velocity decay rate at `accel` rating 0, in 1/s. Unity's `DriveConfig.linearDrag` (1.0).
   *
   * THIS ONE NUMBER SETS THREE THINGS at once, which is the whole content of the Unity model (U4):
   * top speed (`engineAccel / dragRate`), the time constant of the wind-up, and how far the car
   * rolls off the throttle. A car cannot launch quickly and roll a long way.
   */
  baseDrag: 0.768,
  /** Added drag per point of `accel` rating, 1/s. Anchored so rating 85 reaches ~90% of top speed in ~1.8 s. */
  dragPerRating: 0.00608,
  /**
   * How fast sideways velocity bleeds off, 1/s. Unity's `DriveConfig.lateralGripStrength` (6.0).
   *
   * Global rather than per-car (U10). This is the drift knob: lower drifts more, and 0 is a hockey
   * puck. **`atan(turnRate / lateralGripRate)` alone OVERSTATES the drift**, because drag also acts
   * on the lateral component every tick (see `stepDrive`'s step 2) — it is extra sideways bleed
   * grip shares the vector with, not a separate channel the slip angle can ignore. The honest
   * continuous prediction is `atan(turnRate / (dragRate + lateralGripRate))`.
   *
   * Measured for Mirage (highest `handling` on the roster, 85) at the drive-model port's Task 6
   * turn-rate anchors (`baseTurnRate` 0.667, `turnRatePerRating` 0.0169 — not yet landed as of this
   * writing; `turnRateOf` today still reads 3.6/0.054) against `dragRateOf("mirage")` (1.2848,
   * unaffected by Task 6) and this rate (3.0): the continuous formula above gives **26.1°**
   * (`atan(2.1035 / 4.2848)`), and stepping the real chassis to its own steady state (full lock,
   * 10s) lands the DISCRETE figure at **28.2°** — close to, not identical to, the continuous one,
   * the same discretization gap `stepDrive`'s `commandFactorOf` exists to close for the forward
   * axis; nothing does that for the lateral one, since grip has no forcing term to solve against.
   * Both replace an earlier "~35°" claimed here against the wrong formula (`atan(turnRate /
   * lateralGripRate)` alone, ignoring drag) and against today's un-retuned turn rate — re-measure
   * again once Task 6 actually lands the anchors above.
   *
   * STALE AS OF STAGE 5 TASK 5 (2026-09-19): `baseTurnRate`/`turnRatePerRating` moved 1.5x again
   * (`turnRateOf("mirage")` 2.1035 -> 3.15525), and this rate did NOT move with them, so Mirage's
   * slip rose from the ~26-28° measured above to a measured ~36.4° (`docs/turn-tuning.md`'s slip
   * row carries the current figure). **Flagged to the user, not acted on**: they were shown the
   * number and chose to keep `lateralGripRate` as-is pending player feedback on the raised turn
   * rate, rather than have this pass quietly bring slip back down. Do not "fix" this by raising
   * `lateralGripRate` without that feedback.
   *
   * **This rate is the DRIVER's drift only.** How long an IMPOSED shove carries a victim is the
   * `grip` status multiplier on `reeling` (spec §5), because one number could not answer both
   * questions once the base rate came down this far.
   */
  lateralGripRate: 3.0,
  /**
   * Forward speed below which Down reverses instead of braking, u/s. Unity's
   * `DriveConfig.reverseEpsilon` (0.5 m/s). It is also the threshold the steering flip reads, which
   * is why there is one of it and not two.
   */
  reverseEpsilon: 6.0,
  /**
   * Invert the steering sense while genuinely travelling backwards, the way a real car behaves.
   * Unity's `DriveConfig.flipSteeringInReverse`. Off gives tank-style absolute steering. Turning on
   * the spot is unaffected either way, because the flip needs `forwardSpeed < -reverseEpsilon`.
   *
   * **OFF for the tuning pass, deliberately, and this is not a permanent decision.** The flip reads
   * the car-frame FORWARD component of velocity to ask "am I reversing?". That was sound before the
   * Unity port, when `steeringGrip: 1.0` welded velocity to the nose and the component simply WAS
   * the car's speed. With drift it is `speed * cos(slip)`, so a hard corner that swings the nose past
   * sideways drives it negative while the car is still moving fast — and it then sits on the
   * `-reverseEpsilon` threshold and chatters, inverting the steering several times a second. Measured
   * at `baseTurnRate` 1.0005 / `turnRatePerRating` 0.02535: Mirage 12 sense flips, Bullseye 6,
   * Bastion 0 — which is exactly the "mostly Mirage, sometimes Bullseye, never Bastion" a player
   * reported. The shipped turn rates clear it only by 5 u/s, so any handling buff walks back into it.
   *
   * **Do not simply flip this back to `true`.** The machinery is kept on purpose, but the predicate
   * needs replacing first: gate the flip on the driver having COMMANDED reverse
   * (`throttle === -1 && forward < -reverseEpsilon`) rather than on the velocity component alone.
   * No threshold on velocity MAGNITUDE can work — spin-out and genuine reverse occupy the same speed
   * range, and at higher turn rates the ranges cross over entirely.
   */
  flipSteeringInReverse: false,
} as const;

/**
 * How the client's arena camera follows a car — the local one while driving, and the cycled target
 * while spectating. Render-only: nothing in `stepSim` reads it, so these are safe to tune without
 * touching determinism or prediction.
 *
 * `camLerp` is the fraction of remaining distance the camera closes per **60 Hz frame**.
 * `smoothFollow` rescales it by the real frame time, so a 144 Hz display converges at the same rate
 * per second rather than 2.4x faster — without that, the settled trailing offset would be
 * `speed / (fps * camLerp)` and a 60 Hz player would see meaningfully less road ahead than a 144 Hz
 * one. The softness also keeps a reconciliation snap from throwing the whole view, which is why
 * raising this trades camera tightness against how visible corrections are.
 *
 * `zoom` above 1 pushes the view in. Car art is stored at twice the hull (`scripts/import-art.mjs`
 * `SUPERSAMPLE`), so a zoom of 2 draws every texture at exactly 1:1 — the sharpest the sprites can
 * be; the price is a 640x360 world-unit view at 1280x720. 1 is the other end of that trade: the
 * full 1280x720 world-unit view, with the 2x textures drawn at half size. It is the widest setting
 * inside the 1–2 range — below 1 the textures shimmer.
 *
 * `freeRoamSpeed` is how fast a spectator's free-look camera pans, in world units per **second**, so
 * the pan covers the same ground on a 60 Hz and a 144 Hz display. It is pitched a little above the
 * fastest car so a spectator can outrun the fight to see where it is going — see the coupling note
 * on `DRIVE_CONFIG`.
 */
export type CameraConfig = typeof CAMERA_CONFIG;

export const CAMERA_CONFIG = {
  camLerp: 0.18,
  zoom: 1,
  /**
   * Cut from 1050 to 340 on 2026-09-06 alongside the vector-drive rework's heavy-car speed cut
   * (`DRIVE_CONFIG.baseMaxSpeed`/`speedPerRating`), which dropped the fastest car from 449.5 to
   * 267 u/s. Left at 1050 a free-look pan would run four times quicker than any car and read as
   * unmoored; 340 keeps it a little above the new fastest car, per the coupling note above.
   */
  freeRoamSpeed: 340,
} as const;

/**
 * The client's logical canvas the arena camera renders into, before any HUD gutter or letterboxing
 * — `ARENA_01`'s own header calls this out by name: "1280x720 is not a taste call — it is the
 * client's logical canvas, so at `CAMERA_CONFIG.zoom` of 1 the camera covers the arena exactly."
 * `packages/client/src/config/display.ts` is where that fact actually drives the Phaser game config
 * (`ARENA_VIEW_WIDTH`, `VIEW_HEIGHT`) — `shared` cannot import from `client`, so this is that same
 * fact restated here, for a second consumer client-side code never had: the SERVER.
 *
 * `buildBotView` (B17) is that consumer. A bot's fairness rests on "a human sees every car" being
 * true, which only holds while the arena fits inside this rectangle (divided by `CAMERA_CONFIG.zoom`
 * — `arena-01`, 1280x720, fits exactly; `arena-02` is the same size now). Once an arena is larger
 * than this, "could a human see this car" stops being "yes, always" and becomes a real question the
 * server has to answer, and this is the fact it answers it with. Named and pulled from config
 * instead of a literal 1280/720 inside `buildBotView` because invariant 2 (no magic numbers in
 * logic) does not stop applying just because the number in question happens to be about rendering
 * rather than balance.
 *
 * Part of `configFingerprint` (`balance/fingerprint.ts`) for the same reason every other table there
 * is: changing what a bot can see changes what the harness measures.
 */
export const LOGICAL_CANVAS = {
  width: 1280,
  height: 720,
} as const;
