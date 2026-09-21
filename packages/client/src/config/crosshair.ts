/** The crosshair's look (spec TR32), screen pixels. White with a dark outline, to read on both floors. */
export const CROSSHAIR_STYLE = {
  radius: 10,
  dotRadius: 1.5,
  /** Gap between the dot and where each arm starts. */
  armGap: 4,
  /** How far each arm runs past the circle. */
  armOverhang: 5,
  lineWidth: 2,
  outlineWidth: 4,
  color: 0xffffff,
  outlineColor: 0x101014,
} as const;
