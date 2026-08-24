import { Schema, MapSchema, type } from "@colyseus/schema";
import { RoomPhase, GameMode } from "../constants.js";
import { PlayerState } from "./PlayerState.js";

export class ArenaState extends Schema {
  @type("uint8") phase: RoomPhase = RoomPhase.LOBBY;
  @type("uint32") tick = 0;
  @type("string") hostSessionId = "";
  @type("uint8") mode: GameMode = GameMode.FFA;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
