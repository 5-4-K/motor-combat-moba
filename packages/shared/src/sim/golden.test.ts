import { describe, expect, it } from "vitest";
import type { ChassisDrive } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { InputMessage } from "../net/input.js";
import { resolveWorld } from "./collide.js";
import { stepDrive } from "./drive.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import type { SimBody } from "./step.js";
import { forwardOf, lateralOf, toWorld } from "./velocity.js";

/**
 * Behaviour frozen against `stepDrive`'s integration. This suite has been refixtured twice now:
 * originally against the pre-ram-CC scalar `SimBody.speed` model (2026-08-29), then against the
 * vector-velocity `vx`/`vy` rework of car-physics stage 1 (2026-09-06), and now AGAIN for the Unity
 * drive-model port (car-physics-port stage 1 Task 3, current), which replaces the whole
 * accel-clamp-and-coast integration with one always-on exponential drag rate plus a lateral grip
 * rate. `ChassisDrive`'s shape changed a third time along with it — `reverseMaxSpeed`, `accel`,
 * `turnRateAtStop` and `coastPerTick` are gone, replaced by `engineAccel`, `dragRate`,
 * `dragPerTick`, `gripPerTick` and `spinPerTick` — so EVERY number in the "golden: stepDrive" block
 * below moved, not just the ones that touched coasting last time. This is refixtured here BY
 * DESIGN, the same as the two rewrites before it; see the task report for how each number below was
 * derived and why it is right.
 *
 * `angVel` is unrelated to this port: at 0 it contributes nothing, so it stays neutral in `body()`
 * below and every number here is unaffected by it, the same contract this suite has held since the
 * ram work landed.
 *
 * These numbers are pinned against `GOLDEN_CHASSIS`, a frozen fixture, not against a car in
 * `CAR_TABLE`. Retuning the roster therefore cannot move them, and a future balance edit has no
 * excuse to. If one of these moves without a deliberate, understood change to the integration itself,
 * the integration broke — do not re-record them.
 *
 * The "golden: resolveWorld" block below is UNTOUCHED by this port: `resolveWorld` never calls
 * `stepDrive` and never reads a `ChassisDrive`, so none of its own fixtures or derivations move.
 */
const DT = 1 / 30;

/**
 * The drive numbers this suite is recorded against, given verbatim by the Task 3 brief.
 *
 * Frozen here rather than read from `CAR_TABLE` deliberately: these expectations pin the SHAPE of
 * the integration, not the roster's balance. A car's ratings must be free to move without any
 * number below moving with them.
 */
// NOTE: `drive.test.ts` also declares a `GOLDEN_CHASSIS`. The two used to differ (a different
// `coastPerTick` half-life picked as a round number for that suite's own scenarios) but that
// distinguishing field no longer exists on `ChassisDrive` at all, so the brief's literal fixture is
// used in both files now and they happen to coincide field-for-field. Not a copy-paste drift.
const GOLDEN_CHASSIS: ChassisDrive = Object.freeze({
  maxSpeed: 200,
  engineAccel: 200,
  reverseAccel: 80,
  brakeDecel: 500,
  turnRate: 2,
  dragRate: 1,
  dragPerTick: Math.exp(-1 / 30),
  gripPerTick: Math.exp(-7 / 30),
  spinPerTick: 1,
});

function input(steer: -1 | 0 | 1, throttle: -1 | 0 | 1): InputMessage {
  return { seq: 0, steer, throttle, fireSlots: 0 };
}

function body(over: Partial<SimBody> = {}): SimBody {
  return {
    x: 0,
    y: 0,
    angle: 0,
    vx: 0,
    vy: 0,
    angVel: 0,
    maneuver: 0,
    maneuverTicksLeft: 0,
    maneuverAngle: 0,
    maneuverSpeed: 0,
    ...over,
  };
}

/**
 * A body whose entire velocity is a signed magnitude along its own heading, zero lateral — exactly
 * the shape the pre-rework scalar `speed` field could represent and nothing else. Every fixture below
 * that used to write `{ speed, angle }` now goes through this, so the historical intent ("this car is
 * doing X along its nose") survives the switch to a raw `vx`/`vy` pair unchanged.
 */
function bodyAt(x: number, y: number, angle: number, forward: number): SimBody {
  return body({ x, y, angle, ...toWorld(angle, forward, 0) });
}

function drive(start: SimBody, msg: InputMessage, ticks: number): SimBody {
  let next = start;
  // `NEUTRAL_MODIFIERS`, and only ever that: the status work adds a fifth argument whose
  // neutral value multiplies every drive constant by exactly 1. Every number below must survive
  // that unchanged, the same contract the ram fields are held to above. If one of these moves,
  // the multiplicative property has been broken and the change is wrong — do not re-record them.
  for (let i = 0; i < ticks; i++) next = stepDrive(next, msg, DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
  return next;
}

/**
 * `forward` is the signed component along the heading — the direct successor to the old scalar
 * `speed` (negative meant reversing there too). `lateral` defaults to 0 because MOST cases below
 * never steer, not because a driven car cannot slide.
 *
 * CORRECTED: this used to argue that the default was exact for every `stepDrive` case because
 * "`steeringGrip` is 1.0 ('on rails'), so driven velocity always stays aligned with the nose". The
 * Unity drive-model port DELETED that knob, and the two cases immediately below that steer carry a
 * real, hand-derived lateral value for exactly that reason — the gap between where the car points
 * and where it is going IS the drift this port exists to add. Read the default as "this case does not
 * turn", and check it against the case rather than against a rule.
 *
 * `resolveWorld` is different since stage 2 Task 1: `applyContact` now hands back the WHOLE
 * reflected vector instead of discarding it and rebuilding a scalar along the unchanged heading, so
 * a contact whose push normal is not collinear with the car's velocity leaves real lateral motion
 * behind. Two of the four `resolveWorld` cases below are dead-on (normal exactly anti-parallel to
 * velocity) and still land on lateral 0 for that reason, not because the field is unconditionally
 * zero; the other two pass their hand-derived lateral value explicitly. See the comment on that
 * describe block for the derivations.
 */
function expectPose(
  actual: SimBody,
  x: number,
  y: number,
  angle: number,
  forward: number,
  lateral = 0,
): void {
  expect(actual.x).toBeCloseTo(x, 9);
  expect(actual.y).toBeCloseTo(y, 9);
  expect(actual.angle).toBeCloseTo(angle, 9);
  expect(forwardOf(actual.vx, actual.vy, actual.angle)).toBeCloseTo(forward, 9);
  expect(lateralOf(actual.vx, actual.vy, actual.angle)).toBeCloseTo(lateral, 9);
}

// RE-DERIVED a second time within this same task, after the controller's ruling on the
// asymptote/90%/slip contradiction reported against `drive-vector.test.ts`: `stepDrive`'s command
// term went from explicit-Euler (`command * dt`) to the exact exponential-forcing integrator
// (`command * commandFactorOf(...)`, drive.ts). Every case below that touches a command (throttle,
// brake, or reverse) moved again as a result; "decays via drag from 300" did NOT move (coasting has
// no command at all) and is the one case whose figure survives unchanged from the first derivation.
describe("golden: stepDrive against the Unity drive-model port", () => {
  it("accelerates straight for 10 ticks", () => {
    // No lateral term at all here (steer 0), so forward alone is the story: it is well below
    // `maxSpeed` (200) after only 10 ticks — under this model wind-up is governed by `dragRate`
    // (1/s here), and 10 ticks is a third of one time constant (`1/dragRate` seconds = 30 ticks).
    expectPose(drive(body(), input(0, 1), 10), 10.9125750899, 0, 0, 56.6937378852);
  });

  it("accelerates while turning right for 10 ticks", () => {
    // Same `input(1, 1)` this case has always used. Lateral is now genuinely nonzero: the car
    // turns 0.667 rad over these 10 ticks (turnRate 2 * DT * 10) while its velocity is recomposed
    // at the OLD heading each tick (U-model drift), so it trails behind the new nose direction
    // instead of riding on rails the way the pre-port `steeringGrip: 1.0` model kept it.
    expectPose(drive(body(), input(1, 1), 10), 10.2138413518, 3.0423607314, 0.6666666667, 54.0072745122, -11.1867892243);
  });

  it("turns left under throttle for 25 ticks", () => {
    // Same `input(-1, 1)` this case has always used. RENAMED from "...capped at top speed": there
    // is no cap any more, only the asymptote `engineAccel / dragRate` (200), and forward here
    // (97.35) is still well short of it after 25 ticks under a full-lock turn — most of the
    // engine's push goes into rotating the drift rather than building straight-line speed.
    // `forward` stays positive throughout the run (tick-by-tick trace checked before recording
    // this), so `steerSenseOf` never flips: `angle` integrates at a constant `-turnRate * DT` per
    // tick the whole way, landing at exactly `-2 * DT * 25`.
    expectPose(drive(body(), input(-1, 1), 25), 31.5970409754, -36.5187702449, -1.6666666667, 97.3515910998, 25.7425032628);
  });

  it("decays via drag from 300 for 8 ticks", () => {
    // CHANGED again from the vector-drive-rework fixture (which pinned 60.122.../176.915... for a
    // PROPORTIONAL `coastPerTick` decay): the Unity port removes the dedicated coast knob entirely
    // and replaces it with the always-on drag rate `dragPerTick` (U4) — the SAME mechanism that also
    // sets top speed and wind-up now. `300 * dragPerTick^8` (dragPerTick = exp(-1/30)) hand-checked
    // against the figure below before recording it. UNCHANGED by the command-integrator ruling:
    // throttle is 0 here, so `commandFactorOf` never enters the computation at all.
    expectPose(drive(bodyAt(0, 0, 0, 300), input(0, 0), 8), 69.0576420526, 0, 0, 229.7785015094);
  });

  it("brakes from 300 toward rest over 6 ticks", () => {
    expectPose(drive(bodyAt(0, 0, 0, 300), input(0, -1), 6), 42.6119013483, 0, 0, 154.9846024624);
  });

  it("reverses from rest immediately, with no hold delay", () => {
    // CHANGED: the reverse-hold ceremony (`DRIVE_CONFIG.reverseHoldTicks`, `SimBody.reverseHold`)
    // is gone from `stepDrive`'s own logic — `engineCommandOf` reverses on the very first tick Down
    // is held, since `forward` (0) is already at or below `reverseEpsilon`. `reverseHold` itself was
    // deleted outright from `SimBody`/`PlayerState` by the Unity drive port. The magnitude (-26.4,
    // well short of the pre-port -351 reverse cap) is smaller for two reasons at once:
    // `reverseAccel` on this frozen fixture (80) is a much smaller number than the old fixture's
    // 1100, and reverse is likewise an asymptote now, not a clamp reached instantly.
    const out = drive(body(), input(0, -1), 12);
    expectPose(out, -6.0627349263, 0, 0, -26.3743963171);
  });

  it("accelerates and turns from a non-zero heading", () => {
    expectPose(drive(body({ angle: 0.7 }), input(1, 1), 15), 8.2830671932, 19.7841894395, 1.7, 72.4433972347, -17.1627604449);
  });
});

describe("golden: resolveWorld against the vector-drive rework", () => {
  const bounds = { width: 1000, height: 800 };
  // Filler for every case below that resolves against bounds/obstacles only, or where the
  // positional split is not what the case is pinning: those code paths never consult
  // `selfRamDefence` (obstacles and bounds always take `OBSTACLE_SHARE`, 1), so any positive number
  // reproduces the same numbers the pre-split fixture pinned. Real roster ratings appear ONLY in
  // "separates from another car" below, which is the one case this block exists to pin the split
  // against.
  //
  // FIX ROUND 1 (stage 3 Task 3 review): changed from 480 (an old Mirage `mass` figure, 5.5x the
  // roster's real `ramDefence` domain of 30-90) to 50 (mirage's real `ramDefence` rating). Nothing
  // below moves: every case pairing with this constant resolves only against bounds or an obstacle
  // (`OBSTACLE_SHARE` is 1 unconditionally, so `selfRamDefence` is never read), confirmed by
  // re-running the suite after the change.
  const FILLER_RAM_DEFENCE = 50;

  // REFIXTURED for stage 2 Task 1 (2026-09-06): `applyContact` no longer discards the reflected
  // direction and rebuilds a scalar along the unchanged heading — it now hands back the whole
  // reflected `vx`/`vy` — and `DRIVE_CONFIG.restitution` dropped 0.35 -> 0.15. Positions are
  // untouched (the push/MTV math never looked at velocity, only geometry), but every `forward`
  // value below is a fresh hand-derivation, not a copy of the previous fixture.
  //
  // The rule, from `applyContact`'s own doc comment, with `n` the unit push direction:
  //
  //   if dot(v, n) < 0:  v' = v - (1 + restitution) * dot(v, n) * n
  //
  // Two of the four contact cases below hit dead-on — the push normal is exactly anti-parallel to
  // the car's heading (a car driving straight into a wall or straight into another car ahead of
  // it) — so the reflected vector stays collinear with the original heading and the whole thing
  // collapses to the familiar scalar bounce `forward' = -restitution * forward`:
  //   - "bounces off the left wall": forward 200 -> -(200 * 0.15) = -30.
  //   - "separates from another car": push resolves along x only (n = (-1, 0)), and the car's
  //     velocity is already pure +x, so forward 250 -> -(250 * 0.15) = -37.5. This one is
  //     UNAFFECTED by the mass split below: `applyContact`'s normal `n` is `push / |push|`, and
  //     scaling `push` by `share` before that division cancels out of the unit vector, so the
  //     reflection math never sees `share` at all — only the POSITION half of this case moves.
  //
  // The corner case is a second axis-aligned double contact (x then y, `resolveBounds` applies one
  // `applyContact` per violated axis) that ALSO happens to stay collinear with the heading, by the
  // fixture's own symmetry rather than because the hit is dead-on:
  //   - "reflects off both walls at a corner": at 1.25π, vx = vy = 150*cos(1.25π) = -75√2. The
  //     x-contact (n=(1,0)) leaves vx' = -restitution*vx = 11.25√2 and vy untouched; the y-contact
  //     (n=(0,1)) then leaves vy' = -restitution*vy = 11.25√2 too (same algebra, vy was still -75√2
  //     going in). Final v = (11.25√2, 11.25√2) points exactly opposite the original heading
  //     (cos, sin)(1.25π) = (-√2/2, -√2/2) — same line, flipped sign — because the fixture starts
  //     the car's velocity already at 45°, matching the corner's own symmetry, so lateral is still
  //     0 here: forward = v . (cos, sin)(1.25π) = 11.25√2 * (-√2/2) * 2 = -22.5.
  //
  // The obstacle case is genuinely off-axis, and this is the one case in the block that needs its
  // `lateral` argument spelled out rather than defaulting to 0:
  //   - "separates from an obstacle": the MTV here is a single contact along world -x (n = (-1, 0),
  //     matching the unchanged push that put x at 289.5798033337405 — 291.663842667 before the
  //     2026-09-16 hull resize, see below), while the car's heading is 0.4
  //     rad — off-axis from the wall normal. vx = 180cos(0.4) = 165.7909789205193,
  //     vy = 180sin(0.4) = 70.09530161555709. Only vx reflects (n has no y component):
  //     vx' = -0.15 * vx = -24.868646838077897, vy' = vy UNCHANGED. Re-projected onto the car's
  //     frame: forward = vx'*cos(0.4) + vy'*sin(0.4) = 4.390855582568385, and
  //     lateral = -vx'*sin(0.4) + vy'*cos(0.4) = 74.24635540810061 — a large, genuinely nonzero
  //     lateral component, which is the whole point of this task: the car's forward-moving y-ish
  //     motion rides straight through a contact whose normal never touched it.
  //
  // REFIXTURED for stage 2 Task 2 (2026-09-06): `others` widened to `CarObstacle[]` and
  // `resolveWorld` gained a fifth parameter. "separates from another car" ran mirage (480, real
  // `massOf("mirage")`) against bastion (900, real `massOf("bastion")`) instead of an implicit,
  // pre-split full push, moving the POSITION half of the fixture (forward stayed untouched, per the
  // note above): `shareOf(480, 900) = 900 / 1380 = 0.6521739130434783`, `x' = 500 -
  // 18 * 0.6521739130434783 = 488.2608695652174` (exact value `500 - 270/23`).
  //
  // REFIXTURED AGAIN for stage 3 Task 3 (2026-09-06): the fifth parameter is `selfRamDefence` now,
  // and `CarObstacle.mass` is `ramDefence`, so "separates from another car" reads real
  // `ramDefenceOf` ratings instead of `massOf` ones — mirage 50, bastion 90 (NOT the roster's `mass`
  // rating of 48/90; mirage's `mass` and `ramDefence` ratings differ, bastion's happen to coincide).
  // The MTV depth is geometry, untouched by which stat divides the push (still 18 units: the cars'
  // half-widths sum to 48, their centres sit 30 apart, `48 - 30 = 18`), so only the share changes:
  // `shareOf(50, 90) = 90 / (50 + 90) = 90 / 140 = 0.6428571428571429`, `18 *
  // 0.6428571428571429 = 11.571428571428571...` of the depth instead of the pre-Task-3
  // `11.739130434782608`, so `x' = 500 - 11.571428571428571... = 488.4285714285714` (exact value
  // `500 - 81/7 = 3419/7`, repeating decimal `.428571`, rounded to the same 13-digit precision the
  // pre-Task-3 fixture used). Every other case below resolves against bounds or an obstacle, neither
  // of which yields — `OBSTACLE_SHARE` is 1 unconditionally — so their positions and the
  // `selfRamDefence` passed in are unrelated; `FILLER_RAM_DEFENCE` above documents that.
  //
  // RE-PINNED for the 2026-09-16 hull resize (60x40, spec BC14): the wall cases now settle at the
  // new half-extents — 30 ("bounces off the left wall") and (30 + 20)/2 * √2 = 35.36 at the corner
  // ("reflects off both walls at a corner"), both unchanged in `forward` since the reflection
  // algebra never touches geometry. The car case ("separates from another car") scaled its 30-unit
  // centre gap to 37.5, so depth `60 - 37.5 = 22.5` is 1.25x the old 18, and
  // `x' = 500 - 22.5 * 0.6428571428571429`. The obstacle case ("separates from an obstacle") was
  // RESCALED, not re-measured: its obstacle scaled 1.25x about the car's centre,
  // `{ x: 320, y: 290, w: 60, h: 60 }` -> `{ x: 325, y: 287.5, w: 75, h: 75 }`, so the MTV still
  // resolves along world -x against the same face and the off-axis reflection above is untouched —
  // forward 4.390855582568385 and lateral 74.24635540810061 are the pre-resize values exactly, and
  // only `x` moved (291.663842667 -> 289.5798033337405, depth 1.25x). Reading the pose off a
  // failing run of the UN-scaled obstacle instead would turn this into a dead-on hit
  // (forward -27, lateral 0) that a scalar bounce would also pass, losing the one off-axis case
  // this block exists to guard.
  // REFIXTURED for stage 2 Task 1 (2026-09-18, restitution 0.15 -> 0): the rule above,
  // `v' = v - (1 + restitution) * dot(v, n) * n`, is unchanged — only `restitution` moved, so it
  // now collapses to `v' = v - dot(v, n) * n`: the WHOLE component into the surface is removed,
  // none of it survives damped. Every position below is unchanged (the MTV/push math is pure
  // geometry and never reads velocity or `restitution` at all); only `forward`/`lateral` move, and
  // only where the old hand-derivation above actually used the value 0.15:
  //   - "bounces off the left wall": forward 200 -> -(200 * 0) = 0 (was -30).
  //   - "reflects off both walls at a corner": both contacts are still dead-on by the fixture's own
  //     symmetry, so vx' = vy' = 0 exactly (was 11.25*sqrt(2) each) and forward = 0 (was -22.5).
  //   - "separates from another car": dead-on and still unaffected by the `ramDefence` split for
  //     the same reason as before (`n` is a unit vector, `share` cancels out of it) — forward
  //     250 -> -(250 * 0) = 0 (was -37.5).
  //   - "separates from an obstacle": still the one off-axis case. vx = 165.7909789205193 is the
  //     only reflected component (n has no y part); at `restitution = 0` it is fully absorbed to
  //     exactly 0 rather than damped to -24.868646838077897, so the ENTIRE surviving velocity is
  //     the untouched vy = 70.09530161555709, re-projected onto the car's 0.4 rad frame:
  //     forward = vy * sin(0.4) = 27.296396158755115 (was 4.390855582568385), lateral =
  //     vy * cos(0.4) = 64.56204818095705 (was 74.24635540810061) — still genuinely nonzero, still
  //     the case this block exists to guard, just no longer carrying a leftover sliver of the
  //     reflected axis.
  //
  // Numbers read off a real run (`node --input-type=module` against built `dist`, per the task's
  // own re-derivation rule), not re-derived by hand alone; the hand algebra above was checked
  // against that run before being recorded.
  it("bounces off the left wall", () => {
    const out = resolveWorld(bodyAt(10, 400, Math.PI, 200), [], [], bounds, FILLER_RAM_DEFENCE);
    expectPose(out, 30, 400, Math.PI, 0);
  });

  it("reflects off both walls at a corner", () => {
    const out = resolveWorld(bodyAt(5, 4, Math.PI * 1.25, 150), [], [], bounds, FILLER_RAM_DEFENCE);
    expectPose(out, 35.3553390593, 35.3553390593, 3.926990817, 0);
  });

  it("separates from another car", () => {
    // mirage (ramDefence 50) driving into a stationary bastion (ramDefence 90) — real roster
    // ratings, not filler, since this is the one case in this block pinning the positional split
    // rather than merely surviving it.
    const other = {
      hull: { x: 537.5, y: 400, angle: 0, w: DRIVE_CONFIG.carWidth, h: DRIVE_CONFIG.carHeight },
      ramDefence: 90,
    };
    const out = resolveWorld(bodyAt(500, 400, 0, 250), [other], [], bounds, 50);
    expectPose(out, 485.5357142857143, 400, 0, 0);
  });

  it("separates from an obstacle", () => {
    const obstacle = { x: 325, y: 287.5, w: 75, h: 75 };
    const out = resolveWorld(bodyAt(300, 300, 0.4, 180), [], [obstacle], bounds, FILLER_RAM_DEFENCE);
    expectPose(out, 289.5798033337405, 300, 0.4, 27.296396158755115, 64.56204818095705);
  });

  it("leaves a free body untouched", () => {
    const out = resolveWorld(bodyAt(500, 400, 1.1, 100), [], [], bounds, FILLER_RAM_DEFENCE);
    expectPose(out, 500, 400, 1.1, 100);
  });
});
