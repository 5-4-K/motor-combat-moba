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
 * - *Time to top speed* is `forwardMaxSpeedOf(id) / accelOf(id)`, also per-car now. Raising a
 *   chassis's speed rating alone stretches this, and that car feels sluggish off the line despite
 *   the higher ceiling.
 * - Each chassis's `CarDef.brakeDecel` **must** beat its own coasting, measured where proportional
 *   drag is strongest — at that chassis's top speed — or holding Down stops it slower than lifting
 *   off and the brake button stops meaning anything. `config.test.ts` enforces the ordering per car.
 * - `CAMERA_CONFIG.freeRoamSpeed` **must** exceed `forwardMaxSpeedOf` of the fastest car, or a
 *   spectator can never get ahead of the fight. `config.test.ts` enforces this against `CAR_TABLE`,
 *   so raising `baseMaxSpeed` or `speedPerRating` past it fails the suite rather than shipping.
 *
 * `baseMaxSpeed` and `speedPerRating` scale together deliberately: the ratio between them is what
 * decides how much the per-car `speed` rating matters. Moving only one re-balances the roster.
 * `baseTurnRate`/`turnRatePerRating` and `baseAccel`/`accelPerRating` are anchored the same way: at
 * rating 50 each pair reproduces one global `turnRate` and `accel`, so retuning `handling` or
 * `accel` per car is a driving change, never accidentally a re-anchor of the whole roster. Moving
 * the whole roster is the other edit, and it means scaling a pair together — as the 1.5x turn-rate
 * raise on 2026-08-31 did.
 *
 * **`docs/turn-tuning.md` tabulates every turn number this file produces, by hand**, and
 * `scripts/turn-tuning-doc.test.mjs` holds those tables to this config. Editing `baseTurnRate`,
 * `turnRatePerRating`, `stopTurnRatio`, `baseMaxSpeed`, `speedPerRating` or `reverseSpeedRatio`
 * fails that test until the page is updated with it. Its "Keeping this page honest" section carries
 * the field list and a snippet that prints the new values.
 */
export const DRIVE_CONFIG = {
  /**
   * Halved from 180 together with `speedPerRating` (4.5 -> 2.25) on 2026-09-01 — a roster-wide 50%
   * top-speed cut, scaled as a pair so the per-car `speed` rating kept its relative weight. Raised
   * 1.5x again on 2026-09-02, to 135, alongside a same-day rating rewrite (see `CAR_TABLE`) — this
   * half of the pair alone would have kept every car's top speed at exactly 1.5x its prior value.
   * Cut again on 2026-09-06 (stage 1 of the vector-drive rework), to 80, alongside `speedPerRating`
   * dropping to 2.2 — together a roughly 40% roster-wide top-speed cut so cars read as heavy, and
   * (with turn rate untouched) a turn radius cut to comfortably under one car length per chassis.
   */
  baseMaxSpeed: 80,
  /**
   * Ratings are 0-100 (see `CAR_TABLE`), so this is a tenth of what it would be on a 0-10 scale.
   * It was 45 against 0-10 ratings and became 4.5 when they widened, precisely so that every car's
   * top speed stayed where it was. 2.25 since the 2026-09-01 half-speed cut — see `baseMaxSpeed`.
   * Raised again on 2026-09-02, but not to the pair-preserving 3.375 (2.25 x 1.5) — 3.7 was a
   * deliberate extra push on top of the uniform 1.5x, so a point of `speed` now buys more than it did
   * before the 2026-09-01 cut, not merely 1.5x more. Cut to 2.2 on 2026-09-06 alongside
   * `baseMaxSpeed`'s drop to 80, for the heavy-car top-speed cut described there.
   */
  speedPerRating: 2.2,
  /**
   * How completely the velocity vector rotates with the heading, 0-1.
   *
   * At 1 the car is on rails: velocity tracks the nose exactly, so turning at any speed puts you
   * where you aim and you never fight your own momentum while steering. Below 1 the velocity lags
   * and the car washes wide.
   *
   * This is deliberately NOT one half of a friction circle. Holding Mirage's turn at top speed
   * demands roughly fifteen times the lateral force that bleeding a ram's knockback needs, so a
   * single honest grip cap high enough to corner on rails would annihilate knockback in about 70ms.
   * Steering is therefore exempt from the grip budget by construction, and `impactGripDecel` below
   * governs imposed motion alone. See spec "Why one friction circle does not work here".
   */
  steeringGrip: 1.0,
  /**
   * The rate externally imposed sideways velocity bleeds off, u/s². Ram recovery and nothing else.
   * Flat rather than proportional: a saturated tyre delivers a roughly constant force.
   */
  impactGripDecel: 250,
  /**
   * Turn rate is `baseTurnRate + handling * turnRatePerRating`, resolved per car by `turnRateOf`.
   *
   * Anchored so rating 50 yields exactly 6.3. That pivot was 4.2 — the single global turn rate this
   * game shipped with — until 2026-08-31, when both halves of the scale were multiplied by 1.5
   * together: driving, and therefore aiming, read as too heavy, so every chassis now turns half again
   * as sharply while the roster's relative agility is untouched. Scaling the pair rather than the
   * base alone is what keeps a point of `handling` worth the same 1.5x on every car.
   * `config.test.ts` pins the anchor.
   */
  baseTurnRate: 3.6,
  turnRatePerRating: 0.054,
  /** Steering at rest, as a fraction of the moving rate. Half the moving rate: 3.15 / 6.3. */
  stopTurnRatio: 0.5,
  /**
   * Engine push is `baseAccel + accel * accelPerRating`, resolved per car by `accelOf`. Anchored the
   * same way `baseTurnRate` is: rating 50 yielded exactly 780 until 2026-09-06. Cut that day, alongside
   * `accelPerRating` (7.2 -> 1.4), from 420 to 60 — rating 50 now yields 130 — as part of stage 1 of
   * the vector-drive rework's heavy-car pass: with the flat `baseAccel` term shrunk relative to the
   * per-rating term, a car's `accel` rating now does most of the work of deciding its time-to-top-speed,
   * which runs 3-4x longer roster-wide and spreads noticeably further between chassis than before.
   */
  baseAccel: 60,
  accelPerRating: 1.4,
  reverseSpeedRatio: 0.65,
  /**
   * Reverse push as a fraction of forward. Below 1: a car pulls away harder in its forward gear than
   * in reverse, which is the whole content of this number.
   *
   * IT USED TO BE 1.41, AND THAT WAS A SURVIVING ARTEFACT RATHER THAN A CHOICE. The figure was
   * historical: when rating 50 yielded exactly 780 forward (until 2026-09-06, see `baseAccel` above),
   * 1.41 gave 1099.8 against the 1100 that shipped — a 0.02% rounding of the exact 1100/780. Under
   * those numbers a car reached BOTH caps well inside any horizon anyone cared about (forward
   * 0.44-0.57 s roster-wide), so the reverse cap — `reverseSpeedRatio` 0.65 of forward — was what a
   * driver actually felt, and the accel factor exceeding 1 never surfaced.
   *
   * The 2026-09-06 heavy-car pass cut `baseAccel`/`accelPerRating` 420/7.2 -> 60/1.4 without
   * touching this factor, and that removed the cover. Time to the forward cap went to 1.49-2.16 s,
   * which is longer than most things that sample the drive model look ahead, so cars now spend the
   * part of a manoeuvre anyone observes in the ACCELERATION-limited regime rather than the
   * speed-limited one — and in that regime this factor, not `reverseSpeedRatio`, is what governs.
   * At 1.41 every chassis covered 1.29x more ground reversing than driving forward over hard's
   * 22-tick plan (Bullseye 44.5 u against 34.6, Mirage 64.7 against 50.3, Bastion 31.8 against
   * 24.7), which is backwards as a statement about a car and was measurably steering the bot: the
   * planner scores candidates on where they END UP, so `throttle: -1` beat `throttle: 1` on every
   * chassis unconditionally and the bot moonwalked. See `bot/brain/planner.ts`.
   *
   * 0.6 is chosen against `reverseSpeedRatio` 0.65 rather than derived: reverse is the weaker gear
   * in both terms now, and slightly weaker in push than in top speed. Nothing anchors it to a
   * measured target — the honest statement is that the ordering is what was wrong, and any value
   * below 1 fixes the ordering. Retune it freely; keep it under 1.
   */
  reverseAccelFactor: 0.6,
  /**
   * Ticks Down must be held *at rest* before reverse engages, guarding against a tap of the brake
   * flinging you backward. At `TICK_RATE_HZ` 30 this is 66ms. Networked as uint16 via `reverseHold`.
   */
  reverseHoldTicks: 2,
  /**
   * Below this |speed| the car counts as stopped: it steers at `turnRateAtStop`, coasting snaps it
   * to exact rest instead of creeping, and the reverse hold delay is allowed to accumulate. It gates
   * sim branches, so it lives here rather than as a literal in `drive.ts`.
   */
  stopEpsilon: 1e-3,
  carWidth: 48,
  carHeight: 32,
  /**
   * Max world units a DASH may translate between collision checks. Half the car's SHORT axis.
   *
   * `mtvBetween` answers "what is the shortest way out of this overlap", which is the way the car
   * came in only while the overlap is shallow. For two axis-aligned cars the backwards push wins
   * only while the centres are more than 16u apart on the dash axis, so there is a 32-unit-wide
   * band in which the resolver is already right — and `thunderclap` at 1600 u/s covers 53.3u per
   * tick, jumping clean over it. Capping the travel per check at half the 32-unit face keeps every
   * sample inside that band from any approach angle; the 48-unit face is the wrong one to size
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
   * against a 48x32 hull): Mirage dashing into a Bullseye, T-boning its side at 90° approach against
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
   * `18.49 → 11.56 → 7.22 → 4.51 → 2.82 → 1.76 → 1.10 …`.
   *
   * Tightening this knob trades substep count for granularity (measured, Mirage-into-Bullseye; all
   * five rows re-measured under stage 3 Task 3's `ramDefence`-weighted split, same method as the
   * headline figure above — this table is not a simple rescale of the pre-Task-3 numbers):
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
   * 0.15, down from 0.35 on 2026-09-06. Real cars are built to crush, not bounce, and sit around
   * 0.1-0.15; a T-bone is a shunt, not a billiard shot. The knockback this game wants comes from
   * momentum transfer through `applyImpulse`, not from springiness here — raising this to get
   * bigger knocks is reaching for the wrong knob and makes every wall graze feel rubbery.
   */
  restitution: 0.15,
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
