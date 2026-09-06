import { describe, expect, it } from "vitest";
import { lobbyRenderSignature } from "./lobby-signature.js";

type Player = { name: string; team: number; status: number; colorId: number };

function state(opts: {
  mode?: number;
  hostSessionId?: string;
  tick?: number;
  players: Record<string, Player>;
  chat?: { seq: number }[];
}) {
  const players = {
    forEach(cb: (player: Player, sessionId: string) => void) {
      for (const [sessionId, player] of Object.entries(opts.players)) cb(player, sessionId);
    },
  };
  return {
    mode: opts.mode ?? 0,
    hostSessionId: opts.hostSessionId ?? "host",
    tick: opts.tick ?? 0,
    players,
    chat: opts.chat ?? [],
  };
}

const ada = { name: "Ada", team: 0, status: 0, colorId: 1 };

describe("lobbyRenderSignature", () => {
  it("is unchanged when only tick advances", () => {
    const a = lobbyRenderSignature(state({ tick: 1, players: { s1: ada } }));
    const b = lobbyRenderSignature(state({ tick: 2, players: { s1: ada } }));
    expect(a).toBe(b);
  });

  it("changes when a player is added or removed", () => {
    const one = lobbyRenderSignature(state({ players: { s1: ada } }));
    const two = lobbyRenderSignature(
      state({ players: { s1: ada, s2: { name: "Bob", team: 1, status: 0, colorId: 2 } } }),
    );
    const none = lobbyRenderSignature(state({ players: {} }));
    expect(one).not.toBe(two);
    expect(one).not.toBe(none);
  });

  it("changes when name, team, status, colorId, mode, or hostSessionId change", () => {
    const base = lobbyRenderSignature(state({ players: { s1: ada } }));
    expect(
      lobbyRenderSignature(state({ players: { s1: { ...ada, name: "Cam" } } })),
    ).not.toBe(base);
    expect(
      lobbyRenderSignature(state({ players: { s1: { ...ada, team: 1 } } })),
    ).not.toBe(base);
    expect(
      lobbyRenderSignature(state({ players: { s1: { ...ada, status: 1 } } })),
    ).not.toBe(base);
    expect(
      lobbyRenderSignature(state({ players: { s1: { ...ada, colorId: 3 } } })),
    ).not.toBe(base);
    expect(lobbyRenderSignature(state({ mode: 1, players: { s1: ada } }))).not.toBe(base);
    expect(
      lobbyRenderSignature(state({ hostSessionId: "other", players: { s1: ada } })),
    ).not.toBe(base);
  });
});

describe("lobbyRenderSignature and chat (LC12)", () => {
  it("is stable when nothing changes", () => {
    const a = lobbyRenderSignature(state({ players: { s1: ada }, chat: [{ seq: 3 }] }));
    const b = lobbyRenderSignature(state({ players: { s1: ada }, chat: [{ seq: 3 }] }));
    expect(a).toBe(b);
  });

  it("changes when a message arrives", () => {
    const before = lobbyRenderSignature(state({ players: { s1: ada }, chat: [{ seq: 3 }] }));
    const after = lobbyRenderSignature(
      state({ players: { s1: ada }, chat: [{ seq: 3 }, { seq: 4 }] }),
    );
    expect(after).not.toBe(before);
  });

  it("changes on a message that arrives at the cap, where length does not move", () => {
    // The buffer is full: one in, one out, length unchanged. This is the case seq exists for.
    const before = lobbyRenderSignature(
      state({ players: { s1: ada }, chat: [{ seq: 20 }, { seq: 21 }] }),
    );
    const after = lobbyRenderSignature(
      state({ players: { s1: ada }, chat: [{ seq: 21 }, { seq: 22 }] }),
    );
    expect(after).not.toBe(before);
  });

  it("changes on two identical messages a minute apart", () => {
    // Text and time would compare equal here; seq is what tells them apart.
    const before = lobbyRenderSignature(state({ players: { s1: ada }, chat: [{ seq: 7 }] }));
    const after = lobbyRenderSignature(
      state({ players: { s1: ada }, chat: [{ seq: 7 }, { seq: 8 }] }),
    );
    expect(after).not.toBe(before);
  });

  it("defaults to an empty buffer, so the existing cases still pass", () => {
    expect(() => lobbyRenderSignature(state({ players: { s1: ada } }))).not.toThrow();
  });
});
