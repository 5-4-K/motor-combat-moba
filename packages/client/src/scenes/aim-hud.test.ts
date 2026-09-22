import { describe, expect, it } from "vitest";
import { CROSSHAIR_CONFIG } from "../config/crosshair.js";
import { AIM_HUD_STYLE } from "../config/aim-hud.js";
import { HP_BAR_GEOMETRY } from "./combat-visual.js";
import {
  AXIAL_STANDOFF,
  LATERAL_STANDOFF,
  MUZZLE_DIRS_DEG,
  aimHudIsEmpty,
  aimHudSignature,
  dashedLine,
  dashedRingSpans,
  drawAimHud,
  muzzleArrowPoints,
  muzzleArrows,
  ringCrossing,
  standoffOf,
  swingLimitLines,
  type AimHudSpec,
} from "./aim-hud.js";

const SHIPPED: AimHudSpec = {
  showTurret: true,
  showMuzzle: true,
  ringRadius: CROSSHAIR_CONFIG.maxDistance,
  maxSwingDeg: 360,
  pivot: { x: 0, y: 0 },
};

/** A duck-typed `Phaser.GameObjects.Graphics`: `drawAimHud` calls these seven methods and no more. */
function fakeGraphics() {
  const calls = {
    clears: 0,
    lineStyles: [] as number[][],
    fillStyles: [] as number[][],
    arcs: [] as number[][],
    lines: [] as number[][],
    polys: [] as Array<Array<{ x: number; y: number }>>,
  };
  return {
    calls,
    clear: () => {
      calls.clears += 1;
    },
    lineStyle: (w: number, c: number, a: number) => {
      calls.lineStyles.push([w, c, a]);
    },
    fillStyle: (c: number, a: number) => {
      calls.fillStyles.push([c, a]);
    },
    beginPath: () => undefined,
    strokePath: () => undefined,
    arc: (x: number, y: number, r: number, s: number, e: number) => {
      calls.arcs.push([x, y, r, s, e]);
    },
    lineBetween: (x1: number, y1: number, x2: number, y2: number) => {
      calls.lines.push([x1, y1, x2, y2]);
    },
    fillPoints: (points: Array<{ x: number; y: number }>) => {
      calls.polys.push(points);
    },
  };
}

describe("dashedRingSpans", () => {
  it("closes on itself: the dashes tile the full circle with no short one at the seam", () => {
    const spans = dashedRingSpans(60);
    expect(spans.length).toBeGreaterThan(4);
    const step = (Math.PI * 2) / spans.length;
    for (let i = 0; i < spans.length; i += 1) {
      expect(spans[i]!.start).toBeCloseTo(i * step, 10);
      // Every dash subtends the same arc, so there is no visible join.
      expect(spans[i]!.end - spans[i]!.start).toBeCloseTo(spans[0]!.end - spans[0]!.start, 10);
    }
  });

  it("keeps the authored dash-to-gap ratio after fitting", () => {
    const spans = dashedRingSpans(60);
    const step = (Math.PI * 2) / spans.length;
    const dashFraction = (spans[0]!.end - spans[0]!.start) / step;
    expect(dashFraction).toBeCloseTo(
      AIM_HUD_STYLE.dashLength / (AIM_HUD_STYLE.dashLength + AIM_HUD_STYLE.dashGap),
      10,
    );
  });

  it("draws nothing at a zero or negative radius rather than dividing by it", () => {
    expect(dashedRingSpans(0)).toEqual([]);
    expect(dashedRingSpans(-10)).toEqual([]);
  });
});

describe("dashedLine", () => {
  it("starts on the first point and ends on the last, so a run touches both ends", () => {
    const segs = dashedLine(0, 0, 60, 0);
    expect(segs.length).toBeGreaterThan(1);
    expect(segs[0]!.x1).toBeCloseTo(0, 10);
    expect(segs[segs.length - 1]!.x2).toBeCloseTo(60, 10);
  });

  it("lays every dash at the same length", () => {
    const segs = dashedLine(0, 0, 0, 97);
    const lengths = segs.map((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1));
    for (const length of lengths) expect(length).toBeCloseTo(lengths[0]!, 10);
  });

  it("returns nothing for a zero-length run", () => {
    expect(dashedLine(5, 5, 5, 5)).toEqual([]);
  });
});

describe("ringCrossing", () => {
  it("is the radius itself from the centre", () => {
    expect(ringCrossing({ x: 0, y: 0 }, 60, 0)).toBeCloseTo(60, 10);
    expect(ringCrossing({ x: 0, y: 0 }, 60, 2.3)).toBeCloseTo(60, 10);
  });

  it("lands on the ring from an off-centre pivot, which a bare radius would not", () => {
    const pivot = { x: 12, y: -7 };
    const angle = 0.9;
    const reach = ringCrossing(pivot, 60, angle);
    const hit = { x: pivot.x + Math.cos(angle) * reach, y: pivot.y + Math.sin(angle) * reach };
    expect(Math.hypot(hit.x, hit.y)).toBeCloseTo(60, 10);
    expect(reach).not.toBeCloseTo(60, 3);
  });
});

describe("swingLimitLines (TR55)", () => {
  it("draws nothing at the shipped 360, where the turret has no limit to mark", () => {
    expect(swingLimitLines(SHIPPED)).toEqual([]);
  });

  it("still draws nothing past 360", () => {
    expect(swingLimitLines({ ...SHIPPED, maxSwingDeg: 540 })).toEqual([]);
  });

  it("puts the two runs at plus and minus half the arc, ending on the ring", () => {
    const spec: AimHudSpec = { ...SHIPPED, maxSwingDeg: 200 };
    const segs = swingLimitLines(spec);
    expect(segs.length).toBeGreaterThan(1);
    // The outermost point of each run is on the ring, at the arc's own edges.
    const ends = segs
      .map((s) => ({ x: s.x2, y: s.y2 }))
      .filter((p) => Math.abs(Math.hypot(p.x, p.y) - spec.ringRadius) < 1e-6);
    expect(ends).toHaveLength(2);
    const bearings = ends.map((p) => (Math.atan2(p.y, p.x) * 180) / Math.PI).sort((a, b) => a - b);
    expect(bearings[0]).toBeCloseTo(-100, 6);
    expect(bearings[1]).toBeCloseTo(100, 6);
  });

  it("starts both runs at the turret mount, not at the car's centre", () => {
    const pivot = { x: 9, y: 4 };
    const segs = swingLimitLines({ ...SHIPPED, maxSwingDeg: 120, pivot });
    const starts = segs.filter(
      (s) => Math.abs(s.x1 - pivot.x) < 1e-9 && Math.abs(s.y1 - pivot.y) < 1e-9,
    );
    expect(starts).toHaveLength(2);
  });
});

describe("muzzle arrows", () => {
  it("draws one per fixed muzzle direction", () => {
    expect(MUZZLE_DIRS_DEG).toEqual([0, 90, 180, 270]);
    expect(muzzleArrows()).toHaveLength(4);
  });

  it("clears the hp bar with the tail arrow, which is the whole reason the axial pair moved out", () => {
    const barFarEdge = HP_BAR_GEOMETRY.offset + HP_BAR_GEOMETRY.thickness;
    expect(AXIAL_STANDOFF).toBe(barFarEdge + AIM_HUD_STYLE.hpBarClearance);
    expect(AXIAL_STANDOFF).toBeGreaterThan(barFarEdge);
    // The tail arrow's nearest point is its base, and the base is what has to clear the bar.
    const tail = muzzleArrowPoints(180);
    const nearest = Math.min(...tail.map((p) => Math.hypot(p.x, p.y)));
    expect(nearest).toBeGreaterThan(barFarEdge);
  });

  it("leaves the lateral pair at the muzzle's own standoff", () => {
    expect(standoffOf(90)).toBe(LATERAL_STANDOFF);
    expect(standoffOf(270)).toBe(LATERAL_STANDOFF);
    expect(standoffOf(0)).toBe(AXIAL_STANDOFF);
    expect(standoffOf(180)).toBe(AXIAL_STANDOFF);
    expect(AXIAL_STANDOFF).toBeGreaterThan(LATERAL_STANDOFF);
  });

  it("keeps every arrow inside the ring, so the HUD reads as one instrument", () => {
    const furthest = Math.max(
      ...muzzleArrows().flatMap((points) => points.map((p) => Math.hypot(p.x, p.y))),
    );
    expect(furthest).toBeLessThan(CROSSHAIR_CONFIG.maxDistance);
  });

  it("points each arrow outward along its own direction", () => {
    for (const deg of MUZZLE_DIRS_DEG) {
      const [tip] = muzzleArrowPoints(deg);
      const bearing = (Math.atan2(tip!.y, tip!.x) * 180) / Math.PI;
      // atan2 returns (-180, 180]; 270 comes back as -90.
      expect(((bearing % 360) + 360) % 360).toBeCloseTo(deg, 6);
      expect(Math.hypot(tip!.x, tip!.y)).toBeCloseTo(standoffOf(deg) + AIM_HUD_STYLE.arrowLength, 6);
    }
  });
});

describe("aimHudSignature", () => {
  it("moves when anything drawn moves, and not otherwise", () => {
    const base = aimHudSignature(SHIPPED);
    expect(aimHudSignature({ ...SHIPPED })).toBe(base);
    expect(aimHudSignature({ ...SHIPPED, ringRadius: 90 })).not.toBe(base);
    expect(aimHudSignature({ ...SHIPPED, maxSwingDeg: 200 })).not.toBe(base);
    expect(aimHudSignature({ ...SHIPPED, pivot: { x: 6, y: 0 } })).not.toBe(base);
  });

  it("moves when either group is switched off, so the picture is rebuilt", () => {
    const base = aimHudSignature(SHIPPED);
    expect(aimHudSignature({ ...SHIPPED, showTurret: false })).not.toBe(base);
    expect(aimHudSignature({ ...SHIPPED, showMuzzle: false })).not.toBe(base);
    expect(aimHudSignature({ ...SHIPPED, showTurret: false })).not.toBe(
      aimHudSignature({ ...SHIPPED, showMuzzle: false }),
    );
  });
});

describe("the two groups (turret HUD vs muzzle HUD)", () => {
  it("drops the ring AND the swing limits with the turret group, keeping the arrows", () => {
    const g = fakeGraphics();
    drawAimHud(g as never, { ...SHIPPED, maxSwingDeg: 180, showTurret: false });
    expect(g.calls.arcs).toEqual([]);
    expect(g.calls.lines).toEqual([]);
    expect(g.calls.polys).toHaveLength(4);
  });

  it("drops the arrows with the muzzle group, keeping the ring", () => {
    const g = fakeGraphics();
    drawAimHud(g as never, { ...SHIPPED, showMuzzle: false });
    expect(g.calls.polys).toEqual([]);
    expect(g.calls.arcs.length).toBeGreaterThan(0);
  });

  it("asks for no swing lines at all once the turret group is off, arc or no arc", () => {
    expect(swingLimitLines({ ...SHIPPED, maxSwingDeg: 180, showTurret: false })).toEqual([]);
    expect(swingLimitLines({ ...SHIPPED, maxSwingDeg: 180 }).length).toBeGreaterThan(0);
  });

  it("reads as empty only when BOTH groups are off", () => {
    expect(aimHudIsEmpty(SHIPPED)).toBe(false);
    expect(aimHudIsEmpty({ ...SHIPPED, showTurret: false })).toBe(false);
    expect(aimHudIsEmpty({ ...SHIPPED, showMuzzle: false })).toBe(false);
    expect(aimHudIsEmpty({ ...SHIPPED, showTurret: false, showMuzzle: false })).toBe(true);
  });

  it("clears the layer even when both groups are off, so nothing stale is left drawn", () => {
    const g = fakeGraphics();
    drawAimHud(g as never, { ...SHIPPED, showTurret: false, showMuzzle: false });
    expect(g.calls.clears).toBe(1);
    expect(g.calls.arcs).toEqual([]);
    expect(g.calls.lines).toEqual([]);
    expect(g.calls.polys).toEqual([]);
  });
});

describe("drawAimHud", () => {
  it("draws the ring and the four arrows, and no swing lines, at the shipped values", () => {
    const g = fakeGraphics();
    drawAimHud(g as never, SHIPPED);
    expect(g.calls.clears).toBe(1);
    expect(g.calls.arcs.length).toBe(dashedRingSpans(SHIPPED.ringRadius).length);
    expect(g.calls.lines).toEqual([]);
    expect(g.calls.polys).toHaveLength(4);
  });

  it("adds the swing runs once the arc is restricted", () => {
    const g = fakeGraphics();
    drawAimHud(g as never, { ...SHIPPED, maxSwingDeg: 180 });
    expect(g.calls.lines.length).toBe(swingLimitLines({ ...SHIPPED, maxSwingDeg: 180 }).length);
  });

  it("paints every mark white", () => {
    const g = fakeGraphics();
    drawAimHud(g as never, { ...SHIPPED, maxSwingDeg: 180 });
    for (const [, color] of g.calls.lineStyles) expect(color).toBe(AIM_HUD_STYLE.color);
    for (const [color] of g.calls.fillStyles) expect(color).toBe(AIM_HUD_STYLE.color);
  });

  it("centres the ring on the car's centre, not on the turret mount", () => {
    const g = fakeGraphics();
    drawAimHud(g as never, { ...SHIPPED, pivot: { x: 9, y: 4 } });
    for (const [x, y, r] of g.calls.arcs) {
      expect(x).toBe(0);
      expect(y).toBe(0);
      expect(r).toBe(SHIPPED.ringRadius);
    }
  });
});
