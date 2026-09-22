import { beforeEach, describe, expect, it } from "vitest";
import {
  ArenaState,
  DEFAULT_GAME_MODE,
  GameMode,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  TICK_RATE_HZ,
  assembleModeConfig,
  hpOf,
  installMode,
  modeConfigOf,
  type InputMessage,
  type ModeConfig,
} from "@motor-combat-moba/shared";
import { newCombatMemory } from "../sim/combat-bridge.js";
import { newContactMemory } from "../sim/ram-bridge.js";
import { scoped } from "./mode-scope.js";
import { runPipeline, type PipelineCtx } from "./tick-pipeline.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

/**
 * G2, driven through the REAL production entry point rather than the bare lockstep alone:
 * `runPipeline` wrapped in `scoped(config, ...)` — exactly how `ArenaRoom`, `PracticeRoom` and
 * `PlaygroundRoom` call it every tick (`ArenaRoom.ts`'s `setSimulationInterval`). This exercises
 * `statusTick` -> `serverTick` -> `contactTick` -> `combatTick` as one unit against real
 * `ArenaState`/`PlayerState` schema instances, not only `stepSim` in isolation — so a leak anywhere
 * across that wider surface (the derived tick tables, `slots()`, `combat()`, ...) would show up
 * here too, not only in the drive numbers `modes/concurrency.test.ts` pins.
 *
 * Same central trap as that suite, restated because it is easy to re-introduce by accident: Brawl
 * and Deathmatch ship IDENTICAL tables today, so `FAST` below is again a SYNTHETIC bundle —
 * Deathmatch's own tables with `drive.baseMaxSpeed` multiplied 6x, assembled fresh via
 * `assembleModeConfig` so the difference is genuinely derived rather than copied. Comparing the two
 * SHIPPED mode bundles directly would prove nothing.
 *
 * What this covers beyond `modes/concurrency.test.ts`: the real per-room call shape (`scoped` +
 * `PipelineCtx`, each room owning its own `CombatMemory`/`ContactMemory`/input queues) and the wider
 * accessor surface `runPipeline` touches. What it does NOT cover: two rooms whose PLAYER COUNT,
 * weapon fire, or ram/slam contacts differ mid-tick — this fixture is deliberately one car driving
 * straight in each room, so the isolation property is the only thing under test, not combat or
 * contact resolution.
 */

/** Dead centre of arena-01 (matches `tick-pipeline.test.ts`), clear of every wall and spike strip. */
const ARENA_CENTRE_X = 640;
const ARENA_CENTRE_Y = 360;
const SESSION_ID = "p1";
const CAR_ID = "mirage";
// 10 ticks keeps even FAST's 6x top speed well inside arena-01's ~560u clearance from centre
// (estimated ~45u of travel under FAST vs ~18u under SLOW over this span) so neither room's car
// reaches a wall or a spike — this fixture is about mode isolation, not boundary/contact resolution.
const TICKS = 10;

const SLOW: ModeConfig = modeConfigOf(GameMode.FFA_LAST_STANDING);

/** Strips `id`/`derived` and the global hull fields back off a `ModeConfig`, back to `ModeTables`
 *  shape, the way `assembleModeConfig` itself expects to receive them. */
function tablesOf(config: ModeConfig) {
  const { carWidth, carHeight, ...driveRest } = config.drive;
  return {
    cars: config.cars,
    weapons: config.weapons,
    drive: driveRest,
    ram: config.ram,
    impulse: config.impulse,
    combat: config.combat,
    turret: config.turret,
    statusConfig: config.statusConfig,
    statusTable: config.statusTable,
    statusLimits: config.statusLimits,
    spike: config.spike,
    slots: config.slots,
    flow: config.flow,
    deathmatch: config.deathmatch,
    camera: config.camera,
    arenas: config.arenas,
    maxPlayers: config.maxPlayers,
  };
}

const deathmatchTables = tablesOf(modeConfigOf(GameMode.FFA_DEATHMATCH));
const FAST: ModeConfig = assembleModeConfig(GameMode.FFA_DEATHMATCH, {
  ...deathmatchTables,
  drive: { ...deathmatchTables.drive, baseMaxSpeed: deathmatchTables.drive.baseMaxSpeed * 6 },
});

const THROTTLE_INPUT: Omit<InputMessage, "seq"> = { steer: 0, throttle: 1, fireSlots: 0 };

function newRoom(): { ctx: PipelineCtx; player: PlayerState } {
  const state = new ArenaState();
  state.phase = RoomPhase.MATCH;

  const player = new PlayerState();
  player.sessionId = SESSION_ID;
  player.carId = CAR_ID;
  player.status = PlayerStatus.IN_MATCH;
  player.x = ARENA_CENTRE_X;
  player.y = ARENA_CENTRE_Y;
  player.angle = 0;
  player.hp = hpOf(CAR_ID);
  player.alive = true;
  player.level = 1;
  state.players.set(SESSION_ID, player);

  const ctx: PipelineCtx = {
    state,
    inputQueues: new Map(),
    prevFireMasks: new Map(),
    silentTicks: new Map(),
    matchRoster: new Set([SESSION_ID]),
    phaseCaps: new Map(),
    combat: newCombatMemory(),
    ram: newContactMemory(),
    hz: TICK_RATE_HZ,
    runPhaseSweep: false,
  };

  return { ctx, player };
}

function oneTick(ctx: PipelineCtx): void {
  ctx.state.tick += 1;
  ctx.inputQueues.set(SESSION_ID, [{ ...THROTTLE_INPUT, seq: ctx.state.tick }]);
  runPipeline(ctx);
}

function poseOf(player: PlayerState) {
  return {
    x: player.x,
    y: player.y,
    angle: player.angle,
    vx: player.vx,
    vy: player.vy,
    angVel: player.angVel,
  };
}

function runAlone(config: ModeConfig, ticks: number) {
  const { ctx, player } = newRoom();
  scoped(config, () => {
    for (let i = 0; i < ticks; i += 1) oneTick(ctx);
  });
  return poseOf(player);
}

describe("two modes in one process (G2), through runPipeline", () => {
  it("FAST's synthetic bundle is genuinely different from SLOW's", () => {
    // Same non-optional guard as `modes/concurrency.test.ts` — if this fails, the rest of this file
    // is worthless: it would pass just as happily against a `scoped`/`withMode` that silently no-ops.
    expect(FAST.drive.baseMaxSpeed).not.toBe(SLOW.drive.baseMaxSpeed);
    expect(FAST.derived.chassisDrive[CAR_ID].maxSpeed).not.toBe(
      SLOW.derived.chassisDrive[CAR_ID].maxSpeed,
    );
  });

  it("gives each room the same result interleaved as it does alone", () => {
    const aloneSlow = runAlone(SLOW, TICKS);
    const aloneFast = runAlone(FAST, TICKS);

    // Step 1: the two alone-runs must differ, or nothing below proves anything was exercised.
    expect(aloneFast).not.toEqual(aloneSlow);
    expect(aloneFast.x).not.toBeCloseTo(aloneSlow.x, 3);

    // Step 2: two independent rooms, each with its own `PipelineCtx` (its own input queue, its own
    // combat/contact memory) — interleaved one tick at a time, the way an arena room and a practice
    // room actually tick against one Colyseus process.
    const roomA = newRoom(); // ticks under SLOW
    const roomB = newRoom(); // ticks under FAST
    for (let i = 0; i < TICKS; i += 1) {
      scoped(SLOW, () => oneTick(roomA.ctx));
      scoped(FAST, () => oneTick(roomB.ctx));
    }

    expect(poseOf(roomA.player)).toEqual(aloneSlow);
    expect(poseOf(roomB.player)).toEqual(aloneFast);
  });
});
