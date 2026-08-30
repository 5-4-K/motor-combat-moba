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
 * - `brakeDecel` **must** exceed `drag`, or holding Down stops you slower than releasing the
 *   throttle and the brake button stops meaning anything. `config.test.ts` enforces the ordering.
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
 */
export const DRIVE_CONFIG = {
  baseMaxSpeed: 180,
  /**
   * Ratings are 0-100 (see `CAR_TABLE`), so this is a tenth of what it would be on a 0-10 scale.
   * It was 45 against 0-10 ratings and became 4.5 when they widened, precisely so that every car's
   * top speed stayed where it was: widening the ratings is a combat change, not a driving one.
   */
  speedPerRating: 4.5,
  /** Holding Down against forward motion. Also brakes reverse when Up is held. 0.34s to rest. */
  brakeDecel: 1600,
  /** Throttle released. 0.60s to rest — kept below `brakeDecel` so braking stays the faster option. */
  drag: 900,
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
   * same way `baseTurnRate` is: rating 50 yields exactly 780.
   */
  baseAccel: 420,
  accelPerRating: 7.2,
  reverseSpeedRatio: 0.65,
  /**
   * Reverse push as a fraction of forward. At rating 50 this gives 1099.8 against the 1100 that
   * shipped — a deliberate 0.02% rounding, below anything a driver can feel, taken because the exact
   * ratio (1100/780) is not a number anyone should have to read in a config file.
   */
  reverseAccelFactor: 1.41,
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
  restitution: 0.35,
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
  freeRoamSpeed: 1050,
} as const;
