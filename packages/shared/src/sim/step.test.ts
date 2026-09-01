import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "../constants.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { RAM_CONFIG } from "../config/ram-config.js";
import { obbsInContact, obbsOverlap, type Obb } from "./collide.js";
import { ManeuverKind } from "./maneuver.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import { stepSim, type SimBody, type StepContext } from "./step.js";
import type { InputMessage } from "../net/input.js";

const DT = MS_PER_TICK / 1000;
const UP: InputMessage = { seq: 1, steer: 0, throttle: 1, fireSlots: 0 };

const EMPTY_ARENA: StepContext = {
  carId: "mirage",
  others: [],
  obstacles: [],
  bounds: { width: 800, height: 600 },
  modifiers: NEUTRAL_MODIFIERS,
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
      speed: 0,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };

    const out = stepSim(body, UP, DT, EMPTY_ARENA);

    expect(out.x).toBeGreaterThan(body.x);
    expect(out.y).toBe(body.y);
    expect(out.speed).toBeGreaterThan(0);
    // Pure: the caller's body is untouched.
    expect(body).toEqual({
      x: 100,
      y: 300,
      angle: 0,
      speed: 0,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    });
  });

  it("stops the car at an obstacle it would otherwise have driven through", () => {
    const obstacle = { x: 400, y: 0, w: 60, h: 600 };
    const start: SimBody = {
      x: 100,
      y: 300,
      angle: 0,
      speed: 0,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
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
      speed: 0,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
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
      speed: 0,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
      maneuver: ManeuverKind.DASH,
      maneuverTicksLeft: DASH_TICKS,
      maneuverAngle: angle,
      maneuverSpeed: DASH_SPEED,
    };
  }

  it("never leaves the dasher inside or past the car it dashed into, from any phase or angle", () => {
    const failures: string[] = [];

    for (let deg = 0; deg < 360; deg += 30) {
      const a = (deg * Math.PI) / 180;
      const dir = { x: Math.cos(a), y: Math.sin(a) };

      for (const targetDeg of [0, 22.5, 45, 67.5]) {
        const targetAngle = (targetDeg * Math.PI) / 180;
        const targetHull = hullOf(TARGET.x, TARGET.y, targetAngle);
        const ctx: StepContext = {
          carId: "mirage",
          others: [targetHull],
          obstacles: [],
          bounds: { width: 1280, height: 720 },
          modifiers: NEUTRAL_MODIFIERS,
        };

        // Sweep the full sub-tick phase: shifting the start by one tick's travel walks the contact
        // through every position it can occupy on the tick grid.
        for (let p = 0; p < PHASE_SAMPLES; p++) {
          const back = START_BACK + (p * TICK_TRAVEL) / PHASE_SAMPLES;
          let body = dasherAt(TARGET.x - dir.x * back, TARGET.y - dir.y * back, a);

          for (let tick = 0; tick < DASH_TICKS; tick++) {
            body = stepSim(body, NO_INPUT, DT, ctx);
            const hull = hullOf(body.x, body.y, body.angle);
            const along = (body.x - TARGET.x) * dir.x + (body.y - TARGET.y) * dir.y;
            const label = `approach ${deg}deg, target ${targetDeg}deg, phase ${p}, tick ${tick}`;

            // Started behind the target, so the projection onto the dash axis must stay negative:
            // the dasher plants itself in front of what it hit and never comes out the far side.
            if (along >= 0) failures.push(`${label}: ended ${along.toFixed(1)}u PAST the target centre`);
            if (obbsOverlap(hull, targetHull)) failures.push(`${label}: ended INSIDE the target hull`);

            // Stop where the real lifecycle stops. `endDash` lives in the server's `ram-bridge`,
            // not in `stepSim`, so nothing here would otherwise end the dash — and a car held
            // against an ANGLED face for the remaining ticks slides along it and eventually rounds
            // it, which is ordinary resolution behaviour and not the tunnelling this pins. This is
            // the same predicate `resolveContacts` fires its `dashHit` on, so breaking here ends
            // the sweep on exactly the tick a match would.
            if (obbsInContact(hull, targetHull, RAM_CONFIG.contactPad)) break;
          }
        }
      }
    }

    expect(failures.slice(0, 10)).toEqual([]);
    expect(failures).toHaveLength(0);
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
    };
    const driving: SimBody = {
      x: 200,
      y: 300,
      angle: 0,
      speed: 300,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
      maneuver: ManeuverKind.NONE,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
    };
    let body = driving;
    for (let tick = 0; tick < 20; tick++) body = stepSim(body, UP, DT, wall);
    // One bounce off one surface: speed is damped by `restitution` once, never r^2 or r^3, so a
    // car that hit the wall is still rolling rather than stopped dead by repeated damping.
    expect(body.x).toBeLessThan(300);
    expect(Math.abs(body.speed)).toBeGreaterThan(0);
  });
});
