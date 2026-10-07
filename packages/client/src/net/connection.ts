import { Client, type Room } from "@colyseus/sdk";
import {
  ArenaState,
  MSG_PING,
  MSG_TIME,
  PLAYGROUND_ROOM_NAME,
  PROTOCOL_VERSION,
  PlaygroundState,
  ROOM_NAME,
  PRACTICE_ROOM_NAME,
  PracticeState,
  type PracticeSetup,
} from "@motor-combat-moba/shared";
import { detectServerEndpoint } from "../config/client-mode.js";

/**
 * @colyseus/sdk 0.18 retries a dropped socket by default, but the server never calls
 * `allowReconnection`, so a retry could only hang and `onLeave` would never fire. Reconnection is
 * a future designed feature; until then a lost connection must leave the room immediately.
 */
/**
 * Every join carries the wire protocol version (NR55). A server built from a different wire refuses
 * the join with a readable "Refresh the page" error, which each scene's existing join-error path
 * shows like any other refusal.
 */
export function joinOptions<T extends object>(options: T): T & { protocol: number } {
  return { ...options, protocol: PROTOCOL_VERSION };
}

/** Rooms whose time echo is already bound, so a second call is a no-op rather than a second echo. */
const echoBound = new WeakSet<object>();

/**
 * Binds the room-lifetime half of time sync (NR19) once per join: the server's `MSG_PING` is echoed
 * straight back, and a stray `MSG_TIME` pong is swallowed. The server pings every client in every phase,
 * so this lives on the ROOM rather than on `ArenaScene`: the lobby, car select, reveal, results and the
 * practice/playground setup screens all answer, the server has an RTT before the arena starts, and the
 * SDK never warns about an unhandled `"ping"` (or about a pong still in flight when `ArenaScene` shuts
 * down). `ArenaScene` adds its own `MSG_TIME` listener beside the sink for its `InputClock`; the SDK
 * fans a message out to every listener. The bindings die with the room — the SDK drops every handler on
 * leave — and a rejoin is a new `Room`, bound afresh.
 */
export function bindTimeEcho(room: Room): void {
  if (echoBound.has(room)) return;
  echoBound.add(room);
  room.onMessage(MSG_PING, (m: unknown) => room.send(MSG_PING, m));
  room.onMessage(MSG_TIME, () => {});
}

/**
 * `joinOrCreate` resolves BEFORE the SDK applies the room's first state message, so for a brief
 * window `room.state.players` is undefined. Every scene reads it on create — the view router's
 * `sync`, `LobbyScene.render`, `ArenaScene` — so starting a scene inside that window throws
 * `Cannot read properties of undefined (reading 'get')`. That throw escapes Phaser's `Game.step`,
 * which then never reschedules its RAF, so the whole tab freezes: a black screen when it dies during
 * a scene's create, a frozen game otherwise. Reproduced 2026-10-08; the per-client view filtering
 * added by the netcode redesign (the first populated view now rides the next snapshot patch rather
 * than the join handshake) widened the window from rare to common.
 *
 * So the join does not resolve until that first decode has populated `state.players`. No timeout:
 * the server always sends state, and a connection that drops first rejects through `onLeave`/
 * `onError` — exactly the rejection each join screen already renders as a join error.
 */
function awaitInitialState(room: Room): Promise<void> {
  const ready = (): boolean => (room.state as { players?: unknown } | undefined)?.players !== undefined;
  if (ready()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      room.onStateChange.remove(onState);
      room.onError.remove(onError);
      room.onLeave.remove(onLeave);
    };
    const onState = (): void => {
      if (!ready()) return;
      cleanup();
      resolve();
    };
    const onError = (_code: number, message?: string): void => {
      cleanup();
      reject(new Error(message || "Connection error while joining"));
    };
    const onLeave = (): void => {
      cleanup();
      reject(new Error("Disconnected before the room state arrived"));
    };
    room.onStateChange(onState);
    room.onError(onError);
    room.onLeave(onLeave);
  });
}

async function noReconnect<T extends Room>(joining: Promise<T>): Promise<T> {
  const room = await joining;
  room.reconnection.enabled = false;
  bindTimeEcho(room);
  await awaitInitialState(room);
  return room;
}

export async function joinArena(name: string): Promise<Room<ArenaState>> {
  const client = new Client(detectServerEndpoint());
  return noReconnect(client.joinOrCreate<ArenaState>(ROOM_NAME, joinOptions({ name })));
}

/**
 * Joins the dev-only playground room (spec PG2). Same client construction as `joinArena`; the name
 * is fixed rather than prompted because the sandbox has no name-entry screen. Rejects with the
 * server's error (e.g. "room not found" when `DEV_TOOLS=1` is unset, or `ARENA_BUSY_ERROR` when a
 * live arena is open) — `PlaygroundScene` is what turns that into readable text.
 */
export async function joinPlayground(): Promise<Room<PlaygroundState>> {
  const client = new Client(detectServerEndpoint());
  return noReconnect(client.joinOrCreate<PlaygroundState>(PLAYGROUND_ROOM_NAME, joinOptions({ name: "Dev" })));
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
  return noReconnect(client.joinOrCreate<PracticeState>(PRACTICE_ROOM_NAME, joinOptions(setup)));
}
