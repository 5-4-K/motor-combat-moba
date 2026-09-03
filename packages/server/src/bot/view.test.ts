import { describe, expect, it } from "vitest";
import {
  ArenaState,
  PlayerState,
  applyStatus,
  hpOf,
  newStatusState,
} from "@motor-combat-moba/shared";
import { newCombatMemory, toCombatPlayers, type CombatMemory } from "../sim/combat-bridge.js";
import { writeStatuses } from "../sim/status-bridge.js";
import { makeRng } from "./rng.js";
import { buildBotView } from "./view.js";

// Copied from `combat-bridge.test.ts` rather than invented: it is the same shape a real room
// produces, and `buildBotView` must be tested against exactly that, not a hand-rolled stand-in.
function playerIn(state: ArenaState, sessionId: string, over: Partial<PlayerState> = {}): PlayerState {
  const player = new PlayerState();
  player.sessionId = sessionId;
  player.x = 400;
  player.y = 150;
  player.angle = 0;
  player.carId = "mirage";
  player.hp = hpOf("mirage");
  player.alive = true;
  player.level = 1;
  Object.assign(player, over);
  state.players.set(sessionId, player);
  return player;
}

interface Fixture {
  state: ArenaState;
  selfSessionId: string;
  combat: CombatMemory;
  rng: ReturnType<typeof makeRng>;
}

function fixture(): Fixture {
  const state = new ArenaState();
  playerIn(state, "bot", { carId: "mirage", x: 300 });
  playerIn(state, "p2", { carId: "bastion", x: 600 });
  const combat = newCombatMemory();
  // Runs the real fire-state build (`toCombatPlayers`) so `self.slots` carries a genuine loadout —
  // exactly what `ArenaRoom.tick` would have on hand when it asks the bot to decide.
  toCombatPlayers(state, new Set(["bot", "p2"]), new Map(), combat);
  return { state, selfSessionId: "bot", combat, rng: makeRng(1) };
}

function fixtureWithPhasedOpponent(): Fixture {
  const f = fixture();
  const p2 = f.state.players.get("p2")!;
  writeStatuses(p2, applyStatus(newStatusState(), "phased", f.state.tick, 90));
  return f;
}

describe("buildBotView fairness (B15, B16, B18)", () => {
  it("gives the bot its own slot state in full", () => {
    const view = buildBotView(fixture())!;
    expect(view.self.slots.length).toBeGreaterThan(0);
    expect(view.self.slots[0]).toHaveProperty("rechargeEndsTick");
    expect(view.self.slots[0]).toHaveProperty("range");
  });

  it("never exposes another car's slot state", () => {
    const view = buildBotView(fixture())!;
    for (const other of view.others) {
      expect(other).not.toHaveProperty("slots");
      expect(other).not.toHaveProperty("stocks");
      expect(other).not.toHaveProperty("rechargeEndsTick");
    }
  });

  it("carries no route back to keypresses", () => {
    const view = buildBotView(fixture())!;
    const json = JSON.stringify({ ...view, rng: undefined });
    expect(json).not.toContain("inputQueues");
    expect(json).not.toContain("prevFireMasks");
    expect(json).not.toContain("fireMask");
    expect(json).not.toContain("lastDamagerSessionId");
  });

  it("marks a phased car as phased, since a human sees it translucent", () => {
    const view = buildBotView(fixtureWithPhasedOpponent())!;
    expect(view.others.find((o) => o.sessionId === "p2")?.phased).toBe(true);
  });

  it("excludes the bot itself from others", () => {
    const view = buildBotView(fixture())!;
    expect(view.others.map((o) => o.sessionId)).not.toContain("bot");
  });

  it("passes observed fires through, and defaults them to empty", () => {
    expect(buildBotView(fixture())!.observedFires).toEqual([]);
    const fires = [
      { tick: 1, shooterSessionId: "p2", carId: "mirage", weaponId: "magmablast", slot: 0, pressId: "p2#1#0" },
    ] as const;
    expect(buildBotView({ ...fixture(), observedFires: fires })!.observedFires).toEqual(fires);
  });

  it("returns null when the bot's own car is gone", () => {
    expect(buildBotView({ ...fixture(), selfSessionId: "nobody" })).toBeNull();
  });
});
