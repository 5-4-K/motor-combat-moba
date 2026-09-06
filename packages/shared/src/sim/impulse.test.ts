import { describe, expect, it } from "vitest";
import { RAM_CONFIG } from "../config/ram-config.js";
import { applyImpulse, reactionOf, type Impulse } from "./impulse.js";
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
  it("adds the push to the victim's velocity rather than replacing it", () => {
    const next = applyImpulse(body({ vx: 100, vy: 0 }), 500, impulse({ defenceScaled: false }));
    expect(next.vx).toBeCloseTo(100); // the car keeps driving
    expect(next.vy).toBeCloseTo(200); // and is also thrown
  });

  it("moves a light car further than a heavy one under the same impulse", () => {
    const light = applyImpulse(body(), 300, impulse());
    const heavy = applyImpulse(body(), 900, impulse());
    expect(Math.abs(light.vy)).toBeGreaterThan(Math.abs(heavy.vy));
  });

  it("ignores mass entirely when defenceScaled is false", () => {
    const light = applyImpulse(body(), 300, impulse({ defenceScaled: false }));
    const heavy = applyImpulse(body(), 900, impulse({ defenceScaled: false }));
    expect(light.vy).toBeCloseTo(heavy.vy);
  });

  it("imparts no spin for a dead-centre hit, where the lever arm is zero", () => {
    // Contact at the victim's own centre: force and lever are colinear, torque is zero.
    const next = applyImpulse(body(), 500, impulse({ contactX: 0, contactY: 0 }));
    expect(next.angVel).toBeCloseTo(0);
  });

  it("imparts spin for an off-centre hit", () => {
    const next = applyImpulse(body(), 500, impulse({ contactX: 20, contactY: 0 }));
    expect(Math.abs(next.angVel)).toBeGreaterThan(0);
  });

  it("imparts no spin at all when the def asks for none", () => {
    const next = applyImpulse(body(), 500, impulse({ contactX: 20, contactY: 0, spin: 0 }));
    expect(next.angVel).toBeCloseTo(0);
  });

  it("preserves the victim's existing spin when the impulse asks for none, rather than cancelling it", () => {
    // A zero-spin impulse is an early return in `nextSpin`, not an assignment of 0 — a deliberate
    // change from the pre-`Impulse` slam path, which did `player.angVel = knock.angVel` and so zeroed
    // a spinning victim outright. A victim already spinning from an earlier hit must keep that spin
    // when hit by a `spin: 0` push (e.g. a hard slam's clean straight punt).
    const spinning = body({ angVel: 2 });
    const next = applyImpulse(spinning, 500, impulse({ contactX: 20, contactY: 0, spin: 0 }));
    expect(next.angVel).toBe(2);
  });

  it("clamps spin to the configured ceiling", () => {
    const next = applyImpulse(body(), 1, impulse({ contactX: 24, speed: 100000, spin: 10 }));
    expect(Math.abs(next.angVel)).toBeLessThanOrEqual(RAM_CONFIG.spinMaxRate);
  });

  it("leaves position and facing alone", () => {
    const next = applyImpulse(body({ x: 5, y: 7, angle: 1.1 }), 500, impulse());
    expect(next.x).toBe(5);
    expect(next.y).toBe(7);
    expect(next.angle).toBe(1.1);
  });

  it("robs the victim's forward momentum when the push opposes its heading", () => {
    // Spec P15: this falls out of vector addition rather than being special-cased. A car doing 200
    // forward, hit from in front, is slowed — no code anywhere reaches in and sets its speed down.
    const driving = body({ vx: 200, vy: 0 }); // facing +x, driving +x
    const headOn = impulse({ dirX: -1, dirY: 0, defenceScaled: false, speed: 150 });
    const next = applyImpulse(driving, 500, headOn);
    expect(forwardOf(next.vx, next.vy, next.angle)).toBeCloseTo(50);
  });

  it("leaves forward momentum untouched for a perfectly perpendicular hit", () => {
    // The one case where it should NOT be robbed, and it also falls out for free.
    const driving = body({ vx: 200, vy: 0 });
    const perpendicular = impulse({ dirX: 0, dirY: 1, defenceScaled: false, speed: 150 });
    const next = applyImpulse(driving, 500, perpendicular);
    expect(forwardOf(next.vx, next.vy, next.angle)).toBeCloseTo(200);
  });

  it("clamps the mass factor so no chassis degenerates at either extreme", () => {
    const featherweight = applyImpulse(body(), 1, impulse());
    expect(Math.abs(featherweight.vy)).toBeLessThanOrEqual(
      impulse().speed * RAM_CONFIG.massFactorMax + 1e-6,
    );
  });
});

describe("reactionOf", () => {
  it("points the opposite way with the same magnitude", () => {
    const imp = impulse({ dirX: 0, dirY: 1, speed: 200 });
    const back = reactionOf(imp);
    expect(back.dirX).toBeCloseTo(0);
    expect(back.dirY).toBeCloseTo(-1);
    expect(back.speed).toBeCloseTo(200);
  });

  it("carries no uncontrol — being the attacker is not being rammed", () => {
    expect(reactionOf(impulse({ uncontrolTicks: 30 })).uncontrolTicks).toBe(0);
  });

  it("carries no spin — the attacker's own lever arm is a separate question", () => {
    expect(reactionOf(impulse({ spin: 1 })).spin).toBe(0);
  });

  it("forces defenceScaled: true even when the source impulse was unscaled", () => {
    // The one field of the four `reactionOf` overrides unconditionally, and the surprising one: a
    // hard slam's victim push is `defenceScaled: false` (every chassis takes the same knock), but the
    // reaction charged back onto the attacker is ALWAYS divided by the attacker's own mass. This is
    // the single line that makes a heavy attacker's own slam recoil smaller than the fixed knock it
    // just dealt — see `SLAM_CONFIG.knockSpeed`'s doc comment for the measured Bastion case.
    expect(reactionOf(impulse({ defenceScaled: false })).defenceScaled).toBe(true);
  });
});
