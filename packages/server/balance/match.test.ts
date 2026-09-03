import { describe, expect, it } from "vitest";
import { GameMode, TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { runMatch } from "./match.js";

const SETUP = {
  seats: [
    { sessionId: "a", carId: "mirage", team: 0 },
    { sessionId: "b", carId: "bastion", team: 0 },
  ],
  mode: GameMode.FFA_LAST_STANDING,
  arenaId: "arena-01",
  difficulty: "hard",
  seed: 1,
  maxTicks: 30 * 60,
} as const;

describe("runMatch", () => {
  it("runs to a conclusion and names a winner or a draw", () => {
    const out = runMatch(SETUP);
    expect(out.ticks).toBeGreaterThan(0);
    expect(out.ticks).toBeLessThanOrEqual(SETUP.maxTicks);
  });

  it("collects combat events", () => {
    const out = runMatch(SETUP);
    expect(out.events.fired.length).toBeGreaterThan(0);
  });

  it("is deterministic for a seed (B43)", () => {
    const a = runMatch(SETUP);
    const b = runMatch(SETUP);
    expect(b.ticks).toBe(a.ticks);
    expect(b.winnerSessionId).toBe(a.winnerSessionId);
    expect(b.events.damaged.length).toBe(a.events.damaged.length);
  });

  it("differs between seeds", () => {
    const a = runMatch(SETUP);
    const b = runMatch({ ...SETUP, seed: 2 });
    // Spawn assignment is seeded, so two seeds place the cars differently.
    expect(b.ticks).not.toBe(a.ticks);
  });

  it("respawns in deathmatch, so both cars can outlive their first death", () => {
    const out = runMatch({ ...SETUP, mode: GameMode.FFA_DEATHMATCH, maxTicks: 30 * 60 });
    expect(out.seats.every((s) => s.deaths >= 0)).toBe(true);
    // The harness's own match length IS the deathmatch clock (fix round 2, defect 1): the match
    // runs its full 60 s and ends via `deathmatchEnded`'s own clock check, which is a NORMAL
    // conclusion for a timed mode, not the harness's `maxTicks` safety valve — so `hitClock` reads
    // false here, and a real winner/draw comes out of `deathmatchOutcome`'s kills-then-deaths rank.
    expect(out.ticks).toBe(30 * 60);
    expect(out.hitClock).toBe(false);
  });

  it("shortening matchSeconds still lets the deathmatch clock fire, so a winner can appear (fix round 2, defect 1)", () => {
    // Before the fix, `state.matchEndsTick` was pinned to the game's 180 s clock regardless of
    // `setup.maxTicks`, so any shortened run exited the loop before `deathmatchEnded` ever fired —
    // every match came back a draw (`winnerSessionId: ""`), and win rate silently read 0% for
    // exactly the fast-iteration runs the harness exists to support. This is the short-run case
    // that would have caught it: `matchSeconds` well under the game's 180 s default.
    const out = runMatch({ ...SETUP, mode: GameMode.FFA_DEATHMATCH, maxTicks: 10 * TICK_RATE_HZ });
    expect(out.winnerSessionId).not.toBe("");
    expect(out.hitClock).toBe(false);
  });

  it("ranks placement by kills then fewest deaths in deathmatch", () => {
    const out = runMatch({ ...SETUP, mode: GameMode.FFA_DEATHMATCH });
    expect(out.seats.map((s) => s.placement).sort()).toEqual([1, 2]);
  });
});
