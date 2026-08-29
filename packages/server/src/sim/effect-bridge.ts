import {
  EffectState,
  NEUTRAL_MODIFIERS,
  expireEffects,
  modifiersOf,
  toActiveEffects,
  type ActiveEffect,
  type ArenaState,
  type Modifiers,
  type PlayerState,
} from "@motor-combat-moba/shared";

/**
 * The schema half of buffs and debuffs: read `PlayerState.effects` into plain objects, run the pure
 * expiry, write the answer back, and hand every other tick phase the modifiers it needs.
 *
 * The split mirrors `ram-bridge.ts` and `combat-bridge.ts`. Every rule lives in
 * `@motor-combat-moba/shared` and can be tested without a Colyseus room; this file knows about
 * `ArraySchema` and holds no rules at all.
 *
 * Unlike those two, this bridge owns no room memory. An effect has no server-only half — the list on
 * the schema IS the state, because the client has to hold the same list to predict the same car
 * through `stepSim`. That is the difference between an effect and a `FireState`: the fire machine's
 * rules are the server's business and the client is told only the result, whereas an effect's rules
 * are read by both halves of the lockstep.
 *
 * `effectTick` runs FIRST in the room tick, before driving, ramming or combat — see `ArenaRoom.tick`.
 */

/** One player's effects as the sim sees them, validated off the wire. */
export function readEffects(player: PlayerState): ActiveEffect[] {
  return toActiveEffects(player.effects);
}

/**
 * Project an effect list back onto the schema.
 *
 * Rows are positional and resized rather than rebuilt, exactly as `writeSlots` handles weapon slots:
 * an `ArraySchema` emptied and refilled patches every row to every client every tick, which is
 * precisely the bandwidth the patch rate exists to avoid. `applyEffect` keeps the list sorted by
 * `effectId`, so a stable set of effects writes stable rows and produces no patch at all.
 */
export function writeEffects(player: PlayerState, effects: readonly ActiveEffect[]): void {
  while (player.effects.length > effects.length) player.effects.pop();
  effects.forEach((effect, index) => {
    let row = player.effects.at(index);
    if (!row) {
      row = new EffectState();
      player.effects.push(row);
    }
    row.effectId = effect.effectId;
    row.endsTick = effect.endsTick;
    row.stacks = effect.stacks;
    row.sourceSessionId = effect.sourceSessionId;
  });
}

/** Every effect gone at once. A new match, a fresh spawn — anything that is not "it ran out". */
export function clearPlayerEffects(player: PlayerState): void {
  while (player.effects.length > 0) player.effects.pop();
}

/**
 * Sweep every player's expired effects and return the modifiers the rest of the tick reads.
 *
 * Expiry happens here, once, before anything reads a modifier: driving, ramming and combat all see
 * the same list, so a tick can never simulate an effect whose last tick was the previous one, and no
 * two phases can disagree about whether a car is still slowed.
 *
 * A player with nothing on them is not written to and is not given an entry — `modifiersFor` below
 * falls back to the shared frozen `NEUTRAL_MODIFIERS`, so the common case costs one array read and
 * allocates nothing. The schema is only touched when something actually lapsed, because rewriting
 * an `ArraySchema` patches it whether or not its contents changed.
 */
export function effectTick(state: ArenaState, tick: number): Map<string, Modifiers> {
  const mods = new Map<string, Modifiers>();
  state.players.forEach((player, sessionId) => {
    if (player.effects.length === 0) return;
    const before = readEffects(player);
    const after = expireEffects(before, tick);
    if (after !== before) writeEffects(player, after);
    if (after.length === 0) return;
    mods.set(sessionId, modifiersOf(after, tick));
  });
  return mods;
}

/** This player's modifiers, or the shared neutral set when they carry nothing. */
export function modifiersFor(
  mods: ReadonlyMap<string, Modifiers>,
  sessionId: string,
): Readonly<Modifiers> {
  return mods.get(sessionId) ?? NEUTRAL_MODIFIERS;
}
