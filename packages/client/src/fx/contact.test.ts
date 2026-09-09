import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG, TICK_RATE_HZ, WEAPON_TABLE } from "@motor-combat-moba/shared";
import { damagePoint, shotEndPoint, shotGeometriesOf } from "./contact.js";
import type { FxCarView, FxInstanceView } from "./events.js";

// Car "a" sits at (100, 200) facing +x, so its hull spans x 76..124 and y 184..216. Every expected
// number below is read off those four edges rather than typed as a bare literal.
const HALF_LEN = DRIVE_CONFIG.carWidth / 2;
const HALF_WID = DRIVE_CONFIG.carHeight / 2;
const CAR_X = 100;
const CAR_Y = 200;
const NEAR_FACE = CAR_X - HALF_LEN;
const FAR_FACE = CAR_X + HALF_LEN;

const car = (over: Partial<FxCarView> = {}): FxCarView => ({
  sessionId: "a",
  x: CAR_X,
  y: CAR_Y,
  angle: 0,
  hp: 100,
  alive: true,
  carId: "mirage",
  vx: 0,
  vy: 0,
  ...over,
});

const shot = (over: Partial<FxInstanceView> & { weaponId: string }): FxInstanceView => ({
  id: "s1",
  x: 0,
  y: 0,
  angle: 0,
  alive: true,
  extent: 0,
  isExplosion: false,
  ...over,
});

/** How far a projectile of this weapon covers in one sim tick — the window the derivation allows. */
const travelPerTick = (id: "predator" | "magmablast") => WEAPON_TABLE[id].speed / TICK_RATE_HZ;

describe("shotEndPoint — a beam ends at its tip, never at its muzzle", () => {
  it("puts a rect beam's impact at origin + extent, not at the origin", () => {
    // The bug this exists for: WeaponInstance.x/y is a beam's ORIGIN, so lance's authored impact
    // burst used to detonate on the shooter's own nose.
    const beam = shot({ weaponId: "lance", x: 100, y: 100, angle: 0, extent: 400 });
    expect(shotEndPoint(beam, [])).toEqual({ x: 500, y: 100 });
  });

  it("carries the tip around with the beam's angle", () => {
    const beam = shot({ weaponId: "lance", x: 0, y: 0, angle: Math.PI / 2, extent: 200 });
    const p = shotEndPoint(beam, []);
    expect(p.x).toBeCloseTo(0, 8);
    expect(p.y).toBeCloseTo(200, 8);
  });

  it("puts a cone beam's tip on its axis too", () => {
    const beam = shot({ weaponId: "afterburner", x: 10, y: 20, angle: Math.PI, extent: 150 });
    const p = shotEndPoint(beam, []);
    expect(p.x).toBeCloseTo(-140, 8);
    expect(p.y).toBeCloseTo(20, 8);
  });

  it("leaves a DISC beam at its centre — a blast is radially symmetric and has no tip", () => {
    // magmablast's detonation resolves through instanceDefOf to a centre-origin disc. Its pose IS
    // the blast centre, so moving it along the shell's old heading would be strictly wrong.
    const blast = shot({
      weaponId: "magmablast",
      x: 300,
      y: 400,
      angle: 1.2,
      extent: 60,
      isExplosion: true,
    });
    expect(shotEndPoint(blast, [car()])).toEqual({ x: 300, y: 400 });
  });
});

describe("shotEndPoint — a projectile ends on the hull it struck", () => {
  it("snaps a shot sitting inside a car back onto the face it entered through", () => {
    const dart = shot({ weaponId: "predator", x: CAR_X, y: CAR_Y, angle: 0 });
    expect(shotEndPoint(dart, [car()])).toEqual({ x: NEAR_FACE, y: CAR_Y });
  });

  it("pulls a shot that OVERSHOT the car back to the entry face", () => {
    // The headline bug. A predator dart covers 30 u per tick against a 48 u hull, so the pose the
    // client observes routinely sits a car-length past the car — and the burst went with it.
    const past = FAR_FACE + 26;
    const dart = shot({ weaponId: "predator", x: past, y: CAR_Y, angle: 0 });
    expect(shotEndPoint(dart, [car()])).toEqual({ x: NEAR_FACE, y: CAR_Y });
  });

  it("places the burst by the shot's own line, not by proximity — a flank hit lands on the flank", () => {
    // Travelling +y through the car's side: the entry face is the near LONG edge, and the point
    // keeps the shot's own x rather than sliding to the nearest corner.
    const dart = shot({ weaponId: "predator", x: CAR_X + 10, y: CAR_Y, angle: Math.PI / 2 });
    const p = shotEndPoint(dart, [car()]);
    expect(p.x).toBeCloseTo(CAR_X + 10, 8);
    expect(p.y).toBeCloseTo(CAR_Y - HALF_WID, 8);
  });

  it("leaves a shot that hit no car exactly where it died — a wall is its own contact point", () => {
    const dart = shot({ weaponId: "predator", x: 500, y: 500, angle: 0 });
    expect(shotEndPoint(dart, [car()])).toEqual({ x: 500, y: 500 });
  });

  it("refuses a car further back than one tick of travel could reach", () => {
    // Same line as the car, but died far past it — a wall hit beyond the target. Snapping to the
    // car here would teleport the burst backwards across the arena.
    const wayPast = FAR_FACE + travelPerTick("predator") * 3;
    const dart = shot({ weaponId: "predator", x: wayPast, y: CAR_Y, angle: 0 });
    expect(shotEndPoint(dart, [car()])).toEqual({ x: wayPast, y: CAR_Y });
  });

  it("ignores a car nowhere near the shot's line", () => {
    const dart = shot({ weaponId: "predator", x: CAR_X, y: CAR_Y + 300, angle: 0 });
    expect(shotEndPoint(dart, [car()])).toEqual({ x: CAR_X, y: CAR_Y + 300 });
  });

  it("picks the car the shot is actually in when two sit on its line", () => {
    const near = car({ sessionId: "near" });
    const far = car({ sessionId: "far", x: CAR_X + 400 });
    const dart = shot({ weaponId: "predator", x: CAR_X, y: CAR_Y, angle: 0 });
    expect(shotEndPoint(dart, [near, far])).toEqual({ x: NEAR_FACE, y: CAR_Y });
  });

  it("follows a rotated hull rather than the world axes", () => {
    // Turned a quarter turn, the car's LONG axis runs along y, so a shot arriving along +x enters
    // through a face only carHeight / 2 out from the centre.
    const turned = car({ angle: Math.PI / 2 });
    const dart = shot({ weaponId: "predator", x: CAR_X, y: CAR_Y, angle: 0 });
    const p = shotEndPoint(dart, [turned]);
    expect(p.x).toBeCloseTo(CAR_X - HALF_WID, 8);
    expect(p.y).toBeCloseTo(CAR_Y, 8);
  });

  it("keeps the pose for a weapon id it cannot resolve", () => {
    const odd = shot({ weaponId: "carDamage", x: 12, y: 34 });
    expect(shotEndPoint(odd, [car()])).toEqual({ x: 12, y: 34 });
  });

  it("keeps the pose for a maneuver, which spawns no hitbox to contact anything with", () => {
    const dash = shot({ weaponId: "wildcharge", x: CAR_X, y: CAR_Y, angle: 0 });
    expect(shotEndPoint(dash, [car()])).toEqual({ x: CAR_X, y: CAR_Y });
  });
});

describe("damagePoint — sparks come off the skin that was struck", () => {
  it("falls back to the car's centre when nothing is in flight — a ram has no instance", () => {
    expect(damagePoint(car(), shotGeometriesOf([]))).toEqual({ x: CAR_X, y: CAR_Y });
  });

  it("puts a beam's damage on the face turned toward the shooter", () => {
    const beam = shot({ weaponId: "lance", x: 0, y: CAR_Y, angle: 0, extent: 400 });
    expect(damagePoint(car(), shotGeometriesOf([beam]))).toEqual({ x: NEAR_FACE, y: CAR_Y });
  });

  it("ignores a beam that stops short of the car", () => {
    const short = shot({ weaponId: "lance", x: 0, y: CAR_Y, angle: 0, extent: 20 });
    expect(damagePoint(car(), shotGeometriesOf([short]))).toEqual({ x: CAR_X, y: CAR_Y });
  });

  it("ignores a beam pointing away from the car", () => {
    const away = shot({ weaponId: "lance", x: 0, y: CAR_Y, angle: Math.PI, extent: 400 });
    expect(damagePoint(car(), shotGeometriesOf([away]))).toEqual({ x: CAR_X, y: CAR_Y });
  });

  it("puts an explosion's damage on the face turned toward the blast", () => {
    const blast = shot({
      weaponId: "magmablast",
      x: CAR_X - 100,
      y: CAR_Y,
      angle: 0,
      extent: 140,
      isExplosion: true,
    });
    expect(damagePoint(car(), shotGeometriesOf([blast]))).toEqual({ x: NEAR_FACE, y: CAR_Y });
  });

  it("puts a projectile's damage on the face it came through, not the car's middle", () => {
    const shell = shot({ weaponId: "magmablast", x: CAR_X, y: CAR_Y, angle: 0 });
    expect(damagePoint(car(), shotGeometriesOf([shell]))).toEqual({ x: NEAR_FACE, y: CAR_Y });
  });

  it("prefers the instance actually touching the car over a distant one", () => {
    const miles = shot({ id: "far", weaponId: "lance", x: 0, y: CAR_Y + 900, angle: 0, extent: 400 });
    const onIt = shot({ id: "hit", weaponId: "magmablast", x: CAR_X, y: CAR_Y, angle: 0 });
    expect(damagePoint(car(), shotGeometriesOf([miles, onIt]))).toEqual({ x: NEAR_FACE, y: CAR_Y });
  });

  it("stays on the centre when the only shot in flight is somewhere else entirely", () => {
    const elsewhere = shot({ weaponId: "magmablast", x: 900, y: 900, angle: 0 });
    expect(damagePoint(car(), shotGeometriesOf([elsewhere]))).toEqual({ x: CAR_X, y: CAR_Y });
  });

  it("returns a point on or inside the struck hull, whatever the geometry", () => {
    // The property that matters across every case at once: the sparks may never spawn off the car.
    const turned = car({ angle: 0.9 });
    for (const angle of [0, 1, 2, 3, 4, 5]) {
      const shell = shot({ weaponId: "magmablast", x: CAR_X, y: CAR_Y, angle });
      const p = damagePoint(turned, shotGeometriesOf([shell]));
      const dx = p.x - turned.x;
      const dy = p.y - turned.y;
      const localX = dx * Math.cos(-turned.angle) - dy * Math.sin(-turned.angle);
      const localY = dx * Math.sin(-turned.angle) + dy * Math.cos(-turned.angle);
      expect(Math.abs(localX)).toBeLessThanOrEqual(HALF_LEN + 1e-6);
      expect(Math.abs(localY)).toBeLessThanOrEqual(HALF_WID + 1e-6);
    }
  });
});
