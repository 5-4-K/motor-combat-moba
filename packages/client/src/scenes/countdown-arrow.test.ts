import { describe, expect, it } from "vitest";
import {
  ARROW_BOB_AMPLITUDE_PX,
  ARROW_BOB_PERIOD_MS,
  ARROW_GAP_PX,
  ARROW_HEIGHT_PX,
  ARROW_WIDTH_PX,
  arrowBobOffset,
  countdownArrowPoints,
} from "./countdown-arrow.js";

describe("arrowBobOffset", () => {
  it("stays inside its amplitude for any clock, including one that has run all day", () => {
    // Sampled rather than exhaustive, and deliberately off a round divisor of the period so the
    // samples walk the whole cycle instead of landing on the same few phases.
    const dayMs = 24 * 60 * 60 * 1000;
    let peak = 0;
    for (let ms = 0; ms < dayMs; ms += 997) peak = Math.max(peak, Math.abs(arrowBobOffset(ms)));
    expect(peak).toBeLessThanOrEqual(ARROW_BOB_AMPLITUDE_PX);
    expect(peak).toBeCloseTo(ARROW_BOB_AMPLITUDE_PX, 2);
  });

  it("repeats every period, so the motion never drifts against the clock", () => {
    for (const ms of [0, 123, 450, 899]) {
      expect(arrowBobOffset(ms + ARROW_BOB_PERIOD_MS)).toBeCloseTo(arrowBobOffset(ms), 6);
      expect(arrowBobOffset(ms + 10 * ARROW_BOB_PERIOD_MS)).toBeCloseTo(arrowBobOffset(ms), 6);
    }
  });

  it("actually moves — half a period apart is the full swing", () => {
    expect(arrowBobOffset(ARROW_BOB_PERIOD_MS / 4)).toBeCloseTo(ARROW_BOB_AMPLITUDE_PX, 6);
    expect(arrowBobOffset((3 * ARROW_BOB_PERIOD_MS) / 4)).toBeCloseTo(-ARROW_BOB_AMPLITUDE_PX, 6);
  });
});

describe("countdownArrowPoints", () => {
  /**
   * "Screen-up" is a shape claim, not a rotation one: the base is level and the apex is centred
   * under it, for every car on the field. The signature has no angle to pass, so there is nothing a
   * caller could rotate this by — this is the test that fails if someone ever "improves" the marker
   * by turning it with the chassis (D4).
   */
  it("is screen-up: a level base with the apex centred below it", () => {
    for (const [x, y, bob] of [
      [0, 0, 0],
      [640, 360, ARROW_BOB_AMPLITUDE_PX],
      [-25.5, 1099.25, -ARROW_BOB_AMPLITUDE_PX],
    ]) {
      const [left, right, apex] = countdownArrowPoints(x, y, bob);
      expect(left.y).toBe(right.y);
      expect(apex.x).toBeCloseTo((left.x + right.x) / 2, 6);
      expect(left.x).toBeLessThan(right.x);
    }
  });

  it("points down at the car: the apex is below the base and above the car's centre", () => {
    const [left, right, apex] = countdownArrowPoints(0, 0, 0);
    // Screen and world y both grow downward, so "below" is the larger y.
    expect(apex.y).toBeGreaterThan(left.y);
    expect(apex.y).toBeGreaterThan(right.y);
    expect(apex.y).toBeLessThan(0);
    expect(apex.y - left.y).toBeCloseTo(ARROW_HEIGHT_PX, 6);
  });

  it("clears the hull at the bottom of the bob", () => {
    // Worst case is the 48 x 32 hull's half-diagonal, 29 units, whichever way the car is pointing.
    const hullHalfDiagonal = Math.hypot(48, 32) / 2;
    const [, , apex] = countdownArrowPoints(0, 0, ARROW_BOB_AMPLITUDE_PX);
    expect(Math.abs(apex.y)).toBeGreaterThan(hullHalfDiagonal);
  });

  it("straddles the car and is as wide as its width says", () => {
    const [left, right] = countdownArrowPoints(50, 60, 0);
    expect(right.x - left.x).toBeCloseTo(ARROW_WIDTH_PX, 6);
    expect((left.x + right.x) / 2).toBeCloseTo(50, 6);
  });

  it("translates rigidly with the car and with the bob", () => {
    const at = countdownArrowPoints(0, 0, 0);
    const moved = countdownArrowPoints(30, -12, 4);
    for (let i = 0; i < at.length; i++) {
      expect(moved[i].x - at[i].x).toBeCloseTo(30, 6);
      expect(moved[i].y - at[i].y).toBeCloseTo(-12 + 4, 6);
    }
  });

  it("sits the apex a gap above the car at the middle of the bob", () => {
    const [, , apex] = countdownArrowPoints(7, 9, 0);
    expect(apex.x).toBeCloseTo(7, 6);
    expect(apex.y).toBeCloseTo(9 - ARROW_GAP_PX, 6);
  });
});
