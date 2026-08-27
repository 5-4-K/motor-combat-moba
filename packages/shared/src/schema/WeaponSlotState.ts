import { Schema, type } from "@colyseus/schema";

/** One slot's live state. Array position is the slot index. */
export class WeaponSlotState extends Schema {
  @type("string") weaponId = "";
  @type("uint8") stocks = 0;
  /** Tick the running recharge completes; 0 = not recharging. The HUD derives its sweep from this. */
  @type("uint32") rechargeEndsTick = 0;
  @type("uint32") refireLockUntilTick = 0;
}
