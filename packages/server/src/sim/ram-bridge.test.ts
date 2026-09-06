import { describe, expect, it } from "vitest";
import {
  ArenaState,
  ManeuverKind,
  NEUTRAL_MODIFIERS,
  PlayerState,
  PlayerStatus,
  RAM_CONFIG,
  RAM_REFERENCE_MASS,
  SLAM_CONFIG,
  SLAM_TICKS,
  applyStatus,
  forwardMaxSpeedOf,
  forwardOf,
  massOf,
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
 * The approach speeds `serverTick` would have reported for this state: each car's FORWARD velocity
 * as it entered the tick. These tests set `vx`/`vy` on `PlayerState` directly and never run
 * `serverTick`, so the two are the same number here — which is the point. `contactTick` requires
 * the map because in the live tick collision resolution has already reflected `player.vx`/`vy` by
 * the time contact runs.
 */
function approachSpeeds(state: ArenaState): Map<string, number> {
  const speeds = new Map<string, number>();
  state.players.forEach((p, id) => speeds.set(id, forwardOf(p.vx, p.vy, p.angle)));
  return speeds;
}

describe("contactTick (ordinary ram, unchanged behaviour)", () => {
  it("knocks a victim that was just rammed", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    // The impulse is added straight into the victim's velocity (Task 4 — see `contactTick`'s own
    // comment on `Impulse` application). The victim starts at rest and is rammed along +x by an
    // attacker approaching from -x, so the shove has a known sign, not merely a nonzero magnitude.
    expect(victim.vx).toBeGreaterThan(0);
  });

  it("recoils the attacker via Newton's third law rather than leaving it untouched", () => {
    // Renamed from "leaves the attacker untouched" (Task 4): that was the stage-1 shim's behaviour,
    // which dropped `knock.authority` and never touched the attacker at all. `ram-bridge.ts` now
    // applies `reactionOf` of the victim's own impulse to the attacker — the whole point of routing
    // ram through `Impulse` (equal-and-opposite reactions) — so the attacker recoils along the same
    // axis it rammed on, opposite the victim's push.
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    expect(attacker.vx).toBeLessThan(540);
    // The reaction always carries `spin: 0` (`reactionOf`'s own contract) — the attacker never
    // spins from its own hit, unlike the victim.
    expect(attacker.angVel).toBe(0);
  });

  it("never changes hp", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540, hp: 400 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0, hp: 400 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachSpeeds(state),
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
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    const afterFirst = victim.vx;
    expect(afterFirst).not.toBe(0);
    // Reset to a sentinel so a second (undesired) knock on the still-touching pair would be visible.
    victim.vx = 0;
    victim.vy = 0;
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state),
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
      state, new Set(["a"]), newContactMemory(), "ffa", NO_EFFECTS, approachSpeeds(state),
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
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachSpeeds(state),
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
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachSpeeds(state),
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
      state, new Set(["a", "b"]), newContactMemory(), "team", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    expect(mate.vx).toBe(0);
    expect(mate.vy).toBe(0);
  });

  // `authority` and its "no rescue" precedence rule (a weaker knock could never overwrite a
  // stronger standing one) are gone entirely — there never was, and still is not, an authority
  // field on `Impulse` (see `contactTick`'s own comment on `Impulse` application). Stage 3
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
      state, new Set(["strong", "b"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state),
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
      state, new Set(["strong", "b", "second"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 11,
    );

    // The first knock's x component survives untouched, and the second knock adds a fresh y
    // component on top of it — neither is discarded in favour of the other. `toBeCloseTo` rather
    // than `toBe`: the second attacker's shove is nominally along y alone, but its x contribution is
    // only float-zero (`Math.cos(-Math.PI / 2)` is ~6e-17, not exactly 0), so exact equality would
    // fail for the wrong reason on any geometry change that perturbs that residual.
    expect(victim.vx).toBeCloseTo(afterFirstRam);
    // The knock's SIGN is purely geometric (`ram.ts`'s `shoveX = away.x * impulse * massFactor`,
    // with `impulse` and `massFactor` both always >= 0), independent of severity/mass/side-bonus —
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
      state, new Set(["medium", "b"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state),
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
      state, new Set(["medium", "b", "hexy"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 11,
    );

    // Same float-zero caveat as the test above: the second attacker's shove is nominally along y
    // alone, but its x contribution is only float-zero, not exactly 0.
    expect(victim.vx).toBeCloseTo(afterMediumRam);
    // Same geometric-sign reasoning as the test above: "hexy" sits at y=431 approaching along -y
    // toward the victim at y=400, so `away.y < 0` and the knock must push the victim's vy negative,
    // independent of the attacker's mass or severity.
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
      approachSpeeds(state),
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
      approachSpeeds(state),
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
  it("ends a charge on its first slam: fields cleared, self statuses expired, and the attacker recoils under equal-and-opposite reaction", () => {
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
    // Task 4: `SLAM_CONFIG.selfKeepFactor`'s hand-tuned forward-only restore is gone. The
    // attacker's cost now falls out of Newton's third law — `reactionOf` of the SAME impulse the
    // victim received (a fixed 520 u/s, unlike a graded ram), negated and scaled by the ATTACKER's
    // own mass (`reactionOf` always forces `massScaled: true`, even though the slam's own push on
    // the victim is not). "a" is the default `mirage` chassis here (480 mass), and the geometry is
    // dead straight along +x, so the closed form is exact rather than merely a sign check.
    const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
    const dv = SLAM_CONFIG.knockSpeed * clamp(RAM_REFERENCE_MASS / massOf("mirage"), RAM_CONFIG.massFactorMin, RAM_CONFIG.massFactorMax);
    expect(forwardOf(attacker.vx, attacker.vy, attacker.angle)).toBeCloseTo(300 - dv, 6);
    expect(memory.slammed.get("b")).toBeDefined();
  });

  it("stuns a slammed victim shoved into a wall inside the window, once", () => {
    const state = arena();
    const victim = addPlayer(state, "b", { x: 24, y: 500, angle: 0 });
    const roster = new Set(["b"]);
    const memory = newContactMemory();
    memory.slammed.set("b", { bySessionId: "a", wallStunUntilTick: 25, immuneUntilTick: 28 });
    const speeds = approachSpeeds(state);

    const first = contactTick(state, roster, memory, "ffa", NO_EFFECTS, speeds, NO_MANEUVER_WEAPONS, 12);
    expect(first.statusRequests).toEqual([
      { targetSessionId: "b", statusId: "stunned", durationTicks: SLAM_TICKS.wallStunDuration, sourceSessionId: "a" },
    ]);
    const second = contactTick(state, roster, memory, "ffa", NO_EFFECTS, speeds, NO_MANEUVER_WEAPONS, 13);
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
