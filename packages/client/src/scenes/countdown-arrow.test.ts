import { describe, expect, it } from "vitest";
import {
  ARROW_BLINK_PERIOD_MS,
  ARROW_BOB_AMPLITUDE_PX,
  ARROW_BOB_PERIOD_MS,
  ARROW_GAP_PX,
  ARROW_HEIGHT_PX,
  ARROW_WIDTH_PX,
  arrowBlinkOn,
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

describe("arrowBlinkOn", () => {
  it("is on at the top of a cycle and off at the halfway mark", () => {
    expect(arrowBlinkOn(0)).toBe(true);
    expect(arrowBlinkOn(ARROW_BLINK_PERIOD_MS / 2)).toBe(false);
  });

  it("spends exactly half of each cycle on", () => {
    const samples = 1000;
    let on = 0;
    for (let i = 0; i < samples; i++) {
      if (arrowBlinkOn((i * ARROW_BLINK_PERIOD_MS) / samples)) on++;
    }
    expect(on).toBe(samples / 2);
  });

  // Same contract as the bob: driven by a wall clock that has been running all day, so the phase has
  // to repeat rather than drift or fall out of range.
  it("repeats every period, at any point in a long-running clock", () => {
    for (const t of [0, 37, 179.5, 359.9, 12_345.6]) {
      expect(arrowBlinkOn(t + ARROW_BLINK_PERIOD_MS * 9_999)).toBe(arrowBlinkOn(t));
    }
  });

  // The respawn marker has to be catchable mid-fight, which is what separates it from the bob. A
  // period anywhere near the bob's would read as the same slow breathing rather than as an alert.
  it("blinks several times over the shortest spawn protection window", () => {
    const shortestProtectionMs = 1500;
    expect(shortestProtectionMs / ARROW_BLINK_PERIOD_MS).toBeGreaterThan(3);
    expect(ARROW_BLINK_PERIOD_MS).toBeLessThan(ARROW_BOB_PERIOD_MS);
  });
});
