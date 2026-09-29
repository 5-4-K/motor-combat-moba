import { describe, expect, it } from "vitest";
import { Decoder, Encoder } from "@colyseus/schema";
import { ArenaState, GameMode } from "@motor-combat-moba/shared";
import { cfg, hasMode, modeConfigOf } from "@motor-combat-moba/shared";
import { watchRoomMode } from "./mode-scope.js";

// No mocks: real @colyseus/schema 5 Encoder/Decoder and the real SDK Callbacks.get, fed the
// `{ state, serializer: { decoder } }` shape SchemaSerializer gives a joined room.
describe("watchRoomMode over the real schema decoder", () => {
  it("fires immediately with the current mode, then again on a patch that changes it", () => {
    const server = new ArenaState();
    server.mode = GameMode.FFA_DEATHMATCH;
    const encoder = new Encoder(server);
    const client = new ArenaState();
    const decoder = new Decoder(client);
    decoder.decode(encoder.encodeAll());
    expect(client.mode).toBe(GameMode.FFA_DEATHMATCH);

    // Immediate fire: the bundle for the mode already decoded is installed.
    watchRoomMode({ state: client, serializer: { decoder } });
    expect(hasMode()).toBe(true);
    expect(cfg()).toBe(modeConfigOf(GameMode.FFA_DEATHMATCH));

    // A later patch changes the mode: the listener reinstalls for the new one.
    server.mode = GameMode.FFA_LAST_STANDING;
    decoder.decode(encoder.encode());
    expect(client.mode).toBe(GameMode.FFA_LAST_STANDING);
    expect(cfg()).toBe(modeConfigOf(GameMode.FFA_LAST_STANDING));
  });
});
