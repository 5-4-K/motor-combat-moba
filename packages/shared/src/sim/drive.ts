import type { CarId } from "../config/types.js";
import { forwardMaxSpeedOf, reverseMaxSpeedOf } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { RAM_CONFIG, RAM_DECAY } from "../config/ram-config.js";
import type { InputMessage } from "../net/input.js";
import type { Modifiers } from "./effects/modifiers.js";
import type { SimBody } from "./step.js";

/**
 * Arcade drive: steering, throttle/brake/reverse, and world translation for one tick. Pure.
 *
 * `mods` are the car's buff/debuff multipliers. They scale the drive CONSTANTS — the turn rate, the
 * engine's push, the speed caps — and change nothing about the integration itself: the drive model
 * is the same three lines it was, read with different numbers. At `NEUTRAL_MODIFIERS` every product
 * is a multiplication by 1 and this function is arithmetically identical to its pre-effect self,
 * which is the property `golden.test.ts` pins.
 *
 * Braking and drag are deliberately NOT scaled by any channel. Both are the car's ability to *stop*,
 * and a debuff that made a car harder to slow down would read to its driver as the game taking the
 * brakes away — the one input a player reaches for when they are already in trouble.
 */
export function stepDrive(
  body: SimBody,
  input: InputMessage,
  dt: number,
  carId: CarId,
  mods: Readonly<Modifiers>,
): SimBody {
  const baseTurnRate = isMoving(body.speed) ? DRIVE_CONFIG.turnRate : DRIVE_CONFIG.turnRateAtStop;
  const turnRate = baseTurnRate * mods.turnRate;
  // Steering is scaled by authority; injected spin is not. Both are ADDED into one rotation, which
  // is what makes countersteering free: the integrator does not know why angVel is high, so steering
  // the other way simply subtracts from the same sum.
  //
  // `mods.turnRate` multiplies alongside `authority` rather than replacing it: they answer different
  // questions ("how sharply does this car turn" vs "how much of your steering is reaching the road
  // right now"), they decay on different clocks, and a rattled car mid-ram should be both.
  const angle = body.angle + (input.steer * turnRate * body.authority + body.angVel) * dt;

  // `immobilised` zeroes the THROTTLE, not the car: steering, braking, drag and any standing knock
  // all still resolve. No effect row uses it — see the design note in `effect-config.ts`.
  const throttle = mods.immobilised ? 0 : input.throttle;
  const { speed, reverseHold } = nextSpeed(body.speed, body.reverseHold, throttle, dt, carId, mods);

  // cos/sin are not guaranteed bit-identical across JS engines (server V8 vs. client browser
  // engine), so replayed positions can drift by an ULP or two. That's fine here: Task 4
  // reconciles client prediction against authoritative server state rather than trusting
  // bit-exact replay, so this is not a desync-checksum-safe function.
  //
  // Shove is added to the drive velocity, never substituted for it: a car that is both driving and
  // knocked does both. At `shoveX/shoveY` of 0 this is arithmetically identical to the pre-ram
  // model, which `golden.test.ts` pins.
  const x = body.x + (Math.cos(angle) * speed + body.shoveX) * dt;
  const y = body.y + (Math.sin(angle) * speed + body.shoveY) * dt;

  return {
    x,
    y,
    angle,
    speed,
    reverseHold,
    angVel: nextAngVel(body.angVel, input.steer),
    shoveX: decayShove(body.shoveX),
    shoveY: decayShove(body.shoveY),
    authority: recoverAuthority(body.authority),
  };
}

/**
 * Injected spin decays on its own, and decays FASTER while the player steers against it.
 *
 * Without that second rate, steering could only offset the visible rotation while the underlying
 * spin ran its full course, so recovery time would be fixed by decay alone and skill could not
 * shorten a knock. This is the one line that makes reading the spin direction worth anything.
 */
function nextAngVel(angVel: number, steer: InputMessage["steer"]): number {
  const fighting = steer * angVel < 0;
  const next = angVel * (fighting ? RAM_DECAY.counterSteer : RAM_DECAY.spin);
  return Math.abs(next) < RAM_CONFIG.spinEpsilon ? 0 : next;
}

function decayShove(component: number): number {
  const next = component * RAM_DECAY.shove;
  return Math.abs(next) < RAM_CONFIG.shoveEpsilon ? 0 : next;
}

/**
 * Authority climbs back toward full control: it is the GAP to 1 that halves, not the value itself.
 * Snapped to exactly 1 inside the epsilon so a car is never left permanently a hair below full
 * steering — exponential recovery never actually arrives.
 */
function recoverAuthority(authority: number): number {
  const next = 1 - (1 - authority) * RAM_DECAY.authority;
  return 1 - next < RAM_CONFIG.authorityEpsilon ? 1 : next;
}

/** Outside the `stopEpsilon` band the car counts as rolling, in whichever direction. */
function isMoving(speed: number): boolean {
  return Math.abs(speed) > DRIVE_CONFIG.stopEpsilon;
}

function nextSpeed(
  speed: number,
  reverseHold: number,
  throttle: InputMessage["throttle"],
  dt: number,
  carId: CarId,
  mods: Readonly<Modifiers>,
): { speed: number; reverseHold: number } {
  if (throttle === 1) {
    return { speed: accelerateForward(speed, dt, carId, mods), reverseHold: 0 };
  }
  if (throttle === -1) {
    return brakeOrReverse(speed, reverseHold, dt, carId, mods);
  }
  return { speed: coast(speed, dt), reverseHold: 0 };
}

/**
 * Up: brake toward 0 while rolling backward, otherwise accelerate forward, clamped to the car's
 * forward max.
 *
 * The cap is the car's rating scaled by `mods.topSpeed`, and it CLAMPS rather than merely limiting
 * growth: a car doing 260 that is slowed to a cap of 200 drops to 200 on the next throttled tick.
 * That is abrupt on purpose. The alternative — letting a car hold a speed its engine may no longer
 * reach — means a slow does nothing at all to whoever was already at top speed, which is precisely
 * the car it was aimed at. Off the throttle, drag brings the same car down smoothly; the snap only
 * happens while the driver is actively asking for more.
 */
function accelerateForward(
  speed: number,
  dt: number,
  carId: CarId,
  mods: Readonly<Modifiers>,
): number {
  if (speed < -DRIVE_CONFIG.stopEpsilon) {
    return Math.min(0, speed + DRIVE_CONFIG.brakeDecel * dt);
  }
  return Math.min(
    forwardMaxSpeedOf(carId) * mods.topSpeed,
    speed + DRIVE_CONFIG.accel * mods.accel * dt,
  );
}

/**
 * Down: brake toward 0 at `brakeDecel` while rolling forward. Once already reversing, keep
 * accelerating backward at `reverseAccel` without re-arming the hold delay. Only at rest does
 * reverseHold accumulate toward reverseHoldTicks before reverse engages, clamped to the car's
 * reverse max.
 */
function brakeOrReverse(
  speed: number,
  reverseHold: number,
  dt: number,
  carId: CarId,
  mods: Readonly<Modifiers>,
): { speed: number; reverseHold: number } {
  if (speed > DRIVE_CONFIG.stopEpsilon) {
    // Still rolling forward — brake toward 0 first.
    return { speed: Math.max(0, speed - DRIVE_CONFIG.brakeDecel * dt), reverseHold: 0 };
  }
  if (speed < -DRIVE_CONFIG.stopEpsilon) {
    // Already reversing — keep accelerating; do not re-arm the hold delay.
    return { speed: reverseFurther(speed, dt, carId, mods), reverseHold: DRIVE_CONFIG.reverseHoldTicks };
  }
  // At rest: accumulate toward the reverse threshold. Clamped so the uint16-networked field
  // stays idempotent at the threshold instead of growing unbounded (and eventually truncating
  // on the wire) while reverse is held.
  const heldTicks = Math.min(reverseHold + 1, DRIVE_CONFIG.reverseHoldTicks);
  if (heldTicks < DRIVE_CONFIG.reverseHoldTicks) {
    return { speed, reverseHold: heldTicks };
  }
  return { speed: reverseFurther(speed, dt, carId, mods), reverseHold: heldTicks };
}

/**
 * One tick of backward acceleration, pinned at the car's reverse cap.
 *
 * Reverse is scaled by the same two channels as forward — a slow that left reverse untouched would
 * make backing away the fastest way out of it.
 */
function reverseFurther(
  speed: number,
  dt: number,
  carId: CarId,
  mods: Readonly<Modifiers>,
): number {
  return Math.max(
    -reverseMaxSpeedOf(carId) * mods.topSpeed,
    speed - DRIVE_CONFIG.reverseAccel * mods.accel * dt,
  );
}

/** No throttle: drag pulls speed toward 0 from either direction. */
function coast(speed: number, dt: number): number {
  if (speed > DRIVE_CONFIG.stopEpsilon) return Math.max(0, speed - DRIVE_CONFIG.drag * dt);
  if (speed < -DRIVE_CONFIG.stopEpsilon) return Math.min(0, speed + DRIVE_CONFIG.drag * dt);
  return 0; // inside the band: snap to true rest
}
