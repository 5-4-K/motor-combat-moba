import { beforeEach, describe, expect, it } from "vitest";
import { installMode } from "../modes/active.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../modes/registry.js";
import { MS_PER_TICK } from "../constants.js";
import { ramDefenceOf } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { RAM_CONFIG } from "../config/ram-config.js";
import { obbCorners, obbsInContact, type Obb } from "./collide.js";
import { ManeuverKind } from "./maneuver.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import { stepSim, type SimBody, type StepContext } from "./step.js";
import { forwardOf } from "./velocity.js";
import type { InputMessage } from "../net/input.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

// Also installed directly, synchronously, at module scope: `describe`/`const` bodies below run
// during test COLLECTION, which happens once, before any `beforeEach` hook ever fires. The fixture
// constants that read config (`ramDefenceOf` below) need a mode installed at that point too.
installMode(modeConfigOf(DEFAULT_GAME_MODE));

const DT = MS_PER_TICK / 1000;
const UP: InputMessage = { seq: 1, steer: 0, throttle: 1, fireSlots: 0 };

const EMPTY_ARENA: StepContext = {
  carId: "mirage",
  others: [],
  obstacles: [],
  bounds: { width: 800, height: 600 },
  modifiers: NEUTRAL_MODIFIERS,
  selfRamDefence: ramDefenceOf("mirage"),
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
      angVel: 0,
    };

    // 90 ticks (3 s), not 60: the point of the case is that the UNOBSTRUCTED run ends up past the
    // obstacle, and how far a car gets in a fixed time is a balance number. The 2026-09-16 speed cut
    // left Mirage 281 u short of the 300 it needs over 2 s, so the run was lengthened rather than the
    // 400 u obstacle moved — the obstacle's position is what the blocked assertion measures against.
    const unobstructed = drive(start, EMPTY_ARENA, 90);
    const blocked = drive(start, { ...EMPTY_ARENA, obstacles: [obstacle] }, 90);

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
      angVel: 0,
    };

    const out = drive(start, EMPTY_ARENA, 60);

    expect(out.x).toBeGreaterThan(start.x);
    expect(out.x + DRIVE_CONFIG.carWidth / 2).toBeLessThanOrEqual(EMPTY_ARENA.bounds.width);
  });
});

/**
 * `thunderclap` covers 53.3u per tick against a 60x40 hull, so before substepping the dasher
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

  it("never ends the dasher past the car it dashed into, and bounds how far in it can end, at every real roster ramDefence pairing", () => {
    // Production can never hand `resolveWorld` `selfRamDefence: 0` (share 1, the pre-split
    // always-full-push rule) -- that rating does not exist on the roster. Sweep the ramDefence
    // ratings a real dash can actually produce instead: all 9 ordered pairings of the three
    // chassis' ratings, dasher and target independently, since the resolver does not care which
    // side is doing the dashing. Renamed from a `mass` sweep in stage 3 Task 3; the roster's
    // relative ordering (bullseye < mirage < bastion) is unchanged, but mirage's ratio to the other
    // two shifted slightly (mass 480:300:900 vs ramDefence 50:30:90), so the worst-case figures
    // below are re-measured, not merely relabelled.
    const ROSTER_RAM_DEFENCES = [ramDefenceOf("mirage"), ramDefenceOf("bullseye"), ramDefenceOf("bastion")];

    const pastFailures: string[] = [];
    let worstDepth = 0;
    let worstDepthLabel = "";
    // `thunderclap` is the only dash in the game and it is Mirage-only (`wildcharge` is a `charge`,
    // not a `dash`), so of the 9 pairings below only the 3 where `selfRamDefence` is Mirage's are
    // ones a player can ever produce. Track those separately for a tighter bound than the full
    // sweep needs.
    const MIRAGE_RAM_DEFENCE = ramDefenceOf("mirage");
    let worstReachableDepth = 0;
    let worstReachableDepthLabel = "";

    for (const selfRamDefence of ROSTER_RAM_DEFENCES) {
      for (const otherRamDefence of ROSTER_RAM_DEFENCES) {
        for (let deg = 0; deg < 360; deg += 30) {
          const a = (deg * Math.PI) / 180;
          const dir = { x: Math.cos(a), y: Math.sin(a) };

          for (const targetDeg of [0, 22.5, 45, 67.5]) {
            const targetAngle = (targetDeg * Math.PI) / 180;
            const targetHull = hullOf(TARGET.x, TARGET.y, targetAngle);
            const ctx: StepContext = {
              carId: "mirage",
              others: [{ hull: targetHull, ramDefence: otherRamDefence }],
              obstacles: [],
              bounds: { width: 1280, height: 720 },
              modifiers: NEUTRAL_MODIFIERS,
              selfRamDefence,
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
                const label = `self ${selfRamDefence} other ${otherRamDefence}, approach ${deg}deg, target ${targetDeg}deg, phase ${p}, tick ${tick}`;

                // Started behind the target, so the projection onto the dash axis must stay
                // negative: the dasher plants itself in front of what it hit and never comes out
                // the far side. This is the anti-tunnelling safety property dash substepping exists
                // for (C1/C2); it is unaffected by the split (see the derivation on
                // `shareOf` — `share` scales the push, not the contact normal) and holds exactly, in
                // every one of the 9 ramDefence pairings below.
                if (along >= 0) {
                  pastFailures.push(`${label}: ended ${along.toFixed(1)}u PAST the target centre`);
                }

                const depth = penetrationDepthOf(hull, targetHull);
                if (depth > worstDepth) {
                  worstDepth = depth;
                  worstDepthLabel = label;
                }
                if (selfRamDefence === MIRAGE_RAM_DEFENCE && depth > worstReachableDepth) {
                  worstReachableDepth = depth;
                  worstReachableDepthLabel = label;
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

    // Half 2 (penetration): no longer zero once `selfRamDefence` is a real chassis rating instead of
    // the impossible 0. With the positional split (stage 2 Task 2), the dasher takes only
    // `shareOf(selfRamDefence, otherRamDefence)` of the correction on the contact tick and relies on
    // the OTHER car conceding the rest via its own `resolveWorld` call — which this sweep never runs,
    // since it drives only the dasher, matching a real target that has not yet reacted on this same
    // tick. Momentary penetration is therefore expected here and is not a bug: it decays over the
    // following ticks once the target starts conceding its own share (see `shareOf`'s doc comment),
    // it just is not reproducible in a sweep that only steps one side.
    //
    // Bound derived from this exact sweep: the worst of the 9 ordered pairings is bastion (ramDefence
    // 90) dashing into bullseye (ramDefence 30) — the most-solid-into-least-solid pairing, share =
    // 30/(90+30) = 0.25, so the dasher corrects only a quarter of the overlap on the contact tick.
    // That share is UNCHANGED from the pre-Task-3 `mass` sweep (bastion 900 into bullseye 300 was also
    // share 300/1200 = 0.25 — same ratio, just scaled 10x), so the measured worst depth is unchanged
    // too: ~26.64u against the 60x40 hull (see `worstDepthLabel` below if this ever needs
    // re-deriving). 34 leaves noticeable headroom above that without being loose enough to hide a
    // doubled residual.
    //
    // Re-measured 2026-09-16 for the 60x40 hull resize (spec BC11), same sweep and method: the worst
    // depth came back at 26.640625000000227, the pre-resize 48x32 measurement (26.640625) to within
    // float noise. That is not a bug — this figure is driven by `dashSubstepMaxUnits` (still 16,
    // unscaled by the hull) and the ramDefence-weighted share, neither of which the hull resize
    // touched. The resolver does read the hull on this path (`collide.ts`'s `carObbOf` builds every
    // car OBB from `DRIVE_CONFIG.carWidth`/`carHeight`); the resize moved which sweep cell reaches
    // the worst case (the label now reads a 180deg approach, phase 16, where 48x32 read 90deg,
    // phase 7) but not the depth it reaches. `MAX_PENETRATION` therefore needed no change.
    const MAX_PENETRATION = 34;
    expect(worstDepth, `worst penetration at [${worstDepthLabel}]`).toBeLessThan(MAX_PENETRATION);

    // Half 3 (reachable subset): the 34u bound above covers the resolver's full symmetric
    // behaviour, including pairings (bastion dashing) that cannot happen in a real match — nothing
    // in `WEAPON_TABLE` gives Bastion or Bullseye a `type: "dash"` maneuver, only Mirage's
    // `thunderclap`. That headroom is real resolver coverage and stays, but it is nearly 2x looser
    // than what a player can ever see, so a regression that doubled Mirage's actual worst case would
    // still pass it silently. Pin the Mirage-as-dasher subset separately, with headroom picked the
    // same way `MAX_PENETRATION` was: enough to absorb measurement noise across the phase/angle
    // sweep, not enough to hide a doubled residual.
    //
    // UNLIKE the bastion/bullseye pairing above, this figure DOES move under stage 3 Task 3: mirage's
    // ramDefence-to-others ratio (50:30 and 50:90) is not quite the same as its old mass-to-others
    // ratio (480:300 and 480:900, since 48 — mirage's `mass` rating — and 50 — its `ramDefence`
    // rating — differ), so mirage's own worst-case share shifts slightly. Re-measured directly from
    // this exact sweep (not hand-derived from the pre-Task-3 17.96u figure, and not pasted from a
    // one-off run either — re-run this test with the bound removed, or read
    // `worstReachableDepthLabel`, if this ever needs re-deriving again): mirage (ramDefence 50)
    // dashing into bullseye (ramDefence 30), 180deg approach, 0deg target, phase 16 tick 4 —
    // 18.49229600694457u. Applying the full bound's own headroom ratio (34 / 26.640625, its worst
    // case) to that gives ~23.6u; a doubled residual (~37.0u) would still fail it comfortably, so it
    // still discriminates.
    //
    // Re-measured 2026-09-16 for the 60x40 hull resize (spec BC11), same sweep and method: the worst
    // reachable depth came back at 18.49229600694457 against the 60x40 hull, the pre-resize
    // 18.492296006944457 to within float noise, for the same reason as `MAX_PENETRATION` above —
    // `dashSubstepMaxUnits` and the ramDefence shares are what this number tracks, and neither moved
    // with the hull. Only the last digits of the pin and the sweep cell it is reached in moved, so
    // `MAX_REACHABLE_PENETRATION`'s headroom is unchanged.
    const MEASURED_WORST_REACHABLE = 18.49229600694457;
    const MAX_REACHABLE_PENETRATION = MEASURED_WORST_REACHABLE * (MAX_PENETRATION / 26.640625);
    expect(
      worstReachableDepth,
      `worst reachable (Mirage-as-dasher) penetration at [${worstReachableDepthLabel}]`,
    ).toBeLessThan(MAX_REACHABLE_PENETRATION);
  });

  it("leaves an uncontested dash covering exactly the ground it always did", () => {
    // C13: substepping changes the contact case and nothing else. Four adds of 1600*(dt/4) can
    // differ from one 1600*dt in the last bit or two — 1e-14 units against a 60-unit car — so this
    // is close, not bit-identical, and `stepSim` already documents that cos/sin are not bit-exact
    // across engines either.
    const empty: StepContext = {
      carId: "mirage",
      others: [],
      obstacles: [],
      bounds: { width: 4000, height: 4000 },
      modifiers: NEUTRAL_MODIFIERS,
      selfRamDefence: ramDefenceOf("mirage"),
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
      selfRamDefence: ramDefenceOf("mirage"),
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
      selfRamDefence: ramDefenceOf("mirage"),
    };
    const driving: SimBody = {
      x: 200,
      y: 300,
      angle: 0,
      vx: 300,
      vy: 0,
      angVel: 0,
      maneuver: ManeuverKind.NONE,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
    };
    // RE-PINNED for stage 2 Task 1 (2026-09-18, restitution 0.15 -> 0): the sign-flip / damping-
    // ratio technique this test used to rely on is no longer able to tell a correct single contact
    // from a hypothetical escaped-dash-substep double contact. `applyContact` at `restitution: 0`
    // is an idempotent projection (`v' = v - (v.n)n`, and projecting an already-projected vector a
    // second time changes nothing — see `DRIVE_CONFIG.restitution`'s doc comment), so BOTH the
    // correct path and the buggy one this test was written to catch converge on the exact same
    // dead-stop `forward = 0`. A damping-ratio check can no longer distinguish them; measured
    // directly (this test, pre-fix): `bounceForward` was never negative at all any more, because a
    // head-on hit at `restitution: 0` never overshoots past zero to trigger the old sign-flip
    // detector, so `bounceForward` stayed `null` for the whole 20-tick run.
    //
    // What DOES still distinguish the two paths: `resolveDash`'s substep loop (`step.ts`) re-walks
    // position from the TICK-START `body.x`/`body.y` and adds `dashTranslation`, which is derived
    // from `maneuverSpeed` — 0 on this ordinary driving car. If the DASH gate (`isDashing`) ever
    // mis-fired for a non-dashing body, `stepSim` would take that branch instead of the plain
    // `resolveWorld` call, and the car would sit frozen at its starting `x` every tick (translated
    // by a zero dash speed) rather than actually driving forward under `stepDrive`'s integration.
    // That is now the test's discriminator: driving one ordinary tick, well clear of the obstacle,
    // MUST advance `x` — a frozen `x` is exactly what the escaped-gate bug looks like.
    let body = driving;
    const startX = body.x;
    body = stepSim(body, UP, DT, wall);
    expect(body.x).toBeGreaterThan(startX);

    for (let tick = 1; tick < 20; tick++) {
      body = stepSim(body, UP, DT, wall);
    }
    // Settled against the obstacle: a dead stop under the zero-restitution contract, not a
    // rebound, and never tunnelled past the face it struck.
    expect(forwardOf(body.vx, body.vy, body.angle)).toBeCloseTo(0, 6);
    expect(body.x).toBeLessThan(300);
  });
});
