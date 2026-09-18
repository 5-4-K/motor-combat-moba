import { describe, expect, it } from "vitest";
import {
  ArenaState,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  forwardMaxSpeedOf,
  hasStatus,
  type Modifiers,
  type WeaponId,
} from "@motor-combat-moba/shared";
import { serverTick } from "./tick.js";
import { contactTick, newContactMemory } from "./ram-bridge.js";
import { readStatuses } from "./status-bridge.js";

/**
 * The one thing NOTHING in the suite covered before this fix: `serverTick` and `contactTick` driven
 * in the REAL order for a ram, on the SAME tick.
 *
 * `ram-bridge.test.ts` calls `contactTick` alone, feeding it a hand-built `approachVelocities` map
 * that equals `player.vx/vy` because nothing ever moved the player first. `tick.test.ts` calls
 * `serverTick` alone and never looks at a ram. Neither exercises the fact that
 * `tick-pipeline.ts`'s `runPipeline` runs `serverTick` (drive + `resolveWorld`) BEFORE `contactTick`
 * on the very same tick — so by the time a ram resolves, the attacker's velocity has ALREADY been
 * reflected once by `resolveWorld`'s contact pass, and the drive-in the ram rule reads has to come
 * from somewhere else.
 *
 * **This file asserts the ORDER, and deliberately pins no ram magnitudes.** It used to hand-derive
 * the attacker's own recoil from the ram contest's formula and pin the composed number to six
 * decimals, and its header declared itself the sequence `RAM_CONFIG.globalScale` and `spinScale`
 * were measured through. Both of those went with the contest: the Unity port's stage 3 replaced it
 * with a rule — the attacker STOPS, whatever it was carrying — so there is no composed recoil number
 * left to derive, and re-measuring the two constants against the new model is stage 5's, not this
 * file's. What survives is the ordering claim, which was always the reason the file exists.
 *
 * **The assertion that carries it is a NEGATIVE CONTROL, not a threshold.** Running the same tick
 * twice — once handing `contactTick` the carried-in velocities `serverTick` returned, once handing
 * it the velocities the bodies are left holding afterwards — produces a ram in the first case and
 * NO ram at all in the second, because `resolveWorld` has already zeroed the attacker's dead-on
 * velocity and a stopped car is below `RAM_CONFIG.minRamSpeed`. That is the real trigger bug this
 * file was written about (it shipped, and it cost 80-90% of all rams), stated as a claim that can
 * only be satisfied by threading the right map — never by a number that happens to be nonzero.
 *
 * Placed beside `tick.test.ts` and `ram-bridge.test.ts` — the two "half" tests this fixes the gap
 * between — rather than inventing a `rooms/tick-pipeline.test.ts`: nothing already exercises
 * `runPipeline` itself (it is only driven indirectly through full `ArenaRoom`/`PlaygroundRoom`/
 * `PracticeRoom` tests), and pinning the order needs only `serverTick` + `contactTick`, not the
 * combat half `runPipeline` also drives. Combat's place in the order (last, reading the
 * `ContactHit`s and `StatusRequest`s contact produced) is covered by `combat-bridge`'s own tests.
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

/** Whatever the bodies are holding right now — the WRONG map to hand `contactTick`, by construction. */
function currentVelocities(state: ArenaState): Map<string, { vx: number; vy: number }> {
  const out = new Map<string, { vx: number; vy: number }>();
  state.players.forEach((p, id) => out.set(id, { vx: p.vx, vy: p.vy }));
  return out;
}

/**
 * One whole tick in the pipeline's real order: drive and `resolveWorld` through `serverTick`, then
 * `contactTick`. `driveIn` chooses which velocity map the ram rule is allowed to read.
 *
 * Bastion rear-ends a stationary Bullseye at Bastion's own top speed, dead straight along +x — both
 * cars facing +x, attacker behind, so the victim is struck on the REAR with the two headings
 * agreeing, and the attacker meets it nose-first.
 */
function runTick(driveIn: "carried-in" | "post-resolution") {
  const state = arena();
  const topSpeed = forwardMaxSpeedOf("bastion");
  // Close enough that this ONE tick's drive translation both overlaps the hulls and rams.
  const attacker = addPlayer(state, "a", { x: 952, y: 400, angle: 0, carId: "bastion", vx: topSpeed, vy: 0 });
  const victim = addPlayer(state, "b", { x: 1000, y: 400, angle: 0, carId: "bullseye" });

  const queues = new Map([
    ["a", [{ seq: 1, steer: 0, throttle: 1, fireSlots: 0 }]],
    ["b", [{ seq: 1, steer: 0, throttle: 0, fireSlots: 0 }]],
  ]);

  // Step 1: the REAL `serverTick` — drive, then `resolveWorld`'s contact pass.
  const { approachVelocities } = serverTick(state, queues, 1 / 30, RoomPhase.MATCH, NO_EFFECTS, new Map(), new Map());
  const afterResolveWorld = attacker.vx;

  // Step 2: the REAL `contactTick`, on the same tick.
  contactTick(
    state,
    new Set(["a", "b"]),
    newContactMemory(),
    "ffa",
    NO_EFFECTS,
    driveIn === "carried-in" ? approachVelocities : currentVelocities(state),
    NO_MANEUVER_WEAPONS,
    10,
  );

  return { attacker, victim, afterResolveWorld };
}

describe("the real serverTick -> contactTick order", () => {
  it("resolves the ram from the CARRIED-IN velocity, which the same tick's contact pass has already erased", () => {
    const real = runTick("carried-in");

    // At `DRIVE_CONFIG.restitution` 0, `applyContact`'s `v' = v - (1 + e)(v·n)n` removes exactly the
    // into-surface component and adds nothing back. This hit is dead-on, so the WHOLE pre-collision
    // velocity is into-surface and the contact pass leaves the attacker at an exact stop — not a
    // reflection and not a partial damping. This is the runtime measurement the negative control
    // below depends on: a stopped car is under `RAM_CONFIG.minRamSpeed` and cannot qualify to ram.
    expect(real.afterResolveWorld).toBeCloseTo(0, 6);

    // The ram landed. Three independent witnesses, none of them a magnitude: the victim is reeling,
    // the attacker is locked, and the victim was thrown the way the attacker was pointing.
    expect(hasStatus(readStatuses(real.victim), "reeling", 10)).toBe(true);
    expect(hasStatus(readStatuses(real.attacker), "ramLock", 10)).toBe(true);
    expect(real.victim.vx).toBeGreaterThan(0);

    // THE NEGATIVE CONTROL. Identical tick, identical geometry — the only difference is that the ram
    // rule reads the velocities the bodies were left holding instead of the ones `serverTick`
    // carried out of the pre-collision state. Nothing rams: no reeling, no lock, no shove. If the
    // production thread ever regresses to the post-resolution map, the block above becomes this.
    const wrong = runTick("post-resolution");
    expect(hasStatus(readStatuses(wrong.victim), "reeling", 10)).toBe(false);
    expect(hasStatus(readStatuses(wrong.attacker), "ramLock", 10)).toBe(false);
    expect(wrong.victim.vx).toBe(0);
  });

  it("drives before it measures contact, so the ram is classified against the poses the tick ended at", () => {
    // The other half of the order. `serverTick` translates the attacker along +x before
    // `contactTick` reads a single pose, which is why the ram's region and contact point describe
    // where the cars ENDED the tick rather than where they began it. A contact pass hoisted above
    // driving would classify last tick's geometry.
    const real = runTick("carried-in");
    expect(real.attacker.x).toBeGreaterThan(952);
    // …and the attacker ends the tick stopped, not travelling backwards. Under the deleted contest
    // it ended every dead-on ram moving in reverse — an exit criterion the rework could not meet and
    // the Unity rule closes by construction. Kept as a sign, not a number.
    expect(real.attacker.vx).toBe(0);
    expect(real.attacker.vy).toBe(0);
  });
});
