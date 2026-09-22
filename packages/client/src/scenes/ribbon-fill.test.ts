import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { WEAPON_TABLE } from "@motor-combat-moba/shared";
import {
  beamDrawLayers,
  beamFlareShapes,
  projectileDrawLayers,
  projectileHaloShapes,
} from "./combat-visual.js";
import { discSegments, fillDisc, fillRibbon } from "./ribbon-fill.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));
// Also installed directly, synchronously, at module scope: fixture constants below (and
// some describe bodies) read config during test COLLECTION, which happens once, before any
// beforeEach hook ever fires.
installMode(modeConfigOf(DEFAULT_GAME_MODE));

interface Tri {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Records what a `Graphics` would have been asked to fill. */
function recorder(): { tris: Tri[]; fillTriangle: (...n: number[]) => void } {
  const tris: Tri[] = [];
  return {
    tris,
    fillTriangle: (x0, y0, x1, y1, x2, y2) => {
      tris.push({ x0: x0!, y0: y0!, x1: x1!, y1: y1!, x2: x2!, y2: y2! });
    },
  };
}

const triArea = (t: Tri): number =>
  Math.abs((t.x1 - t.x0) * (t.y2 - t.y0) - (t.x2 - t.x0) * (t.y1 - t.y0)) / 2;

/** Shoelace. The polygon `fillPoints` would have filled. */
function polygonArea(points: readonly { x: number; y: number }[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

// A flame and a bolt at full reach, at a heading that is not axis-aligned, on an animated clock —
// the frozen `nowMs = 0` frame is the one case where a tear could hide.
const LANCE = beamDrawLayers("lance", 300, 200, 0.7, 1200, 0, 12_345);
const FLAME = beamDrawLayers("afterburner", 300, 200, 2.1, 220, 0, 12_345);

describe("fillRibbon", () => {
  it("tiles a plain two-station ribbon with exactly its two triangles", () => {
    const sink = recorder();
    // near: (0,0) -> (10,0); far reversed: (10,4) -> (0,4).
    fillRibbon(sink, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 }], 2);
    expect(sink.tris).toHaveLength(2);
    expect(sink.tris.reduce((sum, t) => sum + triArea(t), 0)).toBeCloseTo(40, 9);
  });

  it("draws nothing for a layout it cannot be — rather than reading past the array", () => {
    const sink = recorder();
    fillRibbon(sink, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], 2);
    fillRibbon(sink, [{ x: 0, y: 0 }, { x: 1, y: 0 }], 1);
    expect(sink.tris).toHaveLength(0);
  });

  it("covers exactly the polygon it replaces, for every real ribbon layer", () => {
    // Equal area is the whole correctness argument in one number: the strip cannot spill outside
    // the outline (every vertex is the outline's own, bar the cap's midpoint, which is inside it),
    // so covering the same area means covering the same pixels, once each — which is what keeps a
    // translucent layer compositing as it did under `fillPoints`.
    const ribbons = [...LANCE, ...FLAME].filter((layer) => layer.ribbon !== undefined);
    expect(ribbons.length).toBeGreaterThan(8);
    for (const layer of ribbons) {
      const sink = recorder();
      fillRibbon(sink, layer.points, layer.ribbon!);
      const covered = sink.tris.reduce((sum, t) => sum + triArea(t), 0);
      const outline = polygonArea(layer.points);
      expect(covered / outline).toBeCloseTo(1, 6);
    }
  });

  it("uses only the outline's own vertices, plus one midpoint for a cap", () => {
    for (const layer of LANCE.filter((l) => l.ribbon !== undefined)) {
      const sink = recorder();
      fillRibbon(sink, layer.points, layer.ribbon!);
      const own = new Set(layer.points.map((p) => `${p.x},${p.y}`));
      const strays = new Set<string>();
      for (const t of sink.tris) {
        for (const key of [`${t.x0},${t.y0}`, `${t.x1},${t.y1}`, `${t.x2},${t.y2}`]) {
          if (!own.has(key)) strays.add(key);
        }
      }
      expect(strays.size).toBeLessThanOrEqual(1);
    }
  });
});

describe("the bolt's sub-pixel layers", () => {
  const ribbons = LANCE.filter((layer) => layer.ribbon !== undefined);

  it("still tears every layer whose tear can be seen", () => {
    // `lance`'s five outer layers tear by 8.6, 5.4, 3.2, 1.7 and 0.8 units. If this count drops,
    // `BOLT_VISIBLE_TEAR` has started eating the look rather than the waste.
    expect(ribbons.filter((layer) => layer.ribbon! > 2)).toHaveLength(5);
  });

  it("draws the three whose tear is under half a pixel with straight edges", () => {
    const straight = ribbons.filter((layer) => layer.ribbon === 2);
    expect(straight).toHaveLength(3);
    // Four shaft corners plus the dome, not two hundred stations.
    for (const layer of straight) expect(layer.points.length).toBeLessThan(20);
  });

  it("keeps the layer ORDER and count, so the colours still nest as authored", () => {
    expect(ribbons).toHaveLength(8);
    // Outermost first: each layer is narrower than the one before it.
    const widthOf = (layer: (typeof ribbons)[number]): number => {
      const a = layer.points[0]!;
      const b = layer.points[layer.ribbon! * 2 - 1]!;
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    for (let i = 1; i < ribbons.length; i += 1) {
      expect(widthOf(ribbons[i]!)).toBeLessThan(widthOf(ribbons[i - 1]!));
    }
  });
});

describe("fillDisc", () => {
  // Every radius the shot layer draws today, from a basic attack core to the widest halo.
  const RADII = [4, 5, 8, 9, 12, 17, 23, 30, 60];

  it("covers a true circle to within a fraction of a percent", () => {
    for (const radius of RADII) {
      const sink = recorder();
      fillDisc(sink, 100, 50, radius);
      const covered = sink.tris.reduce((sum, t) => sum + triArea(t), 0);
      expect(covered / (Math.PI * radius * radius)).toBeGreaterThan(0.95);
      expect(covered / (Math.PI * radius * radius)).toBeLessThanOrEqual(1);
    }
  });

  it("never lets the rim stray a third of a pixel from the circle it stands for", () => {
    // The polygon can only fall INSIDE the circle (D19 is safe either way: a disc drawn a hair
    // small is still inside its hitbox); this bounds how far.
    for (let radius = 1; radius <= 60; radius += 0.5) {
      const sagitta = radius * (1 - Math.cos(Math.PI / discSegments(radius)));
      expect(sagitta).toBeLessThan(0.3);
    }
  });

  it("closes: the last triangle ends where the first began", () => {
    const sink = recorder();
    fillDisc(sink, 0, 0, 10);
    const first = sink.tris[0]!;
    const last = sink.tris.at(-1)!;
    expect(last.x2).toBeCloseTo(first.x1, 9);
    expect(last.y2).toBeCloseTo(first.y1, 9);
  });

  it("draws nothing for a radius that is not one", () => {
    const sink = recorder();
    fillDisc(sink, 0, 0, 0);
    fillDisc(sink, 0, 0, -3);
    fillDisc(sink, 0, 0, Number.NaN);
    expect(sink.tris).toHaveLength(0);
  });
});

/**
 * The most vertices one shot polygon may hand to Phaser's per-frame triangulator.
 *
 * Every un-ribboned shape the shot layers draw today is small — a marking is 12 to 24 vertices, an
 * ember 10, a shard 4, `tremor`'s frozen fan 4 — while a station walk is 194 (a jet) or 415 (a
 * bolt). 64 sits between the two with room either side: ten tongues on a fan is 62. A layer past
 * it is a strip somebody built station by station, and the renderer can only fill it as one if the
 * builder says so. See `DrawBeamLayer.ribbon` and `packages/client/CLAUDE.md`.
 */
const EARCUT_VERTEX_BUDGET = 64;

/** Poses that are not axis-aligned, at spawn, mid-growth and full reach, on two clock times. */
const HEADINGS = [0.7, 2.1, -2.6];
const EXTENT_FRACTIONS = [0.05, 0.5, 1];
const CLOCKS = [0, 12_345];

describe("every shot polygon is either small or a ribbon", () => {
  // The guard the ribbon rule needs to outlive `lance` and `afterburner`: a NEW beam look that walks
  // hundreds of stations and forgets to say `ribbon` would silently fall back to `fillPoints`,
  // costing exactly what those two cost before `fillRibbon` existed, with every other test green.
  for (const def of Object.values(WEAPON_TABLE)) {
    it(`${def.id}: no layer past ${EARCUT_VERTEX_BUDGET} vertices without a ribbon layout`, () => {
      for (const heading of HEADINGS) {
        for (const fraction of EXTENT_FRACTIONS) {
          for (const nowMs of CLOCKS) {
            const extent = def.range * fraction;
            const instance = { weaponId: def.id, isExplosion: false, x: 300, y: 200, angle: heading, extent };
            const layers =
              def.kind === "beam"
                ? [
                    ...beamDrawLayers(def.id, 300, 200, heading, extent, 0, nowMs),
                    ...beamFlareShapes(def.id, 300, 200, heading, 40).flatMap((s) => (s.kind === "poly" ? [s] : [])),
                  ]
                : [...projectileDrawLayers(instance, 40), ...projectileHaloShapes(instance, 40)];
            for (const layer of layers) {
              const ribbon = "ribbon" in layer ? layer.ribbon : undefined;
              if (ribbon !== undefined) {
                // A ribbon is only a saving if it is also correct: it must tile the outline exactly.
                const sink = recorder();
                fillRibbon(sink, layer.points, ribbon);
                const covered = sink.tris.reduce((sum, t) => sum + triArea(t), 0);
                expect(covered / polygonArea(layer.points)).toBeCloseTo(1, 6);
                continue;
              }
              expect(
                layer.points.length,
                `${def.id} hands Phaser a ${layer.points.length}-vertex polygon to triangulate every frame; ` +
                  "a shape built station by station must carry `ribbon` (see scenes/ribbon-fill.ts)",
              ).toBeLessThanOrEqual(EARCUT_VERTEX_BUDGET);
            }
          }
        }
      }
    });
  }
});
