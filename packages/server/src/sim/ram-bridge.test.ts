import { describe, expect, it } from "vitest";
import {
  ArenaState,
  ManeuverKind,
  NEUTRAL_MODIFIERS,
  PlayerState,
  PlayerStatus,
  RAM_CONFIG,
  RAM_TICKS,
  WEAPON_TABLE,
  WEAPON_TICKS,
  applyStatus,
  forwardMaxSpeedOf,
  forwardOf,
  ramAttackOf,
  ramDefenceOf,
  type Modifiers,
  type WeaponId,
} from "@motor-combat-moba/shared";
import {
  clearKnock,
  newContactMemory,
  newFalloffStack,
  nextFalloff,
  sweepFalloff,
  contactTick,
} from "./ram-bridge.js";
import { readStatuses, writeStatuses } from "./status-bridge.js";

/**
 * No buffs or debuffs in play. Every expectation in this file is the unbuffed sim, and a
 * `NEUTRAL_MODIFIERS` lookup is what an empty map yields through `modifiersFor`.
 */
const NO_EFFECTS = new Map<string, Modifiers>();

/** No running maneuver for anyone — the neutral value for `contactTick`'s `maneuverWeapons` map. */
const NO_MANEUVER_WEAPONS = new Map<string, WeaponId | "">();

/**
 * The hard slam's numbers, read from the weapon row that owns them rather than typed in. Every slam
 * expectation below goes through these two: stage 4 moved slam tuning onto `wildcharge`'s own
 * `ImpulseDef`, so a retune there must move these tests rather than leave them asserting a literal
 * the game no longer uses. `WEAPON_TICKS`'s `impulse` is optional by design (absent means absent),
 * hence the one non-null assertion.
 */
const SLAM_IMPULSE = WEAPON_TABLE.wildcharge.impulse;
const SLAM_IMPULSE_TICKS = WEAPON_TICKS.wildcharge.impulse!;

/** "a" charges "b" from the left: the fixture every slam test below shares. */
const CHARGING_WILDCHARGE = new Map<string, WeaponId | "">([["a", "wildcharge"]]);

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

function arena(): ArenaState {
  const state = new ArenaState();
  state.arenaId = "arena-01";
  return state;
}

/**
 * The approach velocities `serverTick` would have reported for this state: each car's whole world
 * velocity as it entered the tick. These tests set `vx`/`vy` on `PlayerState` directly and never run
 * `serverTick`, so the two are the same numbers here — which is the point. `contactTick` requires
 * the map because in the live tick collision resolution has already reflected `player.vx`/`vy` by
 * the time contact runs.
 *
 * Copies each pair rather than handing back the live `PlayerState`. That matters more than it looks:
 * `contactTick` WRITES `player.vx`/`vy` as it applies impulses, so aliasing here would let a victim's
 * post-impulse velocity leak back into a later `contactTick` call's drive-in term — and several tests
 * below deliberately reuse one map across two calls (`approach` in the wall-stun case).
 */
function approachVelocities(state: ArenaState): Map<string, { vx: number; vy: number }> {
  const out = new Map<string, { vx: number; vy: number }>();
  state.players.forEach((p, id) => out.set(id, { vx: p.vx, vy: p.vy }));
  return out;
}

describe("contactTick (ordinary ram, unchanged behaviour)", () => {
  it("knocks a victim that was just rammed", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    // The impulse is added straight into the victim's velocity (Task 4 — see `contactTick`'s own
    // comment on `Impulse` application). The victim starts at rest and is rammed along +x by an
    // attacker approaching from -x, so the shove has a known sign, not merely a nonzero magnitude.
    expect(victim.vx).toBeGreaterThan(0);
  });

  it("charges the attacker by the contest's own independently-computed attackerImpulse", () => {
    // Renamed from "recoils the attacker via Newton's third law" (stage 3 Task 2): the contest
    // computes both outcomes independently (spec R7) rather than negating the victim's own impulse
    // back onto the attacker — `reactionOf` was dead code on this path as of stage 3 Task 2, and
    // stage 3 Task 3 deleted it outright, replacing it with each car's own independently computed
    // `attackerImpulse` from the contest — so the attacker's cost is no longer symmetric with what
    // the victim took.
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    // Both cars are the default "mirage" chassis, dead-straight along +x, victim stationary — a REAR
    // hit (the attacker approaches from behind the victim's own heading). Hand-derived from the
    // contest formula in `sim/ram.ts` (`pushOf`/`impactOn`), not pasted, so a retune of
    // `ramAttack`/`ramDefence`/`defencePushScale`/`globalScale`/`bonusFront` moves this expectation
    // with it:
    const attack = ramAttackOf("mirage");
    const defence = ramDefenceOf("mirage");
    const attackerPush = attack * 540 + defence * RAM_CONFIG.defencePushScale; // victim brings 0 drive-in
    const victimPush = defence * RAM_CONFIG.defencePushScale; // the victim's own drive-in is 0
    // The attacker's own presented face is computed the same way the victim's is (spec R6 — the
    // bonus applies to each car's OWN struck face, not only the victim's): both cars are dead-straight
    // along +x here, so the attacker is genuinely nose-first into the contact and `bonusFront` is what
    // its own geometry produces, not an assumption. Its impulse is
    // `defenceScaled: false` (the contest already divided by its OWN ramDefence) — no separate defence
    // factor to apply on top.
    const attackerImpact =
      (victimPush * (victimPush / (attackerPush + victimPush)) * RAM_CONFIG.bonusFront * RAM_CONFIG.globalScale) /
      defence;
    expect(attacker.vx).toBeCloseTo(540 - attackerImpact, 6);
    // The geometry is dead-straight along +x: nothing should give the push a lateral component.
    expect(attacker.vy).toBe(0);
    // A dead-on hit puts the recovered contact point and the push direction on the same line, so the
    // torque `applyImpulse` derives from them is genuinely zero even though `resolveRam` authors
    // `spin: 1` on both impulses.
    expect(attacker.angVel).toBe(0);
  });

  it("never changes hp", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540, hp: 400 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0, hp: 400 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    expect(victim.hp).toBe(400);
  });

  it("fires once per contact episode, not once per tick", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    const memory = newContactMemory();
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    const afterFirst = victim.vx;
    expect(afterFirst).not.toBe(0);
    // Reset to a sentinel so a second (undesired) knock on the still-touching pair would be visible.
    victim.vx = 0;
    victim.vy = 0;
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 11,
    );
    // Edge-triggered: the pair is still touching on tick 11, so no fresh knock fires.
    expect(victim.vx).toBe(0);
    expect(victim.vy).toBe(0);
  });

  it("ignores players who are not in the roster", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const bystander = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a"]), newContactMemory(), "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    expect(bystander.vx).toBe(0);
    expect(bystander.vy).toBe(0);
  });

  it("ignores players who are not on the field", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const lobbying = addPlayer(state, "b", { x: 47, y: 400, angle: 0, status: PlayerStatus.READY });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    expect(lobbying.vx).toBe(0);
    expect(lobbying.vy).toBe(0);
  });

  it("ignores wrecks", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const wreck = addPlayer(state, "b", { x: 47, y: 400, angle: 0, alive: false });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    expect(wreck.vx).toBe(0);
    expect(wreck.vy).toBe(0);
  });

  it("spares teammates in team mode", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540, team: 0 });
    const mate = addPlayer(state, "b", { x: 47, y: 400, angle: 0, team: 0 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "team", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    expect(mate.vx).toBe(0);
    expect(mate.vy).toBe(0);
  });

  // `authority` and its "no rescue" precedence rule (a weaker knock could never overwrite a
  // stronger standing one) are gone entirely — there never was, and still is not, an authority
  // field on `Impulse` (see `contactTick`'s own comment on `Impulse` application). Stage 3b
  // reinstated control loss as the `reeling` status, but it did NOT reinstate precedence:
  // `applyImpulse` still adds every impulse straight into the victim's velocity — two rams landing
  // on the same victim across different ticks stack rather than one being discarded, and there is
  // no "standing knock" to protect. What limits a chained ram now is the per-victim falloff stack,
  // not a precedence rule. These two tests used to prove no-rescue; they now prove the additive
  // replacement, which stayed unchanged for the victim's own half of the exchange (only the
  // attacker's side gained a reaction).
  it("stacks a later ram's knock onto a victim's still-decaying velocity from an earlier one", () => {
    const state = arena();
    addPlayer(state, "strong", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    const memory = newContactMemory();
    contactTick(
      state, new Set(["strong", "b"]), memory, "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    const afterFirstRam = victim.vx;
    expect(afterFirstRam).not.toBe(0);
    expect(victim.vy).toBe(0);

    // A second attacker rams the victim from a DIFFERENT axis (approaching along y, the same
    // touching margin the dash test above uses: 31 = 16+16-1) on a later tick, so its knock is
    // geometrically independent of the first one and there is no directional ambiguity about which
    // car is the attacker. Its knock is simply added on top of whatever the victim still carries.
    addPlayer(state, "second", { x: 47, y: 431, angle: -Math.PI / 2, vy: -(RAM_CONFIG.minApproachSpeed + 200) });
    contactTick(
      state, new Set(["strong", "b", "second"]), memory, "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 11,
    );

    // The first knock's x component survives untouched, and the second knock adds a fresh y
    // component on top of it — neither is discarded in favour of the other. `toBeCloseTo` rather
    // than `toBe`: the second attacker's shove is nominally along y alone, but its x contribution is
    // only float-zero (`Math.cos(-Math.PI / 2)` is ~6e-17, not exactly 0), so exact equality would
    // fail for the wrong reason on any geometry change that perturbs that residual.
    expect(victim.vx).toBeCloseTo(afterFirstRam);
    // The knock's SIGN is purely geometric (`resolveRam` authors `dirX`/`dirY` as the unit normal
    // pointing away from the attacker, and `impactOn` can never return a negative magnitude),
    // so a directional assertion is exact, not an approximation. "second" sits at y=431 approaching
    // along -y toward the victim at y=400, so `away.y < 0` and the knock must push the victim's vy
    // negative.
    expect(victim.vy).toBeLessThan(0);
  });

  it("adds a second ram's knock on top rather than replacing the standing one (no precedence)", () => {
    const state = arena();
    addPlayer(state, "medium", { x: 0, y: 400, angle: 0, vx: 150 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    const memory = newContactMemory();
    contactTick(
      state, new Set(["medium", "b"]), memory, "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    const afterMediumRam = victim.vx;
    expect(afterMediumRam).toBeGreaterThan(0);

    // A heavier attacker (bastion) rams the same victim from a different axis, at its own top speed,
    // on a later tick. Under the old `authority`-based precedence a stronger ram could overwrite a
    // standing one; that mechanism is gone (temporary shim, stage 1), so this just adds a fresh
    // knock component rather than overwriting or being blocked.
    addPlayer(state, "hexy", { x: 47, y: 431, angle: -Math.PI / 2, vy: -320, carId: "bastion" });
    contactTick(
      state, new Set(["medium", "b", "hexy"]), memory, "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 11,
    );

    // Same float-zero caveat as the test above: the second attacker's shove is nominally along y
    // alone, but its x contribution is only float-zero, not exactly 0.
    expect(victim.vx).toBeCloseTo(afterMediumRam);
    // Same geometric-sign reasoning as the test above: "hexy" sits at y=431 approaching along -y
    // toward the victim at y=400, so `away.y < 0` and the knock must push the victim's vy negative,
    // independent of the attacker's ramDefence or drive-in.
    expect(victim.vy).toBeLessThan(0);
  });
});

describe("contactTick (dash, O12)", () => {
  it("caps a dasher at one ContactHit even when its hull freshly touches two enemies in the same tick", () => {
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 0 });
    attacker.maneuver = ManeuverKind.DASH;
    // "b" touches via the x-axis gap (47 = 24+24-1, the same margin `contactPad` gives every other
    // touching test in this file); "c" touches via the y-axis gap (31 = 16+16-1, the mirror of that
    // margin against the hull's 32-unit height) — two DIFFERENT, both-fresh contacts in one tick,
    // and "b"/"c" are far enough apart (dx 47, dy 31) that they never touch each other.
    addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    addPlayer(state, "c", { x: 0, y: 431, angle: 0 });
    const result = contactTick(
      state,
      new Set(["a", "b", "c"]),
      newContactMemory(),
      "ffa",
      NO_EFFECTS,
      approachVelocities(state),
      new Map<string, WeaponId | "">([["a", "thunderclap"]]),
      10,
    );
    // `resolveContacts` itself reports a dashHit per touching pair (two, here) — `contactTick` is
    // what collapses that to the first one per dasher and drops the rest, per O12.
    expect(result.contactHits).toEqual([{ attackerSessionId: "a", targetSessionId: "b", weaponId: "thunderclap" }]);
    expect(attacker.maneuver).toBe(0); // the dash ended on the one hit it kept
  });

  it("exits a dash hit at the drive cap SCALED by a live topSpeed modifier, not the unmodified cap", () => {
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 0 });
    attacker.maneuver = ManeuverKind.DASH;
    addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    const debuffed = new Map([["a", { ...NEUTRAL_MODIFIERS, topSpeed: 0.6 }]]);
    contactTick(
      state,
      new Set(["a", "b"]),
      newContactMemory(),
      "ffa",
      debuffed,
      approachVelocities(state),
      new Map<string, WeaponId | "">([["a", "thunderclap"]]),
      10,
    );
    const unmodifiedCap = forwardMaxSpeedOf("mirage"); // "a"'s default carId, per addPlayer
    const attackerSpeed = forwardOf(attacker.vx, attacker.vy, attacker.angle);
    expect(attackerSpeed).toBeCloseTo(unmodifiedCap * 0.6, 6);
    expect(attackerSpeed).not.toBeCloseTo(unmodifiedCap, 6);
  });
});

describe("contactTick (hard slam, O2/O3/O18)", () => {
  it("ends a charge on its first slam: fields cleared, self statuses expired, and the attacker keeps its velocity", () => {
    // Renamed from "...the attacker recoils under equal-and-opposite reaction" (stage 3 Task 2): a
    // slam is authored, not contested, so its attacker takes nothing from its own hit. Stage 3
    // expressed that as a zero-magnitude `attackerImpulse` riding the impulses map; stage 4 stopped
    // building one at all and simply never pushes the attacker. `SLAM_CONFIG.selfKeepFactor`'s
    // hand-tuned forward-only restore and the old `reactionOf`-based equal-and-opposite reaction are
    // both gone; the attacker keeps whatever velocity it already had.
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 300 });
    addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    attacker.maneuver = ManeuverKind.CHARGE;
    attacker.maneuverTicksLeft = 200;
    writeStatuses(attacker, applyStatus([], "fortified", 5, 300, "a"));
    const memory = newContactMemory();
    const result = contactTick(
      state,
      new Set(["a", "b"]),
      memory,
      "ffa",
      NO_EFFECTS,
      new Map([["a", 300], ["b", 0]]),
      new Map<string, WeaponId | "">([["a", "wildcharge"]]),
      10,
    );
    // `toMatchObject`, not `toEqual`: a slam's entry is a `SlamEvent`, which rides into
    // `contactHits` carrying the contact geometry as well (structurally still a `ContactHit`, which
    // is all combat reads). The three fields asserted here are the whole of what combat prices.
    expect(result.contactHits).toHaveLength(1);
    expect(result.contactHits[0]).toMatchObject({
      attackerSessionId: "a",
      targetSessionId: "b",
      weaponId: "wildcharge",
    });
    expect(attacker.maneuver).toBe(0);
    expect(readStatuses(attacker)).toHaveLength(0); // fortified expired with the charge (O2)
    expect(forwardOf(attacker.vx, attacker.vy, attacker.angle)).toBeCloseTo(300, 6);
    expect(memory.slammed.get("b")).toBeDefined();
  });

  it("stuns a slammed victim shoved into a wall inside the window, once", () => {
    const state = arena();
    const victim = addPlayer(state, "b", { x: 24, y: 500, angle: 0 });
    const roster = new Set(["b"]);
    const memory = newContactMemory();
    memory.slammed.set("b", {
      bySessionId: "a",
      wallStunUntilTick: 25,
      immuneUntilTick: 28,
      wallStunTicks: SLAM_IMPULSE_TICKS.wallStunDuration,
    });
    const approach = approachVelocities(state);

    const first = contactTick(state, roster, memory, "ffa", NO_EFFECTS, approach, NO_MANEUVER_WEAPONS, 12);
    expect(first.statusRequests).toEqual([
      {
        targetSessionId: "b",
        statusId: "stunned",
        durationTicks: SLAM_IMPULSE_TICKS.wallStunDuration,
        sourceSessionId: "a",
      },
    ]);
    const second = contactTick(state, roster, memory, "ffa", NO_EFFECTS, approach, NO_MANEUVER_WEAPONS, 13);
    expect(second.statusRequests).toHaveLength(0); // one stun per slam
    expect(victim.x).toBe(24);
  });

  it("opens both clocks off the slamming weapon's own ImpulseDef, not a slam-wide constant", () => {
    // The `SLAM_TICKS` half of the dissolve: the wall-stun window, the re-slam immunity and the
    // stun length a landed wall contact would request all come from `WEAPON_TICKS.wildcharge.impulse`
    // now, stamped onto the room's `SlamRecord` at the moment the slam lands.
    //
    // x shifted 0/47 -> 200/247 for the arena-01 octagon (2026-09-11): the pair used to sit at the
    // OLD rectangle's left wall (x=0) with the victim 47 units clear of it, close enough to land the
    // slam but far enough that the wall-stun sweep below would not ALSO fire this same tick — this
    // test is about the clocks' *source*, not the wall-stun sweep, which has its own dedicated test
    // right above. Now that the playable area's left wall sits at x=74, the old victim position (47)
    // is inside the wall band and gets an immediate stun, closing `wallStunUntilTick` at `tick` and
    // failing this assertion. Moving the whole pair inward by the same 200 units keeps the 47-unit
    // spacing the charge contact needs while clearing the new wall by a wide margin.
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 200, y: 400, angle: 0, vx: 300 });
    addPlayer(state, "b", { x: 247, y: 400, angle: 0 });
    attacker.maneuver = ManeuverKind.CHARGE;
    attacker.maneuverTicksLeft = 200;
    const memory = newContactMemory();
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS, approachVelocities(state),
      CHARGING_WILDCHARGE, 10,
    );
    expect(memory.slammed.get("b")).toEqual({
      bySessionId: "a",
      wallStunUntilTick: 10 + SLAM_IMPULSE_TICKS.wallStunWindow,
      immuneUntilTick: 10 + SLAM_IMPULSE_TICKS.retriggerImmunity,
      wallStunTicks: SLAM_IMPULSE_TICKS.wallStunDuration,
    });
  });

  it("pushes the victim at the row's own speed, in the direction the event carried", () => {
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 300 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    attacker.maneuver = ManeuverKind.CHARGE;
    attacker.maneuverTicksLeft = 200;
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachVelocities(state),
      CHARGING_WILDCHARGE, 10,
    );
    // The victim starts at rest, the push is `defenceScaled: false`, and the geometry is dead-on
    // along +x — so its whole post-tick velocity IS the authored magnitude, and it must be the
    // number on the weapon row rather than anything derived from the contest or from falloff.
    expect(victim.vx).toBeCloseTo(SLAM_IMPULSE.speed, 6);
    expect(victim.vy).toBeCloseTo(0, 6);
    // `spin: 0` on the row, and `applyImpulse` treats that as "preserve", so a slam neither adds
    // rotation nor cancels what the victim already had.
    expect(victim.angVel).toBe(0);
  });

  it("punts every chassis identically — the slam opts out of ramDefence", () => {
    // `defenceScaled: false` is the designer's escape hatch (spec principle C / R10), and this is
    // the one place in the game a push deliberately ignores the target's solidity. Bastion carries
    // the roster's highest `ramDefence` and Bullseye's is far lower, so a defence divisor anywhere
    // on this path would separate these two numbers.
    const speedFor = (carId: string): number => {
      const state = arena();
      const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 300 });
      const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0, carId });
      attacker.maneuver = ManeuverKind.CHARGE;
      attacker.maneuverTicksLeft = 200;
      contactTick(
        state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachVelocities(state),
        CHARGING_WILDCHARGE, 10,
      );
      return Math.hypot(victim.vx, victim.vy);
    };
    expect(speedFor("bastion")).toBeCloseTo(SLAM_IMPULSE.speed, 6);
    expect(speedFor("bullseye")).toBeCloseTo(SLAM_IMPULSE.speed, 6);
  });

  it("reels the victim for the weapon's own uncontrol duration, not the ram's", () => {
    // NEW BEHAVIOUR in stage 4. A slam used to impose no control loss at all: `contact.ts` authored
    // `uncontrolTicks: 0` and `SLAM_CONFIG.victimAuthority`, the pre-`Impulse` knob meant to express
    // it, had been inert since the rework's stage 2. The duration is the weapon's, and the assertion
    // pins that it is NOT `RAM_TICKS.uncontrol` — otherwise the ram path leaking onto a slam would
    // read as a pass.
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 300 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    attacker.maneuver = ManeuverKind.CHARGE;
    attacker.maneuverTicksLeft = 200;
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachVelocities(state),
      CHARGING_WILDCHARGE, 10,
    );
    const reeling = readStatuses(victim).find((s) => s.statusId === "reeling");
    expect(reeling).toBeDefined();
    expect(reeling!.endsTick - 10).toBe(SLAM_IMPULSE_TICKS.uncontrol);
    expect(SLAM_IMPULSE_TICKS.uncontrol).not.toBe(RAM_TICKS.uncontrol);
    expect(reeling!.sourceSessionId).toBe("a");
  });

  it("caps a victim at ONE slam push per tick when two chargers land on it, last slam winning", () => {
    // A restoration, not a new rule. Through stage 3 a slam rode `resolveContacts`'s `best` map,
    // which held one entry per victim and resolved a tie with `>=`, so two slams on one victim in
    // one tick silently collapsed to the later of the two. Stage 4 took slams off that map — the
    // whole point, since it is what lets a victim slammed by A and rammed by B take both pushes —
    // and the slam-plus-slam cap had to become explicit or it would have gone with the map.
    // Uncapped, this fixture lands 2x the authored `speed` on one car in a single tick.
    //
    // Geometry: "a" charges into "b" along +x, "c" charges into it along +y. The two chargers are
    // clear of each other (a's hull spans x [-71,-23], c's spans x [-16,16]), so the only two
    // contacts in the tick are the two slams, and the pushes are PERPENDICULAR — which is what makes
    // doubling observable. Uncapped the victim would end at hypot(speed, speed) ≈ 1.41x the row's
    // number; capped it ends at exactly the row's number, along the LAST slam's axis alone.
    const state = arena();
    const first = addPlayer(state, "a", { x: -47, y: 0, angle: 0, vx: 300 });
    const victim = addPlayer(state, "b", { x: 0, y: 0, angle: 0 });
    const second = addPlayer(state, "c", { x: 0, y: -39, angle: Math.PI / 2, vy: 300 });
    for (const charger of [first, second]) {
      charger.maneuver = ManeuverKind.CHARGE;
      charger.maneuverTicksLeft = 200;
    }
    const memory = newContactMemory();
    const result = contactTick(
      state,
      new Set(["a", "b", "c"]),
      memory,
      "ffa",
      NO_EFFECTS,
      approachVelocities(state),
      new Map<string, WeaponId | "">([["a", "wildcharge"], ["c", "wildcharge"]]),
      10,
    );

    // ONE push, at the single authored magnitude — never the sum of two.
    expect(Math.hypot(victim.vx, victim.vy)).toBeCloseTo(SLAM_IMPULSE.speed, 6);
    // …and it is the LAST slam's, reproducing the old `best` map's `>=` tie-break: "c" pushes along
    // +y, "a" along +x, and the +x component is absent entirely.
    expect(victim.vy).toBeCloseTo(SLAM_IMPULSE.speed, 6);
    expect(victim.vx).toBeCloseTo(0, 6);

    // ONE `reeling`, for the def's own duration rather than a doubled one, credited to the slam that
    // actually landed. (`refresh` would keep the longer of two equal durations either way, so the
    // duration alone cannot prove the cap — the velocity above is what does. This pins that the
    // status still lands, once, at the authored length.)
    const reelings = readStatuses(victim).filter((s) => s.statusId === "reeling");
    expect(reelings).toHaveLength(1);
    expect(reelings[0]!.endsTick - 10).toBe(SLAM_IMPULSE_TICKS.uncontrol);
    expect(reelings[0]!.sourceSessionId).toBe("c");

    // Everything that is NOT the push still runs for BOTH slams: both chargers spent their ult and
    // both maneuvers end (O2), and combat is handed both hits to price.
    expect(first.maneuver).toBe(0);
    expect(second.maneuver).toBe(0);
    expect(result.contactHits).toHaveLength(2);
    expect(result.contactHits.map((h) => h.attackerSessionId)).toEqual(["a", "c"]);
    expect(result.contactHits.every((h) => h.targetSessionId === "b" && h.weaponId === "wildcharge")).toBe(true);
    // `memory.slammed` also runs for every slam; last write wins, same as it did under the map.
    expect(memory.slammed.get("b")?.bySessionId).toBe("c");
  });

  it("lets a dasher's own endDash erase the slam that landed on it in the same tick", () => {
    // THE THUNDERCLAP-VS-WILDCHARGE CLASH, and until this test nothing in the repo covered a
    // dash-vs-charge pair at all.
    //
    // `resolvePair`'s doc comment states the pairing outright: classification is per car and dash is
    // checked first for that car, so a dashing car never also charges — but a dash-vs-charger pair
    // produces a dashHit FROM the dasher AND, independently, a slam ON that same dasher. The dasher
    // is therefore both a `dashHits` attacker (which calls `endDash`) and a slam victim (which takes
    // an impulse), on one tick.
    //
    // `endDash` OVERWRITES velocity — it discards whatever the car was carrying and sets a purely
    // forward exit speed — so whichever of the two runs LAST decides what the dasher ends up doing.
    // Through stage 3 the slam's push rode `resolveContacts`'s `best` map and was applied by the
    // impulses loop, ahead of both `endDash` sweeps, so the dash exit won and the slam was erased.
    // Stage 4 moved the slam's assembly into this bridge and must not change that: the ordering is
    // restored deliberately in `contactTick`, and this test is what holds it. If the push ever moves
    // back below `endDash`, `wildcharge` silently gains its full punt against a dashing Mirage —
    // a balance change to the game's headline ult clash, which belongs to a human, not a refactor.
    const state = arena();
    // Mid-arena (arena-01 has no obstacles), so neither hull is near level geometry and the
    // `wallBlockedDashers` sweep stays empty — otherwise `endDash(a, 0)` would fire too and the
    // measurement below would not be about the dash-hit exit.
    const dasher = addPlayer(state, "a", { x: 400, y: 400, angle: 0, vx: 300 });
    dasher.maneuver = ManeuverKind.DASH;
    dasher.maneuverTicksLeft = 200;
    const charger = addPlayer(state, "b", { x: 447, y: 400, angle: Math.PI, vx: -300 });
    charger.maneuver = ManeuverKind.CHARGE;
    charger.maneuverTicksLeft = 200;
    const memory = newContactMemory();
    const result = contactTick(
      state,
      new Set(["a", "b"]),
      memory,
      "ffa",
      NO_EFFECTS,
      approachVelocities(state),
      new Map<string, WeaponId | "">([["a", "thunderclap"], ["b", "wildcharge"]]),
      10,
    );

    // The tick really did contain both events — otherwise the velocity assertion below would be
    // evidence about a fixture that never produced a slam.
    expect(result.contactHits).toHaveLength(2);
    expect(result.contactHits.map((h) => h.weaponId)).toEqual(["thunderclap", "wildcharge"]);
    expect(memory.slammed.get("a")?.bySessionId).toBe("b");

    // The dasher ends at its `endDash` exit velocity and NOTHING else: the drive cap, purely
    // forward along its heading. The slam's push is gone.
    const exitSpeed = forwardMaxSpeedOf("mirage"); // "a"'s default carId, per addPlayer
    expect(dasher.vx).toBeCloseTo(exitSpeed, 6);
    expect(dasher.vy).toBeCloseTo(0, 6);
    // Spelled out as the number the wrong ordering produces, so a regression reads as "the slam
    // survived" rather than "some number moved". The charger faces -x, so its push is -x: surviving,
    // it would leave the dasher travelling BACKWARDS at roughly the slam's own magnitude.
    expect(dasher.vx).not.toBeCloseTo(exitSpeed - SLAM_IMPULSE.speed, 6);
    expect(forwardOf(dasher.vx, dasher.vy, dasher.angle)).toBeGreaterThan(0);

    // The CONTROL LOSS is not erased, only the push: `endDash` writes velocity and the four maneuver
    // fields, and touches no status list. A dasher that drives into a Wild Charge still comes out
    // reeling — it just comes out at its dash exit speed rather than punted.
    const reeling = readStatuses(dasher).find((s) => s.statusId === "reeling");
    expect(reeling).toBeDefined();
    expect(reeling!.endsTick - 10).toBe(SLAM_IMPULSE_TICKS.uncontrol);
    expect(reeling!.sourceSessionId).toBe("b");

    // Both maneuvers ended: the dash on its one hit (O12), the charge on its first slam (O2).
    expect(dasher.maneuver).toBe(0);
    expect(charger.maneuver).toBe(0);
  });
});

describe("contactTick applies reeling to a ram victim, scaled by falloff", () => {
  it("gives a freshly rammed victim the full RAM_TICKS.uncontrol duration", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 10,
    );
    const reeling = readStatuses(victim).find((s) => s.statusId === "reeling");
    expect(reeling).toBeDefined();
    expect(reeling!.endsTick - 10).toBe(RAM_TICKS.uncontrol);
  });

  it("gives a re-rammed victim a shorter reeling duration than the first ram", () => {
    const state = arena();
    const memory = newContactMemory();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 10,
    );
    const first = readStatuses(victim).find((s) => s.statusId === "reeling")!.endsTick - 10;

    // The second ram lands at tick 45: AFTER the first `reeling` has lapsed (it ends at tick 40)
    // but well inside the falloff window (`RAM_TICKS.drWindow` runs to tick 70), which is the
    // window duration falloff is actually observable in. That is not incidental to the setup — a
    // re-ram while the first `reeling` is still running cannot shorten anything, because
    // `applyStatus`'s `refresh` rule takes `Math.max(existing.endsTick, endsTick)` and a scaled
    // duration is by construction the smaller of the two. Falloff still bites on that path, on the
    // impulse (the next test) and on the status the ram AFTER it writes; it simply cannot claw back
    // a window already granted. An earlier version of this test re-rammed at tick 11 and asserted
    // only `second < first`, which the one-tick offset satisfied on its own — it would have passed
    // with falloff switched off entirely.
    //
    // Force a fresh contact episode on the SAME memory (and so the same falloff stack) without
    // re-deriving the geometry a real separate-and-return would need: `resolveContacts` keys the
    // "fresh touch" edge-trigger off `memory.contacts`, so clearing it is the direct way to
    // simulate re-approach.
    memory.contacts = new Set();
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 45,
    );
    const second = readStatuses(victim).find((s) => s.statusId === "reeling")!.endsTick - 45;

    expect(first).toBe(RAM_TICKS.uncontrol);
    // Pin the SCALED duration itself, not merely `second < first`. This is the number
    // `nextFalloff`'s second read owes — one application of `durationDrScale`, floored — so a change
    // to either knob has to be typed here too.
    expect(second).toBe(
      Math.max(RAM_TICKS.durationFloor, Math.round(RAM_TICKS.uncontrol * RAM_CONFIG.durationDrScale)),
    );
    expect(second).toBeLessThan(first);
  });

  it("also shrinks the impulse on a re-ram, not only the duration", () => {
    const state = arena();
    const memory = newContactMemory();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 10,
    );
    const first = Math.abs(victim.vx);

    victim.x = 47; victim.y = 400; victim.vx = 0; victim.vy = 0;
    attacker.vx = 540;
    memory.contacts = new Set();
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 11,
    );
    const second = Math.abs(victim.vx);

    expect(second).toBeLessThan(first);
  });

  // The spec-load-bearing counterpart to the test above, and the reason it is worth a test at all
  // even though it is structurally unreachable today (`nextFalloff`'s `scales` binding is scoped
  // inside the IIFE that builds the VICTIM's `scaledImpulse`; `entry.attackerImpulse` is applied
  // untouched). Falloff exists to stop a victim being ram-locked. If it ever discounted the
  // attacker's own half too, spamming rams into an already-worn-down victim would get progressively
  // SAFER for the aggressor — the exact inverse of what a diminishing-returns mechanic should do to
  // the one throwing the punches. Pinning it here means a future refactor that hoists `scales` out
  // of that IIFE cannot quietly acquire the inversion.
  it("does NOT shrink the attacker's own impulse on a re-ram", () => {
    const state = arena();
    const memory = newContactMemory();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 10,
    );
    const firstAttackerDelta = Math.hypot(attacker.vx - 540, attacker.vy);
    const firstVictimKnock = Math.hypot(victim.vx, victim.vy);

    // Restore the exact opening geometry and both approach velocities, so the ONLY thing that
    // differs between the two rams is the falloff stack `memory` is now carrying.
    attacker.x = 0; attacker.y = 400; attacker.vx = 540; attacker.vy = 0;
    victim.x = 47; victim.y = 400; victim.vx = 0; victim.vy = 0;
    memory.contacts = new Set();
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 11,
    );

    // Falloff DID engage across these two ticks — without this the equality below could pass
    // trivially on a run where the stack never counted the first ram at all.
    expect(Math.hypot(victim.vx, victim.vy)).toBeLessThan(firstVictimKnock);
    expect(Math.hypot(attacker.vx - 540, attacker.vy)).toBeCloseTo(firstAttackerDelta, 9);
  });

  it("does not apply reeling to the attacker", () => {
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 10,
    );
    expect(readStatuses(attacker).find((s) => s.statusId === "reeling")).toBeUndefined();
  });

  it("does not run a slam through the ram falloff stack, and does not count it into one", () => {
    const state = arena();
    const memory = newContactMemory();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 300 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    attacker.maneuver = ManeuverKind.CHARGE;
    attacker.maneuverTicksLeft = 200;
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS,
      new Map([["a", { vx: 300, vy: 0 }], ["b", { vx: 0, vy: 0 }]]),
      CHARGING_WILDCHARGE, 10,
    );
    // Spec P24: weapon impulses "do not participate and do not share the stack". A slam lands at the
    // authored magnitude and the authored duration, and the empty stack is the other half of the
    // rule — a counted slam would silently discount the next REAL ram on this victim.
    expect(Math.hypot(victim.vx, victim.vy)).toBeCloseTo(SLAM_IMPULSE.speed, 6);
    expect(readStatuses(victim).find((s) => s.statusId === "reeling")!.endsTick - 10).toBe(
      SLAM_IMPULSE_TICKS.uncontrol,
    );
    expect(memory.falloff.size).toBe(0);
  });

  it("lands two slams on one victim at identical strength — falloff is ram-only", () => {
    // The consequence of the rule above that a player would actually feel. Two rams in this window
    // would diminish (see the two tests further up); two slams must not, in magnitude OR duration.
    const state = arena();
    const memory = newContactMemory();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 300 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    attacker.maneuver = ManeuverKind.CHARGE;
    attacker.maneuverTicksLeft = 200;
    const approach = new Map([["a", { vx: 300, vy: 0 }], ["b", { vx: 0, vy: 0 }]]);

    contactTick(state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS, approach, CHARGING_WILDCHARGE, 10);
    const firstKnock = Math.hypot(victim.vx, victim.vy);
    const firstReeling = readStatuses(victim).find((s) => s.statusId === "reeling")!.endsTick - 10;

    // Restore the opening geometry and re-arm the charge the first slam ended (O2), then force a
    // fresh contact episode on the SAME memory — and so the same falloff stack — the way the ram
    // falloff tests above do. Tick 11 is well inside `RAM_TICKS.drWindow`, which is the window a
    // second ram WOULD be diminished in.
    victim.x = 47; victim.y = 400; victim.vx = 0; victim.vy = 0;
    attacker.x = 0; attacker.y = 400; attacker.vx = 300; attacker.vy = 0;
    attacker.maneuver = ManeuverKind.CHARGE;
    attacker.maneuverTicksLeft = 200;
    memory.contacts = new Set();
    memory.slammed.delete("b"); // clear the re-slam immunity the first slam opened (O18)
    contactTick(state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS, approach, CHARGING_WILDCHARGE, 11);

    expect(Math.hypot(victim.vx, victim.vy)).toBeCloseTo(firstKnock, 6);
    expect(readStatuses(victim).find((s) => s.statusId === "reeling")!.endsTick - 11).toBe(firstReeling);
    expect(memory.falloff.size).toBe(0);
  });

  it("applies a slam AND a concurrent ram to the same victim, and treats the ram as a ram", () => {
    // The corrected direction of a real bug (stage 4). `resolveContacts` used to keep one impulse
    // per victim, so a car slammed by A and rammed by B in the same tick lost the ram entirely —
    // and `ram-bridge` then inferred "this victim was slammed, so its entry is a slam", which would
    // have MISCLASSIFIED B's ram (applying it undiminished, with no `reeling`) the day a retune let
    // a ram out-scale a slam. A slam no longer enters that map, so both pushes land and the ram is
    // unambiguously a ram.
    //
    // The rammer approaches along +x and the charger along -y, so the two pushes are on different
    // axes and can be told apart in the result. Their own hulls are 47 apart in x and 31 in y, well
    // clear of each other.
    const build = (withRammer: boolean, withCharger: boolean) => {
      const state = arena();
      const victim = addPlayer(state, "victim", { x: 0, y: 400, angle: 0 });
      const roster = new Set(["victim"]);
      if (withRammer) {
        addPlayer(state, "aRam", { x: -47, y: 400, angle: 0, vx: 540 });
        roster.add("aRam");
      }
      if (withCharger) {
        const charger = addPlayer(state, "zCharge", { x: 0, y: 431, angle: -Math.PI / 2, vy: -300 });
        charger.maneuver = ManeuverKind.CHARGE;
        charger.maneuverTicksLeft = 200;
        roster.add("zCharge");
      }
      const memory = newContactMemory();
      contactTick(
        state, roster, memory, "ffa", NO_EFFECTS, approachVelocities(state),
        new Map<string, WeaponId | "">([["zCharge", "wildcharge"]]), 10,
      );
      return { victim, memory };
    };

    const ramOnly = build(true, false).victim;
    const slamOnly = build(false, true).victim;
    const both = build(true, true);

    // `applyImpulse` adds into the velocity, so "took BOTH" is exactly the vector sum of the two
    // pushes measured in isolation — a strictly stronger claim than "moved on both axes".
    expect(both.victim.vx).toBeCloseTo(ramOnly.vx + slamOnly.vx, 6);
    expect(both.victim.vy).toBeCloseTo(ramOnly.vy + slamOnly.vy, 6);
    expect(ramOnly.vx).toBeGreaterThan(0);
    expect(slamOnly.vy).toBeLessThan(0);

    // The ram half was classified as a ram: it was COUNTED into the victim's falloff stack, which is
    // the observable the old `slammedVictims` inference got wrong. (Both pushes grant `reeling` and
    // `refresh` keeps the longer of the two, so the status alone cannot distinguish them — the stack
    // can, and it is empty under the old behaviour.)
    expect(both.memory.falloff.get("victim")?.count).toBe(1);
    expect(readStatuses(both.victim).find((s) => s.statusId === "reeling")).toBeDefined();
  });
});

describe("clearKnock", () => {
  it("restores a knocked player to neutral", () => {
    const p = new PlayerState();
    p.angVel = 3;
    p.vx = 100;
    p.vy = -50;
    clearKnock(p);
    expect(p.angVel).toBe(0);
    expect(p.vx).toBe(0);
    expect(p.vy).toBe(0);
  });

  it("zeroes a running maneuver too, so a fresh match never inherits a dash or charge", () => {
    const p = new PlayerState();
    p.maneuver = 3;
    p.maneuverTicksLeft = 250;
    p.maneuverAngle = 1.2;
    p.maneuverSpeed = 1600;
    clearKnock(p);
    expect(p.maneuver).toBe(0);
    expect(p.maneuverTicksLeft).toBe(0);
    expect(p.maneuverAngle).toBe(0);
    expect(p.maneuverSpeed).toBe(0);
  });
});

const VICTIM = "v1";

describe("ram falloff", () => {
  it("leaves the first ram at full strength", () => {
    const stack = newFalloffStack();
    const out = nextFalloff(stack, VICTIM, 0);
    expect(out.durationScale).toBe(1);
    expect(out.impulseScale).toBe(1);
  });

  it("halves the second ram inside the window", () => {
    const stack = newFalloffStack();
    nextFalloff(stack, VICTIM, 0);
    const out = nextFalloff(stack, VICTIM, 10);
    expect(out.durationScale).toBeCloseTo(RAM_CONFIG.durationDrScale);
    expect(out.impulseScale).toBeCloseTo(RAM_CONFIG.impulseDrScale);
  });

  it("compounds across a chain", () => {
    const stack = newFalloffStack();
    nextFalloff(stack, VICTIM, 0);
    nextFalloff(stack, VICTIM, 5);
    const third = nextFalloff(stack, VICTIM, 10);
    expect(third.impulseScale).toBeCloseTo(RAM_CONFIG.impulseDrScale ** 2);
  });

  it("never falls below the impulse floor", () => {
    const stack = newFalloffStack();
    for (let i = 0; i < 20; i++) nextFalloff(stack, VICTIM, i);
    expect(nextFalloff(stack, VICTIM, 20).impulseScale).toBeCloseTo(RAM_CONFIG.impulseDrFloor);
  });

  it("resets to full strength once the window lapses", () => {
    const stack = newFalloffStack();
    nextFalloff(stack, VICTIM, 0);
    const later = nextFalloff(stack, VICTIM, 10_000);
    expect(later.durationScale).toBe(1);
  });

  it("rolls the window forward from each ram, not from the first", () => {
    const stack = newFalloffStack();
    const window = RAM_TICKS.drWindow; // never recompute from ms and a literal tick rate
    nextFalloff(stack, VICTIM, 0);
    nextFalloff(stack, VICTIM, window - 1);        // just inside
    const third = nextFalloff(stack, VICTIM, window + 1); // past the FIRST window, inside the second
    expect(third.durationScale).toBeLessThan(1);
  });

  it("is per-victim: one car's chain does not protect another", () => {
    const stack = newFalloffStack();
    nextFalloff(stack, VICTIM, 0);
    expect(nextFalloff(stack, "someone-else", 1).durationScale).toBe(1);
  });

  it("is global across attackers: who did the ramming is not recorded at all", () => {
    const stack = newFalloffStack();
    nextFalloff(stack, VICTIM, 0);
    expect(nextFalloff(stack, VICTIM, 1).durationScale).toBeLessThan(1);
  });

  it("sweeps lapsed entries so the map cannot grow unbounded", () => {
    const stack = newFalloffStack();
    nextFalloff(stack, VICTIM, 0);
    sweepFalloff(stack, 10_000);
    expect(stack.size).toBe(0);
  });
});
