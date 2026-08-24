import type { CarId } from "../config/types.js";
import { forwardMaxSpeedOf, reverseMaxSpeedOf } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { InputMessage } from "../net/input.js";
import type { SimBody } from "./step.js";

/** Below this |speed|, the car is treated as stopped for steering/braking purposes. */
const MOVING_SPEED_EPSILON = 1e-3;

/** Arcade drive: steering, throttle/brake/reverse, and world translation for one tick. Pure. */
export function stepDrive(body: SimBody, input: InputMessage, dt: number, carId: CarId): SimBody {
  const turnRate =
    Math.abs(body.speed) > MOVING_SPEED_EPSILON ? DRIVE_CONFIG.turnRate : DRIVE_CONFIG.turnRateAtStop;
  const angle = body.angle + input.steer * turnRate * dt;

  const { speed, reverseHold } = nextSpeed(body.speed, body.reverseHold, input.throttle, dt, carId);

  const x = body.x + Math.cos(angle) * speed * dt;
  const y = body.y + Math.sin(angle) * speed * dt;

  return { x, y, angle, speed, reverseHold };
}

function nextSpeed(
  speed: number,
  reverseHold: number,
  throttle: InputMessage["throttle"],
  dt: number,
  carId: CarId,
): { speed: number; reverseHold: number } {
  if (throttle === 1) {
    return { speed: accelerateForward(speed, dt, carId), reverseHold: 0 };
  }
  if (throttle === -1) {
    return brakeOrReverse(speed, reverseHold, dt, carId);
  }
  return { speed: coast(speed, dt), reverseHold: 0 };
}

/** Up: brake toward 0 while rolling backward, otherwise accelerate forward, clamped to the car's forward max. */
function accelerateForward(speed: number, dt: number, carId: CarId): number {
  if (speed < -MOVING_SPEED_EPSILON) {
    return Math.min(0, speed + DRIVE_CONFIG.brakeDecel * dt);
  }
  return Math.min(forwardMaxSpeedOf(carId), speed + DRIVE_CONFIG.accel * dt);
}

/**
 * Down: brake toward 0 while rolling forward. Once stopped (or already reversing), accumulate
 * reverseHold; once it reaches reverseHoldTicks, accelerate backward, clamped to the car's reverse max.
 */
function brakeOrReverse(
  speed: number,
  reverseHold: number,
  dt: number,
  carId: CarId,
): { speed: number; reverseHold: number } {
  if (speed > MOVING_SPEED_EPSILON) {
    return { speed: Math.max(0, speed - DRIVE_CONFIG.brakeDecel * dt), reverseHold: 0 };
  }
  const heldTicks = reverseHold + 1;
  if (heldTicks < DRIVE_CONFIG.reverseHoldTicks) {
    return { speed, reverseHold: heldTicks };
  }
  return {
    speed: Math.max(-reverseMaxSpeedOf(carId), speed - DRIVE_CONFIG.accel * dt),
    reverseHold: heldTicks,
  };
}

/** No throttle: drag pulls speed toward 0 from either direction. */
function coast(speed: number, dt: number): number {
  if (speed > 0) return Math.max(0, speed - DRIVE_CONFIG.drag * dt);
  if (speed < 0) return Math.min(0, speed + DRIVE_CONFIG.drag * dt);
  return speed;
}
