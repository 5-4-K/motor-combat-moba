import { Schema, type } from "@colyseus/schema";
import { PlayerStatus } from "../constants.js";

export class PlayerState extends Schema {
  @type("string") sessionId = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") angle = 0;
  @type("uint8") status: PlayerStatus = PlayerStatus.READY;
  @type("uint32") lastProcessedInputSeq = 0;
}
