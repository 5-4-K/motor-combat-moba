import { describe, expect, it } from "vitest";
import { newCombatEvents } from "./combat-events.js";

describe("newCombatEvents", () => {
  it("starts with three empty logs", () => {
    const events = newCombatEvents();
    expect(events.fired).toEqual([]);
    expect(events.damaged).toEqual([]);
    expect(events.killed).toEqual([]);
  });

  it("returns a fresh bag each call, so two matches never share a log", () => {
    const a = newCombatEvents();
    const b = newCombatEvents();
    a.fired.push({
      tick: 1, shooterSessionId: "p1", carId: "mirage",
      weaponId: "magmablast", slot: 0, pressId: "p1#1#0",
    });
    expect(b.fired).toHaveLength(0);
  });
});
