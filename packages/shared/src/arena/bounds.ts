import type { Bounds } from "../sim/collide.js";
import { planesOf, type BoundaryPlane } from "../sim/boundary.js";
import { TILE_SIZE } from "./tiles/tile-config.js";
import type { ArenaDef } from "./types.js";

/**
 * The ONE place a `Bounds` is built from an arena.
 *
 * Six call sites used to spell `{ width: arena.width, height: arena.height }` by hand — the server
 * tick, the room pipeline, two bot builders, the client's step context, and the ram/slam contact
 * pass. The moment an arena's boundary is more than a rectangle, a site that misses it simulates a
 * different world from the others, and the one that matters most is the client: a client predicting
 * against a rectangle while the server simulates an octagon rubber-bands, and reads as a netcode bug
 * rather than an arena bug (AS8). Route every builder through here.
 *
 * An arena with no polygon gets NO `planes` key rather than the four rectangle planes, so the
 * default stays the integer fast path in `collide.ts` and nothing about a rectangular arena moves.
 *
 * The parameter is `Pick<ArenaDef, "width" | "height" | "boundary">` rather than the whole
 * `ArenaDef`: two of the five call sites (the bot solver's `BotArenaView` and the duel fixture's
 * `ARENA`) never carry `id`/`ffaSpawns`/`teamASpawns`/`teamBSpawns` in the first place, and both
 * already project a real `ArenaDef` down to width/height/obstacles before this function ever sees
 * it. Since `boundary` is optional, a caller that lacks the key entirely still satisfies this type,
 * so a rectangle-only arena view routes through the same function without carrying dead fields.
 */
export function boundsOf(arena: Pick<ArenaDef, "width" | "height" | "boundary">): Bounds {
  if (arena.boundary === undefined) return { width: arena.width, height: arena.height };
  return { width: arena.width, height: arena.height, planes: planesOf(arena.boundary) };
}

/**
 * How big the PLAYABLE floor is, for anything that quotes the arena's size to a person.
 *
 * `width`/`height` are the image frame and the camera bounds, and on `arena-01` the boundary polygon
 * is inset inside them: `1280 x 720` of frame around `1132 x 612` of floor. Either number is the
 * right answer to a different question — the camera wants the frame, a player asking "how far is 900
 * units" wants the floor — and the two were the same number for every arena until the octagon
 * landed, which is exactly why a consumer that wanted one and read the other went unnoticed.
 *
 * The polygon's own bounding box, not a rectangle inscribed in it: the chamfers cut the corners, so
 * no single rectangle is "the playable area", and the extent a reach is meaningfully compared against
 * is the widest and tallest the floor gets. A boundary-less arena answers with its `width`/`height`
 * unchanged. A tile arena answers the bounding box of its non-solid cells (TA30).
 */
type PlayableSource = Pick<ArenaDef, "width" | "height" | "boundary" | "tiles">;

/**
 * The PLAYABLE floor's bounding rectangle in world units (TA30). A polygon arena answers its
 * polygon's box; a tile arena the box of its non-solid cells — its grid frame includes the wall band,
 * the same frame-vs-floor mistake the octagon once caused; a plain arena its frame.
 */
export function playableRectOf(arena: PlayableSource): { x: number; y: number; w: number; h: number } {
  if (arena.boundary !== undefined && arena.boundary.length > 0) {
    const xs = arena.boundary.map((v) => v.x);
    const ys = arena.boundary.map((v) => v.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  const grid = arena.tiles;
  if (grid !== undefined) {
    let minC = Infinity;
    let minR = Infinity;
    let maxC = -Infinity;
    let maxR = -Infinity;
    grid.cells.forEach((cell, i) => {
      if (cell.solid) return;
      const c = i % grid.cols;
      const r = Math.floor(i / grid.cols);
      minC = Math.min(minC, c);
      minR = Math.min(minR, r);
      maxC = Math.max(maxC, c);
      maxR = Math.max(maxR, r);
    });
    if (minC !== Infinity) {
      return {
        x: minC * TILE_SIZE,
        y: minR * TILE_SIZE,
        w: (maxC - minC + 1) * TILE_SIZE,
        h: (maxR - minR + 1) * TILE_SIZE,
      };
    }
  }
  return { x: 0, y: 0, w: arena.width, h: arena.height };
}

export function playableExtentOf(arena: PlayableSource): { width: number; height: number } {
  const rect = playableRectOf(arena);
  return { width: rect.w, height: rect.h };
}

/**
 * The planes a bot should treat as the playable edge (TA31): the polygon's own, or for a tile arena
 * the four planes of its floor rect (wound clockwise in screen coordinates, so `planesOf` points them
 * inward), or `undefined` for a plain rectangle — which keeps every caller on its `rectPlanes`
 * fallback exactly as before.
 */
export function playablePlanesOf(arena: PlayableSource): readonly BoundaryPlane[] | undefined {
  if (arena.boundary !== undefined) return boundsOf(arena).planes;
  if (arena.tiles === undefined) return undefined;
  const { x, y, w, h } = playableRectOf(arena);
  return planesOf([
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]);
}
