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
