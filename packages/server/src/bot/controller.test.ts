import { describe, expect, it } from "vitest";
import {
  ArenaState,
  PlayerState,
  applyStatus,
  hpOf,
  newStatusState,
} from "@motor-combat-moba/shared";
import { BOT_PROFILES } from "../config/bot-profiles.js";
import { newCombatMemory, toCombatPlayers } from "../sim/combat-bridge.js";
import { writeStatuses } from "../sim/status-bridge.js";
import { botInput } from "./input.js";
import { makeRng } from "./rng.js";
import type { BotView } from "./types.js";
import { buildBotView } from "./view.js";
import { LegacyController } from "./controller.js";

// Same fixture shape as `view.test.ts` (Task 10): a real `ArenaState` run through the real
// fire-state build, not a hand-rolled stand-in. `LegacyController` is tested against exactly what
// a room hands it.
function playerIn(state: ArenaState, sessionId: string, over: Partial<PlayerState> = {}): PlayerState {
  const player = new PlayerState();
  player.sessionId = sessionId;
  player.x = 0;
  player.y = 0;
  player.angle = 0;
  player.carId = "mirage";
  player.hp = hpOf("mirage");
  player.alive = true;
  player.level = 1;
  Object.assign(player, over);
  state.players.set(sessionId, player);
  return player;
}

/** Self at the origin facing 0 rad, target "p2" at `targetX` on the x-axis (or dead/absent). */
function viewAt(
  tick: number,
  opts: { targetX?: number; targetAlive?: boolean } = {},
): BotView {
  const { targetX = 500, targetAlive = true } = opts;
  const state = new ArenaState();
  state.tick = tick;
  playerIn(state, "bot", { x: 0, y: 0, angle: 0 });
  playerIn(state, "p2", { x: targetX, y: 0, alive: targetAlive });
  const combat = newCombatMemory();
  toCombatPlayers(state, new Set(["bot", "p2"]), new Map(), combat);
  return buildBotView({ state, selfSessionId: "bot", combat, rng: makeRng(1) })!;
}

/** Self at the origin, plus arbitrary enemies for target-selection tests. All team 0 (FFA). */
function viewWithEnemies(
  enemies: { sessionId: string; x: number; alive: boolean; phased: boolean }[],
): BotView {
  const state = new ArenaState();
  state.tick = 1;
  playerIn(state, "bot", { x: 0, y: 0, angle: 0 });
  const sessionIds = ["bot", ...enemies.map((e) => e.sessionId)];
  for (const enemy of enemies) {
    playerIn(state, enemy.sessionId, { x: enemy.x, y: 0, alive: enemy.alive });
  }
  const combat = newCombatMemory();
  toCombatPlayers(state, new Set(sessionIds), new Map(), combat);
  for (const enemy of enemies) {
    if (!enemy.phased) continue;
    const player = state.players.get(enemy.sessionId)!;
    writeStatuses(player, applyStatus(newStatusState(), "phased", state.tick, 90));
  }
  return buildBotView({ state, selfSessionId: "bot", combat, rng: makeRng(1) })!;
}

describe("LegacyController (B22)", () => {
  it("holds its intent between recomputes on easy's 9-tick cadence", () => {
    const bot = new LegacyController("easy", { targetSessionId: "p2" });
    const first = bot.decide(viewAt(1, { targetX: 500 }));
    const held = bot.decide(viewAt(2, { targetX: -500 })); // target teleports; too soon to react
    expect(held.steer).toBe(first.steer);
  });

  it("recomputes on the cadence tick", () => {
    const bot = new LegacyController("hard", { targetSessionId: "p2" }); // reactionTicks: 1
    const a = bot.decide(viewAt(1, { targetX: 500 }));
    const b = bot.decide(viewAt(2, { targetX: -500 }));
    expect(b.steer).not.toBe(a.steer);
  });

  it("coasts on zeros when the target is dead", () => {
    const bot = new LegacyController("hard", { targetSessionId: "p2" });
    expect(bot.decide(viewAt(1, { targetAlive: false }))).toEqual({ steer: 0, throttle: 0, fireSlots: 0 });
  });

  it("pulses the fire mask, so serverTick sees a fresh press edge", () => {
    const bot = new LegacyController("hard", { targetSessionId: "p2" }); // firePeriodTicks: 2
    const masks = [1, 2, 3, 4].map((t) => bot.decide(viewAt(t, { targetX: 60 })).fireSlots);
    expect(masks.some((m) => m === 0)).toBe(true);
    expect(masks.some((m) => m > 0)).toBe(true);
  });

  it("picks the nearest living enemy when no target is fixed", () => {
    const bot = new LegacyController("hard");
    const intent = bot.decide(viewWithEnemies([
      { sessionId: "far", x: 900, alive: true, phased: false },
      { sessionId: "near", x: 100, alive: true, phased: false },
    ]));
    expect(bot.currentTargetSessionId).toBe("near");
    expect(intent.throttle).not.toBe(0);
  });

  it("skips a phased enemy, which cannot be hit", () => {
    const bot = new LegacyController("hard");
    bot.decide(viewWithEnemies([
      { sessionId: "near", x: 100, alive: true, phased: true },
      { sessionId: "far", x: 900, alive: true, phased: false },
    ]));
    expect(bot.currentTargetSessionId).toBe("far");
  });

  it("reproduces botInput exactly for the same pose and profile", () => {
    const bot = new LegacyController("medium", { targetSessionId: "p2" });
    const view = viewAt(1, { targetX: 300 });
    const direct = botInput(1, { x: 0, y: 0, angle: 0 }, { x: 300, y: 0, angle: 0 },
      view.self.slots.map((s) => s.range), BOT_PROFILES.medium);
    const viaController = bot.decide(view);
    expect(viaController.steer).toBe(direct.steer);
    expect(viaController.throttle).toBe(direct.throttle);
  });
});
