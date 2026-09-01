import { describe, expect, it } from "vitest";
import { canStart } from "./start-rules.js";
import { GameMode } from "../constants.js";

const ready = (team: 0 | 1) => ({ status: "ready" as const, team });

describe("canStart FFA", () => {
  it("rejects fewer than 2 ready", () => {
    expect(canStart(GameMode.FFA_LAST_STANDING, [ready(0)]).ok).toBe(false);
  });
  it("accepts 2+ ready regardless of team", () => {
    expect(canStart(GameMode.FFA_LAST_STANDING, [ready(0), ready(1)]).ok).toBe(true);
  });
  it("ignores in-match and post-match", () => {
    const players = [
      ready(0),
      { status: "in_match" as const, team: 0 },
      { status: "post_match" as const, team: 1 },
    ];
    expect(canStart(GameMode.FFA_LAST_STANDING, players).ok).toBe(false);
  });
  it("returns a stable error when fewer than 2 ready", () => {
    expect(canStart(GameMode.FFA_LAST_STANDING, [ready(0)])).toEqual({
      ok: false,
      error: "Need at least 2 ready players",
    });
    expect(canStart(GameMode.FFA_LAST_STANDING, [])).toEqual({
      ok: false,
      error: "Need at least 2 ready players",
    });
  });
});

describe("canStart TEAM", () => {
  it("accepts 1v1 / 2v2 / 3v3 ready", () => {
    expect(canStart(GameMode.TEAM, [ready(0), ready(1)]).ok).toBe(true);
    expect(canStart(GameMode.TEAM, [ready(0), ready(0), ready(1), ready(1)]).ok).toBe(true);
    expect(
      canStart(GameMode.TEAM, [
        ready(0),
        ready(0),
        ready(0),
        ready(1),
        ready(1),
        ready(1),
      ]).ok,
    ).toBe(true);
  });
  it("rejects unequal ready teams", () => {
    expect(canStart(GameMode.TEAM, [ready(0), ready(0), ready(1)]).ok).toBe(false);
  });
  it("returns unequal error for 2v1", () => {
    expect(canStart(GameMode.TEAM, [ready(0), ready(0), ready(1)])).toEqual({
      ok: false,
      error: "Teams must be equal to start",
    });
  });
  it("returns per-team error when a side has 0 ready", () => {
    expect(canStart(GameMode.TEAM, [ready(0)])).toEqual({
      ok: false,
      error: "Need at least 1 ready player per team",
    });
    expect(canStart(GameMode.TEAM, [])).toEqual({
      ok: false,
      error: "Need at least 1 ready player per team",
    });
  });
});
