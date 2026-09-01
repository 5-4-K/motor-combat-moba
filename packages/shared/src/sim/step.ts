import { driveOf } from "../config/car-config.js";
import type { CarId } from "../config/types.js";
import type { InputMessage } from "../net/input.js";
import { resolveWorld, type Aabb, type Bounds, type Obb } from "./collide.js";
import { stepDrive } from "./drive.js";
import type { Modifiers } from "./status/modifiers.js";

export interface SimBody {
  x: number;
  y: number;
  angle: number;
  speed: number;
  reverseHold: number;
  /**
   * Injected rotation, radians per second, decaying toward 0. Set only by a ram; steering is a
   * separate term and does not write here. Added to the steering rate rather than replacing it, so
   * `angVel: 0` reproduces the pre-ram drive model exactly.
   */
  angVel: number;
  /** Injected lateral knock, world units per second, decaying toward 0. Added to the drive velocity. */
  shoveX: number;
  shoveY: number;
  /**
   * Steering effectiveness, 1 = full control, decaying back UP toward 1. Scales the steer input only
   * — never throttle, so a knocked player can always drive their way out. Neutral is 1, not 0.
   */
  authority: number;
  /**
   * The maneuver this car is in — dash, hold or charge (spec S3). Server-written and
   * `stepDrive`-integrated, exactly the ram-knock pattern above (invariant 8, arch O13): that is
   * what keeps a later client-predicted trigger an additive upgrade rather than a rewrite.
   */
  /** ManeuverKind value. 0 = none. */
  maneuver: number;
  maneuverTicksLeft: number;
  /** DASH only: the direction the car translates and faces. */
  maneuverAngle: number;
  /** DASH only: world units per second. */
  maneuverSpeed: number;
}

/**
 * Everything outside the body that one tick of simulation needs: which car is being driven, and the
 * world it is driving through. `others` are the *other* cars' hulls (centre-based `Obb`), `obstacles`
 * come straight from `getArena(...).obstacles` (top-left `Aabb`), and `bounds` is the arena extent.
 */
export interface StepContext {
  carId: CarId;
  others: readonly Obb[];
  obstacles: readonly Aabb[];
  bounds: Bounds;
  /**
   * The multipliers this car is driving under, collapsed from the statuses it is in by
   * `modifiersOf`. `NEUTRAL_MODIFIERS` for a car in no status, which reproduces the pre-status
   * drive model exactly.
   *
   * It lives on the context rather than on `SimBody` because it is not integrated state: nothing in
   * `stepDrive` writes it back, and it is a fact about the world's current rules for this car in the
   * same way `others` is a fact about where everyone else is. It is also deliberately **required**,
   * not optional with a neutral default — `serverTick` and the client's `buildStepContext` are the
   * only two builders of a `StepContext`, they must describe the same tick, and a default here would
   * let one of them silently forget while the other did not. The compiler is the thing that keeps
   * the two halves of the lockstep honest; a default would take that away.
   */
  modifiers: Readonly<Modifiers>;
}

/**
 * The lockstep: drive, then resolve against the world. Server and client call this same function, so
 * neither half may be reordered or skipped on one side only. Pure — `body` and `ctx` are never mutated.
 */
export function stepSim(body: SimBody, input: InputMessage, dt: number, ctx: StepContext): SimBody {
  const driven = stepDrive(body, input, dt, driveOf(ctx.carId), ctx.modifiers);
  return resolveWorld(driven, ctx.others, ctx.obstacles, ctx.bounds);
}
