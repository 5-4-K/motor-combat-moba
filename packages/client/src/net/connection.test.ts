import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MSG_PING, MSG_TIME, PLAYGROUND_ROOM_NAME, PROTOCOL_VERSION, ROOM_NAME } from "@motor-combat-moba/shared";

const joinOrCreate = vi.fn();
const Client = vi.fn().mockImplementation(() => ({ joinOrCreate }));
const detectServerEndpoint = vi.fn(() => "ws://localhost:2567");

vi.mock("@colyseus/sdk", () => ({
  Client,
}));

vi.mock("../config/client-mode.js", () => ({
  detectServerEndpoint,
}));

/**
 * A room double that dispatches like the SDK's: every listener for a type runs, a type with no
 * listener at all is reported as `unhandled` (where the real SDK prints its console warning), and
 * `removeAllListeners` drops every handler the way a leave does.
 */
function fakeRoom() {
  let handlers = new Map<string, Array<(m: unknown) => void>>();
  const sent: Array<[string, unknown]> = [];
  const unhandled: string[] = [];
  return {
    sessionId: "s1",
    reconnection: { enabled: true },
    sent,
    unhandled,
    onMessage(type: string, cb: (m: unknown) => void) {
      const list = handlers.get(type) ?? [];
      list.push(cb);
      handlers.set(type, list);
      return () => handlers.set(type, (handlers.get(type) ?? []).filter((f) => f !== cb));
    },
    send(type: string, m: unknown) {
      sent.push([type, m]);
    },
    deliver(type: string, m: unknown) {
      const list = handlers.get(type);
      if (list === undefined) unhandled.push(type);
      else for (const f of list) f(m);
    },
    removeAllListeners() {
      handlers = new Map();
    },
  };
}

describe("joinArena", () => {
  beforeEach(() => {
    joinOrCreate.mockReset();
    Client.mockClear();
    detectServerEndpoint.mockClear();
  });

  it("joins or creates the arena room with the given name", async () => {
    const room = fakeRoom();
    joinOrCreate.mockResolvedValue(room);

    const { joinArena } = await import("./connection.js");
    const result = await joinArena("Ada");

    expect(detectServerEndpoint).toHaveBeenCalled();
    expect(Client).toHaveBeenCalledWith("ws://localhost:2567");
    expect(joinOrCreate).toHaveBeenCalledWith(ROOM_NAME, { name: "Ada", protocol: PROTOCOL_VERSION });
    expect(result).toBe(room);
    expect(room.reconnection.enabled).toBe(false);
  });
});

describe("joinPlayground", () => {
  beforeEach(() => {
    joinOrCreate.mockReset();
    Client.mockClear();
    detectServerEndpoint.mockClear();
  });

  it("joins or creates the playground room as \"Dev\" (PG2)", async () => {
    const room = fakeRoom();
    joinOrCreate.mockResolvedValue(room);

    const { joinPlayground } = await import("./connection.js");
    const result = await joinPlayground();

    expect(detectServerEndpoint).toHaveBeenCalled();
    expect(Client).toHaveBeenCalledWith("ws://localhost:2567");
    expect(joinOrCreate).toHaveBeenCalledWith(PLAYGROUND_ROOM_NAME, { name: "Dev", protocol: PROTOCOL_VERSION });
    expect(result).toBe(room);
    expect(room.reconnection.enabled).toBe(false);
  });
});

describe("joinPractice", () => {
  it("returns a room with SDK auto-reconnect disabled", async () => {
    joinOrCreate.mockReset();
    const room = fakeRoom();
    joinOrCreate.mockResolvedValue(room);
    const { joinPractice } = await import("./connection.js");
    const result = await joinPractice({ name: "Ada" } as never);
    expect(joinOrCreate).toHaveBeenCalledWith(expect.any(String), { name: "Ada", protocol: PROTOCOL_VERSION });
    expect(result).toBe(room);
    expect(room.reconnection.enabled).toBe(false);
  });
});

describe("bindTimeEcho (phase D review I1)", () => {
  beforeEach(() => joinOrCreate.mockReset());

  it("a joined room answers the server's ping with no scene bound, once per ping", async () => {
    const room = fakeRoom();
    joinOrCreate.mockResolvedValue(room);
    const { joinArena } = await import("./connection.js");
    await joinArena("Ada");
    room.deliver(MSG_PING, { s: 123.5 });
    expect(room.sent).toEqual([[MSG_PING, { s: 123.5 }]]);
    expect(room.unhandled).toEqual([]);
  });

  it("swallows a stray MSG_TIME pong (no scene listening) without an unhandled-type warning", async () => {
    const room = fakeRoom();
    joinOrCreate.mockResolvedValue(room);
    const { joinPractice } = await import("./connection.js");
    await joinPractice({ name: "Ada" } as never);
    room.deliver(MSG_TIME, { c: 1, t: 2, p: 3 });
    expect(room.unhandled).toEqual([]);
    expect(room.sent).toEqual([]);
  });

  it("binds every join path", async () => {
    const { joinArena, joinPlayground, joinPractice } = await import("./connection.js");
    for (const join of [() => joinArena("Ada"), () => joinPlayground(), () => joinPractice({ name: "Ada" } as never)]) {
      const room = fakeRoom();
      joinOrCreate.mockResolvedValue(room);
      await join();
      room.deliver(MSG_PING, { s: 1 });
      expect(room.sent).toEqual([[MSG_PING, { s: 1 }]]);
    }
  });

  it("binding the same room twice still echoes each ping exactly once", async () => {
    const { bindTimeEcho } = await import("./connection.js");
    const room = fakeRoom();
    bindTimeEcho(room as never);
    bindTimeEcho(room as never);
    room.deliver(MSG_PING, { s: 7 });
    expect(room.sent).toEqual([[MSG_PING, { s: 7 }]]);
  });

  it("a rejoin is a fresh room with its own single echo; the left room answers nothing", async () => {
    const { joinArena } = await import("./connection.js");
    const first = fakeRoom();
    joinOrCreate.mockResolvedValue(first);
    await joinArena("Ada");
    first.removeAllListeners(); // what the SDK does on leave
    const second = fakeRoom();
    joinOrCreate.mockResolvedValue(second);
    await joinArena("Ada");
    second.deliver(MSG_PING, { s: 9 });
    expect(second.sent).toEqual([[MSG_PING, { s: 9 }]]);
    expect(first.sent).toEqual([]);
  });

  it("nothing but connection.ts binds a MSG_PING echo (a second one would double every echo)", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const files = (readdirSync(root, { recursive: true }) as string[]).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith("connection.ts"),
    );
    expect(files.length).toBeGreaterThan(10);
    for (const rel of files) {
      const src = readFileSync(join(root, rel), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(src, rel).not.toMatch(/onMessage\(\s*MSG_PING/);
    }
  });
});
