import { describe, expect, it } from "vitest";
import { RAM_CONFIG } from "../config/ram-config.js";
import { applyImpulse, type Impulse } from "./impulse.js";
import type { SimBody } from "./step.js";
import { forwardOf } from "./velocity.js";

function body(over: Partial<SimBody> = {}): SimBody {
  return {
    x: 0, y: 0, angle: 0, vx: 0, vy: 0, reverseHold: 0, angVel: 0,
    maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
    ...over,
  };
}

function impulse(over: Partial<Impulse> = {}): Impulse {
  return {
    dirX: 0, dirY: 1, speed: 200, spin: 1, defenceScaled: true,
    uncontrolTicks: 30, contactX: 0, contactY: 0,
    ...over,
  };
}

describe("applyImpulse", () => {
  // FIX ROUND 1 (stage 3 Task 3 review): every `ramDefence` argument in this describe block used to
  // be 500 — the old `RAM_REFERENCE_MASS` neutral point, carried over unchanged when the parameter
  // was renamed from `mass`. As a `ramDefence` it is 5.5x the roster maximum (30-90), so a
  // `defenceScaled: true` case (the default from `impulse()`) divided by a value nothing in the game
  // can produce. None of the assertions below actually pin a magnitude that depends on which
  // in-domain value is used — they check sign, closeness to a `defenceScaled: false` pass-through,
  // or position/facing being untouched — so swapping in a real roster rating (50, mirage's) changes
  // no expected value and keeps every assertion exactly as strong. `applyImpulse scales by
  // ramDefence` below is the block that actually exercises the 30-vs-90 comparison.
  it("adds the push to the victim's velocity rather than replacing it", () => {
    const next = applyImpulse(body({ vx: 100, vy: 0 }), 50, impulse({ defenceScaled: false }));
    expect(next.vx).toBeCloseTo(100); // the car keeps driving
    expect(next.vy).toBeCloseTo(200); // and is also thrown
  });

  it("imparts no spin for a dead-centre hit, where the lever arm is zero", () => {
    // Contact at the victim's own centre: force and lever are colinear, torque is zero.
    const next = applyImpulse(body(), 50, impulse({ contactX: 0, contactY: 0 }));
    expect(next.angVel).toBeCloseTo(0);
  });

  it("imparts spin for an off-centre hit", () => {
    const next = applyImpulse(body(), 50, impulse({ contactX: 20, contactY: 0 }));
    expect(Math.abs(next.angVel)).toBeGreaterThan(0);
  });

  it("imparts no spin at all when the def asks for none", () => {
    const next = applyImpulse(body(), 50, impulse({ contactX: 20, contactY: 0, spin: 0 }));
    expect(next.angVel).toBeCloseTo(0);
  });

  it("preserves the victim's existing spin when the impulse asks for none, rather than cancelling it", () => {
    // A zero-spin impulse is an early return in `nextSpin`, not an assignment of 0 — a deliberate
    // change from the pre-`Impulse` slam path, which did `player.angVel = knock.angVel` and so zeroed
    // a spinning victim outright. A victim already spinning from an earlier hit must keep that spin
    // when hit by a `spin: 0` push (e.g. a hard slam's clean straight punt).
    const spinning = body({ angVel: 2 });
    const next = applyImpulse(spinning, 50, impulse({ contactX: 20, contactY: 0, spin: 0 }));
    expect(next.angVel).toBe(2);
  });

  it("clamps spin to the configured ceiling", () => {
    const next = applyImpulse(body(), 1, impulse({ contactX: 24, speed: 100000, spin: 10 }));
    expect(Math.abs(next.angVel)).toBeLessThanOrEqual(RAM_CONFIG.spinMaxRate);
  });

  it("leaves position and facing alone", () => {
    const next = applyImpulse(body({ x: 5, y: 7, angle: 1.1 }), 50, impulse());
    expect(next.x).toBe(5);
    expect(next.y).toBe(7);
    expect(next.angle).toBe(1.1);
  });

  it("robs the victim's forward momentum when the push opposes its heading", () => {
    // Spec P15: this falls out of vector addition rather than being special-cased. A car doing 200
    // forward, hit from in front, is slowed — no code anywhere reaches in and sets its speed down.
    const driving = body({ vx: 200, vy: 0 }); // facing +x, driving +x
    const headOn = impulse({ dirX: -1, dirY: 0, defenceScaled: false, speed: 150 });
    const next = applyImpulse(driving, 50, headOn);
    expect(forwardOf(next.vx, next.vy, next.angle)).toBeCloseTo(50);
  });

  it("leaves forward momentum untouched for a perfectly perpendicular hit", () => {
    // The one case where it should NOT be robbed, and it also falls out for free.
    const driving = body({ vx: 200, vy: 0 });
    const perpendicular = impulse({ dirX: 0, dirY: 1, defenceScaled: false, speed: 150 });
    const next = applyImpulse(driving, 50, perpendicular);
    expect(forwardOf(next.vx, next.vy, next.angle)).toBeCloseTo(200);
  });
});

describe("applyImpulse scales by ramDefence", () => {
  it("moves a flimsy car further than a solid one under the same impulse", () => {
    const flimsy = applyImpulse(body(), 30, impulse());
    const solid = applyImpulse(body(), 90, impulse());
    expect(Math.abs(flimsy.vy)).toBeGreaterThan(Math.abs(solid.vy));
  });

  it("ignores ramDefence entirely when defenceScaled is false", () => {
    const flimsy = applyImpulse(body(), 30, impulse({ defenceScaled: false }));
    const solid = applyImpulse(body(), 90, impulse({ defenceScaled: false }));
    expect(flimsy.vy).toBeCloseTo(solid.vy);
  });
});
