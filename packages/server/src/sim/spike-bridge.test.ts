import { describe, expect, it } from "vitest";
import {
  ArenaState, PlayerState, SPIKE_CONFIG, SPIKE_TICKS, TICK_RATE_HZ, hpOf,
} from "@motor-combat-moba/shared";
import { respawnPlayer } from "../rooms/tick-pipeline.js";
import { newCombatMemory } from "./combat-bridge.js";
import { newContactMemory } from "./ram-bridge.js";
import { clearShover, newSpikeMemory, recordShove, resolveSpikeHits } from "./spike-bridge.js";

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

describe("clearShover", () => {
  it("drops the shove without touching the retrigger lockout", () => {
    const memory = newSpikeMemory();
    recordShove(memory, "a", "b", 1);
    resolveSpikeHits([into("a", 200)], memory, 1);
    clearShover(memory, "a");
    // Still locked out — the two clocks are independent, and only one of them is a respawn's
    // business.
    expect(resolveSpikeHits([into("a", 200)], memory, 2)).toEqual([]);
    // And once the lockout passes, the death is the victim's own again.
    expect(resolveSpikeHits([into("a", 200)], memory, 1 + SPIKE_TICKS.retrigger)).toEqual([
      { targetSessionId: "a", sourceSessionId: "a" },
    ]);
  });
});

describe("respawn clears the shove", () => {
  it("does not credit a pre-death shover with a post-respawn spike death", () => {
    // `combat.lastDamagers` is cleared on respawn for exactly this reason ("or whoever last hurt you
    // before this death is credited with your next one"); the shover memory is the same rule for the
    // hazard's own attribution. Only three unrelated numbers hide it in play — `respawnDelaySeconds`
    // (5) happening to exceed `shoverCreditMs` (4), and `isOnField` requiring `alive` — so this is
    // driven through the real `respawnPlayer` rather than asserted on the delete alone.
    const state = new ArenaState();
    const player = new PlayerState();
    player.sessionId = "a";
    player.carId = "mirage";
    player.x = 400;
    player.y = 150;
    player.hp = 0;
    player.alive = false;
    player.level = 1;
    state.players.set("a", player);

    const ram = newContactMemory();
    recordShove(ram.spikes, "a", "b", 1);

    respawnPlayer(
      {
        state,
        inputQueues: new Map(),
        prevFireMasks: new Map(),
        matchRoster: new Set(["a"]),
        phaseCaps: new Map(),
        combat: newCombatMemory(),
        ram,
        hz: TICK_RATE_HZ,
        runPhaseSweep: true,
      },
      player,
    );

    // Well inside the credit window, so "b" would still be named if the entry had survived.
    expect(resolveSpikeHits([into("a", 200)], ram.spikes, 2)).toEqual([
      { targetSessionId: "a", sourceSessionId: "a" },
    ]);
    // Sanity: the respawn itself still did its job.
    expect(player.alive).toBe(true);
    expect(player.hp).toBe(hpOf("mirage"));
  });
});
