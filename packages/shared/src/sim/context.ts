import { DEFAULT_CAR_ID, isCarId } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { CarId } from "../config/types.js";
import { PlayerStatus } from "../constants.js";
import type { Obb } from "./collide.js";
import { isPhasedAt, type StatusRow } from "./status/statuses.js";

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
  /** 0 hp. A dead car is intangible while it fades out — see `isOnField`. */
  alive: boolean;
  /**
   * This car's status rows, straight off the wire. Read only to answer "is it phasing" — everything
   * else the sim derives from statuses goes through `Modifiers`.
   */
  statuses: Iterable<StatusRow>;
}

/** One player with the session id that orders it. */
export interface ContextEntry {
  sessionId: string;
  player: ContextPlayer;
}

/**
 * Only players actually on the field are simulated. Lobby and post-match players are in the room but
 * must never be moved.
 *
 * **A dead car is off the field the instant it dies.** There is no wreck: it stops being simulated,
 * stops being solid, and stops being a ram participant on the tick its hp reaches 0, then fades out
 * on the client over `DEATH_FADE_MS` and is drawn no more. Before 2026-08-30 a wreck stayed
 * `IN_MATCH` and so stayed a collision hull — solid to driving but transparent to combat — which is
 * why this predicate deliberately reads `alive` now as well as `status`.
 *
 * This is the MOVER gate only — see `isSolid` for the WALL gate. The two used to be one predicate
 * and still have to agree everywhere except one case: a car that is driveable but not solid. That is
 * spawn protection (M14), where a respawning car must steer normally while passing through everyone.
 * Outside that case, a player who is not in the match must never be driven around the arena while
 * staying invisible to everyone else's collisions — nothing else may let this diverge from `isSolid`.
 */
export function isOnField(player: Pick<ContextPlayer, "status" | "alive">): boolean {
  return player.status === PlayerStatus.IN_MATCH && player.alive;
}

/**
 * Does this car participate in contacts — collisions and rams?
 *
 * `isOnField` and this used to be one predicate, and the comment above still explains why they
 * mostly agree. They separate for exactly one case: a car that is **driveable but not solid**.
 *
 * That is spawn protection (M14). A respawning car must steer normally while passing through
 * everyone, so the MOVER gate keeps `isOnField` and the WALL gate takes this. Nothing else may use
 * this to move a car, and nothing else may use `isOnField` to decide solidity.
 */
export function isSolid(
  player: Pick<ContextPlayer, "status" | "alive" | "statuses">,
  tick: number,
): boolean {
  return isOnField(player) && !isPhasedAt(player.statuses, tick);
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
 * Hulls of every *other* solid player (`isSolid`), in the order `entries` are given — UNLESS the
 * caller itself is not solid, in which case this returns `[]` regardless of who else is on the
 * field. See the caller-side guard below for why that second half is required.
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
export function otherCarHulls(
  entries: readonly ContextEntry[],
  selfSessionId: string,
  tick: number,
): Obb[] {
  const self = entries.find((entry) => entry.sessionId === selfSessionId);
  // `resolveWorld` separates a SINGLE body against a list — each car pushes itself out of what it
  // sees. Mutual passage is emergent from both sides running their own step with an empty view of
  // each other; it is not automatic from filtering the ENTRY alone. Entry-only filtering makes A
  // invisible to B, but B is still handed A's hull and gets shoved and speed-bounced by it — a
  // respawning car would be blocked and knocked around by the very car camping its spawn, which
  // defeats spawn protection (M14) and the "not a collider" half of M13. So a non-solid caller sees
  // NOTHING, on top of being filtered out of everyone else's list below — both directions are
  // required for real intangibility.
  //
  // A caller absent from `entries` (the client's "local player not loaded yet" path) defaults to
  // solid rather than phased: `buildStepContext` must still return real hulls for prediction to run
  // against, not an empty world for a car nobody has actually put into spawn protection.
  if (self && !isSolid(self.player, tick)) return [];

  const hulls: Obb[] = [];
  for (const { sessionId, player } of entries) {
    if (sessionId === selfSessionId) continue;
    // Filtered on the ENTRY as well — a solid caller must still not see anyone ELSE who is phasing.
    if (!isSolid(player, tick)) continue;
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
