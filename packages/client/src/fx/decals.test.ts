import { describe, expect, it } from "vitest";
import {
  decalFadeAlpha,
  decalStampsFor,
  DECAL_HALF_LIFE_MS,
  TYRE_MARK_MAX_STEP,
  TYRE_MARK_SPACING,
  TYRE_MARK_SPEED_FLOOR,
  tyreMarkSteps,
  tyreMarksFor,
} from "./decals.js";

describe("decalStampsFor", () => {
  it("scorches the ground where a shot ended", () => {
    const stamps = decalStampsFor({ kind: "shotEnded", weaponId: "magmablast", x: 40, y: 50, angle: 0 });
    expect(stamps).toHaveLength(1);
    expect(stamps[0]).toMatchObject({ kind: "scorch", x: 40, y: 50 });
  });

  it("scorches harder for an explosion than for a beam's far end", () => {
    const blast = decalStampsFor({ kind: "shotEnded", weaponId: "magmablast", x: 0, y: 0, angle: 0 });
    const beam = decalStampsFor({ kind: "shotEnded", weaponId: "lance", x: 0, y: 0, angle: 0 });
    expect(blast[0].scale).toBeGreaterThan(beam[0].scale);
  });

  it("scorches a death site", () => {
    expect(decalStampsFor({ kind: "died", sessionId: "a", x: 1, y: 2 })).toHaveLength(1);
  });

  it("leaves nothing for a muzzle flash or a scratch — the floor would fill with noise", () => {
    expect(decalStampsFor({ kind: "shotFired", weaponId: "lance", x: 0, y: 0, angle: 0 })).toEqual([]);
    expect(decalStampsFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 9 })).toEqual([]);
  });
});

describe("tyreMarksFor", () => {
  it("lays two marks, one per side of the car", () => {
    const marks = tyreMarksFor({ x: 100, y: 100, angle: 0 }, 200);
    expect(marks).toHaveLength(2);
    // Angle 0 means facing +x, so the two tracks straddle the car in y.
    expect(marks[0].y).not.toBe(marks[1].y);
    expect(marks[0].x).toBeCloseTo(100, 6);
  });

  it("puts the marks perpendicular to the heading, so they turn with the car", () => {
    const marks = tyreMarksFor({ x: 0, y: 0, angle: Math.PI / 2 }, 200);
    // Facing +y now, so the tracks straddle in x instead.
    expect(marks[0].x).not.toBe(marks[1].x);
    expect(marks[0].y).toBeCloseTo(0, 6);
  });

  it("lays nothing below the speed floor — a trail is a skid mark, not a record of parking", () => {
    expect(tyreMarksFor({ x: 0, y: 0, angle: 0 }, TYRE_MARK_SPEED_FLOOR - 1)).toEqual([]);
  });

  it("keeps a mark light but individually visible", () => {
    // Each mark is stamped ONCE per frame from the ring buffer, so unlike an accumulating layer it
    // has to read on its own — but a trail must still say rubber rather than ink.
    for (const mark of tyreMarksFor({ x: 0, y: 0, angle: 0 }, 300)) {
      expect(mark.alpha).toBeGreaterThan(0.05);
      expect(mark.alpha).toBeLessThan(0.35);
    }
  });
});

describe("decalFadeAlpha", () => {
  it("is fully opaque the moment it is laid", () => {
    expect(decalFadeAlpha(0)).toBe(1);
  });

  it("is half faded after one half-life", () => {
    expect(decalFadeAlpha(DECAL_HALF_LIFE_MS)).toBeCloseTo(0.5, 5);
  });

  it("decays monotonically", () => {
    expect(decalFadeAlpha(1000)).toBeGreaterThan(decalFadeAlpha(2000));
  });

  it("reaches zero rather than lingering forever at a hair above it", () => {
    expect(decalFadeAlpha(10 * 60 * 1000)).toBe(0);
  });

  it("never returns a negative alpha for a nonsense age", () => {
    expect(decalFadeAlpha(-500)).toBeLessThanOrEqual(1);
    expect(decalFadeAlpha(-500)).toBeGreaterThanOrEqual(0);
  });
});

describe("tyreMarkSteps", () => {
  it("lays nothing until a full spacing has been travelled", () => {
    expect(tyreMarkSteps(0, TYRE_MARK_SPACING - 0.01).fractions).toEqual([]);
    expect(tyreMarkSteps(0, TYRE_MARK_SPACING).fractions).toHaveLength(1);
  });

  it("carries the remainder forward instead of resetting it, so spacing does not drift", () => {
    // The bug this replaced: the old clock was stamped with `now` rather than advanced by the
    // interval, so every frame's overshoot was thrown away and the real spacing was frame-rate
    // dependent. Ten short frames must produce exactly the marks the distance pays for.
    let carry = 0;
    let marks = 0;
    for (let frame = 0; frame < 10; frame++) {
      const step = tyreMarkSteps(carry, 2);
      marks += step.fractions.length;
      carry = step.carry;
    }
    expect(marks).toBe(Math.floor(20 / TYRE_MARK_SPACING));
    expect(carry).toBeCloseTo(20 - marks * TYRE_MARK_SPACING, 10);
  });

  it("lays the same marks per unit travelled however the travel is split across frames", () => {
    // This IS the frame-rate independence claim, stated as a test rather than as a comment.
    const run = (frames: number, total: number): number => {
      let carry = 0;
      let marks = 0;
      for (let i = 0; i < frames; i++) {
        const step = tyreMarkSteps(carry, total / frames);
        marks += step.fractions.length;
        carry = step.carry;
      }
      return marks;
    };
    // 300 units at 144fps-sized steps against 30fps-sized ones, both well under the teleport guard.
    expect(run(160, 300)).toBe(run(34, 300));
  });

  it("spaces marks closely enough to overlap, so the trail is a line and not a dotted one", () => {
    const dabDiameter = tyreMarksFor({ x: 0, y: 0, angle: 0 }, 200)[0].radius * 2;
    expect(TYRE_MARK_SPACING).toBeLessThan(dabDiameter);
  });

  it("places several marks in one long frame, evenly along the segment", () => {
    const { fractions } = tyreMarkSteps(0, TYRE_MARK_SPACING * 3);
    expect(fractions).toHaveLength(3);
    expect(fractions[0]).toBeCloseTo(1 / 3, 10);
    expect(fractions[1]).toBeCloseTo(2 / 3, 10);
    expect(fractions[2]).toBeCloseTo(1, 10);
  });

  it("draws nothing through a teleport, and restarts the trail on the far side", () => {
    // A respawn or a reconciliation snap. Spacing by distance would otherwise faithfully paint a
    // rubber line across the whole arena.
    const step = tyreMarkSteps(3, TYRE_MARK_MAX_STEP + 1);
    expect(step.fractions).toEqual([]);
    expect(step.carry).toBe(0);
  });

  it("keeps the carry across a frame in which the car did not move", () => {
    expect(tyreMarkSteps(3.2, 0)).toEqual({ fractions: [], carry: 3.2 });
  });
});
