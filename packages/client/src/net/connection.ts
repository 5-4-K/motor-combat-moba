import { Client, type Room } from "colyseus.js";
import {
  ArenaState,
  PLAYGROUND_ROOM_NAME,
  PlaygroundState,
  ROOM_NAME,
  PRACTICE_ROOM_NAME,
  PracticeState,
  type PracticeSetup,
} from "@motor-combat-moba/shared";
import { detectServerEndpoint } from "../config/client-mode.js";

export async function joinArena(name: string): Promise<Room<ArenaState>> {
  const client = new Client(detectServerEndpoint());
  return client.joinOrCreate<ArenaState>(ROOM_NAME, { name });
}

/**
 * Joins the dev-only playground room (spec PG2). Same client construction as `joinArena`; the name
 * is fixed rather than prompted because the sandbox has no name-entry screen. Rejects with the
 * server's error (e.g. "room not found" when `DEV_TOOLS=1` is unset, or `ARENA_BUSY_ERROR` when a
 * live arena is open) — `PlaygroundScene` is what turns that into readable text.
 */
export async function joinPlayground(): Promise<Room<PlaygroundState>> {
  const client = new Client(detectServerEndpoint());
  return client.joinOrCreate<PlaygroundState>(PLAYGROUND_ROOM_NAME, { name: "Dev" });
}

/**
 * Joins a practice room (spec PR7). Unlike `joinPlayground` this is a shipped path: the room is
 * registered on every server, and the setup rides as join options because practice settings are
 * fixed for the session and there is no mid-session message to change them.
 *
 * Rejects with the server's error — `PRACTICE_FULL_ERROR` when the host is at capacity — which
 * `PracticeSetupScene` turns into readable text without leaving the settings page.
 */
export async function joinPractice(setup: PracticeSetup): Promise<Room<PracticeState>> {
  const client = new Client(detectServerEndpoint());
  return client.joinOrCreate<PracticeState>(PRACTICE_ROOM_NAME, setup);
}
