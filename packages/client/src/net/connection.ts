import { Client, type Room } from "colyseus.js";
import { ArenaState, ROOM_NAME } from "@motor-arena/shared";
import { detectServerEndpoint } from "../config/client-mode.js";

export async function joinArena(): Promise<Room<ArenaState>> {
  const client = new Client(detectServerEndpoint());
  return client.joinOrCreate<ArenaState>(ROOM_NAME);
}
