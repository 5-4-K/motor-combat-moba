import type { Bounds } from "../sim/collide.js";
import { planesOf } from "../sim/boundary.js";
import type { ArenaDef } from "./types.js";

/**
 * The ONE place a `Bounds` is built from an arena.
 *
 * Five call sites used to spell `{ width: arena.width, height: arena.height }` by hand — the server
 * tick, the room pipeline, two bot builders and the client's step context. The moment an arena's
 * boundary is more than a rectangle, a site that misses it simulates a different world from the
 * others, and the one that matters most is the client: a client predicting against a rectangle
 * while the server simulates an octagon rubber-bands, and reads as a netcode bug rather than an
 * arena bug (AS8). Route every builder through here.
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
