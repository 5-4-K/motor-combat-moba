import { Schema, type, view } from "@colyseus/schema";
import { VIEW_OWNER } from "./view-tags.js";

/**
 * One slot's live state. Array position is the slot index. `weaponId` is public — the loadout shows
 * in car select — and the three timers are owner-only (NR42): they reach a client only through a
 * view that added the slot's car with `VIEW_OWNER`.
 */
export class WeaponSlotState extends Schema {
  @type("string") weaponId = "";
  @view(VIEW_OWNER) @type("uint8") stocks = 0;
  /** Tick the running recharge completes; 0 = not recharging. The HUD derives its sweep from this. */
  @view(VIEW_OWNER) @type("uint32") rechargeEndsTick = 0;
  @view(VIEW_OWNER) @type("uint32") refireLockUntilTick = 0;
}
