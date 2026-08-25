/**
 * Arcade drive tuning. Every value here is read by `stepSim`, so server tick and client prediction
 * both depend on them agreeing — these are networked balance, not render preferences.
 *
 * **What is coupled to what.** These knobs are not independent, and changing one in isolation is
 * how the feel regresses:
 *
 * - *Turn radius* is `speed / turnRate`. Raising the speed knobs without raising `turnRate` widens
 *   every corner, so a faster car reads as a *less* agile one. At the current values the fastest
 *   car turns inside 129 world units.
 * - *Time to top speed* is `forwardMaxSpeedOf(id) / accel`. Raising the speed knobs alone stretches
 *   it, and the car feels sluggish off the line despite the higher ceiling. Currently 0.69s.
 * - `brakeDecel` **must** exceed `drag`, or holding Down stops you slower than releasing the
 *   throttle and the brake button stops meaning anything. `config.test.ts` enforces the ordering.
 * - `CAMERA_CONFIG.freeRoamSpeed` **must** exceed `forwardMaxSpeedOf` of the fastest car, or a
 *   spectator can never get ahead of the fight. `config.test.ts` enforces this against `CAR_TABLE`,
 *   so raising `baseMaxSpeed` or `speedPerRating` past it fails the suite rather than shipping.
 *
 * `baseMaxSpeed` and `speedPerRating` scale together deliberately: the ratio between them is what
 * decides how much the per-car `speed` rating matters. Moving only one re-balances the roster.
 *
 * Times below are quoted for the fastest chassis (rectangle, speed rating 8, 540 units/second).
 */
export const DRIVE_CONFIG = {
  baseMaxSpeed: 180,
  speedPerRating: 45,
  accel: 780,
  /** Holding Down against forward motion. Also brakes reverse when Up is held. 0.34s to rest. */
  brakeDecel: 1600,
  /** Throttle released. 0.60s to rest — kept below `brakeDecel` so braking stays the faster option. */
  drag: 900,
  turnRate: 4.2,
  turnRateAtStop: 2.1,
  reverseSpeedRatio: 0.65,
  /**
   * Backing up gets its own rate rather than borrowing `accel`, so the brake-to-reverse transition
   * can be quick without making forward acceleration equally twitchy. 0.32s to the reverse cap.
   */
  reverseAccel: 1100,
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
 * be; the price is a 640x360 world-unit view at 1280x720. 1.5 keeps a wider view and stays inside
 * the 1–2 range where the textures neither shimmer nor go soft.
 *
 * `freeRoamSpeed` is how fast a spectator's free-look camera pans, in world units per **second**, so
 * the pan covers the same ground on a 60 Hz and a 144 Hz display. It is pitched a little above the
 * fastest car so a spectator can outrun the fight to see where it is going — see the coupling note
 * on `DRIVE_CONFIG`.
 */
export const CAMERA_CONFIG = {
  camLerp: 0.18,
  zoom: 1.5,
  freeRoamSpeed: 1050,
} as const;
