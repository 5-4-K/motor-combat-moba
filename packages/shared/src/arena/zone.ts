import type { Aabb } from "../sim/collide.js";

/** Sorted unique values. */
function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * The counting core of a capture zone (spec conquer tile arena CT9): the square (Chebyshev)
 * erosion of the union of `rects` by `inset`. A point is in the core when the axis-aligned square
 * of half-side `inset` centred on it lies wholly inside the union. Returned as disjoint rects,
 * merged greedily row-major (the same sweep as the tile compiler's merge), so the count stays
 * small. `inset <= 0` returns the union unchanged. Pure: it reads no config, so the caller passes
 * the mode's `zoneEdgeInset` at call time.
 *
 * Breakpoints at every rect edge and edge ± inset make coverage constant across each grid cell, so
 * one centre test per cell decides it exactly.
 */
export function zoneCoreOf(rects: readonly Aabb[], inset: number): Aabb[] {
  if (rects.length === 0) return [];
  const d = Math.max(0, inset);
  const minX = Math.min(...rects.map((r) => r.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  const clip = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  const xs = uniqueSorted(
    rects.flatMap((r) => [r.x, r.x + r.w]).flatMap((e) => [e, e - d, e + d]).map((v) => clip(v, minX, maxX)),
  );
  const ys = uniqueSorted(
    rects.flatMap((r) => [r.y, r.y + r.h]).flatMap((e) => [e, e - d, e + d]).map((v) => clip(v, minY, maxY)),
  );
  const cols = xs.length - 1;
  const rows = ys.length - 1;
  if (cols < 1 || rows < 1) return [];

  // covered[r][c]: the grid cell lies inside some rect (its centre decides; edges are breakpoints).
  const covered: boolean[][] = [];
  for (let r = 0; r < rows; r += 1) {
    const cy = (ys[r]! + ys[r + 1]!) / 2;
    const line: boolean[] = [];
    for (let c = 0; c < cols; c += 1) {
      const cx = (xs[c]! + xs[c + 1]!) / 2;
      line.push(rects.some((q) => cx > q.x && cx < q.x + q.w && cy > q.y && cy < q.y + q.h));
    }
    covered.push(line);
  }

  const kept: boolean[][] = [];
  for (let r = 0; r < rows; r += 1) {
    const cy = (ys[r]! + ys[r + 1]!) / 2;
    const line: boolean[] = [];
    for (let c = 0; c < cols; c += 1) {
      const cx = (xs[c]! + xs[c + 1]!) / 2;
      // A square poking out of the bounding box cannot be inside the union.
      let ok = cx - d >= minX && cx + d <= maxX && cy - d >= minY && cy + d <= maxY;
      for (let rr = 0; ok && rr < rows; rr += 1) {
        if (!(ys[rr]! < cy + d && ys[rr + 1]! > cy - d)) continue;
        for (let cc = 0; cc < cols; cc += 1) {
          if (xs[cc]! < cx + d && xs[cc + 1]! > cx - d && !covered[rr]![cc]) {
            ok = false;
            break;
          }
        }
      }
      line.push(ok);
    }
    kept.push(line);
  }

  const claimed = kept.map((line) => line.map(() => false));
  const free = (r: number, c: number): boolean => kept[r]![c]! && !claimed[r]![c]!;
  const out: Aabb[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!free(r, c)) continue;
      let w = 1;
      while (c + w < cols && free(r, c + w)) w += 1;
      let h = 1;
      grow: while (r + h < rows) {
        for (let k = 0; k < w; k += 1) if (!free(r + h, c + k)) break grow;
        h += 1;
      }
      for (let dr = 0; dr < h; dr += 1) for (let k = 0; k < w; k += 1) claimed[r + dr]![c + k] = true;
      out.push({ x: xs[c]!, y: ys[r]!, w: xs[c + w]! - xs[c]!, h: ys[r + h]! - ys[r]! });
    }
  }
  return out;
}

/** The centre of the rects' bounding box (CT9) — where the zone's marker and HUD anchor. */
export function zoneCentreOf(rects: readonly Aabb[]): { x: number; y: number } {
  const minX = Math.min(...rects.map((r) => r.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}
