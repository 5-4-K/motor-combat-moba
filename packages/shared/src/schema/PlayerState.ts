import { ArraySchema, Schema, type } from "@colyseus/schema";
import { PlayerStatus } from "../constants.js";
import { WeaponSlotState } from "./WeaponSlotState.js";

export class PlayerState extends Schema {
  @type("string") sessionId = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") angle = 0;
  @type("uint8") status: PlayerStatus = PlayerStatus.READY;
  @type("uint32") lastProcessedInputSeq = 0;
  @type("string") name = "";
  @type("uint8") colorId = 0;
  @type("uint8") team = 0;
  @type("uint32") joinedAtTick = 0;
  @type("string") carId = "";
  @type("number") speed = 0;
  @type("uint16") reverseHold = 0;
  @type("uint16") hp = 0;
  @type("boolean") alive = true;
  @type("boolean") selectLocked = false;
  @type([WeaponSlotState]) weapons = new ArraySchema<WeaponSlotState>();
  @type("uint32") switchLockUntilTick = 0;
  @type("uint8") level = 1;
  /**
   * Tick the car's committed press next puts a shot out — a wind-up or the next volley of a burst.
   * `0` means nothing is pending, and so does any tick already passed: the HUD reads "this car is
   * mid-press" as `tick < pendingUntilTick`, which stays right between two patches at 20 Hz.
   */
  @type("uint32") pendingUntilTick = 0;
  /**
   * Slot index the car most recently committed to firing, or `-1` before its first shot — hence
   * `int8` rather than a uint8 sentinel: -1 is the natural "never" for an index, and slot counts are
   * capped at `WEAPON_SLOT_CONFIG.maxWeaponSlots` (3), nowhere near the type's range.
   */
  @type("int8") lastFiredSlot = -1;
}
