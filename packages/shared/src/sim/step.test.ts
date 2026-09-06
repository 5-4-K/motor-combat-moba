import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "../constants.js";
import { massOf } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { RAM_CONFIG } from "../config/ram-config.js";
import { obbCorners, obbsInContact, type Obb } from "./collide.js";
import { ManeuverKind } from "./maneuver.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import { stepSim, type SimBody, type StepContext } from "./step.js";
import { forwardOf } from "./velocity.js";
import type { InputMessage } from "../net/input.js";

const DT = MS_PER_TICK / 1000;
const UP: InputMessage = { seq: 1, steer: 0, throttle: 1, fireSlots: 0 };

const EMPTY_ARENA: StepContext = {
  carId: "mirage",
  others: [],
  obstacles: [],
  bounds: { width: 800, height: 600 },
  modifiers: NEUTRAL_MODIFIERS,
  selfMass: massOf("mirage"),
};

function drive(body: SimBody, ctx: StepContext, ticks: number): SimBody {
  let next = body;
  for (let i = 0; i < ticks; i++) {
    next = stepSim(next, UP, DT, ctx);
  }
  return next;
}

describe("stepSim", () => {
  it("moves a car forward when Up is held from rest on an empty arena", () => {
    const body: SimBody = {
      x: 100,
      y: 300,
      angle: 0,
      vx: 0,
      vy: 0,
      reverseHold: 0,
      angVel: 0,
    };

    const out = stepSim(body, UP, DT, EMPTY_ARENA);

    expect(out.x).toBeGreaterThan(body.x);
    expect(out.y).toBe(body.y);
    expect(forwardOf(out.vx, out.vy, out.angle)).toBeGreaterThan(0);
    // Pure: the caller's body is untouched.
    expect(body).toEqual({
      x: 100,
      y: 300,
      angle: 0,
      vx: 0,
      vy: 0,
      reverseHold: 0,
      angVel: 0,
    });
  });

  it("stops the car at an obstacle it would otherwise have driven through", () => {
    const obstacle = { x: 400, y: 0, w: 60, h: 600 };
    const start: SimBody = {
      x: 100,
      y: 300,
      angle: 0,
      vx: 0,
      vy: 0,
      reverseHold: 0,
      angVel: 0,
    };

    const unobstructed = drive(start, EMPTY_ARENA, 60);
    const blocked = drive(start, { ...EMPTY_ARENA, obstacles: [obstacle] }, 60);

    // Without the obstacle the car is well past it; with it, the hull never crosses the near face.
    expect(unobstructed.x).toBeGreaterThan(obstacle.x);
    expect(blocked.x).toBeGreaterThan(start.x);
    expect(blocked.x + DRIVE_CONFIG.carWidth / 2).toBeLessThanOrEqual(obstacle.x);
  });

  it("keeps a car driving at a wall inside the arena bounds", () => {
    const start: SimBody = {
      x: 700,
      y: 300,
      angle: 0,
      vx: 0,
      vy: 0,
      reverseHold: 0,
      angVel: 0,
    };

    const out = drive(start, EMPTY_ARENA, 60);

    expect(out.x).toBeGreaterThan(start.x);
    expect(out.x + DRIVE_CONFIG.carWidth / 2).toBeLessThanOrEqual(EMPTY_ARENA.bounds.width);
  });
});

/**
 * `thunderclap` covers 53.3u per tick against a 48x32 hull, so before substepping the dasher
 * arrived already deep inside its target and `mtvBetween` — which returns the SHORTEST way out of
 * an overlap, not the way the car came in — ejected it sideways or out the far side. It was fully
 * deterministic in the sub-tick phase, which is exactly why it read as intermittent in play.
 *
 * A single placement measures one arbitrary point on the tick grid and would have passed against
 * the broken code for 10 of 25 phases. So this sweeps the phase, and it sweeps approach angles and
 * target orientations too: the failure band depends on which hull face is the competing escape
 * axis, so head-on-only would test one geometry out of all the ones a player produces.
 */
describe("dash substepping (spec C2 / C12 / C14)", () => {
  const DASH_SPEED = 1600; // thunderclap
  const DASH_TICKS = 8; // 400u of range at 53.3u per tick
  const TICK_TRAVEL = DASH_SPEED * DT;
  const TARGET = { x: 640, y: 360 };
  /** Clear of the target by more than a hull diagonal, and inside the dash's 400u reach. */
  const START_BACK = 240;
  const PHASE_SAMPLES = 24;

  const NO_INPUT: InputMessage = { seq: 1, steer: 0, throttle: 0, fireSlots: 0 };

  function hullOf(x: number, y: number, angle: number): Obb {
    return { x, y, angle, w: DRIVE_CONFIG.carWidth, h: DRIVE_CONFIG.carHeight };
  }

  function dasherAt(x: number, y: number, angle: number): SimBody {
    return {
      x,
      y,
      angle,
      vx: 0,
      vy: 0,
      reverseHold: 0,
      angVel: 0,
      maneuver: ManeuverKind.DASH,
      maneuverTicksLeft: DASH_TICKS,
      maneuverAngle: angle,
      maneuverSpeed: DASH_SPEED,
    };
  }

  /**
   * SAT penetration depth between two hulls, for measurement only (not exported from `collide.ts` —
   * this file has no need to change production code to observe how deep a contact still is). Mirrors
   * `mtvBetween`'s own depth computation exactly, minus the direction: the smallest axis-projected
   * overlap over both boxes' face normals, or 0 once any axis fully separates them.
   */
  function penetrationDepthOf(a: Obb, b: Obb): number {
    function axesOf(o: Obb) {
      const c = Math.cos(o.angle);
      const s = Math.sin(o.angle);
      return [
        { x: c, y: s },
        { x: -s, y: c },
      ];
    }
    function spanOf(corners: { x: number; y: number }[], axis: { x: number; y: number }) {
      let min = Infinity;
      let max = -Infinity;
      for (const p of corners) {
        const proj = p.x * axis.x + p.y * axis.y;
        if (proj < min) min = proj;
        if (proj > max) max = proj;
      }
      return { min, max };
    }
    const cornersA = obbCorners(a);
    const cornersB = obbCorners(b);
    let depth = Infinity;
    for (const axis of [...axesOf(a), ...axesOf(b)]) {
      const spanA = spanOf(cornersA, axis);
      const spanB = spanOf(cornersB, axis);
      const pushBack = spanA.max - spanB.min;
      const pushForward = spanB.max - spanA.min;
      if (pushBack <= 1e-6 || pushForward <= 1e-6) return 0;
      depth = Math.min(depth, pushBack, pushForward);
    }
    return depth;
  }

  it("never ends the dasher past the car it dashed into, and bounds how far in it can end, at every real roster mass pairing", () => {
    // Production can never hand `resolveWorld` `selfMass: 0` (share 1, the pre-mass-split
    // always-full-push rule) -- that mass does not exist on the roster. Sweep the masses a real dash
    // can actually produce instead: all 9 ordered pairings of the three chassis masses, dasher and
    // target independently, since the resolver does not care which side is doing the dashing.
    const ROSTER_MASSES = [massOf("mirage"), massOf("bullseye"), massOf("bastion")];

    const pastFailures: string[] = [];
    let worstDepth = 0;
    let worstDepthLabel = "";

    for (const selfMass of ROSTER_MASSES) {
      for (const otherMass of ROSTER_MASSES) {
        for (let deg = 0; deg < 360; deg += 30) {
          const a = (deg * Math.PI) / 180;
          const dir = { x: Math.cos(a), y: Math.sin(a) };

          for (const targetDeg of [0, 22.5, 45, 67.5]) {
            const targetAngle = (targetDeg * Math.PI) / 180;
            const targetHull = hullOf(TARGET.x, TARGET.y, targetAngle);
            const ctx: StepContext = {
              carId: "mirage",
              others: [{ hull: targetHull, mass: otherMass }],
              obstacles: [],
              bounds: { width: 1280, height: 720 },
              modifiers: NEUTRAL_MODIFIERS,
              selfMass,
            };

            // Sweep the full sub-tick phase: shifting the start by one tick's travel walks the
            // contact through every position it can occupy on the tick grid.
            for (let p = 0; p < PHASE_SAMPLES; p++) {
              const back = START_BACK + (p * TICK_TRAVEL) / PHASE_SAMPLES;
              let body = dasherAt(TARGET.x - dir.x * back, TARGET.y - dir.y * back, a);

              for (let tick = 0; tick < DASH_TICKS; tick++) {
                body = stepSim(body, NO_INPUT, DT, ctx);
                const hull = hullOf(body.x, body.y, body.angle);
                const along = (body.x - TARGET.x) * dir.x + (body.y - TARGET.y) * dir.y;
                const label = `self ${selfMass} other ${otherMass}, approach ${deg}deg, target ${targetDeg}deg, phase ${p}, tick ${tick}`;

                // Started behind the target, so the projection onto the dash axis must stay
                // negative: the dasher plants itself in front of what it hit and never comes out
                // the far side. This is the anti-tunnelling safety property dash substepping exists
                // for (C1/C2); it is unaffected by the mass split (see the derivation on
                // `shareOf` — `share` scales the push, not the contact normal) and holds exactly, in
                // every one of the 9 mass pairings below.
                if (along >= 0) {
                  pastFailures.push(`${label}: ended ${along.toFixed(1)}u PAST the target centre`);
                }

                const depth = penetrationDepthOf(hull, targetHull);
                if (depth > worstDepth) {
                  worstDepth = depth;
                  worstDepthLabel = label;
                }

                // Stop where the real lifecycle stops. `endDash` lives in the server's `ram-bridge`,
                // not in `stepSim`, so nothing here would otherwise end the dash — and a car held
                // against an ANGLED face for the remaining ticks slides along it and eventually
                // rounds it, which is ordinary resolution behaviour and not the tunnelling this
                // pins. This is the same predicate `resolveContacts` fires its `dashHit` on, so
                // breaking here ends the sweep on exactly the tick a match would.
                if (obbsInContact(hull, targetHull, RAM_CONFIG.contactPad)) break;
              }
            }
          }
        }
      }
    }

    // Half 1 (anti-tunnelling): no tolerance. A dasher ending past its target is the failure this
    // whole sweep exists to catch.
    expect(pastFailures.slice(0, 10)).toEqual([]);
    expect(pastFailures).toHaveLength(0);

    // Half 2 (penetration): no longer zero once `selfMass` is a real chassis mass instead of the
    // impossible 0. With the mass split (stage 2 Task 2), the dasher takes only `shareOf(selfMass,
    // otherMass)` of the correction on the contact tick and relies on the OTHER car conceding the
    // rest via its own `resolveWorld` call — which this sweep never runs, since it drives only the
    // dasher, matching a real target that has not yet reacted on this same tick. Momentary
    // penetration is therefore expected here and is not a bug: it decays over the following ticks
    // once the target starts conceding its own share (see `shareOf`'s doc comment), it just is not
    // reproducible in a sweep that only steps one side.
    //
    // Bound derived from this exact sweep: the worst of the 9 ordered mass pairings is bastion (900)
    // dashing into bullseye (300) — the heaviest-into-lightest pairing, share = 300/(900+300) =
    // 0.25, so the dasher corrects only a quarter of the overlap on the contact tick — measured at
    // ~26.64u against the 48x32 hull (see `worstDepthLabel` below if this ever needs re-deriving).
    // 34 leaves noticeable headroom above that without being loose enough to hide a doubled residual.
    const MAX_PENETRATION = 34;
    expect(worstDepth, `worst penetration at [${worstDepthLabel}]`).toBeLessThan(MAX_PENETRATION);
  });

  it("leaves an uncontested dash covering exactly the ground it always did", () => {
    // C13: substepping changes the contact case and nothing else. Four adds of 1600*(dt/4) can
    // differ from one 1600*dt in the last bit or two — 1e-14 units against a 48-unit car — so this
    // is close, not bit-identical, and `stepSim` already documents that cos/sin are not bit-exact
    // across engines either.
    const empty: StepContext = {
      carId: "mirage",
      others: [],
      obstacles: [],
      bounds: { width: 4000, height: 4000 },
      modifiers: NEUTRAL_MODIFIERS,
      selfMass: massOf("mirage"),
    };
    let body = dasherAt(200, 2000, 0);
    for (let tick = 0; tick < DASH_TICKS; tick++) {
      body = stepSim(body, NO_INPUT, DT, empty);
    }
    expect(body.x).toBeCloseTo(200 + DASH_SPEED * DT * DASH_TICKS, 6);
    expect(body.y).toBeCloseTo(2000, 9);
    expect(body.maneuver).toBe(ManeuverKind.NONE);
    expect(body.maneuverTicksLeft).toBe(0);
  });

  it("burns the dash's duration once per tick, not once per substep", () => {
    // The whole reason `stepDash` was split (C6): four substeps of the un-split function would
    // spend four ticks of dash in one tick of sim.
    const empty: StepContext = {
      carId: "mirage",
      others: [],
      obstacles: [],
      bounds: { width: 4000, height: 4000 },
      modifiers: NEUTRAL_MODIFIERS,
      selfMass: massOf("mirage"),
    };
    const out = stepSim(dasherAt(200, 2000, 0), NO_INPUT, DT, empty);
    expect(out.maneuverTicksLeft).toBe(DASH_TICKS - 1);
  });

  it("leaves an ordinary driving car on the single-step path", () => {
    // C9: the loop is gated on DASH explicitly. Repeated restitution within one tick is harmless
    // for a dash (its motion source is `maneuverSpeed`, and `endDash` overwrites `speed` on the
    // tick the hit lands) but would break `resolveWorld`'s "each distinct surface damps exactly
    // once" contract for ordinary driving. A driven car must reach `resolveWorld` exactly once.
    const wall: StepContext = {
      carId: "mirage",
      others: [],
      obstacles: [{ x: 300, y: 200, w: 200, h: 200 }],
      bounds: { width: 1280, height: 720 },
      modifiers: NEUTRAL_MODIFIERS,
      selfMass: massOf("mirage"),
    };
    const driving: SimBody = {
      x: 200,
      y: 300,
      angle: 0,
      vx: 300,
      vy: 0,
      reverseHold: 0,
      angVel: 0,
      maneuver: ManeuverKind.NONE,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
    };
    let body = driving;
    // Measured on the BOUNCE TICK itself, not on the equilibrium state 20 ticks later: a car driven
    // head-on into a wall with the throttle held is *supposed* to settle pinned at rest against it
    // (that is what a single, correct restitution damping converges to over many repeated contacts)
    // — asserting nonzero forward speed at tick 20 stopped discriminating anything once whole-vector
    // reflection replaced the old discard-and-rebuild-along-heading code (stage 2 task 1). What this
    // test is actually pinning, per its own name and the C9 comment above, is that ONE tick's contact
    // applies `restitution` exactly once, never r^2 or r^3 from an accidental substep loop. So watch
    // for the first tick where the sign of the forward speed flips from driving-in to bouncing-back
    // — the wall's one bounce event in this run — and check that tick's damping ratio directly.
    let prevForward = forwardOf(body.vx, body.vy, body.angle);
    let bounceForward: number | null = null;
    let preBounceForward = 0;
    for (let tick = 0; tick < 20; tick++) {
      body = stepSim(body, UP, DT, wall);
      const forward = forwardOf(body.vx, body.vy, body.angle);
      if (bounceForward === null && prevForward > 0 && forward < 0) {
        preBounceForward = prevForward;
        bounceForward = forward;
      }
      prevForward = forward;
    }

    expect(bounceForward).not.toBeNull();
    // One restitution factor off the pre-bounce forward speed: forward' = -restitution * forward.
    // A double-damped bug (the dash substep loop escaping its DASH gate and running `applyContact`
    // twice in that one tick) would instead land on forward' = +restitution^2 * forward — POSITIVE,
    // not negative, and roughly 1/13th the magnitude here (0.15^2 / 0.15 = 0.15) — so this
    // assertion's sign alone already tells the two apart; the magnitude check is belt and braces.
    expect(bounceForward).toBeCloseTo(-DRIVE_CONFIG.restitution * preBounceForward, 6);
    // Still rolling near the wall, not ejected back out past where it started.
    expect(body.x).toBeLessThan(300);
  });
});
