import type { Bounds } from "../sim/collide.js";
import { planesOf } from "../sim/boundary.js";
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
 * unchanged, so `arena-02` and every future rectangle are unaffected.
 */
export function playableExtentOf(
  arena: Pick<ArenaDef, "width" | "height" | "boundary">,
): { width: number; height: number } {
  if (arena.boundary === undefined || arena.boundary.length === 0) {
    return { width: arena.width, height: arena.height };
  }
  const xs = arena.boundary.map((v) => v.x);
  const ys = arena.boundary.map((v) => v.y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}
