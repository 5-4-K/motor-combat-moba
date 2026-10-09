import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { arenaSelectView, inRouletteWindow, type ArenaSelectInput } from "./arena-select-view.js";

const cards = [
  { id: "arena-01", name: "Arena 01", previewUrl: null },
  { id: "arena-02", name: "Arena 02", previewUrl: "art/x.png" },
];
const base: ArenaSelectInput = {
  cards, modeLabel: "Brawl", highlightId: "arena-01", chosenId: null,
  isHost: true, stage: "choosing", secondsLeft: 10, revealSecondsLeft: 3,
};

describe("arenaSelectView (AR28-AR33)", () => {
  it("marks the highlighted card", () => {
    const v = arenaSelectView({ ...base, highlightId: "arena-02" });
    expect(v.cards.map((c) => c.highlighted)).toEqual([false, true]);
  });
  it("lets the host act while choosing", () => {
    const v = arenaSelectView(base);
    expect(v.canAct).toBe(true);
    expect(v.status).toBe("Choose an arena, then Select.");
  });
  it("disables a watcher's buttons and says who is choosing", () => {
    const v = arenaSelectView({ ...base, isHost: false });
    expect(v.canAct).toBe(false);
    expect(v.status).toBe("The host is choosing the arena.");
  });
  it("disables everyone once picked", () => {
    expect(arenaSelectView({ ...base, stage: "roulette", chosenId: "arena-02" }).canAct).toBe(false);
    expect(arenaSelectView({ ...base, stage: "revealed", chosenId: "arena-02" }).canAct).toBe(false);
  });
  it("formats the clock and turns urgent in the last 3 s", () => {
    expect(arenaSelectView(base).clock).toBe("0:10");
    expect(arenaSelectView(base).urgent).toBe(false);
    expect(arenaSelectView({ ...base, secondsLeft: 3 }).urgent).toBe(true);
  });
  it("carries the chosen card and the reveal count", () => {
    const v = arenaSelectView({ ...base, stage: "revealed", chosenId: "arena-02", revealSecondsLeft: 2 });
    expect(v.chosen?.name).toBe("Arena 02");
    expect(v.revealLabel).toBe("Car select in 2");
  });
});

describe("inRouletteWindow (AR34)", () => {
  it("is open until the plain reveal's share begins", () => {
    const ends = 1000;
    const revealStart = ends - 3 * TICK_RATE_HZ;
    expect(inRouletteWindow(revealStart - 1, ends, 3)).toBe(true);
    expect(inRouletteWindow(revealStart, ends, 3)).toBe(false);
  });
});
