import { describe, expect, it } from "vitest";
import { carTintStyle, SCOREBOARD_CAR_LAYOUT } from "./car-tint.js";

const CAR = 'url("art/cars/mirage.png")';
const REVEAL_LAYOUT = "center / 104px 68px no-repeat";

describe("carTintStyle", () => {
  it("multiplies the player's colour over the car, the way setTint does in the arena", () => {
    const style = carTintStyle(CAR, "#BF1402", REVEAL_LAYOUT);
    expect(style).toContain("background: #BF1402");
    expect(style).toContain("mix-blend-mode: multiply");
  });

  it("masks with the car's own art, so the colour lands on the car and not the well", () => {
    const style = carTintStyle(CAR, "#3498DB", REVEAL_LAYOUT);
    expect(style).toContain(`mask: ${CAR}`);
    expect(style).toContain(`-webkit-mask: ${CAR}`);
  });

  it("gives the mask the same size and position the thumbnail draws the art at", () => {
    const style = carTintStyle(CAR, "#2ECC71", REVEAL_LAYOUT);
    // Both mask longhands carry the layout, or the tint drifts off the sprite it is painting.
    expect(style.match(/center \/ 104px 68px no-repeat/g)).toHaveLength(2);
  });

  it("paints at the caller's art size, so a scoreboard thumb is not stuck at the reveal grid's size", () => {
    const style = carTintStyle(CAR, "#2ECC71", SCOREBOARD_CAR_LAYOUT);
    expect(style.match(/center \/ 54px 38px no-repeat/g)).toHaveLength(2);
  });
});
