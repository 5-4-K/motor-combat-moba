/**
 * Where the crosshair may go (spec TR56). `maxDistance` is WORLD units from the driven car's CENTRE:
 * the crosshair is an offset from the car that rides with it, never further out than this. Read at
 * use time (`input/aim-offset.ts`'s defaults), never copied, so a live retune lands on the next
 * frame — hence a plain mutable object rather than `as const`.
 */
export const CROSSHAIR_CONFIG: { maxDistance: number } = {
  maxDistance: 60,
};

/** The crosshair's look (spec TR32), screen pixels. White with a dark outline, to read on both floors. */
export const CROSSHAIR_STYLE = {
  radius: 10,
  dotRadius: 1.5,
  /** The outline pass's centre dot, drawn a touch larger than `dotRadius` so the white dot on top
   *  keeps a visible dark ring (final-fixes item 7). */
  outlineDotRadius: 2.5,
  /** Gap between the dot and where each arm starts. */
  armGap: 4,
  /** How far each arm runs past the circle. */
  armOverhang: 5,
  lineWidth: 2,
  outlineWidth: 4,
  color: 0xffffff,
  outlineColor: 0x101014,
} as const;
