import { boundsOf, rectPlanes, type ArenaDef } from "@motor-combat-moba/shared";

/** Spacing of the procedural spike teeth along a strip's long side, in world units (CQ49). */
export const SPIKE_TOOTH_PX = 12;
/** The strip's own fill, under its teeth — a dark bed the red points read against. */
export const SPIKE_STRIP_COLOR = 0x3a2a26;
/** The teeth themselves. */
export const SPIKE_TOOTH_COLOR = 0xb8432f;

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

/**
 * What `redrawArenaGraphics` should draw. A sprite arena carries its own painted markings and its
 * own walls, so painting a 4px slate border and a dashed lane grid over them reads as a rendering
 * bug rather than as atmosphere (AS24). An arena whose floor texture never loaded still needs both,
 * so this must never collapse to a constant.
 */
export function arenaDecoration(hasFloorSprite: boolean): {
  drawMarkings: boolean;
  drawBorder: boolean;
} {
  return { drawMarkings: !hasFloorSprite, drawBorder: !hasFloorSprite };
}

/**
 * Which obstacles the client fills solid. Spike strips (`kind: "spike"`) are painted into the arena
 * art already, so filling them again draws a grey rectangle over a set of painted spikes (AS25).
 * Wall-mounted geometry is the only kind today; an ordinary block (`kind` absent) is still filled.
 */
export function drawableObstacles<T extends { kind?: string }>(obstacles: readonly T[]): T[] {
  return obstacles.filter((o) => o.kind === undefined);
}

/** One tooth, as the three points `Graphics.fillTriangle` takes: base, base, apex. */
export type SpikeTooth = [number, number, number, number, number, number];

export interface SpikeStrip extends Rect {
  teeth: SpikeTooth[];
}

/**
 * The procedural spike strips of an art-less arena (CQ49). A sprite arena paints its spikes into the
 * floor art (AS25), which is why `drawableObstacles` drops every `kind`d obstacle; an arena with no
 * art has nothing else to show them, so they are drawn here instead: the strip's rect, and a row of
 * teeth whose bases sit on the wall face and whose apexes point into the playable side.
 *
 * "Into the playable side" is the inward normal of the boundary plane the strip is flush against
 * (AS13 is what guarantees one exists). The plane is the axis-aligned one whose outer face of the
 * strip lies closest to it (among those across the strip's short axis), so a strip needs no
 * authored facing. The apex protrudes half a tooth past the inner face — purely visual; the sim's
 * solid is still the rect.
 */
export function spikeStrips(arena: ArenaDef): SpikeStrip[] {
  const planes = boundsOf(arena).planes ?? rectPlanes(arena.width, arena.height);
  const axisPlanes = planes.filter((p) => Math.abs(p.nx) > 0.999 || Math.abs(p.ny) > 0.999);
  const strips: SpikeStrip[] = [];
  for (const o of arena.obstacles) {
    if (o.kind !== "spike") continue;
    const corners = [
      [o.x, o.y],
      [o.x + o.w, o.y],
      [o.x + o.w, o.y + o.h],
      [o.x, o.y + o.h],
    ] as const;
    // The plane this strip is flush against: the one its outermost face (least `n·p`) sits on.
    // Only planes across the strip's SHORT axis qualify — a strip running into a corner touches the
    // neighbouring wall with its end too (arena-02's top and bottom strips), and that end is not
    // where its teeth go.
    const horizontal = o.w >= o.h;
    let best: { nx: number; ny: number; gap: number } | undefined;
    for (const p of axisPlanes) {
      if (horizontal ? Math.abs(p.ny) < 0.999 : Math.abs(p.nx) < 0.999) continue;
      const outer = Math.min(...corners.map(([x, y]) => p.nx * x + p.ny * y));
      const gap = Math.abs(outer - p.d);
      if (!best || gap < best.gap) best = { nx: p.nx, ny: p.ny, gap };
    }
    if (!best) {
      strips.push({ x: o.x, y: o.y, w: o.w, h: o.h, teeth: [] });
      continue;
    }
    const { nx, ny } = best;
    // Tangent along the wall, and each corner in (normal, tangent) coordinates.
    const tx = -ny;
    const ty = nx;
    const ns = corners.map(([x, y]) => nx * x + ny * y);
    const ts = corners.map(([x, y]) => tx * x + ty * y);
    const wall = Math.min(...ns);
    const apexN = Math.max(...ns) + SPIKE_TOOTH_PX / 2;
    const t0 = Math.min(...ts);
    const length = Math.max(...ts) - t0;
    // Whole teeth only, stretched to fill the strip exactly, so a strip never ends on half a tooth.
    const count = Math.max(1, Math.round(length / SPIKE_TOOTH_PX));
    const step = length / count;
    const at = (n: number, t: number): [number, number] => [nx * n + tx * t, ny * n + ty * t];
    const teeth: SpikeTooth[] = [];
    for (let i = 0; i < count; i++) {
      const a = at(wall, t0 + i * step);
      const b = at(wall, t0 + (i + 1) * step);
      const c = at(apexN, t0 + (i + 0.5) * step);
      teeth.push([a[0], a[1], b[0], b[1], c[0], c[1]]);
    }
    strips.push({ x: o.x, y: o.y, w: o.w, h: o.h, teeth });
  }
  return strips;
}

/**
 * The regions between an art-less arena's frame and its boundary polygon (CQ50) — arena-03's four
 * chamfer corners, filled in the border colour so the cut corners read as wall rather than as floor.
 *
 * Deliberately narrow: only a boundary whose every vertex lies on the frame, where each gap is the
 * triangle between a frame corner and the two boundary vertices either side of it. Anything else
 * (no boundary, or `arena-01`/`arena-02`'s polygons inset inside the frame) returns `[]` and keeps
 * the plain rect border — those arenas ship floor art that draws its own walls anyway.
 */
export function boundaryGaps(arena: ArenaDef): Array<Array<{ x: number; y: number }>> {
  const boundary = arena.boundary;
  if (!boundary || boundary.length < 3) return [];
  const { width: w, height: h } = arena;
  const onLeft = (v: { x: number }): boolean => v.x === 0;
  const onRight = (v: { x: number }): boolean => v.x === w;
  const onTop = (v: { y: number }): boolean => v.y === 0;
  const onBottom = (v: { y: number }): boolean => v.y === h;
  if (!boundary.every((v) => onLeft(v) || onRight(v) || onTop(v) || onBottom(v))) return [];

  // Each frame corner with the two frame edges that meet at it.
  const frameCorners = [
    { x: 0, y: 0, edgeA: onTop, edgeB: onLeft },
    { x: w, y: 0, edgeA: onTop, edgeB: onRight },
    { x: w, y: h, edgeA: onBottom, edgeB: onRight },
    { x: 0, y: h, edgeA: onBottom, edgeB: onLeft },
  ];
  const gaps: Array<Array<{ x: number; y: number }>> = [];
  for (const c of frameCorners) {
    if (boundary.some((v) => v.x === c.x && v.y === c.y)) continue;
    // The polygon edge that cuts this corner: consecutive vertices, one on each of its frame edges.
    for (let i = 0; i < boundary.length; i++) {
      const before = boundary[i]!;
      const after = boundary[(i + 1) % boundary.length]!;
      const cuts =
        (c.edgeA(before) && c.edgeB(after)) || (c.edgeB(before) && c.edgeA(after));
      if (cuts) {
        gaps.push([
          { x: c.x, y: c.y },
          { x: before.x, y: before.y },
          { x: after.x, y: after.y },
        ]);
        break;
      }
    }
  }
  return gaps;
}

/**
 * Whether the painted markings' centre circle is drawn (CQ51). A zone sits at the centre of the one
 * arena that has one, and its ring is drawn separately in the capture colours; a second, unrelated
 * circle under it would read as part of the zone.
 */
export function markingsCircleVisible(arena: ArenaDef): boolean {
  return arena.zone === undefined;
}
