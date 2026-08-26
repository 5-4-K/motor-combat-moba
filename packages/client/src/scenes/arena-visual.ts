import type { ArenaDef } from "@motor-combat-moba/shared";

/**
 * The palette an arena gets when it declares none. These are the three constants `ArenaScene` used
 * inline before arenas could carry their own, so `ARENA_01` looks exactly as it always has.
 */
export const ARENA_COLOR_DEFAULTS = {
  floor: 0xebebeb,
  obstacle: 0x4a5568,
  border: 0x2d3436,
} as const;

export interface ArenaColors {
  floor: number;
  obstacle: number;
  border: number;
}

/**
 * `#RRGGBB` as the integer Phaser wants, falling back per channel rather than producing `NaN` —
 * Phaser renders `NaN` as an invisible fill, which would turn a one-character typo in a palette into
 * an arena with no visible walls. The same guard `carFillOf` takes for an out-of-range `colorId`.
 */
function hexToInt(hex: string, fallback: number): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return Number.parseInt(hex.slice(1), 16);
}

export function arenaColorsOf(arena: ArenaDef): ArenaColors {
  const palette = arena.palette;
  if (!palette) return { ...ARENA_COLOR_DEFAULTS };
  return {
    floor: hexToInt(palette.floor, ARENA_COLOR_DEFAULTS.floor),
    obstacle: hexToInt(palette.obstacle, ARENA_COLOR_DEFAULTS.obstacle),
    border: hexToInt(palette.border, ARENA_COLOR_DEFAULTS.border),
  };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The rect to stroke so the arena border is drawn entirely inside the world.
 *
 * Phaser centres a stroke on the path, so stroking the arena bounds directly puts half the line
 * outside them. That was harmless while the camera roamed a world bigger than the view; an arena
 * sized to the view has the camera ending exactly on the bounds, and the outer half is clipped on
 * every side — a 4px border rendering as 2px, dimmer on all four edges. Insetting by half the
 * stroke width is the fix, and it is a no-op for a zero-width border.
 */
export function arenaBorderRect(arena: { width: number; height: number }, borderPx: number): Rect {
  const inset = borderPx / 2;
  return { x: inset, y: inset, w: arena.width - borderPx, h: arena.height - borderPx };
}
