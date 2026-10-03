import { StateView } from "@colyseus/schema";
import { VIEW_OWNER, type ArenaState, type PlayerState } from "@motor-combat-moba/shared";

/**
 * Each client's `StateView` under Phase G's G2 (NR42–NR44, `fov` off everywhere): every car and every
 * weapon instance is in every view, and the car a client drives is in it with `VIEW_OWNER` too. G3's
 * `ViewManager` replaces the "every" with a vision test; the owner and the nested-row rules below stay.
 *
 * A `StateView` is imperative: an object reaches a view only by `view.add`, and that is true of
 * every NESTED schema row created after its parent was added, not only of top-level objects. So a
 * status row pushed onto a visible car's `statuses` is withheld from a view until it is added there
 * itself, and a weapon slot pushed onto the owner's `weapons` carries its `VIEW_OWNER` timers to no
 * one until it is added with the tag. `syncViews` walks those rows every call; each step is guarded by
 * `has`/`hasTag`, because a default-tag `add` of an already-visible object re-sends its whole snapshot.
 * Rows are reused by push/pop (`writeStatuses`, combat-bridge's `writeSlots`); a whole `statuses`
 * or `weapons` array REPLACED under a car already in a view is not recovered by this walk (measured
 * against schema 5.0.34), so never replace one.
 *
 * Call it in `onJoin` (after the joiner's car exists, before Colyseus sends the joiner its full state)
 * and immediately before every `broadcastPatch`: nothing reaches a client between the two, so an
 * object created anywhere in between — a car, a status, an instance, an ended row (NR37) — is in every
 * view by the time it is encoded.
 */
export interface ViewClient {
  sessionId: string;
  view?: StateView;
}

/**
 * Gives a client its (empty) view if it has none. Every room calls this in `onJoin`: a client with no
 * view receives none of the tagged fields.
 */
export function ensureView(client: ViewClient): StateView {
  if (!client.view) client.view = new StateView();
  return client.view;
}

/**
 * Brings every client's view up to G2's full visibility. `ownedSessionOf` names the car a client
 * drives (its own session in an arena or practice room; the driven seat in the playground), or
 * `undefined` for none; that car alone carries `VIEW_OWNER` in its view, and a car the client no
 * longer drives loses the tag.
 */
export function syncViews(
  clients: Iterable<ViewClient>,
  state: ArenaState,
  ownedSessionOf: (client: ViewClient) => string | undefined,
): void {
  for (const client of clients) {
    const view = ensureView(client);
    // The map itself is a `@view()` field: without this a client that has no instance in view yet
    // decodes `state.weapons` as undefined rather than an empty map.
    if (!view.has(state.weapons)) view.add(state.weapons);
    const owned = ownedSessionOf(client);
    state.players.forEach((player, sessionId) => syncCar(view, player, sessionId === owned));
    state.weapons.forEach((instance) => {
      if (!view.has(instance)) view.add(instance);
    });
  }
}

function syncCar(view: StateView, player: PlayerState, owner: boolean): void {
  if (!view.has(player)) view.add(player);
  for (const row of player.statuses) {
    if (!view.has(row)) view.add(row);
  }
  if (owner) {
    if (!view.hasTag(player, VIEW_OWNER)) view.add(player, VIEW_OWNER);
    for (const slot of player.weapons) {
      if (!view.hasTag(slot, VIEW_OWNER)) view.add(slot, VIEW_OWNER);
    }
  } else {
    if (view.hasTag(player, VIEW_OWNER)) view.remove(player, VIEW_OWNER);
    for (const slot of player.weapons) {
      if (view.hasTag(slot, VIEW_OWNER)) view.remove(slot, VIEW_OWNER);
    }
  }
}
