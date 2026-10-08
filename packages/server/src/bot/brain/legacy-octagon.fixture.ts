/**
 * The octagon `arena-01` was until 2026-10-09 (it is a square-cornered tile arena now, TA9), kept
 * as a test fixture: what the suites using it pin is how a CHAMFER plane is read, and no shipped
 * arena has a chamfer that sits inside the rect rule's margin on both axes.
 *
 * Test-only; the `.fixture.ts` suffix keeps it out of vitest's collection (which matches
 * `*.test.*` / `*.spec.*` only) and marks it, like `duel.fixture.ts`, as not production code.
 */
import { boundsOf } from "@motor-combat-moba/shared";

/** The old arena-01 `boundary` vertex list. */
export const LEGACY_OCTAGON = [
  { x: 124, y: 54 }, { x: 1156, y: 54 }, { x: 1206, y: 104 }, { x: 1206, y: 616 },
  { x: 1156, y: 666 }, { x: 124, y: 666 }, { x: 74, y: 616 }, { x: 74, y: 104 },
];

/**
 * A bot arena view of the legacy octagon: the 1280 x 720 frame, no obstacles, and the octagon's
 * boundary planes — so any wall reading that fires near a chamfer fires because of the PLANES.
 */
export function legacyOctagonView() {
  const rect = { width: 1280, height: 720, obstacles: [] };
  return { ...rect, planes: boundsOf({ ...rect, boundary: LEGACY_OCTAGON }).planes };
}
