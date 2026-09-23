import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_MODE,
  assembleModeConfig,
  installMode,
  modeConfigOf,
  type ModeTables,
} from "@motor-combat-moba/shared";
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
  /**
   * The one weapon this build can make a turret press with, and the flag that lets it be pressed.
   *
   * `development/main` returned `predator`, `magmablast` and `thumper` to fixed muzzles, leaving the
   * nine `basic-attack-*` rows as the table's only `turret` carriers — and those sit on fire slot 0,
   * which `beginFire` refuses while the active bundle's `slots().basicAttackEnabled` is `false`. Unlike the unit tests
   * elsewhere, this one drives the REAL pipeline off `PlayerState.carId`, so it cannot hand itself
   * an ability slot carrying a basic attack; it pins the flag on instead, which is the repo's own
   * rule for a test that covers the mechanic rather than the shipped position.
   */
  const TURRET_ROW = "basic-attack-mirage";

  // Pinned on the BUNDLE, not on `BASIC_ATTACK_CONFIG`. `development/main` pinned the raw global,
  // which was correct when `beginFire` read it; since the per-mode work `fire.ts` reads
  // `slots().basicAttackEnabled` off the INSTALLED bundle, so writing the global reaches nothing
  // and this test failed with the shipped flag `false`. Same intent, carried to where the sim now
  // looks: assemble a sibling of the default bundle with the flag on and install it for these cases.
  const SHIPPED = modeConfigOf(DEFAULT_GAME_MODE);
  const BASIC_ATTACK_ON = assembleModeConfig(DEFAULT_GAME_MODE, {
    ...(SHIPPED as unknown as ModeTables),
    slots: { ...SHIPPED.slots, basicAttackEnabled: true },
  });
  beforeEach(() => installMode(BASIC_ATTACK_ON));
  afterEach(() => installMode(SHIPPED));

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

    // Mirage's basic attack is its only turret weapon on this build, and it sits on fire slot 0.
    oneTick({ seq: 1, steer: 0, throttle: 0, fireSlots: 1 << 0, aimAngle: Math.PI / 2 });

    // The turret is still turning, so nothing has fired yet.
    expect(hasInstance(state, TURRET_ROW)).toBe(false);

    // The +1 absorbs float rounding at an exact multiple: at 540deg/s and 30 Hz the turn is exactly
    // 5 steps of 18deg (TURRET_TICKS.turnPerTick), and the press tick above already spent the first
    // one, so at most 4 more ticks should be needed.
    const maxTicks = Math.ceil(Math.PI / 2 / TURRET_TICKS.turnPerTick) + 1;
    let seq = 2;
    for (let i = 1; i < maxTicks && !hasInstance(state, TURRET_ROW); i++) {
      // The mask is HELD, not re-pressed: the same bit was already down last tick, so no new press
      // is detected and no aimAngle is needed — the turret keeps turning toward the frozen bearing
      // on its own every tick a turret press is pending (TR11/TR15).
      oneTick({ seq: seq++, steer: 0, throttle: 0, fireSlots: 1 << 0 });
    }

    expect(hasInstance(state, TURRET_ROW)).toBe(true);
    expect(instanceAngle(state, TURRET_ROW)).toBeCloseTo(Math.PI / 2, 3);
    expect(player.turretAngle).toBeCloseTo(Math.PI / 2, 3);
  });
});
