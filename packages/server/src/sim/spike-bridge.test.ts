import { describe, expect, it } from "vitest";
import { SPIKE_CONFIG, SPIKE_TICKS } from "@motor-combat-moba/shared";
import { newSpikeMemory, recordShove, resolveSpikeHits } from "./spike-bridge.js";

const into = (id: string, speedIn: number) => ({ sessionId: id, nx: 1, ny: 0, speedIn });

describe("resolveSpikeHits", () => {
  it("ignores a car resting against the strip", () => {
    expect(resolveSpikeHits([into("a", 0)], newSpikeMemory(), 1)).toEqual([]);
  });

  it("ignores a car below the trigger speed", () => {
    const slow = SPIKE_CONFIG.triggerSpeed - 1;
    expect(resolveSpikeHits([into("a", slow)], newSpikeMemory(), 1)).toEqual([]);
  });

  it("ignores a car driving away", () => {
    expect(resolveSpikeHits([into("a", -200)], newSpikeMemory(), 1)).toEqual([]);
  });

  it("hits a car pushing in above the trigger speed", () => {
    const memory = newSpikeMemory();
    expect(resolveSpikeHits([into("a", 200)], memory, 1)).toEqual([
      { targetSessionId: "a", sourceSessionId: "a" },
    ]);
  });

  // Not in the brief verbatim — added because the "below trigger speed" test only exercises
  // `triggerSpeed - 1`, which cannot distinguish `speedIn < triggerSpeed` from
  // `speedIn <= triggerSpeed`: both drop that input. Only a contact at exactly `triggerSpeed`
  // tells the two apart, and the spec is explicit ("`speedIn < SPIKE_CONFIG.triggerSpeed` is
  // dropped") — so exactly-at-threshold must trigger.
  it("hits a car exactly at the trigger speed", () => {
    const memory = newSpikeMemory();
    expect(resolveSpikeHits([into("a", SPIKE_CONFIG.triggerSpeed)], memory, 1)).toEqual([
      { targetSessionId: "a", sourceSessionId: "a" },
    ]);
  });

  it("locks out a second hit inside the retrigger window", () => {
    const memory = newSpikeMemory();
    resolveSpikeHits([into("a", 200)], memory, 1);
    expect(resolveSpikeHits([into("a", 200)], memory, 1 + SPIKE_TICKS.retrigger - 1)).toEqual([]);
  });

  it("allows one again once the window has passed", () => {
    const memory = newSpikeMemory();
    resolveSpikeHits([into("a", 200)], memory, 1);
    const later = resolveSpikeHits([into("a", 200)], memory, 1 + SPIKE_TICKS.retrigger);
    expect(later).toHaveLength(1);
  });

  it("credits a recent shover", () => {
    const memory = newSpikeMemory();
    recordShove(memory, "a", "b", 1);
    expect(resolveSpikeHits([into("a", 200)], memory, 2)).toEqual([
      { targetSessionId: "a", sourceSessionId: "b" },
    ]);
  });

  it("credits the victim itself once the shove window has expired", () => {
    const memory = newSpikeMemory();
    recordShove(memory, "a", "b", 1);
    const hits = resolveSpikeHits([into("a", 200)], memory, 1 + SPIKE_TICKS.shoverCredit + 1);
    expect(hits).toEqual([{ targetSessionId: "a", sourceSessionId: "a" }]);
  });

  it("never credits a shover to themselves", () => {
    const memory = newSpikeMemory();
    recordShove(memory, "a", "a", 1);
    expect(resolveSpikeHits([into("a", 200)], memory, 2)[0]!.sourceSessionId).toBe("a");
  });
});
