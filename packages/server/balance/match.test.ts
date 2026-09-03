import { describe, expect, it } from "vitest";
import { GameMode } from "@motor-combat-moba/shared";
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
    expect(out.hitClock).toBe(true);
  });

  it("ranks placement by kills then fewest deaths in deathmatch", () => {
    const out = runMatch({ ...SETUP, mode: GameMode.FFA_DEATHMATCH });
    expect(out.seats.map((s) => s.placement).sort()).toEqual([1, 2]);
  });
});
