export const DRIVE_CONFIG = {
  baseMaxSpeed: 120,
  speedPerRating: 30,
  accel: 520,
  brakeDecel: 780,
  drag: 140,
  turnRate: 2.8,
  turnRateAtStop: 1.4,
  reverseSpeedRatio: 0.5,
  reverseHoldTicks: 6,
  carWidth: 48,
  carHeight: 32,
  restitution: 0.35,
} as const;

/**
 * How the client's arena camera follows the local car.
 *
 * `camLerp` is the per-frame fraction of the remaining distance the camera closes on the car. It is
 * a *frame* rate, not a tick rate: rendering is uncapped while the sim runs at `TICK_RATE_HZ`, so
 * this is deliberately a soft-follow feel knob rather than a simulated quantity. Nothing in
 * `stepSim` reads it.
 *
 * `zoom` below 1 pulls the view out so a nearby fight fits on screen at 1280x720.
 *
 * `freeRoamSpeed` is how fast a spectator's free-look camera pans, in world units per **second**, so
 * the pan covers the same ground on a 60 Hz and a 144 Hz display. It is pitched a little above the
 * fastest car so a spectator can outrun the fight to see where it is going.
 */
export const CAMERA_CONFIG = {
  camLerp: 0.12,
  zoom: 1.2,
  freeRoamSpeed: 700,
} as const;
