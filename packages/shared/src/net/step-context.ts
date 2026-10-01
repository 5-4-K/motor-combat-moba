import { NEUTRAL_MODIFIERS, type Modifiers } from "../sim/status/modifiers.js";
import { boundsOf } from "../arena/bounds.js";
import { carIdOf, otherCarHulls, type ContextEntry, type ContextPlayer } from "../sim/context.js";
import { modifiersFromRows, type StatusRow } from "../sim/status/statuses.js";
import { ramDefenceOf } from "../config/car-config.js";
import { type ArenaDef } from "../arena/types.js";
import { type StepContext } from "../sim/step.js";

export type { ContextPlayer };

/** Just the roster. The arena is passed in separately so it is not looked up per predicted tick. */
export interface ContextState {
  players: {
    forEach(callback: (player: ContextPlayer, sessionId: string) => void): void;
  };
}

/**
 * Where a remote car stands at the END of server tick `tick` (a snapshot of tick T is the end of T),
 * or undefined to use its roster pose. `buildStepContext` says which tick to ask about
 * (`remotePoseTickFor`).
 */
export type PoseOf = (sessionId: string, tick: number) => { x: number; y: number; angle: number } | undefined;

/**
 * The tick whose END a remote stands at while the local car is stepped on server tick `tick`.
 * `serverTick` steps cars one after another in sorted `sessionId` order, each against the CURRENT
 * poses of the others: a remote that sorts before the local car has already been stepped this tick
 * (end of `tick`), one that sorts after it has not (end of `tick - 1`). Same comparison as the
 * server's `sortedEntries` (phase E review M1).
 */
export function remotePoseTickFor(remoteSessionId: string, selfSessionId: string, tick: number): number {
  return remoteSessionId < selfSessionId ? tick : tick - 1;
}

/**
 * The `StepContext` the local car is predicted through. This is the client's half of the lockstep:
 * it must describe the same world `serverTick` describes for the same tick, or prediction diverges
 * and reconciliation spends the match snapping the car back.
 *
 * The parts that must agree — who is solid, how a hull is sized, and the fallback chassis — are not
 * reimplemented here. `carIdOf` and `otherCarHulls` are the *same* shared functions `serverTick`
 * calls, so a P5 change like per-car hull dimensions moves both sides at once. All this function
 * owns is getting the roster into sorted `sessionId` order, because `resolveWorld` resolves contacts
 * sequentially and `MapSchema` iteration order is not stable enough to rely on.
 *
 * Scope note: the `isSolid` filter inside `otherCarHulls` is only the **wall** half of the gate —
 * which players are solid (a respawning car passes it once its phase lapses, per M14). The **mover**
 * half, whether the local player's inputs may move anything at all, is the caller's: see
 * `ArenaScene.canDrive` and `reconcileLocal`. Calling this function does not by itself gate movement.
 *
 * `tick` is the SERVER tick the step simulates — for prediction, the frame's own tick, the one
 * `serverTick` will run it on (phase D review M5) — and the same one `localModifiers` reads:
 * `isSolid` and `modifiersFromRows` both judge a status by `tick < endsTick`, so reading the
 * snapshot's tick for a frame `lead` ticks later would keep a lapsing slow on for `lead` ticks too
 * long, and a local wall clock would lapse it on a tick the server never ran.
 *
 * Remotes enter wherever `poseOf` says they are when the server steps the local car (NR32): the
 * client passes each remote's dead-reckoned pose, because the server steps the local car at that
 * tick against wherever the remotes are THEN, not where the last snapshot showed them. "Then" is the
 * end of `tick` for a remote stepped before the local car and the end of `tick - 1` for one stepped
 * after it (`remotePoseTickFor`), so `poseOf` is asked about that tick. Only `x`,
 * `y` and `angle` are replaced — who is solid, the chassis and `ramDefence` still come off the
 * roster. `poseOf` is never asked about the local car, and a remote it has no answer for (or every
 * remote, when it is omitted) enters at its last-known server pose.
 */
export function buildStepContext(
  arena: ArenaDef,
  state: ContextState,
  selfSessionId: string,
  tick: number,
  modifiers: Readonly<Modifiers>,
  poseOf?: PoseOf,
): StepContext {
  const entries: ContextEntry[] = [];
  state.players.forEach((player, sessionId) => {
    const pose =
      poseOf && sessionId !== selfSessionId
        ? poseOf(sessionId, remotePoseTickFor(sessionId, selfSessionId, tick))
        : undefined;
    // Field by field, never a spread: `player` is a Colyseus schema instance in the client, whose
    // fields are accessors a spread would not copy.
    entries.push({
      sessionId,
      player: pose
        ? {
            x: pose.x,
            y: pose.y,
            angle: pose.angle,
            status: player.status,
            carId: player.carId,
            alive: player.alive,
            statuses: player.statuses,
          }
        : player,
    });
  });
  entries.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));

  const self = entries.find((entry) => entry.sessionId === selfSessionId);
  // Same fallback as `carId` below: a missing local player still yields a usable context.
  const carId = carIdOf(self?.player ?? { carId: "" });

  return {
    carId,
    others: otherCarHulls(entries, selfSessionId, tick),
    obstacles: arena.obstacles,
    bounds: boundsOf(arena),
    modifiers,
    selfRamDefence: ramDefenceOf(carId),
  };
}

/**
 * The local car's status multipliers, from the rows the server patched onto it.
 *
 * The client's half of the effect layer, and it is deliberately thin: `modifiersFromRows` is the
 * *same* shared function `serverTick` reaches through, so the two sides cannot drift on how a list
 * of effects becomes a set of multipliers — the same rule that keeps `carIdOf` and `otherCarHulls`
 * out of this file. All this adds is reading the rows off the schema and answering neutral for a
 * player who is not in the room yet.
 *
 * `tick` is the state's own tick, not a local clock. A status is active while `tick < endsTick`, so
 * the reading has to be taken on the tick the server is on — and `modifiersFromRows` filters by it
 * independently of the server's sweep, which is what stops a patch arriving one tick late from
 * predicting a slow the server has already dropped.
 */
export function localModifiers(
  state: StatusRowSource,
  selfSessionId: string,
  tick: number,
): Readonly<Modifiers> {
  const rows = state.players.get(selfSessionId)?.statuses;
  if (!rows) return NEUTRAL_MODIFIERS;
  return modifiersFromRows(rows, tick);
}

/**
 * Just enough of `ArenaState` to read one player's status rows. Named for what it supplies rather
 * than after the schema class `StatusState`, which is one row and not a source of them.
 */
export interface StatusRowSource {
  players: { get(sessionId: string): { statuses: Iterable<StatusRow> } | undefined };
}
