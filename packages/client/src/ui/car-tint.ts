import { h } from "./dom.js";

/**
 * How the art sits in a scoreboard thumbnail well (results and practice summary). The tint layer
 * masks itself with the same image, so this string is shared by the well's background and the overlay.
 */
export const SCOREBOARD_CAR_LAYOUT = "center / 54px 38px no-repeat";

/**
 * The player-colour layer laid over a car thumbnail.
 *
 * A multiply masked by the car's own alpha is exactly what the arena does: `applyCarSprite` calls
 * Phaser's `setTint`, which multiplies the texture by the colour, and the sprites ship desaturated
 * so that reads as paint rather than mud. The mask is what keeps the multiply on the car instead of
 * on the well behind it; `isolation: isolate` on the well keeps it off the row.
 *
 * Car select stays untinted on purpose — there the art answers "which chassis", not "which player".
 * `layout` is how the well draws the PNG; the mask must use that same string or the colour drifts.
 */
export function carTintStyle(carImage: string, hex: string, layout: string): string {
  const mask = `${carImage} ${layout}`;
  return (
    `position: absolute; inset: 0; background: ${hex}; mix-blend-mode: multiply; ` +
    `-webkit-mask: ${mask}; mask: ${mask};`
  );
}

/**
 * The 62×44 well used on the post-match and practice-summary tables: the greyscale PNG plus the
 * player's colour, stacked the same way the reveal grid does it.
 */
export function scoreboardCarThumb(carImage: string, hex: string): HTMLElement {
  return h(
    "div",
    {
      role: "img",
      "aria-label": "Car",
      style:
        `position: relative; isolation: isolate; width: 62px; height: 44px; flex: none; ` +
        `border-radius: 4px; background: var(--color-bg) ${carImage} ${SCOREBOARD_CAR_LAYOUT};`,
    },
    [h("div", { "aria-hidden": "true", style: carTintStyle(carImage, hex, SCOREBOARD_CAR_LAYOUT) })],
  );
}
