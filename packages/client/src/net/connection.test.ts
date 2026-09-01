import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYGROUND_ROOM_NAME, ROOM_NAME } from "@motor-combat-moba/shared";

const joinOrCreate = vi.fn();
const Client = vi.fn().mockImplementation(() => ({ joinOrCreate }));
const detectServerEndpoint = vi.fn(() => "ws://localhost:2567");

vi.mock("colyseus.js", () => ({
  Client,
}));

vi.mock("../config/client-mode.js", () => ({
  detectServerEndpoint,
}));

describe("joinArena", () => {
  beforeEach(() => {
    joinOrCreate.mockReset();
    Client.mockClear();
    detectServerEndpoint.mockClear();
  });

  it("joins or creates the arena room with the given name", async () => {
    const room = { sessionId: "s1" };
    joinOrCreate.mockResolvedValue(room);

    const { joinArena } = await import("./connection.js");
    const result = await joinArena("Ada");

    expect(detectServerEndpoint).toHaveBeenCalled();
    expect(Client).toHaveBeenCalledWith("ws://localhost:2567");
    expect(joinOrCreate).toHaveBeenCalledWith(ROOM_NAME, { name: "Ada" });
    expect(result).toBe(room);
  });
});

describe("joinPlayground", () => {
  beforeEach(() => {
    joinOrCreate.mockReset();
    Client.mockClear();
    detectServerEndpoint.mockClear();
  });

  it("joins or creates the playground room as \"Dev\" (PG2)", async () => {
    const room = { sessionId: "s1" };
    joinOrCreate.mockResolvedValue(room);

    const { joinPlayground } = await import("./connection.js");
    const result = await joinPlayground();

    expect(detectServerEndpoint).toHaveBeenCalled();
    expect(Client).toHaveBeenCalledWith("ws://localhost:2567");
    expect(joinOrCreate).toHaveBeenCalledWith(PLAYGROUND_ROOM_NAME, { name: "Dev" });
    expect(result).toBe(room);
  });
});
