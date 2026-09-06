import { describe, expect, it } from "vitest";
import {
  ArenaState,
  ManeuverKind,
  NEUTRAL_MODIFIERS,
  PlayerState,
  PlayerStatus,
  RAM_CONFIG,
  SLAM_TICKS,
  applyStatus,
  forwardMaxSpeedOf,
  forwardOf,
  ramAttackOf,
  ramDefenceOf,
  type Modifiers,
  type WeaponId,
} from "@motor-combat-moba/shared";
import { clearKnock, newContactMemory, contactTick } from "./ram-bridge.js";
import { readStatuses, writeStatuses } from "./status-bridge.js";

/**
 * No buffs or debuffs in play. Every expectation in this file is the unbuffed sim, and a
 * `NEUTRAL_MODIFIERS` lookup is what an empty map yields through `modifiersFor`.
 */
const NO_EFFECTS = new Map<string, Modifiers>();

/** No running maneuver for anyone — the neutral value for `contactTick`'s `maneuverWeapons` map. */
const NO_MANEUVER_WEAPONS = new Map<string, WeaponId | "">();

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
  // reinstates control loss as the `reeling` status, at which point precedence-style rules belong
  // there again. Until then, `applyImpulse` just adds every impulse straight into the victim's
  // velocity — two rams landing on the same victim across different ticks stack rather than one
  // being discarded, and there is no "standing knock" to protect. These two tests used to prove
  // no-rescue; they now prove the additive replacement, which Task 4 leaves unchanged for the
  // victim's own half of the exchange (only the attacker's side gained a reaction).
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
    // slam is authored, not contested, so `sim/contact.ts`'s slam branch builds the attacker's half
    // of the contact (`ImpulseEntry.attackerImpulse`) as a deliberate zero-magnitude `Impulse` —
    // applying it changes nothing. `SLAM_CONFIG.selfKeepFactor`'s hand-tuned forward-only restore and
    // the old `reactionOf`-based equal-and-opposite reaction are both gone; the attacker simply keeps
    // whatever velocity it already had.
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
    expect(result.contactHits).toEqual([{ attackerSessionId: "a", targetSessionId: "b", weaponId: "wildcharge" }]);
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
    memory.slammed.set("b", { bySessionId: "a", wallStunUntilTick: 25, immuneUntilTick: 28 });
    const approach = approachVelocities(state);

    const first = contactTick(state, roster, memory, "ffa", NO_EFFECTS, approach, NO_MANEUVER_WEAPONS, 12);
    expect(first.statusRequests).toEqual([
      { targetSessionId: "b", statusId: "stunned", durationTicks: SLAM_TICKS.wallStunDuration, sourceSessionId: "a" },
    ]);
    const second = contactTick(state, roster, memory, "ffa", NO_EFFECTS, approach, NO_MANEUVER_WEAPONS, 13);
    expect(second.statusRequests).toHaveLength(0); // one stun per slam
    expect(victim.x).toBe(24);
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
