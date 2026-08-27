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
}
