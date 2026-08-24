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

  // cos/sin are not guaranteed bit-identical across JS engines (server V8 vs. client browser
  // engine), so replayed positions can drift by an ULP or two. That's fine here: Task 4
  // reconciles client prediction against authoritative server state rather than trusting
  // bit-exact replay, so this is not a desync-checksum-safe function.
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
 * Down: brake toward 0 while rolling forward. Once already reversing, keep accelerating backward
 * without re-arming the hold delay. Only at rest does reverseHold accumulate toward
 * reverseHoldTicks before reverse engages, clamped to the car's reverse max.
 */
function brakeOrReverse(
  speed: number,
  reverseHold: number,
  dt: number,
  carId: CarId,
): { speed: number; reverseHold: number } {
  if (speed > MOVING_SPEED_EPSILON) {
    // Still rolling forward — brake toward 0 first.
    return { speed: Math.max(0, speed - DRIVE_CONFIG.brakeDecel * dt), reverseHold: 0 };
  }
  if (speed < -MOVING_SPEED_EPSILON) {
    // Already reversing — keep accelerating; do not re-arm the hold delay.
    return {
      speed: Math.max(-reverseMaxSpeedOf(carId), speed - DRIVE_CONFIG.accel * dt),
      reverseHold: DRIVE_CONFIG.reverseHoldTicks,
    };
  }
  // At rest: accumulate toward the reverse threshold. Clamped so the uint16-networked field
  // stays idempotent at the threshold instead of growing unbounded (and eventually truncating
  // on the wire) while reverse is held.
  const heldTicks = Math.min(reverseHold + 1, DRIVE_CONFIG.reverseHoldTicks);
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
  if (speed > MOVING_SPEED_EPSILON) return Math.max(0, speed - DRIVE_CONFIG.drag * dt);
  if (speed < -MOVING_SPEED_EPSILON) return Math.min(0, speed + DRIVE_CONFIG.drag * dt);
  return 0; // inside the band: snap to true rest
}
