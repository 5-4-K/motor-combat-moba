import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_MODE,
  applyOverrides,
  installMode,
  modeConfigOf,
  type TuningOverrides,
} from "@motor-combat-moba/shared";
import {
  ArenaState,
  ManeuverKind,
  NEUTRAL_MODIFIERS,
  PlayerState,
  PlayerStatus,
  RAM_CONFIG,
  WEAPON_TABLE,
  WEAPON_TICKS,
  applyStatus,
  forwardMaxSpeedOf,
  forwardOf,
  hasStatus,
  pairKey,
  ramAttackOf,
  ramDefenceOf,
  ramTicks,
  type Modifiers,
  type WeaponId,
} from "@motor-combat-moba/shared";
import {
  clearKnock,
  forgetContactPlayer,
  newContactMemory,
  newFalloffStack,
  nextFalloff,
  sweepFalloff,
  contactTick,
} from "./ram-bridge.js";
import { readStatuses, writeStatuses } from "./status-bridge.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

/**
 * Installs a tuned bundle for one test, the way the playground now builds one: `applyOverrides`
 * off the pristine default-mode bundle, then an install so the bridge's own accessor reads see it.
 * Always from `modeConfigOf(DEFAULT_GAME_MODE)`, never from whatever is currently installed, so two
 * calls in one test replace rather than stack — and `beforeEach` above reinstalls the pristine
 * bundle anyway, so no test has to undo one.
 */
function tune(overrides: TuningOverrides): void {
  installMode(applyOverrides(modeConfigOf(DEFAULT_GAME_MODE), overrides));
}

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

describe("contactTick (ordinary ram)", () => {
  it("knocks a victim that was just rammed", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    // The victim starts at rest and is rammed along +x by an attacker approaching from -x, so the
    // shove has a known sign, not merely a nonzero magnitude.
    expect(victim.vx).toBeGreaterThan(0);
  });

  it("shoves the victim by the §7.2 formula, along the attacker's heading", () => {
    // Was "charges the attacker by the contest's own independently-computed attackerImpulse". The
    // contest is gone: the attacker's outcome is a rule ("you stop", pinned in the §7.2 block below)
    // and no longer a number, so the number worth pinning here is the VICTIM's — the one thing on
    // this path still derived from the tables rather than stated outright.
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    // Both cars are the default "mirage" chassis, dead-straight along +x, victim stationary — the
    // attacker strikes the victim's REAR with their headings agreeing, so `rearScale` is what
    // classification produces here, not an assumption. Hand-derived from `shoveOf`, not pasted, so a
    // retune of `ramAttack`/`ramDefence`/`rearScale`/`globalScale` moves this expectation with it.
    const expected =
      (540 * RAM_CONFIG.rearScale * RAM_CONFIG.globalScale * ramAttackOf("mirage")) / ramDefenceOf("mirage");
    expect(victim.vx).toBeCloseTo(expected, 6);
    // The geometry is dead-straight along +x: nothing should give the shove a lateral component…
    expect(victim.vy).toBeCloseTo(0, 6);
    // …and a dead-on hit puts the recovered contact point and the shove on the same line, so
    // `spinOf`'s cross product is zero by construction rather than by tuning.
    expect(victim.angVel).toBe(0);
  });

  it("never changes hp", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540, hp: 400 });
    const victim = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0, hp: 400 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    expect(victim.hp).toBe(400);
  });

  it("fires once per contact episode, not once per tick", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
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
    const bystander = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
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
    const lobbying = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0, status: PlayerStatus.READY });
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
    const wreck = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0, alive: false });
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
    const mate = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0, team: 0 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "team", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    expect(mate.vx).toBe(0);
    expect(mate.vy).toBe(0);
  });

  // `authority` and its "no rescue" precedence rule (a weaker knock could never overwrite a
  // stronger standing one) are gone entirely, and nothing replaced them. A flank or rear victim's
  // velocity is SET to its own PRE-COLLISION velocity plus the shove (spec §7.2), and the
  // pre-collision velocity is whatever it was already carrying — so two rams landing across
  // different ticks compound rather than one being discarded, and there is no "standing knock" to
  // protect. What limits a chained ram is the per-victim falloff stack, not a precedence rule.
  // These two tests used to prove no-rescue; they now prove that compounding. (The wording moved
  // from "added into the velocity" to "set to pre-collision plus shove" with the Unity port's stage
  // 3 — the observable is the same for a victim across ticks, but it is no longer an accumulation:
  // an ATTACKER's velocity is replaced outright, which is what the §7.2 block below pins.)
  it("stacks a later ram's knock onto a victim's still-decaying velocity from an earlier one", () => {
    const state = arena();
    addPlayer(state, "strong", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
    const memory = newContactMemory();
    contactTick(
      state, new Set(["strong", "b"]), memory, "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    const afterFirstRam = victim.vx;
    expect(afterFirstRam).not.toBe(0);
    expect(victim.vy).toBe(0);

    // A second attacker rams the victim from a DIFFERENT axis (approaching along y) on a later tick,
    // so its knock is geometrically independent of the first one and there is no directional
    // ambiguity about which car is the attacker. Its knock is simply added on top of whatever the
    // victim still carries. The offsets are the pre-2026-09-16 48x32 fixture's, scaled 1.25x for the
    // 60x40 hull (spec BC9): "second" sits 38.75 u above the victim (31 before), so its
    // hull overlaps the victim's by 11.25 u along y, and it clears "strong" by 8.75 u along x (7 before)
    // — it touches the victim alone. Left unscaled at (47, 431) the wider hull made it overlap
    // "strong" too, a third contact this test never meant to have.
    addPlayer(state, "second", { x: 58.75, y: 438.75, angle: -Math.PI / 2, vy: -(RAM_CONFIG.minRamSpeed + 200) });
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
    // The knock's SIGN is purely geometric: `shoveOf` pushes along the ATTACKER'S OWN HEADING and
    // its magnitude can never be negative, so a directional assertion is exact rather than an
    // approximation. "second" faces -y (angle -π/2) driving down onto the victim at y=400, so the
    // shove must push the victim's vy negative.
    expect(victim.vy).toBeLessThan(0);
  });

  it("adds a second ram's knock on top rather than replacing the standing one (no precedence)", () => {
    const state = arena();
    addPlayer(state, "medium", { x: 0, y: 400, angle: 0, vx: 150 });
    const victim = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
    const memory = newContactMemory();
    contactTick(
      state, new Set(["medium", "b"]), memory, "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    const afterMediumRam = victim.vx;
    expect(afterMediumRam).toBeGreaterThan(0);

    // A harder-hitting attacker (bastion, the roster's highest `ramAttack`) rams the same victim from
    // a different axis, at its own top speed, on a later tick. Under the old `authority`-based
    // precedence a stronger ram could overwrite a standing one; that mechanism was deleted and never
    // replaced, so this simply lands on top of what the victim was already carrying.
    addPlayer(state, "hexy", { x: 58.75, y: 438.75, angle: -Math.PI / 2, vy: -320, carId: "bastion" });
    contactTick(
      state, new Set(["medium", "b", "hexy"]), memory, "ffa", NO_EFFECTS, approachVelocities(state),
      NO_MANEUVER_WEAPONS, 11,
    );

    // Same float-zero caveat as the test above: the second attacker's shove is nominally along y
    // alone, but its x contribution is only float-zero, not exactly 0.
    expect(victim.vx).toBeCloseTo(afterMediumRam);
    // Same geometric-sign reasoning as the test above: "hexy" faces -y driving down onto the victim
    // at y=400, so the shove along its own heading must push the victim's vy negative, independent
    // of either car's ratings or drive-in.
    expect(victim.vy).toBeLessThan(0);
  });
});

describe("contactTick (dash, O12)", () => {
  it("caps a dasher at one ContactHit even when its hull freshly touches two enemies in the same tick", () => {
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 0 });
    attacker.maneuver = ManeuverKind.DASH;
    // "b" touches via the x-axis gap (58.75 = 30+30-1.25, a grazing 1.25 u overlap — the 60x40 hull's
    // 1.25x scaling of the old 47 = 24+24-1, and the margin every other touching test in this file
    // uses); "c" touches via the y-axis gap (38.75 = 20+20-1.25, the mirror of that margin against
    // the hull's 40-unit height) — two DIFFERENT, both-fresh contacts in one tick. "c" also sits
    // half a hull length back (x -30), so "b"/"c" are 88.75 apart in x and clear each other by
    // 28.75 u: they never touch each other. (Before 2026-09-16 "c" sat at x 0, and dx 47 / dy 31
    // left "b" and "c" overlapping by 1 u at the corner — the claim was already false at 48x32, and
    // at 60x40 the unscaled offsets made that a 13 x 9 overlap.)
    addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
    addPlayer(state, "c", { x: -30, y: 438.75, angle: 0 });
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
    addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
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
    // Renamed from "...the attacker recoils under equal-and-opposite reaction" (car-physics stage 3
    // Task 2): a slam is authored, not contested, so its attacker takes nothing from its own hit.
    // That was once a zero-magnitude `attackerImpulse` riding a per-victim impulses map; stage 4
    // stopped building one and the Unity ram port removed the map. `SLAM_CONFIG.selfKeepFactor`'s
    // hand-tuned forward-only restore and the old `reactionOf`-based equal-and-opposite reaction are
    // both gone; the attacker keeps whatever velocity it already had. A RAM attacker does NOT — it
    // stops dead (spec §7.2) — and that asymmetry between the two is the point of this assertion.
    //
    // ANNOTATED, stage 5 Task 9 (2026-09-19): `vx: 300` here exceeds the default chassis's real top
    // speed under current tuning, the same stale-literal shape as `duel.fixture.ts`'s fixed
    // `BOT_START` bug — but this scene sets `vx` directly on a `PlayerState` and asserts it comes back
    // UNCHANGED (see the `forwardOf(...)` expectation below), never running it through `stepDrive`, so
    // there is no drive-model cap for it to be above and no transient this literal could produce. Left
    // un-derived: 300 is an arbitrary nonzero value proving "the attacker keeps whatever velocity it
    // already had", not a claim about a real chassis's top speed.
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 300 });
    addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
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
    // `toMatchObject`, not `toEqual`: a slam's entry is a `ContactHit` that also carries the push
    // geometry (`.push`), same as every other impulse-bearing hit since the 2026-09-19 merge. The
    // three fields asserted here are the whole of what combat prices.
    expect(result.contactHits).toHaveLength(1);
    expect(result.contactHits[0]).toMatchObject({
      attackerSessionId: "a",
      targetSessionId: "b",
      weaponId: "wildcharge",
    });
    expect(attacker.maneuver).toBe(0);
    expect(readStatuses(attacker)).toHaveLength(0); // fortified expired with the charge (O2)
    expect(forwardOf(attacker.vx, attacker.vy, attacker.angle)).toBeCloseTo(300, 6);
    expect(memory.pushed.get("b")).toBeDefined();
  });

  it("stuns a slammed victim shoved into a wall inside the window, once", () => {
    const state = arena();
    const victim = addPlayer(state, "b", { x: 24, y: 500, angle: 0 });
    const roster = new Set(["b"]);
    const memory = newContactMemory();
    memory.pushed.set("b", {
      bySessionId: "a",
      wallWindowUntilTick: 25,
      immuneUntilTick: 28,
      wallApplies: SLAM_IMPULSE_TICKS.onWallImpact!.applies,
    });
    const approach = approachVelocities(state);

    const first = contactTick(state, roster, memory, "ffa", NO_EFFECTS, approach, NO_MANEUVER_WEAPONS, 12);
    expect(first.statusRequests).toEqual([
      {
        targetSessionId: "b",
        statusId: "stunned",
        durationTicks: SLAM_IMPULSE_TICKS.onWallImpact!.applies[0]!.durationTicks,
        sourceSessionId: "a",
      },
    ]);
    const second = contactTick(state, roster, memory, "ffa", NO_EFFECTS, approach, NO_MANEUVER_WEAPONS, 13);
    expect(second.statusRequests).toHaveLength(0); // one stun per slam
    expect(victim.x).toBe(24);
  });

  it("opens both clocks off the slamming weapon's own ImpulseDef, not a slam-wide constant", () => {
    // The `SLAM_TICKS` half of the dissolve: the wall-impact window, the re-push immunity and the
    // statuses a landed wall contact would request all come from `WEAPON_TICKS.wildcharge.impulse`
    // now, stamped onto the room's `PushRecord` at the moment the slam lands.
    //
    // x shifted 0/47 -> 200/247 for the arena-01 octagon (2026-09-11): the pair used to sit at the
    // OLD rectangle's left wall (x=0) with the victim 47 units clear of it, close enough to land the
    // slam but far enough that the wall-stun sweep below would not ALSO fire this same tick — this
    // test is about the clocks' *source*, not the wall-stun sweep, which has its own dedicated test
    // right above. Now that the playable area's left wall sits at x=74, the old victim position (47)
    // is inside the wall band and gets an immediate stun, closing `wallWindowUntilTick` at `tick` and
    // failing this assertion. Moving the whole pair inward by the same 200 units keeps the 47-unit
    // spacing the charge contact needs while clearing the new wall by a wide margin. That spacing
    // is 58.75 u since the 2026-09-16 resize to the 60x40 hull (1.25x, spec BC9), so "b" sits at 258.75.
    // ANNOTATED, stage 5 Task 9 (2026-09-19): same `vx: 300` shape as the slam test above — a
    // charging attacker's velocity here, never run through `stepDrive`, so this is inert with respect
    // to the transient-deceleration bug class; not derived for the same reason.
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 200, y: 400, angle: 0, vx: 300 });
    addPlayer(state, "b", { x: 258.75, y: 400, angle: 0 });
    attacker.maneuver = ManeuverKind.CHARGE;
    attacker.maneuverTicksLeft = 200;
    const memory = newContactMemory();
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS, approachVelocities(state),
      CHARGING_WILDCHARGE, 10,
    );
    expect(memory.pushed.get("b")).toEqual({
      bySessionId: "a",
      wallWindowUntilTick: 10 + SLAM_IMPULSE_TICKS.onWallImpact!.windowTicks,
      immuneUntilTick: 10 + SLAM_IMPULSE_TICKS.retriggerImmunity,
      wallApplies: SLAM_IMPULSE_TICKS.onWallImpact!.applies,
    });
  });

  it("pushes the victim at the row's own speed, in the direction the event carried", () => {
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 300 });
    const victim = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
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
      const victim = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0, carId });
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
    // it, had been inert since the rework's stage 2. The duration is the weapon's OWN declared
    // application — `SLAM_IMPULSE_TICKS.applies[0]`, since 2026-09-19 the bridge names no status of
    // its own — and the assertion pins that it is NOT `ramTicks().uncontrol` — otherwise the ram
    // path leaking onto a slam would read as a pass.
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 300 });
    const victim = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
    attacker.maneuver = ManeuverKind.CHARGE;
    attacker.maneuverTicksLeft = 200;
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachVelocities(state),
      CHARGING_WILDCHARGE, 10,
    );
    const reeling = readStatuses(victim).find((s) => s.statusId === "reeling");
    expect(reeling).toBeDefined();
    expect(reeling!.endsTick - 10).toBe(SLAM_IMPULSE_TICKS.applies[0]!.durationTicks);
    expect(SLAM_IMPULSE_TICKS.applies[0]!.durationTicks).not.toBe(ramTicks().uncontrol);
    expect(reeling!.sourceSessionId).toBe("a");
  });

  it("applies exactly the statuses the row declared, by id", () => {
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 300 });
    const victim = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
    attacker.maneuver = ManeuverKind.CHARGE;
    attacker.maneuverTicksLeft = 200;
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachVelocities(state),
      CHARGING_WILDCHARGE, 10,
    );
    expect(hasStatus(readStatuses(victim), "reeling", 10)).toBe(true);
  });

  it("would apply a different status if the row named one", () => {
    // The restructure's whole point: nothing in the bridge knows the word "reeling" — every
    // application is read off `authored.ticks.applies` by id. A leaf-only override can rewrite a
    // single field of an authored row without touching the rest, which is exactly the surface this
    // test needs: `wildcharge`'s own `applies[0].statusId`, and nothing else.
    tune({ "weapon.wildcharge.impulse.applies.0.statusId": "spiked" });
    {
      const state = arena();
      const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 300 });
      const victim = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
      attacker.maneuver = ManeuverKind.CHARGE;
      attacker.maneuverTicksLeft = 200;
      contactTick(
        state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachVelocities(state),
        CHARGING_WILDCHARGE, 10,
      );
      const victimStatuses = readStatuses(victim);
      expect(hasStatus(victimStatuses, "spiked", 10)).toBe(true);
      expect(hasStatus(victimStatuses, "reeling", 10)).toBe(false);
    }
  });

  it("rotates a victim when the row authors a spin, and not when it does not", () => {
    // The 2026-09-19 Task 2 contact-point fix gave a slam a genuine lever arm — `contactPointOn`,
    // not the victim's own centre — so this is the first test exercising that a nonzero
    // `ImpulseDef.spin` actually rotates a slam's victim through the real bridge, and that the
    // shipped `spin: 0` still does not. "b" sits 15 u off the attacker's approach line so the
    // recovered contact point has a nonzero lever arm off the victim's own centre line — dead-on,
    // as every other slam fixture in this file is deliberately built, the cross product is exactly
    // zero regardless of `spin` (see `ramScenario`'s own `offsetY` doc comment for the ordinary-ram
    // version of the same trick).
    const angVelFor = (spin: number): number => {
      tune({ "weapon.wildcharge.impulse.spin": spin });
      {
        const state = arena();
        const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 300 });
        const victim = addPlayer(state, "b", { x: 58.75, y: 415, angle: 0 });
        attacker.maneuver = ManeuverKind.CHARGE;
        attacker.maneuverTicksLeft = 200;
        contactTick(
          state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachVelocities(state),
          CHARGING_WILDCHARGE, 10,
        );
        return victim.angVel;
      }
    };
    expect(Math.abs(angVelFor(0))).toBeCloseTo(0, 9);
    expect(Math.abs(angVelFor(3))).toBeGreaterThan(0);
  });

  it("caps a victim at ONE slam push per tick when two chargers land on it, last slam winning", () => {
    // A restoration, not a new rule. Through stage 3 a slam rode `resolveContacts`'s `best` map,
    // which held one entry per victim and resolved a tie with `>=`, so two slams on one victim in
    // one tick silently collapsed to the later of the two. Stage 4 took slams off that map — the
    // whole point, since it is what lets a victim slammed by A and rammed by B take both pushes —
    // and the slam-plus-slam cap had to become explicit or it would have gone with the map.
    // Uncapped, this fixture lands 2x the authored `speed` on one car in a single tick.
    //
    // Geometry: "a" charges into "b" along +x, "c" charges into it along +y. Rescaled for the
    // 2026-09-16 hull resize (60x40): at the old 48x32 hull, -47/-39 put the two chargers clear of
    // each other and each just touching "b"; at 60x40 those same offsets put the chargers touching
    // EACH OTHER too, so both are scaled 1.25x. The two chargers are clear of each other (a's hull
    // spans x [-88.75,-28.75], c's spans x [-20,20] — no x overlap, so the AABBs can't touch even
    // though their y-ranges graze), and each overlaps "b" by 1.25 u, so the only two contacts in the
    // tick are the two slams, and the pushes are PERPENDICULAR — which is what makes doubling
    // observable. Uncapped the victim would end at hypot(speed, speed) ≈ 1.41x the row's number;
    // capped it ends at exactly the row's number, along the LAST slam's axis alone.
    const state = arena();
    const first = addPlayer(state, "a", { x: -58.75, y: 0, angle: 0, vx: 300 });
    const victim = addPlayer(state, "b", { x: 0, y: 0, angle: 0 });
    const second = addPlayer(state, "c", { x: 0, y: -48.75, angle: Math.PI / 2, vy: 300 });
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
    expect(reelings[0]!.endsTick - 10).toBe(SLAM_IMPULSE_TICKS.applies[0]!.durationTicks);
    expect(reelings[0]!.sourceSessionId).toBe("c");

    // Everything that is NOT the push still runs for BOTH slams: both chargers spent their ult and
    // both maneuvers end (O2), and combat is handed both hits to price.
    expect(first.maneuver).toBe(0);
    expect(second.maneuver).toBe(0);
    expect(result.contactHits).toHaveLength(2);
    expect(result.contactHits.map((h) => h.attackerSessionId)).toEqual(["a", "c"]);
    expect(result.contactHits.every((h) => h.targetSessionId === "b" && h.weaponId === "wildcharge")).toBe(true);
    // `memory.pushed` also runs for every slam; last write wins, same as it did under the map.
    expect(memory.pushed.get("b")?.bySessionId).toBe("c");
  });

  it("lets a dasher's own endDash erase the slam that landed on it in the same tick", () => {
    // THE THUNDERCLAP-VS-WILDCHARGE CLASH, and until this test nothing in the repo covered a
    // dash-vs-charge pair at all.
    //
    // `resolvePair`'s doc comment states the pairing outright: classification is per car and dash is
    // checked first for that car, so a dashing car never also charges — but a dash-vs-charger pair
    // produces a `ContactHit` FROM the dasher AND, independently, one ON that same dasher carrying
    // the charger's push. The dasher is therefore both a dash attacker (which calls `endDash`) and a
    // push victim (which takes an impulse), on one tick.
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
    const charger = addPlayer(state, "b", { x: 458.75, y: 400, angle: Math.PI, vx: -300 });
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
    expect(memory.pushed.get("a")?.bySessionId).toBe("b");

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
    expect(reeling!.endsTick - 10).toBe(SLAM_IMPULSE_TICKS.applies[0]!.durationTicks);
    expect(reeling!.sourceSessionId).toBe("b");

    // Both maneuvers ended: the dash on its one hit (O12), the charge on its first slam (O2).
    expect(dasher.maneuver).toBe(0);
    expect(charger.maneuver).toBe(0);
  });
});

describe("contactTick applies reeling to a ram victim, scaled by falloff", () => {
  it("gives a freshly rammed victim the full ramTicks().uncontrol duration", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 10,
    );
    const reeling = readStatuses(victim).find((s) => s.statusId === "reeling");
    expect(reeling).toBeDefined();
    expect(reeling!.endsTick - 10).toBe(ramTicks().uncontrol);
  });

  it("gives a re-rammed victim a shorter reeling duration than the first ram", () => {
    const state = arena();
    const memory = newContactMemory();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 10,
    );
    const first = readStatuses(victim).find((s) => s.statusId === "reeling")!.endsTick - 10;

    // The second ram lands at tick 45: AFTER the first `reeling` has lapsed (it ends at tick 40)
    // but well inside the falloff window (`ramTicks().drWindow` runs to tick 70), which is the
    // window duration falloff is actually observable in. That is not incidental to the setup — a
    // re-ram while the first `reeling` is still running cannot shorten anything, because `reeling`
    // is `reapply: "ignore"` and a second application writes nothing at all while one is standing.
    // (Before the Unity port's status overhaul it was `refresh`, which took the LONGER of the two
    // end ticks — a different rule, same consequence for this test.) Falloff still bites on that
    // path, on the shove (the next test) and on the status the ram AFTER it writes; it simply cannot
    // claw back a window already granted. An earlier version of this test re-rammed at tick 11 and
    // asserted only `second < first`, which the one-tick offset satisfied on its own — it would have
    // passed with falloff switched off entirely.
    //
    // Force a fresh contact episode on the SAME memory (and so the same falloff stack) without
    // re-deriving the geometry a real separate-and-return would need: `resolveContacts` keys the
    // "fresh touch" edge-trigger off `memory.contacts`, so clearing it is the direct way to
    // simulate re-approach. The attacker must also be RE-ARMED: under Unity's rule a ram leaves it
    // stopped dead, and a car at rest is below `minRamSpeed` and no longer qualifies to throw one.
    memory.contacts = new Set();
    attacker.vx = 540;
    attacker.vy = 0;
    victim.vx = 0;
    victim.vy = 0;
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 45,
    );
    const second = readStatuses(victim).find((s) => s.statusId === "reeling")!.endsTick - 45;

    expect(first).toBe(ramTicks().uncontrol);
    // Pin the SCALED duration itself, not merely `second < first`. This is the number
    // `nextFalloff`'s second read owes — one application of `durationDrScale`, floored — so a change
    // to either knob has to be typed here too.
    expect(second).toBe(
      Math.max(ramTicks().durationFloor, Math.round(ramTicks().uncontrol * RAM_CONFIG.durationDrScale)),
    );
    expect(second).toBeLessThan(first);
  });

  it("also shrinks the shove on a re-ram, not only the duration", () => {
    const state = arena();
    const memory = newContactMemory();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 10,
    );
    const first = Math.abs(victim.vx);

    victim.x = 58.75; victim.y = 400; victim.vx = 0; victim.vy = 0;
    attacker.vx = 540;
    memory.contacts = new Set();
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 11,
    );
    const second = Math.abs(victim.vx);

    expect(second).toBeLessThan(first);
  });

  // The spec-load-bearing counterpart to the test above. Was "does NOT shrink the attacker's own
  // impulse on a re-ram", which measured a number the contest computed for the attacker; under
  // Unity's rule the attacker's outcome is a fixed statement ("you stop") and there is no magnitude
  // left to discount. What CAN still go wrong is the stack itself: read falloff for a car that took
  // no push and the attacker starts spending its own entries by throwing punches — so the next ram
  // it TAKES arrives pre-diminished, and chaining into a worn-down victim gets progressively safer
  // for the aggressor, the exact inverse of what diminishing returns are for. That is what this
  // pins, and it is the observable `applyRamResolution`'s `shoved` guard exists for.
  it("never spends the attacker's own falloff stack, so a ram it later TAKES lands at full strength", () => {
    const shoveTakenByA = (ramFirst: boolean): number => {
      const state = arena();
      const a = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
      const b = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
      const memory = newContactMemory();
      const roster = new Set(["a", "b"]);
      if (ramFirst) {
        contactTick(
          state, roster, memory, "ffa", NO_EFFECTS, approachVelocities(state), NO_MANEUVER_WEAPONS, 10,
        );
      }
      // Now "c" rear-ends "a" at tick 11 — well inside `drWindow`, so an entry the first ram had
      // wrongly filed under "a" would still be live and would halve what lands here. Both earlier
      // cars are parked at rest so neither of them qualifies to throw a second punch of its own.
      a.vx = 0; a.vy = 0; b.vx = 0; b.vy = 0;
      addPlayer(state, "c", { x: -58.75, y: 400, angle: 0, vx: 540 });
      roster.add("c");
      memory.contacts = new Set();
      contactTick(
        state, roster, memory, "ffa", NO_EFFECTS, approachVelocities(state), NO_MANEUVER_WEAPONS, 11,
      );
      return Math.hypot(a.vx, a.vy);
    };

    // Nonzero first, or the equality below could pass on a fixture where no ram landed at all.
    expect(shoveTakenByA(false)).toBeGreaterThan(0);
    expect(shoveTakenByA(true)).toBeCloseTo(shoveTakenByA(false), 9);
  });

  it("does not apply reeling to the attacker", () => {
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
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
    const victim = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
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
      SLAM_IMPULSE_TICKS.applies[0]!.durationTicks,
    );
    expect(memory.falloff.size).toBe(0);
  });

  it("lands two slams on one victim at identical strength — falloff is ram-only", () => {
    // The consequence of the rule above that a player would actually feel. Two rams in this window
    // would diminish (see the two tests further up); two slams must not, in magnitude OR duration.
    const state = arena();
    const memory = newContactMemory();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 300 });
    const victim = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0 });
    attacker.maneuver = ManeuverKind.CHARGE;
    attacker.maneuverTicksLeft = 200;
    const approach = new Map([["a", { vx: 300, vy: 0 }], ["b", { vx: 0, vy: 0 }]]);

    contactTick(state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS, approach, CHARGING_WILDCHARGE, 10);
    const firstKnock = Math.hypot(victim.vx, victim.vy);
    const firstReeling = readStatuses(victim).find((s) => s.statusId === "reeling")!.endsTick - 10;

    // Restore the opening geometry and re-arm the charge the first slam ended (O2), then force a
    // fresh contact episode on the SAME memory — and so the same falloff stack — the way the ram
    // falloff tests above do.
    //
    // Tick 55, not 11, and for the same reason the ram DR test above lands its second ram late:
    // `reeling` is `reapply: "ignore"` since the Unity port's status overhaul, so a second slam
    // arriving while the first `reeling` still runs writes no status at all and the duration half of
    // this claim would be measuring the FIRST slam's window counted from the wrong tick. The slam's
    // window is the weapon's own — 42 ticks, ending at 52 — and tick 55 is clear of it while still
    // inside `ramTicks().drWindow` (which runs to tick 70), the window a second RAM would be
    // diminished in.
    victim.x = 58.75; victim.y = 400; victim.vx = 0; victim.vy = 0;
    attacker.x = 0; attacker.y = 400; attacker.vx = 300; attacker.vy = 0;
    attacker.maneuver = ManeuverKind.CHARGE;
    attacker.maneuverTicksLeft = 200;
    memory.contacts = new Set();
    memory.pushed.delete("b"); // clear the re-slam immunity the first slam opened (O18)
    contactTick(state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS, approach, CHARGING_WILDCHARGE, 55);

    expect(Math.hypot(victim.vx, victim.vy)).toBeCloseTo(firstKnock, 6);
    expect(readStatuses(victim).find((s) => s.statusId === "reeling")!.endsTick - 55).toBe(firstReeling);
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
    // axes and can be told apart in the result. Their centres are 58.75 apart in x and 38.75 in y
    // (47 and 31 before the 2026-09-16 resize to the 60x40 hull, scaled 1.25x), which leaves their
    // hulls 8.75 u clear of each other along x — each touches the victim alone.
    const build = (withRammer: boolean, withCharger: boolean) => {
      const state = arena();
      const victim = addPlayer(state, "victim", { x: 0, y: 400, angle: 0 });
      const roster = new Set(["victim"]);
      if (withRammer) {
        addPlayer(state, "aRam", { x: -58.75, y: 400, angle: 0, vx: 540 });
        roster.add("aRam");
      }
      if (withCharger) {
        const charger = addPlayer(state, "zCharge", { x: 0, y: 438.75, angle: -Math.PI / 2, vy: -300 });
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

    // The ram runs first and SETS the victim's velocity to its pre-collision value plus the shove;
    // the slam's `applyImpulse` then adds on top. The victim came in at rest, so "took BOTH" is
    // exactly the vector sum of the two pushes measured in isolation — a strictly stronger claim
    // than "moved on both axes".
    expect(both.victim.vx).toBeCloseTo(ramOnly.vx + slamOnly.vx, 6);
    expect(both.victim.vy).toBeCloseTo(ramOnly.vy + slamOnly.vy, 6);
    expect(ramOnly.vx).toBeGreaterThan(0);
    expect(slamOnly.vy).toBeLessThan(0);

    // The ram half was classified as a ram: it was COUNTED into the victim's falloff stack, which is
    // the observable the old `slammedVictims` inference got wrong. (Both pushes grant `reeling`, and
    // whichever lands first owns the window under `reapply: "ignore"`, so the status alone cannot
    // distinguish them — the stack can, and it is empty under the old behaviour.)
    expect(both.memory.falloff.get("victim")?.count).toBe(1);
    expect(readStatuses(both.victim).find((s) => s.statusId === "reeling")).toBeDefined();
  });
});

/**
 * The canonical flank/rear ram fixture: "a" (mirage, facing +x) drives into the back of a stationary
 * "b" (mirage, facing +x). Both hulls overlap by 1.25 u along x — the 60x40 hull's scaling of the
 * margin every other touching test in this file uses.
 *
 * `offsetY` slides the victim up so the recovered contact point sits off the victim's centre line,
 * which is the only way to give the shove a lever arm and so a nonzero spin: dead-on, the cross
 * product in `spinOf` is exactly zero by construction.
 */
function ramScenario(over: { speed?: number; offsetY?: number } = {}) {
  const speed = over.speed ?? 540;
  const state = arena();
  const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: speed });
  const victim = addPlayer(state, "b", { x: 58.75, y: 400 + (over.offsetY ?? 0), angle: 0 });
  return { state, attacker, victim, memory: newContactMemory(), roster: new Set(["a", "b"]) };
}

/**
 * Two mirages nose to nose, each driving into the other at `speed`. Both qualify as attackers and
 * both read the contact as a front hit within `headOnAngleDeg`, so `resolveRam` returns a head-on:
 * no attacker, both velocities replaced, both locked, neither reeled (U27).
 */
function headOnScenario(speed = 200) {
  const state = arena();
  const a = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: speed });
  const b = addPlayer(state, "b", { x: 58.75, y: 400, angle: Math.PI, vx: -speed });
  return { state, a, b, memory: newContactMemory(), roster: new Set(["a", "b"]) };
}

/** One `contactTick` on a fixture, with the approach map defaulting to the cars' current velocity. */
function runRam(
  fixture: { state: ArenaState; memory: ReturnType<typeof newContactMemory>; roster: Set<string> },
  tick: number,
  approach: Map<string, { vx: number; vy: number }> = approachVelocities(fixture.state),
  statusMods: ReadonlyMap<string, Modifiers> = NO_EFFECTS,
): void {
  contactTick(
    fixture.state, fixture.roster, fixture.memory, "ffa", statusMods, approach, NO_MANEUVER_WEAPONS, tick,
  );
}

describe("contactTick (Unity ram, spec §7.2)", () => {
  it("stops the attacker dead and locks it", () => {
    const { attacker, ...fixture } = ramScenario();
    runRam(fixture, 10);
    // `ApplyRam` SETS the attacker's velocity to zero: it does not slow it and it does not bounce it
    // back. Nothing about this is derived from the victim — the attacker's outcome is a rule.
    expect(attacker.vx).toBe(0);
    expect(attacker.vy).toBe(0);
    expect(hasStatus(readStatuses(attacker), "ramLock", 10)).toBe(true);
    expect(readStatuses(attacker).find((s) => s.statusId === "ramLock")!.endsTick - 10).toBe(
      ramTicks().attackerLock,
    );
  });

  it("leaves the attacker's own spin untouched by its stop", () => {
    // Controller ruling S3-g: §7.2's attacker row reads "spin unchanged", and `RamSide.spin` is a
    // DELTA the bridge always adds. `replacesVelocity` governs velocity alone, so an attacker
    // carrying yaw into a ram keeps it rather than having it erased alongside its velocity.
    const { attacker, ...fixture } = ramScenario();
    attacker.angVel = 1.5;
    runRam(fixture, 10);
    expect(attacker.angVel).toBe(1.5);
  });

  it("adds the shove to the victim's PRE-COLLISION velocity, not to what resolveWorld left", () => {
    const baseline = ramScenario();
    runRam(baseline, 10);
    const shove = baseline.victim.vx; // the victim came in at rest, so this IS the shove

    const fixture = ramScenario();
    // What `resolveWorld` happened to leave on the body this tick — deliberately absurd, so reading
    // it instead of the approach map is unmissable.
    fixture.victim.vx = 999;
    const approach = new Map([
      ["a", { vx: 540, vy: 0 }],
      ["b", { vx: 100, vy: 0 }],
    ]);
    runRam(fixture, 10, approach);
    expect(fixture.victim.vx).toBeCloseTo(100 + shove, 6);
  });

  it("reels the victim and never the attacker", () => {
    const { attacker, victim, ...fixture } = ramScenario();
    runRam(fixture, 10);
    expect(hasStatus(readStatuses(victim), "reeling", 10)).toBe(true);
    expect(readStatuses(victim).find((s) => s.statusId === "reeling")!.endsTick - 10).toBe(
      ramTicks().uncontrol,
    );
    expect(hasStatus(readStatuses(attacker), "reeling", 10)).toBe(false);
    // …and the attacker is the one locked, never the victim: the two statuses are not interchangeable.
    expect(hasStatus(readStatuses(victim), "ramLock", 10)).toBe(false);
  });

  it("adds the spin delta to the victim's own rotation and clamps the written value to spinMaxRate", () => {
    // U26: the clamp is the BRIDGE's, a playability guard, and lives where the spin is written onto a
    // body — `sim/ram.ts` authors an unclamped delta on purpose.
    const modest = ramScenario({ offsetY: 20 });
    modest.victim.angVel = 1;
    runRam(modest, 10);
    // Off-centre, so there is a real lever arm and a real delta — added on top of the 1 rad/s the
    // victim was already carrying, per §7.2's "pre-collision spin + spinDelta".
    expect(modest.victim.angVel).toBeGreaterThan(1);
    expect(Math.abs(modest.victim.angVel)).toBeLessThan(RAM_CONFIG.spinMaxRate);

    const absurd = ramScenario({ offsetY: 20, speed: 10_000 });
    runRam(absurd, 10);
    expect(Math.abs(absurd.victim.angVel)).toBe(RAM_CONFIG.spinMaxRate);
  });

  it("credits the shover for the spikes, and never credits the attacker's own stop", () => {
    const fixture = ramScenario();
    runRam(fixture, 10);
    expect(fixture.memory.spikes.lastShover.get("b")?.id).toBe("a");
    // The attacker took no push, so nobody shoved it — a stop is not a shove (AS20).
    expect(fixture.memory.spikes.lastShover.has("a")).toBe(false);
  });

  it("deals no damage (U28)", () => {
    const fixture = ramScenario();
    fixture.attacker.hp = 400;
    fixture.victim.hp = 400;
    runRam(fixture, 10);
    expect(fixture.victim.hp).toBe(400);
    expect(fixture.attacker.hp).toBe(400);
  });

  it("refuses a ram from a ramBlocked car, which is the bridge JOINING the flag to the rule", () => {
    // The seam nothing else covers. `sim/ram.ts` honours `RamCar.ramBlocked` and `STATUS_TABLE`
    // raises `Modifiers.ramBlocked` on `reeling` and `ramLock`, and both halves have their own
    // tests in shared — but the two only ever meet on `contactCarsOf`'s `ramBlocked: mods.ramBlocked`
    // line. Get that expression wrong (drop it, negate it, read a neighbouring flag) and it
    // compiles, every other suite stays green, and a car walks out of its own attacker lock straight
    // into the next ram: the whole mechanism fails silently and only a player notices.
    const blocked = ramScenario();
    runRam(blocked, 10, approachVelocities(blocked.state), new Map([["a", { ...NEUTRAL_MODIFIERS, ramBlocked: true }]]));
    // Nothing happened at all: `resolveRam` returns null when no car qualifies, so there is no
    // resolution to write and the would-be attacker is not even stopped.
    expect(hasStatus(readStatuses(blocked.victim), "reeling", 10)).toBe(false);
    expect(hasStatus(readStatuses(blocked.attacker), "ramLock", 10)).toBe(false);
    expect(blocked.victim.vx).toBe(0);
    expect(blocked.attacker.vx).toBe(540);

    // The positive control, on the identical fixture: with the flag down the very same tick rams.
    // Without this the block above would also pass on a fixture that could never ram in the first
    // place — the failure mode this test exists to catch is silence, so it has to prove the noise.
    const free = ramScenario();
    runRam(free, 10);
    expect(hasStatus(readStatuses(free.victim), "reeling", 10)).toBe(true);
    expect(hasStatus(readStatuses(free.attacker), "ramLock", 10)).toBe(true);
    expect(free.victim.vx).toBeGreaterThan(0);
    expect(free.attacker.vx).toBe(0);
  });

  it("counts only the car that took a push into the falloff stack", () => {
    // The attacker's dead stop must never count a ram against its own stack: falloff exists to stop a
    // VICTIM being chained, and an attacker that had paid into it would make its next ram weaker for
    // having thrown one.
    const fixture = ramScenario();
    runRam(fixture, 10);
    expect(fixture.memory.falloff.get("b")?.count).toBe(1);
    expect(fixture.memory.falloff.has("a")).toBe(false);
  });
});

/**
 * The canonical fixture plus a SECOND attacker, "z", diving onto the same victim from +y in the SAME
 * tick — the case `contact.ts` has always claimed the bridge handles ("a victim rammed by two
 * attackers in one tick takes both") and did not.
 *
 * `z` sits 38.75 u above the victim facing -y, so its hull overlaps the victim's by 11.25 u along y
 * and clears "a" by 8.75 u along x: each attacker touches the victim alone, and the two shoves are
 * on different axes so they can be told apart in the result. The same offsets the slam-plus-ram test
 * further up uses, for the same reason.
 *
 * Either attacker is disarmed by giving it a drive-in of 0 rather than by removing it from the
 * state: below `RAM_CONFIG.minRamSpeed` it cannot qualify, so the pair still touches and still
 * occupies `memory.contacts`, and the single-ram control measures the identical geometry.
 *
 * "z" drives in slower than "a" on purpose. The two shoves are perpendicular and the second is
 * halved by the victim's own falloff, so a "z" at full speed would give a combined magnitude SMALLER
 * than "z" alone — true, intended, and useless as a test, because it cannot tell the composition
 * apart from a rule that merely kept the bigger push. At 300 the sum is larger than either single
 * ram, so "two at once beats one" is a claim the geometry actually supports.
 */
function twoAttackerScenario(over: { aSpeed?: number; zSpeed?: number } = {}) {
  const fixture = ramScenario({ speed: over.aSpeed ?? 540 });
  const z = addPlayer(fixture.state, "z", {
    x: 58.75, y: 438.75, angle: -Math.PI / 2, vy: -(over.zSpeed ?? 300),
  });
  fixture.roster.add("z");
  return { ...fixture, z };
}

const speedOf = (p: PlayerState) => Math.hypot(p.vx, p.vy);

describe("contactTick (two rams on one car in a tick, controller ruling S3-o)", () => {
  it("adds BOTH attackers' shoves, so being rammed twice at once beats being rammed once", () => {
    // The regression this file never had. Each side used to be ASSIGNED from the same immutable
    // pre-collision cache entry, so the second resolution overwrote the first instead of adding to
    // it — and because falloff still counted both, the victim ended at `0.5 × shove_z` and "a"'s
    // push vanished: strictly LESS than a single ram, from being hit by two cars.
    const both = twoAttackerScenario();
    const aOnly = twoAttackerScenario({ zSpeed: 0 });
    const zOnly = twoAttackerScenario({ aSpeed: 0 });
    runRam(both, 10);
    runRam(aOnly, 10);
    runRam(zOnly, 10);

    // The headline, stated the way a player would: two cars hitting you at once must move you more
    // than either one of them alone.
    expect(speedOf(both.victim)).toBeGreaterThan(speedOf(aOnly.victim));
    expect(speedOf(both.victim)).toBeGreaterThan(speedOf(zOnly.victim));

    // And exactly how much more, derived rather than pasted: "a" lands first and at full strength,
    // "z" lands second and is scaled by the victim's own falloff — spec §7.3 is per victim and
    // across attackers, so the second push inside one tick is legitimately discounted. The sum is
    // still more than either ram alone, which is the whole claim.
    expect(both.victim.vx).toBeCloseTo(aOnly.victim.vx, 6);
    expect(both.victim.vy).toBeCloseTo(zOnly.victim.vy * RAM_CONFIG.impulseDrScale, 6);
    // Both pushes were counted, which is what makes the scaling above the intended discount rather
    // than an accident of which write happened to land last.
    expect(both.memory.falloff.get("b")?.count).toBe(2);
  });

  it("zeroes the base once and adds every shove when a car rams and is rammed on one tick", () => {
    // Controller ruling S3-o, the composition rule. "a" rams "b" while "b" rams "c", all three in
    // line: "b" is a VICTIM in one resolution (it takes a shove) and an ATTACKER in the other (its
    // own ram stops it dead). `ramBlocked` is sampled from `statusMods` computed before the tick, so
    // "b" is not yet blocked by the reel it takes here.
    //
    // The rule composes the two statements — "your own ram stops you" and "the shove you took is
    // added" — so "b" keeps neither its 300 u/s drive-in nor nothing at all. It ends at exactly the
    // shove "a" gave it. Before the fix the answer was decided by which resolution the loop wrote
    // last, which alphabetical session ids made "b"'s own ram: exactly 0.
    const chain = (withC: boolean) => {
      const state = arena();
      const a = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
      const b = addPlayer(state, "b", { x: 58.75, y: 400, angle: 0, vx: 300 });
      const roster = new Set(["a", "b"]);
      if (withC) {
        addPlayer(state, "c", { x: 117.5, y: 400, angle: 0 });
        roster.add("c");
      }
      const fixture = { state, memory: newContactMemory(), roster };
      runRam(fixture, 10);
      return { a, b };
    };

    // The control: "b" is rammed by "a" and rams nobody, so it keeps its drive-in and adds the shove.
    const rammedOnly = chain(false).b;
    const shove = rammedOnly.vx - 300;
    expect(shove).toBeGreaterThan(0);

    const middle = chain(true).b;
    expect(middle.vx).toBeCloseTo(shove, 6);
    // Both halves of the composition, stated separately so a failure says which one broke: the
    // drive-in is gone (its own ram stopped it) and the shove is not (it was still rammed).
    expect(middle.vx).toBeLessThan(rammedOnly.vx);
    expect(middle.vx).toBeGreaterThan(0);
  });
});

describe("contactTick (head-on, U27/U38)", () => {
  it("replaces BOTH cars' velocities with the shove the other one authored", () => {
    const { a, b, ...fixture } = headOnScenario();
    runRam(fixture, 10);
    // Each car is thrown the way the OTHER was travelling: "b" faces -x, so "a" ends going -x, and
    // vice versa. Replacement, not addition — neither keeps the 200 u/s it drove in with.
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
    expect(Math.abs(a.vx)).toBeLessThan(200);
    expect(Math.abs(b.vx)).toBeLessThan(200);
  });

  it("locks both, reels neither, and spins neither", () => {
    const { a, b, ...fixture } = headOnScenario();
    a.angVel = 0.75;
    b.angVel = -0.75;
    runRam(fixture, 10);
    expect(hasStatus(readStatuses(a), "ramLock", 10)).toBe(true);
    expect(hasStatus(readStatuses(b), "ramLock", 10)).toBe(true);
    // U27: a head-on is a mutual stop, not a mutual delete.
    expect(hasStatus(readStatuses(a), "reeling", 10)).toBe(false);
    expect(hasStatus(readStatuses(b), "reeling", 10)).toBe(false);
    expect(a.angVel).toBe(0.75);
    expect(b.angVel).toBe(-0.75);
  });

  it("credits each car to the other for the spikes (U38)", () => {
    // `attackerId` is `""` on a head-on, so a bridge that credited it would record nobody. Each car
    // was put where it ends up by the other, which is what `otherSideOf` reads off the resolution.
    const fixture = headOnScenario();
    runRam(fixture, 10);
    expect(fixture.memory.spikes.lastShover.get("a")?.id).toBe("b");
    expect(fixture.memory.spikes.lastShover.get("b")?.id).toBe("a");
  });
});

describe("contactTick (diminishing returns, spec §7.3)", () => {
  /** One fresh ram on a re-armed fixture, returning what the victim took from it. */
  function chainedRam(fixture: ReturnType<typeof ramScenario>, tick: number) {
    fixture.attacker.x = 0; fixture.attacker.y = 400; fixture.attacker.vx = 540; fixture.attacker.vy = 0;
    fixture.attacker.angVel = 0;
    fixture.victim.x = 58.75; fixture.victim.y = 420; fixture.victim.vx = 0; fixture.victim.vy = 0;
    fixture.victim.angVel = 0;
    // `resolveContacts` edge-triggers off `memory.contacts`, so clearing it is the direct way to
    // simulate separating and re-approaching without re-deriving the geometry.
    fixture.memory.contacts = new Set();
    runRam(fixture, tick);
    return {
      shove: Math.hypot(fixture.victim.vx, fixture.victim.vy),
      spin: Math.abs(fixture.victim.angVel),
      reelTicks: readStatuses(fixture.victim).find((s) => s.statusId === "reeling")!.endsTick - tick,
      attackerStoppedDead: fixture.attacker.vx === 0 && fixture.attacker.vy === 0,
    };
  }

  it("scales a chained ram's shove, spin and reel, and charges the attacker in full", () => {
    // `offsetY: 20` so the spin is nonzero and can be measured shrinking alongside the shove — U5
    // scales BOTH, which a dead-on fixture (spin exactly 0 either way) could never prove.
    const fixture = ramScenario({ offsetY: 20 });
    const first = chainedRam(fixture, 10);
    // Tick 45 is after the first `reeling` lapses but well inside `ramTicks().drWindow`, which is the
    // only window a shortened duration is observable in: `reeling` is `reapply: "ignore"`, so a
    // second application writes nothing at all while one is standing, and a re-ram before the first
    // window lapses cannot claw it back.
    const second = chainedRam(fixture, 45);

    expect(second.shove).toBeCloseTo(first.shove * RAM_CONFIG.impulseDrScale, 6);
    expect(second.spin).toBeCloseTo(first.spin * RAM_CONFIG.impulseDrScale, 6);
    expect(second.reelTicks).toBe(
      Math.max(ramTicks().durationFloor, Math.round(ramTicks().uncontrol * RAM_CONFIG.durationDrScale)),
    );
    expect(second.reelTicks).toBeLessThan(first.reelTicks);
    // The attacker pays full cost for every punch it throws: its stop is a rule, not a scaled push,
    // so no amount of falloff on the victim ever softens it. Chain-ramming a worn-down victim must
    // not get progressively safer for the aggressor.
    expect(first.attackerStoppedDead).toBe(true);
    expect(second.attackerStoppedDead).toBe(true);
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
    const window = ramTicks().drWindow; // never recompute from ms and a literal tick rate
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

describe("forgetContactPlayer (PG67)", () => {
  it("drops the seat's slam, falloff and spike state", () => {
    const memory = newContactMemory();
    memory.pushed.set("pg-0", {
      bySessionId: "pg-1",
      wallWindowUntilTick: 40,
      immuneUntilTick: 60,
      wallApplies: [{ statusId: "stunned", durationTicks: 15 }],
    });
    memory.falloff.set("pg-0", { count: 3, expiresAtTick: 90 });
    memory.spikes.lastShover.set("pg-0", { id: "pg-1", tick: 10 });
    memory.spikes.immuneUntil.set("pg-0", 50);

    forgetContactPlayer(memory, "pg-0");

    expect(memory.pushed.has("pg-0")).toBe(false);
    expect(memory.falloff.has("pg-0")).toBe(false);
    expect(memory.spikes.lastShover.has("pg-0")).toBe(false);
    expect(memory.spikes.immuneUntil.has("pg-0")).toBe(false);
  });

  it("purges every contact pair naming the seat, and keeps the pairs that do not", () => {
    // The subtle one: `contacts` is what makes a ram fire on ENTRY rather than every tick. A pair
    // key left behind would make the next genuine contact between those two read as a continuing
    // one and land no ram at all.
    const memory = newContactMemory();
    memory.contacts.add(pairKey("pg-0", "pg-1"));
    memory.contacts.add(pairKey("pg-2", "pg-0"));
    memory.contacts.add(pairKey("pg-1", "pg-2"));

    forgetContactPlayer(memory, "pg-0");

    expect([...memory.contacts]).toEqual([pairKey("pg-1", "pg-2")]);
  });

  it("is a no-op for a session it has never seen", () => {
    const memory = newContactMemory();
    memory.contacts.add(pairKey("pg-1", "pg-2"));
    expect(() => forgetContactPlayer(memory, "pg-5")).not.toThrow();
    expect(memory.contacts.size).toBe(1);
  });
});
