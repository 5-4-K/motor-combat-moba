import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import {
  ArenaState,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  TICK_RATE_HZ,
  TURRET_TICKS,
  hpOf,
  type InputMessage,
} from "@motor-combat-moba/shared";
import { newCombatMemory } from "../sim/combat-bridge.js";
import { newContactMemory } from "../sim/ram-bridge.js";
import { runPipeline, type PipelineCtx } from "./tick-pipeline.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

/**
 * `runPipeline` end to end for a turret press (TR7, TR10-TR24): the wire's `aimAngle` reaches
 * `serverTick`'s `aims` map, `toCombatPlayers` puts it on `aimBearing`, `beginFire` freezes it as the
 * pending press's bearing, `turnTurret` walks the turret toward it one `TURRET_TICKS.turnPerTick` per
 * tick, and only once aligned does `releaseShots` actually spawn the instance — with
 * `PlayerState.turretAngle` mirroring the car-relative angle the whole way.
 *
 * Nothing else in this suite drives `runPipeline` itself end to end (see `pipeline-order.test.ts`'s
 * own note on why it stuck to `serverTick` + `contactTick`); this is the one integration test for the
 * turret wiring specifically, because the individual bridges (`tick.test.ts`, `combat-bridge.test.ts`)
 * each cover only their own half of the seam.
 */

/** Dead centre of arena-01, clear of every wall and every spike hazard. */
const ARENA_CENTRE_X = 640;
const ARENA_CENTRE_Y = 360;

function newCtx(state: ArenaState, sessionId: string): PipelineCtx {
  return {
    state,
    inputQueues: new Map(),
    prevFireMasks: new Map(),
    silentTicks: new Map(),
    matchRoster: new Set([sessionId]),
    phaseCaps: new Map(),
    combat: newCombatMemory(),
    ram: newContactMemory(),
    hz: TICK_RATE_HZ,
    runPhaseSweep: false,
  };
}

function hasInstance(state: ArenaState, weaponId: string): boolean {
  let found = false;
  state.weapons.forEach((w) => {
    if (w.weaponId === weaponId) found = true;
  });
  return found;
}

function instanceAngle(state: ArenaState, weaponId: string): number | undefined {
  let angle: number | undefined;
  state.weapons.forEach((w) => {
    if (w.weaponId === weaponId) angle = w.angle;
  });
  return angle;
}

describe("runPipeline: a mouse-aimed turret press (TR7, TR10-TR24)", () => {
  it("turns the turret toward the pressed bearing over several ticks, then fires and mirrors turretAngle", () => {
    const state = new ArenaState();
    state.phase = RoomPhase.MATCH;

    const player = new PlayerState();
    player.sessionId = "p1";
    player.carId = "mirage";
    player.status = PlayerStatus.IN_MATCH;
    player.x = ARENA_CENTRE_X;
    player.y = ARENA_CENTRE_Y;
    player.angle = 0;
    player.hp = hpOf("mirage");
    player.alive = true;
    player.level = 1;
    state.players.set("p1", player);

    const ctx = newCtx(state, "p1");

    function oneTick(input: InputMessage): void {
      state.tick += 1;
      ctx.inputQueues.set("p1", [input]);
      runPipeline(ctx);
    }

    // magmablast is mirage's turret weapon, on fire slot 1 (basic attack occupies slot 0).
    oneTick({ seq: 1, steer: 0, throttle: 0, fireSlots: 1 << 1, aimAngle: Math.PI / 2 });

    // The turret is still turning, so nothing has fired yet.
    expect(hasInstance(state, "magmablast")).toBe(false);

    // The +1 absorbs float rounding at an exact multiple: at 540deg/s and 30 Hz the turn is exactly
    // 5 steps of 18deg (TURRET_TICKS.turnPerTick), and the press tick above already spent the first
    // one, so at most 4 more ticks should be needed.
    const maxTicks = Math.ceil(Math.PI / 2 / TURRET_TICKS.turnPerTick) + 1;
    let seq = 2;
    for (let i = 1; i < maxTicks && !hasInstance(state, "magmablast"); i++) {
      // The mask is HELD, not re-pressed: the same bit was already down last tick, so no new press
      // is detected and no aimAngle is needed — the turret keeps turning toward the frozen bearing
      // on its own every tick a turret press is pending (TR11/TR15).
      oneTick({ seq: seq++, steer: 0, throttle: 0, fireSlots: 1 << 1 });
    }

    expect(hasInstance(state, "magmablast")).toBe(true);
    expect(instanceAngle(state, "magmablast")).toBeCloseTo(Math.PI / 2, 3);
    expect(player.turretAngle).toBeCloseTo(Math.PI / 2, 3);
  });
});
