import { describe, expect, it } from "vitest";
import {
  ArenaState,
  DRIVE_CONFIG,
  PlayerState,
  PlayerStatus,
  RAM_CONFIG,
  RoomPhase,
  forwardMaxSpeedOf,
  ramAttackOf,
  ramDefenceOf,
  type Modifiers,
  type WeaponId,
} from "@motor-combat-moba/shared";
import { serverTick } from "./tick.js";
import { contactTick, newContactMemory } from "./ram-bridge.js";

/**
 * The one thing NOTHING in the suite covered before this fix: `serverTick` and `contactTick` driven
 * in the REAL order for a ram, on the SAME tick.
 *
 * `ram-bridge.test.ts` calls `contactTick` alone, feeding it a hand-built `approachVelocities` map that
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
 * retune is checked against what the attacker actually ends up doing, not against a number that
 * skips a step.
 *
 * **Stage 3 Task 4 measured `RAM_CONFIG.globalScale` and `spinScale` through exactly this sequence**
 * (spec R5/P25b), sweeping the sub-tick phase, and both constants' doc comments carry the resulting
 * tables. Re-measure here, never through `contactTick` alone, if either is retuned — measuring in
 * isolation is precisely the mistake that shipped revision 1's 5x error.
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

describe("the real serverTick -> contactTick order (stage 2 whole-stage review, Fix 2)", () => {
  it("charges the attacker with restitution AND its own contest impulse, not the reflection alone", () => {
    const state = arena();
    // Bastion rear-ends a stationary Bullseye at Bastion's own top speed, dead straight along +x —
    // both cars facing +x, attacker behind, so this is a REAR hit for the victim (RAM_CONFIG.bonusRear)
    // and a "front" hit for the attacker (RAM_CONFIG.bonusFront, fixed regardless of geometry, spec
    // R6). Stage 3 Task 2 replaced the severity grade this test used to saturate with the ram
    // contest — the attacker's own impulse is now hand-derived from that contest below rather than
    // read off a single saturated constant.
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
    const { approachVelocities } = serverTick(state, queues, 1 / 30, RoomPhase.MATCH, NO_EFFECTS, new Map());

    const afterResolveWorld = attacker.vx;
    // The reflection alone: `resolveWorld` reflects the WHOLE pre-collision velocity by
    // `DRIVE_CONFIG.restitution`, dead-on here so it is a pure sign flip and scale.
    expect(afterResolveWorld).toBeCloseTo(-(topSpeed * DRIVE_CONFIG.restitution), 6);
    // And it must have actually reflected, not merely slowed — this is the fact the old
    // ram-bridge-only test could never see, because it never ran `serverTick` at all.
    expect(afterResolveWorld).toBeLessThan(0);

    // Step 2: the REAL `contactTick`, fed the carried-in (pre-collision) approach VELOCITY exactly as
    // `runPipeline` feeds it — this is the trigger fix `TickResult.approachVelocities` exists for.
    contactTick(
      state,
      new Set(["a", "b"]),
      newContactMemory(),
      "ffa",
      NO_EFFECTS,
      approachVelocities,
      NO_MANEUVER_WEAPONS,
      10,
    );

    // Hand-derived from the contest formula in `sim/ram.ts` (`pushOf`/`impactOn`), not pasted, so a
    // retune of `ramAttack`/`ramDefence`/`defencePushScale`/`globalScale`/`bonusFront` moves this
    // expectation with it. The victim (bullseye) brings 0 drive-in (it never moved), so its own
    // `ramAttack` never enters either push term.
    const attack = ramAttackOf("bastion");
    const defence = ramDefenceOf("bastion");
    const victimPush = ramDefenceOf("bullseye") * RAM_CONFIG.defencePushScale;
    const attackerPush = attack * topSpeed + defence * RAM_CONFIG.defencePushScale;
    const attackerImpact =
      (victimPush * (victimPush / (attackerPush + victimPush)) * RAM_CONFIG.bonusFront * RAM_CONFIG.globalScale) /
      defence;
    // The composed result: the reflection from step 1, with the contest's own (independently
    // computed) attackerImpulse charged ON TOP of it — not on top of the pre-collision `topSpeed`.
    const expected = afterResolveWorld - attackerImpact;
    expect(attacker.vx).toBeCloseTo(expected, 6);
    // Sanity floor: the attacker ends up travelling BACKWARDS, not merely slowed — driven almost
    // entirely by the reflection now that the attacker's own contest impulse
    // (`attackerImpact`, tiny here: the victim brings almost no push of its own) barely moves it
    // further. If this regresses to `> 0`, either the pipeline order broke or someone changed
    // `contactTick` to charge the attacker's impulse against the pre-collision speed again.
    expect(attacker.vx).toBeLessThan(0);
  });
});
