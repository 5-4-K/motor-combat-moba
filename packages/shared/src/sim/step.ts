import type { CarId } from "../config/types.js";
import type { InputMessage } from "../net/input.js";
import { resolveWorld, type Aabb, type Bounds, type Obb } from "./collide.js";
import { stepDrive } from "./drive.js";

export interface SimBody {
  x: number;
  y: number;
  angle: number;
  speed: number;
  reverseHold: number;
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
}

/**
 * The lockstep: drive, then resolve against the world. Server and client call this same function, so
 * neither half may be reordered or skipped on one side only. Pure — `body` and `ctx` are never mutated.
 */
export function stepSim(body: SimBody, input: InputMessage, dt: number, ctx: StepContext): SimBody {
  const driven = stepDrive(body, input, dt, ctx.carId);
  return resolveWorld(driven, ctx.others, ctx.obstacles, ctx.bounds);
}
