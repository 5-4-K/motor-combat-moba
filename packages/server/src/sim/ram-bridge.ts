import {
  applyRams,
  carIdOf,
  isOnField,
  type ArenaState,
  type Modifiers,
  type PlayerState,
  type RamCar,
} from "@motor-combat-moba/shared";
import { modifiersFor } from "./effect-bridge.js";

/**
 * The schema half of ramming: read `ArenaState` into plain objects, run the pure `applyRams`, write
 * the answer back.
 *
 * The split mirrors `combat-bridge.ts`. Every rule lives in `@motor-combat-moba/shared` and can be
 * tested without a Colyseus room; this file knows about `MapSchema` and holds no rules at all.
 *
 * Ram runs between driving and combat. Driving must have resolved first, so contacts are measured
 * against the poses cars actually ended the tick at; combat runs after, unaffected, because a ram
 * deals no damage and touches no combat state.
 */

/** Room-owned state that lives across ticks and is deliberately never networked. */
export interface RamMemory {
  /** Pairs that were in contact last tick, so a ram fires on entry rather than every tick. */
  contacts: Set<string>;
}

export function newRamMemory(): RamMemory {
  return { contacts: new Set() };
}

/** Reset a player's knock state to neutral. `authority` is 1 at rest, not 0. */
export function clearKnock(player: PlayerState): void {
  player.angVel = 0;
  player.shoveX = 0;
  player.shoveY = 0;
  player.authority = 1;
}

/**
 * Only living roster members on the field can ram or be rammed. A lobby player standing in the room
 * is not part of the fight, and a wreck is scenery — both still collide through `resolveWorld`, they
 * just neither deal nor take control loss.
 */
function ramCarsOf(
  state: ArenaState,
  roster: ReadonlySet<string>,
  effectMods: ReadonlyMap<string, Modifiers>,
): RamCar[] {
  const cars: RamCar[] = [];
  state.players.forEach((player, sessionId) => {
    if (!roster.has(sessionId)) return;
    if (!isOnField(player)) return;
    if (!player.alive) return;
    cars.push({
      sessionId,
      team: player.team === 1 ? 1 : 0,
      x: player.x,
      y: player.y,
      angle: player.angle,
      speed: player.speed,
      carId: carIdOf(player),
      massMult: modifiersFor(effectMods, sessionId).ramMass,
    });
  });
  return cars;
}

export function ramTick(
  state: ArenaState,
  roster: ReadonlySet<string>,
  memory: RamMemory,
  mode: "ffa" | "team",
  effectMods: ReadonlyMap<string, Modifiers>,
): void {
  const { knocks, contacts } = applyRams(
    ramCarsOf(state, roster, effectMods),
    memory.contacts,
    mode,
  );
  memory.contacts = contacts;

  for (const knock of knocks) {
    const player = state.players.get(knock.sessionId);
    if (!player) continue;
    // `applyRams` only ever picks the hardest knock WITHIN one tick — it says nothing about a knock
    // arriving on top of one still standing from an EARLIER tick. Without this guard: a hexagon rams
    // a victim at full severity (authority drops to 0.35), and five ticks later, still mid-knock, a
    // third car barely taps the same victim just above `minApproachSpeed` (severity near zero,
    // authority near 1.0). Writing that knock unconditionally would overwrite the 0.35 with ~1.0 and
    // cancel the hard ram outright — a light tap "rescuing" the victim from the ram that mattered.
    // `authority` is a strictly decreasing function of `severity` (R8), so "only a harder ram may
    // overwrite a standing one" is exactly "only apply a knock whose authority is strictly lower than
    // the player's current authority". A tap arriving mid-knock now does nothing at all — slightly
    // wrong physically (two real hits landing close together should still stack somewhat), but it can
    // never rescue, which is the failure mode that actually matters.
    if (knock.authority >= player.authority) continue;
    player.angVel = knock.angVel;
    player.shoveX = knock.shoveX;
    player.shoveY = knock.shoveY;
    player.authority = knock.authority;
  }
}
