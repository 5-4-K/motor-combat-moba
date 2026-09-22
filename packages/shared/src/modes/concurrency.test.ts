import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import type { InputMessage } from "../net/input.js";
import { NEUTRAL_MODIFIERS } from "../sim/status/modifiers.js";
import { stepSim, type SimBody, type StepContext } from "../sim/step.js";
import { withMode } from "./active.js";
import { assembleModeConfig } from "./build.js";
import { DEATHMATCH_TABLES } from "./deathmatch/index.js";
import { modeConfigOf } from "./registry.js";
import type { ModeConfig } from "./types.js";

/**
 * G2: two modes must be able to tick in the same process, interleaved, and each must get exactly
 * the result it would get running alone — the property that makes it safe for one server process to
 * run an arena room on one mode and a practice room on another at the same time.
 *
 * THE TRAP (see task-6-brief.md): Brawl and Deathmatch ship IDENTICAL drive tables today
 * (`brawl/drive.ts` and `deathmatch/drive.ts` differ only in the export's name). A test that ran
 * `stepSim` under both shipped modes and asserted the results matched would pass even if `withMode`
 * were a complete no-op reading one shared global. So `FAST` below is a SYNTHETIC bundle, built with
 * `assembleModeConfig` from Deathmatch's own tables but with `drive.baseMaxSpeed` multiplied 6x —
 * genuinely different derived drive numbers, not a copy of anything shipped. `SLOW` is the real,
 * unmodified Brawl bundle. Neither mode folder is edited; the difference is built inside this file.
 */

const SLOW: ModeConfig = modeConfigOf(GameMode.FFA_LAST_STANDING);

// Assembled fresh (not patched onto an already-derived bundle) so `derived.chassisDrive` is a REAL
// recomputation from the different `baseMaxSpeed` — see `assembleModeConfig`'s own doc comment on
// why every resolver must read the passed-in clone rather than a module global.
const FAST: ModeConfig = assembleModeConfig(GameMode.FFA_DEATHMATCH, {
  ...DEATHMATCH_TABLES,
  drive: { ...DEATHMATCH_TABLES.drive, baseMaxSpeed: DEATHMATCH_TABLES.drive.baseMaxSpeed * 6 },
});

const CAR_ID = "mirage";
const DT = 1 / 30;
const TICKS = 30;

const THROTTLE_INPUT: InputMessage = { seq: 0, steer: 0, throttle: 1, fireSlots: 0 };

// A wide-open field: no wall or obstacle contact for either bundle across 30 ticks of straight-line
// throttle, so the two bundles' `stepDrive` outputs are the whole story and `resolveWorld` never
// enters it as a confound.
const CONTEXT: StepContext = {
  carId: CAR_ID,
  others: [],
  obstacles: [],
  bounds: { width: 1_000_000, height: 1_000_000 },
  modifiers: NEUTRAL_MODIFIERS,
  selfRamDefence: 50,
};

function freshBody(): SimBody {
  return {
    x: 100,
    y: 100,
    angle: 0,
    vx: 0,
    vy: 0,
    angVel: 0,
    maneuver: 0,
    maneuverTicksLeft: 0,
    maneuverAngle: 0,
    maneuverSpeed: 0,
  };
}

function run(config: ModeConfig, ticks: number): SimBody {
  return withMode(config, () => {
    let body = freshBody();
    for (let i = 0; i < ticks; i += 1) body = stepSim(body, THROTTLE_INPUT, DT, CONTEXT);
    return body;
  });
}

describe("two modes in one process (G2)", () => {
  it("FAST's synthetic bundle is genuinely different from SLOW's, before anything else is asserted", () => {
    // If this fails, the test below is worthless — it would pass just as happily against a
    // `withMode` that silently no-ops and reads one shared global (the exact failure this whole
    // suite exists to catch). This is the guard the brief calls "not optional."
    expect(FAST.drive.baseMaxSpeed).not.toBe(SLOW.drive.baseMaxSpeed);
    expect(FAST.derived.chassisDrive[CAR_ID].maxSpeed).not.toBe(
      SLOW.derived.chassisDrive[CAR_ID].maxSpeed,
    );
    expect(FAST.derived.chassisDrive[CAR_ID].engineAccel).not.toBe(
      SLOW.derived.chassisDrive[CAR_ID].engineAccel,
    );
  });

  it("gives each mode the same result interleaved as it does alone", () => {
    const aloneSlow = run(SLOW, TICKS);
    const aloneFast = run(FAST, TICKS);

    // Step 1: the two alone-runs must differ, or nothing below proves isolation was ever exercised.
    expect(aloneFast).not.toEqual(aloneSlow);
    expect(aloneFast.x).not.toBeCloseTo(aloneSlow.x, 6);

    // Step 2: interleave one tick at a time — one tick of SLOW, one tick of FAST, alternating — the
    // way an arena room and a practice room actually tick against one Colyseus process. Each
    // `withMode` call installs its bundle for exactly one synchronous `stepSim` call and restores
    // whatever was there before, so a leak here means FAST's bundle (or nothing) is what SLOW's
    // `stepSim` call actually read, or vice versa.
    let slow = freshBody();
    let fast = freshBody();
    for (let i = 0; i < TICKS; i += 1) {
      slow = withMode(SLOW, () => stepSim(slow, THROTTLE_INPUT, DT, CONTEXT));
      fast = withMode(FAST, () => stepSim(fast, THROTTLE_INPUT, DT, CONTEXT));
    }

    expect(slow).toEqual(aloneSlow);
    expect(fast).toEqual(aloneFast);
  });
});
