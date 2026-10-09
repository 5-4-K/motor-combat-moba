import { describe, expect, it } from "vitest";
import { RoomPhase, TICK_RATE_HZ } from "@motor-combat-moba/shared";
import {
  acceptHighlight,
  acceptPick,
  openArenaSelect,
  revealEndsTickFor,
  type ArenaSelectGate,
} from "./arena-select.js";

const TWO = ["arena-01", "arena-02"] as const;
const gate = (over: Partial<ArenaSelectGate> = {}): ArenaSelectGate => ({
  senderId: "host",
  hostSessionId: "host",
  senderOnRoster: true,
  phase: RoomPhase.ARENA_SELECT,
  arenaRevealEndsTick: 0,
  arenas: TWO,
  ...over,
});
const TIMING = { arenaRevealSeconds: 3, arenaRouletteSeconds: 1.5 };

describe("openArenaSelect (AR13)", () => {
  it("skips the screen when the mode turns it off, playing arenas[0]", () => {
    expect(openArenaSelect(false, TWO)).toEqual({ kind: "skip", arenaId: "arena-01" });
  });
  it("opens choosing on arenas[0] when there are two or more", () => {
    expect(openArenaSelect(true, TWO)).toEqual({ kind: "choose", highlightId: "arena-01" });
  });
  it("goes straight to the reveal with one arena", () => {
    expect(openArenaSelect(true, ["arena-03"])).toEqual({ kind: "reveal", arenaId: "arena-03" });
  });
});

describe("acceptHighlight (AR16)", () => {
  it("accepts the host naming an arena in the list", () => {
    expect(acceptHighlight(gate(), { arenaId: "arena-02" })).toBe("arena-02");
  });
  it.each([
    ["a non-host", gate({ senderId: "other" })],
    ["a host who is not on the roster", gate({ senderOnRoster: false })],
    ["the wrong phase", gate({ phase: RoomPhase.CAR_SELECT })],
    ["after the pick", gate({ arenaRevealEndsTick: 500 })],
  ])("refuses %s", (_label, g) => {
    expect(acceptHighlight(g, { arenaId: "arena-02" })).toBeNull();
  });
  it("refuses an arena outside the mode's list", () => {
    expect(acceptHighlight(gate(), { arenaId: "arena-03" })).toBeNull();
  });
  it("refuses a malformed payload", () => {
    expect(acceptHighlight(gate(), { arenaId: 7 })).toBeNull();
    expect(acceptHighlight(gate(), null)).toBeNull();
  });
});

describe("acceptPick (AR16, AR18)", () => {
  const never = () => {
    throw new Error("rand must not be called for a named pick");
  };
  it("accepts a named arena, not random", () => {
    expect(acceptPick(gate(), { arenaId: "arena-02" }, never)).toEqual({ arenaId: "arena-02", random: false });
  });
  it("draws a random pick on the server, inside the list", () => {
    expect(acceptPick(gate(), { random: true }, () => 0)).toEqual({ arenaId: "arena-01", random: true });
    expect(acceptPick(gate(), { random: true }, () => 0.999999)).toEqual({ arenaId: "arena-02", random: true });
  });
  it.each([[NaN], [-0.5], [-0]])("lands on the first arena when rand returns %s", (r) => {
    expect(acceptPick(gate(), { random: true }, () => r)?.arenaId).toBe("arena-01");
  });
  it("never lands outside the list, whatever rand returns in [0, 1)", () => {
    for (let i = 0; i < 100; i++) {
      const r = i / 100;
      expect(TWO).toContain(acceptPick(gate(), { random: true }, () => r)?.arenaId);
    }
  });
  it.each([
    ["a non-host", gate({ senderId: "other" })],
    ["a host who is not on the roster", gate({ senderOnRoster: false })],
    ["the wrong phase", gate({ phase: RoomPhase.LOBBY })],
    ["after the pick", gate({ arenaRevealEndsTick: 1 })],
  ])("refuses %s", (_label, g) => {
    expect(acceptPick(g, { random: true }, () => 0)).toBeNull();
    expect(acceptPick(g, { arenaId: "arena-01" }, () => 0)).toBeNull();
  });
  it("refuses an arena outside the list and a malformed payload", () => {
    expect(acceptPick(gate(), { arenaId: "arena-03" }, () => 0)).toBeNull();
    expect(acceptPick(gate(), { random: false }, () => 0)).toBeNull();
  });
});

describe("reveal timing (AR17)", () => {
  it("holds the reveal for arenaRevealSeconds after a named pick", () => {
    expect(revealEndsTickFor(1000, TIMING, false)).toBe(1000 + 3 * TICK_RATE_HZ);
  });
  it("adds the roulette's time after a random pick", () => {
    expect(revealEndsTickFor(1000, TIMING, true)).toBe(1000 + Math.ceil(4.5 * TICK_RATE_HZ));
  });
  it("rounds up to a whole tick", () => {
    expect(Number.isInteger(revealEndsTickFor(0, { arenaRevealSeconds: 0.01, arenaRouletteSeconds: 0 }, false))).toBe(true);
  });
});
