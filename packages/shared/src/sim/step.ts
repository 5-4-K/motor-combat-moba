import { driveOf } from "../config/car-config.js";
import type { CarId } from "../config/types.js";
import type { InputMessage } from "../net/input.js";
import { resolveWorld, type Aabb, type Bounds, type Obb } from "./collide.js";
import { dashSubstepCount, dashTranslation, isDashing, stepDrive } from "./drive.js";
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
  if (!isDashing(body)) {
    return resolveWorld(driven, ctx.others, ctx.obstacles, ctx.bounds);
  }
  return resolveDash(body, driven, dt, ctx);
}

/**
 * A dash, resolved in bounded steps instead of one teleport.
 *
 * `thunderclap` covers 53.3 units per tick against a 48x32 hull, so a single translation lands the
 * car deep inside whatever it hit — and `mtvBetween` returns the SHORTEST way out of an overlap,
 * which for a deep overlap is not the way the car came in. The resolver is not wrong; it is being
 * asked the wrong question (C1). Rather than teach it where the body came from — an entry-normal
 * or a swept hull, a rewrite of `resolveWorld` and its ordering contract — this bounds how far the
 * body may move between checks, so "shortest way out" and "back the way you came" stay the same
 * direction and the existing resolver is already right (C2).
 *
 * Three things this deliberately does:
 *
 * - **Re-walks from the ORIGINAL position, carrying the tick's bookkeeping.** `driven` already
 *   holds the once-per-tick state — the duration countdown, the exit-speed handoff, the shove and
 *   authority decay — and `stepDrive` applied the full-`dt` translation on top of it. Winding the
 *   position back to `body.x/y` and walking it forward in N pieces re-does only the translation
 *   (C6). In free air the N pieces sum to the same distance, so an uncontested dash is unchanged.
 * - **Holds the world frozen across substeps.** `ctx.others`, `ctx.obstacles` and `ctx.bounds` are
 *   the start-of-tick snapshot every car is already stepped against; re-reading mid-tick would
 *   make the outcome depend on iteration order (C7).
 * - **Does not break out early when a substep is blocked.** Later substeps translate into the
 *   target again and are pushed out again, so the car settles flush against what it hit. Detecting
 *   "made no progress" needs a float epsilon for no behavioural gain (C8).
 *
 * Gated on DASH by the caller even though the derived count would independently be 1 for every
 * other body in the game — the roster's fastest car covers ~10.5u per tick. `applyContact` damps
 * `speed` and reflects the shove on every call, and `resolveWorld`'s contract is that each distinct
 * surface damps exactly once, never r^2 or r^3. Repeating it is harmless for a dash, whose motion
 * comes from `maneuverSpeed` and whose `speed` is overwritten by `endDash` on the tick the hit
 * lands; it would not be harmless for ordinary driving (C9). The gate documents that intent.
 */
function resolveDash(body: SimBody, driven: SimBody, dt: number, ctx: StepContext): SimBody {
  const substeps = dashSubstepCount(body, dt);
  const step = dashTranslation(body, dt / substeps);
  let next: SimBody = { ...driven, x: body.x, y: body.y };
  for (let i = 0; i < substeps; i++) {
    next = resolveWorld(
      { ...next, x: next.x + step.x, y: next.y + step.y },
      ctx.others,
      ctx.obstacles,
      ctx.bounds,
    );
  }
  return next;
}
