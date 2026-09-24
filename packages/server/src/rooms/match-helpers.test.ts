import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAR_ID,
  GameMode,
  MODE_TABLE,
  RoomPhase,
  modeConfigOf,
} from "@motor-combat-moba/shared";
import {
  carAtDeadline,
  copySpawnNumbers,
  livingAfterLeave,
  resolveSetMode,
} from "./match-helpers.js";

describe("copySpawnNumbers", () => {
  it("copies x,y,angle by value, not by mutating the source", () => {
    const source = { x: 10, y: 20, angle: 0.5 };
    const copied = copySpawnNumbers(source);
    copied.x = 99;
    expect(source.x).toBe(10);
    expect(copied).toEqual({ x: 99, y: 20, angle: 0.5 });
  });
});

describe("livingAfterLeave", () => {
  it("marks remaining roster members; the leaver is absent", () => {
    const remaining = [
      { sessionId: "b", team: 1 as const, alive: true },
      { sessionId: "spec", team: 0 as const, alive: true },
    ];
    const snapshot = livingAfterLeave(remaining, new Set(["a", "b"]));
    expect(snapshot).toEqual([
      { sessionId: "b", team: 1, alive: true, inRoster: true },
      { sessionId: "spec", team: 0, alive: true, inRoster: false },
    ]);
  });
});

describe("carAtDeadline", () => {
  it("hands back the previewed car, so choosing without locking in still counts", () => {
    expect(carAtDeadline("bastion")).toBe("bastion");
    expect(carAtDeadline("bullseye")).toBe("bullseye");
  });

  it("falls back to the chassis car select opens on, never to chance", () => {
    expect(carAtDeadline(undefined)).toBe(DEFAULT_CAR_ID);
  });

  it("is deterministic — the same input always yields the same car", () => {
    const runs = Array.from({ length: 20 }, () => carAtDeadline(undefined));
    expect(new Set(runs).size).toBe(1);
  });
});

describe("resolveSetMode", () => {
  const OTHER = GameMode.FFA_DEATHMATCH;

  it("resolves the bundle and the arena alongside the mode, never the mode alone", () => {
    const next = resolveSetMode(RoomPhase.LOBBY, false, OTHER);
    expect(next).toBeDefined();
    expect(next?.mode).toBe(OTHER);
    expect(next?.config).toBe(modeConfigOf(OTHER));
    expect(next?.arenaId).toBe(modeConfigOf(OTHER).arenas[0]);
  });

  // The bug this function exists to make impossible: `state.mode` used to be written outside the
  // LOBBY guard while the bundle and the arena were written inside it, so any phase that is neither
  // LOBBY nor "someone is IN_MATCH" left the room advertising one mode and running another's
  // tables. Every non-LOBBY phase must refuse, not partially apply.
  it.each([
    ["CAR_SELECT", RoomPhase.CAR_SELECT],
    ["REVEAL", RoomPhase.REVEAL],
    ["COUNTDOWN", RoomPhase.COUNTDOWN],
    ["MATCH", RoomPhase.MATCH],
  ])("refuses outside LOBBY even with nobody IN_MATCH (%s)", (_name, phase) => {
    expect(resolveSetMode(phase, false, OTHER)).toBeUndefined();
  });

  it("refuses in LOBBY while a player is still IN_MATCH", () => {
    expect(resolveSetMode(RoomPhase.LOBBY, true, OTHER)).toBeUndefined();
  });

  // `MODE_TABLE`'s header has always claimed `set_mode` refuses an inactive mode; until
  // 2026-09-23 nothing here checked, so a hand-built or stale client could seat an unpublished
  // mode by sending its wire id. `GameMode.TEAM` is the shipped inactive row.
  it("refuses a mode no lobby publishes, however well-formed the message", () => {
    expect(MODE_TABLE[GameMode.TEAM].isActive).toBe(false);
    expect(resolveSetMode(RoomPhase.LOBBY, false, GameMode.TEAM)).toBeUndefined();
  });

  // Conquer ships `isActive: false` until its lobby card lands; until then the lobby cannot
  // seat it by wire id either.
  it("refuses Conquer while it is inactive", () => {
    expect(MODE_TABLE[GameMode.CONQUER].isActive).toBe(false);
    expect(resolveSetMode(RoomPhase.LOBBY, false, GameMode.CONQUER)).toBeUndefined();
  });

  it("refuses an unknown wire value rather than falling back or throwing", () => {
    // Was a fallback to `DEFAULT_GAME_MODE`'s bundle; the `isActive` guard subsumes it, since an
    // unregistered byte is not active either. Refusing leaves the room on the mode the host
    // actually picked, which is what the fallback was reaching for without the surprise.
    expect(resolveSetMode(RoomPhase.LOBBY, false, 99 as GameMode)).toBeUndefined();
  });

  it("is pure: two calls give equal results and share the frozen bundle", () => {
    const a = resolveSetMode(RoomPhase.LOBBY, false, OTHER);
    const b = resolveSetMode(RoomPhase.LOBBY, false, OTHER);
    expect(a).toEqual(b);
    expect(a?.config).toBe(b?.config);
  });
});
