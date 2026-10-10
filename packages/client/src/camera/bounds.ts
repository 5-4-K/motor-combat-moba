import type { ArenaDef } from "@motor-combat-moba/shared";
import type { ArenaColors, Rect } from "../scenes/arena-visual.js";

/**
 * The world rectangle the arena camera is bounded to (BAR14).
 *
 * Phaser 4.2.1 `BaseCamera.clampX`/`clampY` pin a bounds rectangle smaller than the view to its
 * origin, so an arena smaller than what the camera sees would sit in the top-left corner. Per axis,
 * when the camera sees more than the arena (`view / zoom`), the bounds are widened to exactly what
 * it sees and centred on the arena; otherwise they are the arena itself. `view` is the camera
 * viewport in screen px.
 */
export function cameraBoundsOf(
  arena: { width: number; height: number },
  view: { width: number; height: number },
  zoom: number,
): Rect {
  const axis = (arenaSize: number, viewSize: number): { start: number; size: number } => {
    const seen = viewSize / zoom;
    if (seen > arenaSize + 1e-6) return { start: -(seen - arenaSize) / 2, size: seen };
    return { start: 0, size: arenaSize };
  };
  const x = axis(arena.width, view.width);
  const y = axis(arena.height, view.height);
  return { x: x.start, y: y.start, w: x.size, h: y.size };
}

/**
 * The colour behind the world (BAR15). A tile arena's band outside its grid is its border colour,
 * so the centred, uncovered margin reads as more wall; any other arena keeps its floor colour.
 */
export function cameraBackgroundOf(arena: ArenaDef, colors: ArenaColors): number {
  return arena.tiles ? colors.border : colors.floor;
}
