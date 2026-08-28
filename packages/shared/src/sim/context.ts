import { DEFAULT_CAR_ID, isCarId } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { CarId } from "../config/types.js";
import { PlayerStatus } from "../constants.js";
import type { Obb } from "./collide.js";

/**
 * The fields of a networked player that `StepContext` assembly reads. Structural on purpose:
 * `PlayerState` satisfies it on the server, and the client can satisfy it without a schema instance.
 */
export interface ContextPlayer {
  x: number;
  y: number;
  angle: number;
  status: number;
  carId: string;
}

/** One player with the session id that orders it. */
export interface ContextEntry {
  sessionId: string;
  player: ContextPlayer;
}

/**
 * Only players actually on the field are simulated, and only they are solid to each other. Lobby
 * and post-match players are in the room but must not act as invisible walls.
 *
 * The mover gate and the wall gate have to be the same predicate, or a player who is not in the
 * match would be driven around the arena while staying invisible to everyone else's collisions.
 */
export function isOnField(player: Pick<ContextPlayer, "status">): boolean {
  return player.status === PlayerStatus.IN_MATCH;
}

/**
 * `""` before the car reveal, and anything unrecognised, falls back to the default chassis.
 * `isCarId` is an own-property check: a bare `in` would also accept inherited names like
 * `"constructor"`, whose stat lookup yields undefined and NaNs the whole drive step.
 */
export function carIdOf(player: Pick<ContextPlayer, "carId">): CarId {
  return isCarId(player.carId) ? player.carId : DEFAULT_CAR_ID;
}

/**
 * Hulls of every *other* player currently on the field, in the order `entries` are given.
 *
 * **`entries` must be sorted by `sessionId`, and the resulting order is load-bearing rather than
 * cosmetic:** `resolveWorld` applies contacts sequentially over `others`, and the last contact
 * resolved is the one guaranteed to end separated. Two hulls swapped here can settle a squeezed car
 * on a different pose. `MapSchema` insertion order is not stable enough to rely on, so callers sort.
 *
 * Server tick and client prediction both call this. That is the point: `stepSim` is the single
 * lockstep, `StepContext` is its input, and a client that built `others` even slightly differently
 * would diverge and spend the match being snapped back. Anything that changes the shape of a hull —
 * per-car dimensions, for instance — changes it for both sides at once here.
 */
export function otherCarHulls(entries: readonly ContextEntry[], selfSessionId: string): Obb[] {
  const hulls: Obb[] = [];
  for (const { sessionId, player } of entries) {
    if (sessionId === selfSessionId) continue;
    if (!isOnField(player)) continue;
    hulls.push(carHullOf(player.x, player.y, player.angle));
  }
  return hulls;
}

/**
 * The collision hull of one car at a pose. Every consumer of car geometry goes through here —
 * driving contacts, projectile hit tests — so hull dimensions are one edit, and a shot can never
 * hit a box that driving would not have collided with.
 */
export function carHullOf(x: number, y: number, angle: number): Obb {
  return { x, y, angle, w: DRIVE_CONFIG.carWidth, h: DRIVE_CONFIG.carHeight };
}
