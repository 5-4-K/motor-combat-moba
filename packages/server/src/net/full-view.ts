import { StateView } from "@colyseus/schema";
import {
  VIEW_OWNER,
  isSpectating,
  spectatableIds,
  type ArenaState,
  type PlayerState,
  type SpectateCandidate,
  type SpectateTarget,
} from "@motor-combat-moba/shared";

/**
 * Each client's `StateView` under Phase G's G2 (NR42–NR44, `fov` off everywhere): every car and
 * every weapon instance is in every view, and the car a client drives is in it with `VIEW_OWNER`
 * too. G3's `ViewManager` replaces the "every" with a vision test; the owner and the nested-row
 * rules below stay.
 *
 * A `StateView` is imperative: an object reaches a view only by `view.add`, and that is true of
 * every NESTED schema row created after its parent was added, not only of top-level objects. So a
 * status row pushed onto a visible car's `statuses` is withheld from a view until it is added there
 * itself, and a weapon slot pushed onto the owner's `weapons` carries its `VIEW_OWNER` timers to no
 * one until it is added with the tag. `syncViews` walks those rows every call; each step is guarded
 * by `has`/`hasTag`, because a default-tag `add` of an already-visible object re-sends its whole
 * snapshot. Rows are reused by push/pop (`writeStatuses`, combat-bridge's `writeSlots`); a whole
 * `statuses` or `weapons` array REPLACED under a car already in a view is not recovered by this
 * walk (measured against schema 5.0.34), so never replace one.
 *
 * Call it in `onJoin` (after the joiner's car exists, before Colyseus sends the joiner its full
 * state) and immediately before every `broadcastPatch`: nothing reaches a client between the two,
 * so an object created anywhere in between — a car, a status, an instance, an ended row (NR37) — is
 * in every view by the time it is encoded.
 */
export interface ViewClient {
  sessionId: string;
  view?: StateView;
}

/**
 * Gives a client its (empty) view if it has none. Every room calls this in `onJoin`: a client with
 * no view receives none of the tagged fields.
 */
export function ensureView(client: ViewClient): StateView {
  if (!client.view) client.view = new StateView();
  return client.view;
}

/**
 * Brings every client's view up to G2's full visibility. `ownedSessionOf` names the car a client
 * drives (its own session in an arena or practice room; the driven seat in the playground), or
 * `undefined` for none. `spectate` is the room's mode's `camera().spectate.target`, read by the
 * caller inside its mode scope.
 *
 * `VIEW_OWNER` goes on the driven car and, while that car is a spectating wreck, on every car the
 * wreck may watch (`spectatableIds`, the same rule the client's spectate cycle runs): its slot HUD
 * (`hudTargetPlayer`) reads the watched car's timers. The whole cycle rather than one target,
 * because the pick is client-local (`[`/`]` sends nothing), so the server cannot know which car is
 * on screen. A car outside that set loses the tag — the watched car died, or the wreck respawned.
 * Re-tagging is `remove(obj, VIEW_OWNER)`, which clears only the owner-tagged fields and leaves
 * the car's public and `@view()` fields in place (pinned in the tests), so nothing flickers.
 */
export function syncViews(
  clients: Iterable<ViewClient>,
  state: ArenaState,
  ownedSessionOf: (client: ViewClient) => string | undefined,
  spectate: SpectateTarget,
): void {
  for (const client of clients) {
    const view = ensureView(client);
    // The map itself is a `@view()` field: without this a client that has no instance in view yet
    // decodes `state.weapons` as undefined rather than an empty map.
    if (!view.has(state.weapons)) view.add(state.weapons);
    const owners = ownerSetOf(state, ownedSessionOf(client), spectate);
    state.players.forEach((player, sessionId) => syncCar(view, player, owners.has(sessionId)));
    state.weapons.forEach((instance) => {
      if (!view.has(instance)) view.add(instance);
    });
  }
}

/** The cars whose owner-only fields a client reads: its own, plus its spectate cycle if wrecked. */
function ownerSetOf(
  state: ArenaState,
  owned: string | undefined,
  spectate: SpectateTarget,
): Set<string> {
  const owners = new Set<string>();
  if (owned === undefined) return owners;
  owners.add(owned);
  const car = state.players.get(owned);
  if (!car || !isSpectating(state.phase, car.status, car.alive, spectate)) return owners;
  const candidates: SpectateCandidate[] = [];
  state.players.forEach((p, sessionId) =>
    candidates.push({ sessionId, status: p.status, alive: p.alive, team: p.team }),
  );
  for (const id of spectatableIds(candidates, spectate, { sessionId: owned, team: car.team })) {
    owners.add(id);
  }
  return owners;
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
