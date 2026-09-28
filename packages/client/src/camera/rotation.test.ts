import { describe, expect, it } from "vitest";
import { ARENA_03 } from "@motor-combat-moba/shared";
import { projectToScreen } from "../input/aim-offset.js";
import {
  easeAngle,
  isAxisAligned,
  normalizeAngle,
  resolveViewRotation,
  teamFacingRotation,
  viewRotationForHeading,
} from "./rotation.js";

const FRAME = 1000 / 60;

describe("normalizeAngle", () => {
  it("maps into (-π, π]", () => {
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(3 * Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    expect(normalizeAngle(0)).toBeCloseTo(0);
    expect(normalizeAngle(4 * Math.PI + 0.1)).toBeCloseTo(0.1);
  });
});

describe("viewRotationForHeading (CB13)", () => {
  // The sign convention, pinned against the crosshair's own world→screen maths: a point straight
  // ahead of the car must land straight above the screen centre, for any heading.
  it.each([0, Math.PI / 2, -Math.PI / 2, Math.PI, 0.7, -2.3])("puts heading %f straight up", (h) => {
    const view = {
      x: 0, y: 0, width: 1280, height: 720, originX: 0.5, originY: 0.5,
      zoomX: 1, zoomY: 1, scrollX: 1000 - 640, scrollY: 1000 - 360,
    };
    const ahead = { x: 1000 + Math.cos(h) * 100, y: 1000 + Math.sin(h) * 100 };
    const s = projectToScreen(view, ahead, viewRotationForHeading(h));
    expect(s.x).toBeCloseTo(640, 6);
    expect(s.y).toBeCloseTo(360 - 100, 6);
  });
});

describe("teamFacingRotation (CB10, CB11)", () => {
  it("reproduces arena-03's old 180° team-B view without a flag", () => {
    expect(teamFacingRotation(ARENA_03, 0)).toBeCloseTo(0);
    expect(Math.abs(teamFacingRotation(ARENA_03, 1))).toBeCloseTo(Math.PI);
  });
  it("reads 0 for an arena with no spawns for that team", () => {
    expect(teamFacingRotation({ teamASpawns: [], teamBSpawns: [] }, 1)).toBe(0);
  });
});

describe("easeAngle", () => {
  it("takes the short way across the ±π seam (Review Focus 2)", () => {
    const from = (170 * Math.PI) / 180;
    const to = (-170 * Math.PI) / 180;
    const next = easeAngle(from, to, 0.5, FRAME);
    // Half of a 20° turn, going up through 180°: 180°, i.e. ±π.
    expect(Math.abs(next)).toBeCloseTo(Math.PI, 6);
  });
  it("closes lerp of the gap per 60 Hz frame, frame-rate independent", () => {
    const one = easeAngle(0, 1, 0.2, FRAME);
    expect(one).toBeCloseTo(0.2, 6);
    let a = 0;
    for (let i = 0; i < 4; i++) a = easeAngle(a, 1, 0.2, FRAME / 4);
    expect(a).toBeCloseTo(0.2, 6);
  });
  it("lerp 1 snaps", () => {
    expect(easeAngle(0, 2, 1, FRAME)).toBeCloseTo(2);
  });
});

describe("isAxisAligned (CB15)", () => {
  it("is true for multiples of π only", () => {
    expect(isAxisAligned(0)).toBe(true);
    expect(isAxisAligned(Math.PI)).toBe(true);
    expect(isAxisAligned(-Math.PI)).toBe(true);
    expect(isAxisAligned(2 * Math.PI)).toBe(true);
    expect(isAxisAligned(Math.PI / 2)).toBe(false);
    expect(isAxisAligned(0.01)).toBe(false);
  });
});

describe("resolveViewRotation", () => {
  const base = {
    arena: ARENA_03, localTeam: 1, followHeading: 0.5, current: 0.2, lerp: 0.15,
    deltaMs: FRAME, snap: false,
  } as const;

  it('"none" is always 0 (CB14)', () => {
    expect(resolveViewRotation({ ...base, rotate: "none" })).toBe(0);
  });
  it('"teamFacing" snaps to the team angle, ignoring the car heading (CB10)', () => {
    expect(Math.abs(resolveViewRotation({ ...base, rotate: "teamFacing" }))).toBeCloseTo(Math.PI);
  });
  it('"teamFacing" reads 0 until the local team is known (Review Focus 1)', () => {
    expect(resolveViewRotation({ ...base, rotate: "teamFacing", localTeam: undefined })).toBe(0);
  });
  it('"heading" eases toward the followed car (CB12)', () => {
    const target = viewRotationForHeading(0.5);
    const got = resolveViewRotation({ ...base, rotate: "heading" });
    expect(got).toBeCloseTo(easeAngle(0.2, target, 0.15, FRAME), 9);
  });
  it('"heading" snaps when asked (first frame, respawn cut)', () => {
    expect(resolveViewRotation({ ...base, rotate: "heading", snap: true })).toBeCloseTo(
      viewRotationForHeading(0.5),
    );
  });
  it('"heading" holds its angle with nothing to follow (CB16 free roam)', () => {
    expect(resolveViewRotation({ ...base, rotate: "heading", followHeading: undefined })).toBe(0.2);
  });
});
