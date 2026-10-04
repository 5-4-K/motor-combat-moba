import type { FxEvent } from "./events.js";

/**
 * What the local view may not show this frame (spec 2026-09-28 camera, CB27). Events are derived
 * from the FULL world and only filtered here, so a shot entering vision mid-flight is not mistaken
 * for a new one — no muzzle flash in mid-air.
 */
export interface FxHidden {
  readonly cars: ReadonlySet<string>;
  readonly instances: ReadonlySet<string>;
}

export const NOTHING_HIDDEN: FxHidden = { cars: new Set(), instances: new Set() };

/**
 * Adds back an id that was hidden last frame but is gone from the world this frame (CB27, review
 * item I1). Written when a shot's end WAS its row vanishing: `shotEnded` for a hidden enemy's shot
 * then fired on the frame the id left `state.weapons`, where `fxHidden` (which only knows instances
 * still present) could not see it. Since protocol 8 a vanishing row fires nothing — every ending is an
 * ENDED row, present on the frame its `shotEnded` fires and filtered by `fxHidden` like any other —
 * so this is no longer load-bearing for impacts; it is kept as a harmless belt for any event a future
 * change derives from a removal.
 *
 * `currentIds` is every instance id the world still carries this frame (from `state.weapons`),
 * regardless of visibility — that is what tells a "no longer exists" id apart from one that simply
 * became visible.
 */
export function carryHiddenInstances(
  prevHidden: ReadonlySet<string>,
  currentIds: ReadonlySet<string>,
  currentHidden: ReadonlySet<string>,
): Set<string> {
  const result = new Set(currentHidden);
  for (const id of prevHidden) {
    if (!currentIds.has(id)) result.add(id);
  }
  return result;
}

export function isHiddenFxEvent(event: FxEvent, hidden: FxHidden): boolean {
  switch (event.kind) {
    case "shotFired":
    case "shotEnded":
      return hidden.instances.has(event.instanceId);
    case "damaged":
    case "died":
      return hidden.cars.has(event.sessionId);
  }
}
