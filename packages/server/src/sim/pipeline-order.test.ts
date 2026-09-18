import { describe, expect, it } from "vitest";
import {
  ArenaState,
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
 * time a ram's `Impulse` lands, the attacker's velocity has ALREADY been resolved once by
 * `resolveWorld`'s contact pass. The two effects compose (resolve the contact, then recoil on top),
 * and every existing test measures only one of them in isolation.
 *
 * **Stage 2 (walls-and-bumps, `DRIVE_CONFIG.restitution` 0.15 -> 0) changed what "resolved once"
 * means, and this file is what had to change with it.** This test used to pin a REFLECTION — the
 * attacker's dead-on velocity flipped sign and shrank to `-(topSpeed * 0.15)` before the ram's own
 * impulse landed on top. At `restitution: 0`, `applyContact`'s `v' = v - (1 + e)(v·n)n` removes the
 * into-surface component and adds nothing back: a dead-on hit, where the WHOLE velocity is
 * into-surface, leaves the attacker at an exact 0 — stopped, not bounced, not merely damped. That is
 * gone-not-smaller, per the stage brief: there is no rebound left for the ram's own contest impulse
 * to land on top of, only rest. The composition this test exists to pin is now "the contact pass
 * zeroes the dead-on component; the ram contest's own (independently tiny) impulse is then the
 * ENTIRE reason the attacker ends the tick moving backwards at all" — worth pinning in its own right,
 * because a regression that made the contact pass merely damp (instead of fully absorb) the dead-on
 * component would silently reintroduce a residual reflection for the contest impulse to stack onto,
 * exactly the bug this file was written to catch in the first place.
 *
 * This is the gap the stage-2 whole-stage review found: the recoil numbers written into
 * `RAM_CONFIG.knockMaxSpeed`'s and the hard slam's own doc comments were computed by
 * adding the recoil straight onto the PRE-collision speed, which is what `ram-bridge.test.ts` alone
 * would lead you to believe happens. (The slam half of that sentence was written against
 * `SLAM_CONFIG.knockSpeed`. Stage 4 dissolved `SLAM_CONFIG` down to `wallContactPad`, so the comment
 * carrying that measurement now lives on `WEAPON_TABLE.wildcharge.impulse.speed` — same number, same
 * caveat, new home.) It is not what ships: `runPipeline`'s own comment at
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
  it("charges the attacker with its own contest impulse against a contact pass that already zeroed it, not the pre-collision speed", () => {
    const state = arena();
    // Bastion rear-ends a stationary Bullseye at Bastion's own top speed, dead straight along +x —
    // both cars facing +x, attacker behind, so this is a REAR hit for the victim (RAM_CONFIG.bonusRear)
    // and a FRONT hit for the attacker too (RAM_CONFIG.bonusFront) — the attacker's own face is
    // computed from its own geometry (spec R6), and it genuinely is nose-first here, not an assumed
    // constant. Stage 3 Task 2 replaced the severity grade this test used to saturate with the ram
    // contest — the attacker's own impulse is now hand-derived from that contest below rather than
    // read off a single saturated constant.
    const topSpeed = forwardMaxSpeedOf("bastion");
    // Positioned edge-to-edge (0 clearance) so this tick's drive translation drives the hulls into a
    // real overlap — `resolveWorld`'s contact pass is a velocity-space correction, not
    // depth-dependent, so the exact clearance does not matter (see the sub-tick-phase sweep in the
    // review), but it must be small enough that this ONE tick both overlaps AND rams; 0 clearance
    // guarantees both.
    const attacker = addPlayer(state, "a", { x: 952, y: 400, angle: 0, carId: "bastion", vx: topSpeed, vy: 0 });
    addPlayer(state, "b", { x: 1000, y: 400, angle: 0, carId: "bullseye" });

    const queues = new Map([
      ["a", [{ seq: 1, steer: 0, throttle: 1, fireSlots: 0 }]],
      ["b", [{ seq: 1, steer: 0, throttle: 0, fireSlots: 0 }]],
    ]);

    // Step 1: the REAL `serverTick` — drive, then `resolveWorld`'s contact pass.
    const { approachVelocities } = serverTick(state, queues, 1 / 30, RoomPhase.MATCH, NO_EFFECTS, new Map(), new Map());

    const afterResolveWorld = attacker.vx;
    // At `DRIVE_CONFIG.restitution` 0, `applyContact`'s `v' = v - (1 + e)(v·n)n` removes exactly the
    // into-surface component and adds nothing back. This hit is dead-on, so the WHOLE pre-collision
    // velocity is into-surface: the contact pass leaves the attacker at an exact stop, not a
    // reflection and not a partial damping. (Stage 1 pinned `restitution` at 0; this is stage 2's own
    // proof that a dead-on contact really does zero out rather than merely shrink.)
    expect(afterResolveWorld).toBeCloseTo(0, 6);

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
    // The composed result: the contest's own (independently computed) attackerImpulse charged ON TOP
    // of the contact pass's already-zeroed velocity from step 1 — not on top of the pre-collision
    // `topSpeed`. Because `approachVelocities` still carries the pre-collision speed, `attackerImpact`
    // itself is unaffected by the zeroing; only what it lands on top of changed.
    const expected = afterResolveWorld - attackerImpact;
    expect(attacker.vx).toBeCloseTo(expected, 6);
    // Sanity floor, re-pitched for zero restitution: the attacker ends the tick moving BACKWARDS by
    // some nonzero amount, but that amount is now ENTIRELY the contest's own impulse — there is no
    // leftover reflection for it to stack onto. If this regresses to `>= 0`, the contest stopped
    // charging the attacker anything; if it regresses to a large negative (on the order of `-topSpeed`
    // rather than a few u/s), the contact pass stopped fully absorbing the dead-on hit and a residual
    // reflection crept back in underneath the contest impulse.
    expect(attacker.vx).toBeLessThan(0);
    expect(attacker.vx).toBeGreaterThan(-topSpeed * 0.1);
  });
});
