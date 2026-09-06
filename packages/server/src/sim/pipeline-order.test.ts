import { describe, expect, it } from "vitest";
import {
  ArenaState,
  DRIVE_CONFIG,
  PlayerState,
  PlayerStatus,
  RAM_CONFIG,
  RAM_REFERENCE_MASS,
  RoomPhase,
  forwardMaxSpeedOf,
  massOf,
  type Modifiers,
  type WeaponId,
} from "@motor-combat-moba/shared";
import { serverTick } from "./tick.js";
import { contactTick, newContactMemory } from "./ram-bridge.js";

/**
 * The one thing NOTHING in the suite covered before this fix: `serverTick` and `contactTick` driven
 * in the REAL order for a ram, on the SAME tick.
 *
 * `ram-bridge.test.ts` calls `contactTick` alone, feeding it a hand-built `approachSpeeds` map that
 * equals `player.vx/vy` because nothing ever moved the player first. `tick.test.ts` calls `serverTick`
 * alone and never looks at a ram. Neither exercises the fact that `tick-pipeline.ts`'s `runPipeline`
 * runs `serverTick` (drive + `resolveWorld`) BEFORE `contactTick` on the very same tick — so by the
 * time a ram's `Impulse` lands, the attacker's velocity has ALREADY been reflected once by
 * `DRIVE_CONFIG.restitution` inside `resolveWorld`. The two effects compose (reflect, then recoil on
 * top), and every existing test measures only one of them in isolation.
 *
 * This is the gap the stage-2 whole-stage review found: the recoil numbers written into
 * `RAM_CONFIG.knockMaxSpeed`'s and `SLAM_CONFIG.knockSpeed`'s own doc comments were computed by
 * adding the recoil straight onto the PRE-collision speed, which is what `ram-bridge.test.ts` alone
 * would lead you to believe happens. It is not what ships: `runPipeline`'s own comment at
 * `tick-pipeline.ts:110` says the order is the rule. This test pins the REAL composed number, so a
 * future retune of `knockMaxSpeed` (stage 3's re-pitch) is checked against what the attacker actually
 * ends up doing, not against a number that skips a step.
 *
 * Placed beside `tick.test.ts` and `ram-bridge.test.ts` — the two "half" tests this fixes the gap
 * between — rather than inventing a `rooms/tick-pipeline.test.ts`: nothing already exercises
 * `runPipeline` itself (it is only driven indirectly through full `ArenaRoom`/`PlaygroundRoom`/
 * `PracticeRoom` tests), and pinning the order needs only `serverTick` + `contactTick`, not the
 * combat half `runPipeline` also drives.
 */

const NO_EFFECTS = new Map<string, Modifiers>();
const NO_MANEUVER_WEAPONS = new Map<string, WeaponId | "">();

function arena(): ArenaState {
  const state = new ArenaState();
  state.arenaId = "arena-01";
  state.phase = RoomPhase.MATCH;
  return state;
}

function addPlayer(state: ArenaState, id: string, over: Partial<PlayerState> = {}): PlayerState {
  const p = new PlayerState();
  p.sessionId = id;
  p.carId = "mirage";
  p.status = PlayerStatus.IN_MATCH;
  p.alive = true;
  Object.assign(p, over);
  state.players.set(id, p);
  return p;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

describe("the real serverTick -> contactTick order (stage 2 whole-stage review, Fix 2)", () => {
  it("charges the attacker with restitution AND ram recoil, not recoil alone", () => {
    const state = arena();
    // Bastion (mass 900) rear-ends a stationary Bullseye at Bastion's own top speed, dead straight
    // along +x — both cars facing +x, attacker behind, so this is a REAR hit (RAM_CONFIG.bonusRear),
    // and Bastion's mass alone saturates severity to 1 at this approach speed (confirmed by direct
    // measurement sweeping 40 sub-tick phases: identical result on every one). That saturation is
    // what lets this test derive its expected value from config constants without re-deriving
    // `resolveRam`'s severity formula: `RAM_CONFIG.knockMaxSpeed` is applied at full strength.
    const topSpeed = forwardMaxSpeedOf("bastion");
    // Positioned edge-to-edge (0 clearance) so this tick's drive translation drives the hulls into a
    // real overlap — `resolveWorld`'s bounce is a velocity-space reflection, not depth-dependent, so
    // the exact clearance does not matter (see the sub-tick-phase sweep in the review), but it must
    // be small enough that this ONE tick both overlaps AND rams; 0 clearance guarantees both.
    const attacker = addPlayer(state, "a", { x: 952, y: 400, angle: 0, carId: "bastion", vx: topSpeed, vy: 0 });
    addPlayer(state, "b", { x: 1000, y: 400, angle: 0, carId: "bullseye" });

    const queues = new Map([
      ["a", [{ seq: 1, steer: 0, throttle: 1, fireSlots: 0 }]],
      ["b", [{ seq: 1, steer: 0, throttle: 0, fireSlots: 0 }]],
    ]);

    // Step 1: the REAL `serverTick` — drive, then `resolveWorld`'s restitution reflection.
    const { approachSpeeds } = serverTick(state, queues, 1 / 30, RoomPhase.MATCH, NO_EFFECTS, new Map());

    const afterResolveWorld = attacker.vx;
    // The reflection alone: `resolveWorld` reflects the WHOLE pre-collision velocity by
    // `DRIVE_CONFIG.restitution`, dead-on here so it is a pure sign flip and scale.
    expect(afterResolveWorld).toBeCloseTo(-(topSpeed * DRIVE_CONFIG.restitution), 6);
    // And it must have actually reflected, not merely slowed — this is the fact the old
    // ram-bridge-only test could never see, because it never ran `serverTick` at all.
    expect(afterResolveWorld).toBeLessThan(0);

    // Step 2: the REAL `contactTick`, fed the carried-in (pre-collision) approach speed exactly as
    // `runPipeline` feeds it — this is the trigger fix `TickResult.approachSpeeds` exists for.
    contactTick(
      state,
      new Set(["a", "b"]),
      newContactMemory(),
      "ffa",
      NO_EFFECTS,
      approachSpeeds,
      NO_MANEUVER_WEAPONS,
      10,
    );

    const massFactor = clamp(
      RAM_REFERENCE_MASS / massOf("bastion"),
      RAM_CONFIG.massFactorMin,
      RAM_CONFIG.massFactorMax,
    );
    // The composed result: the reflection from step 1, with the ram's equal-and-opposite reaction
    // charged ON TOP of it — not on top of the pre-collision `topSpeed`. This is the number Fix 1's
    // doc comments now record, and the number stage 3's re-pitch of `knockMaxSpeed` must be checked
    // against.
    const expected = afterResolveWorld - RAM_CONFIG.knockMaxSpeed * massFactor;
    expect(attacker.vx).toBeCloseTo(expected, 6);
    // Sanity floor: the attacker ends up travelling BACKWARDS, not merely slowed — the whole finding
    // this fix exists to keep visible. If this regresses to `> 0`, either the pipeline order broke or
    // someone changed `contactTick` to charge the recoil against the pre-collision speed again.
    expect(attacker.vx).toBeLessThan(0);
  });
});
