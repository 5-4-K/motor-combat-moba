import { describe, expect, it } from "vitest";
import {
  COLOR_TABLE,
  DEFAULT_PATCH_RATE_HZ,
  DRIVE_CONFIG,
  WEAPON_TABLE,
  WeaponKind,
  hpOf,
} from "@motor-combat-moba/shared";
import {
  extrapolateShot,
  hpBarColor,
  hpFraction,
  instanceDrawShape,
  lockBracketArms,
  LOCK_BRACKET_HALF,
  weaponFillOf,
} from "./combat-visual.js";

describe("hpFraction", () => {
  it("is 1 at full hp", () => {
    expect(hpFraction(hpOf("rectangle"), "rectangle")).toBe(1);
  });

  it("is 0 for a wreck", () => {
    expect(hpFraction(0, "rectangle")).toBe(0);
  });

  it("measures each chassis against its own maximum", () => {
    expect(hpFraction(hpOf("hexagon") / 2, "hexagon")).toBe(0.5);
    expect(hpFraction(hpOf("oval") / 2, "oval")).toBe(0.5);
  });

  it("clamps rather than overflowing the bar", () => {
    expect(hpFraction(hpOf("rectangle") * 2, "rectangle")).toBe(1);
    expect(hpFraction(-5, "rectangle")).toBe(0);
  });

  it("falls back to the default chassis for an unrecognised carId", () => {
    expect(hpFraction(hpOf("rectangle"), "not-a-car")).toBe(1);
    expect(Number.isNaN(hpFraction(10, ""))).toBe(false);
  });
});

describe("hpBarColor", () => {
  it("is green while healthy", () => {
    expect(hpBarColor(1)).toBe(hpBarColor(0.5));
  });

  it("changes colour as hp drops", () => {
    const healthy = hpBarColor(1);
    const hurt = hpBarColor(0.3);
    const critical = hpBarColor(0.1);
    expect(hurt).not.toBe(healthy);
    expect(critical).not.toBe(hurt);
  });

  it("is the critical colour at zero", () => {
    expect(hpBarColor(0)).toBe(hpBarColor(0.1));
  });
});

describe("extrapolateShot", () => {
  const SPEED = WEAPON_TABLE.cannon.speed;

  it("does not move a shot reported this instant", () => {
    expect(extrapolateShot(100, 100, 0, SPEED, 0)).toEqual({ x: 100, y: 100 });
  });

  it("advances along the shot's own heading", () => {
    const moved = extrapolateShot(100, 100, 0, SPEED, 10);
    expect(moved.x).toBeCloseTo(100 + SPEED * 0.01, 6);
    expect(moved.y).toBeCloseTo(100, 6);
  });

  it("follows the angle", () => {
    const moved = extrapolateShot(100, 100, Math.PI / 2, SPEED, 10);
    expect(moved.x).toBeCloseTo(100, 6);
    expect(moved.y).toBeCloseTo(100 + SPEED * 0.01, 6);
  });

  it("caps at one patch interval, so a stall cannot fling a stale shot away", () => {
    const patchMs = 1000 / DEFAULT_PATCH_RATE_HZ;
    const capped = extrapolateShot(100, 100, 0, SPEED, 5000);
    expect(capped).toEqual(extrapolateShot(100, 100, 0, SPEED, patchMs));
  });

  it("never runs a shot backwards on a negative elapsed time", () => {
    expect(extrapolateShot(100, 100, 0, SPEED, -50)).toEqual({ x: 100, y: 100 });
  });
});

describe("instance drawing", () => {
  const projectile = { weaponId: "cannon", x: 100, y: 100, angle: 0, extent: 0 };

  it("extrapolates a projectile along its own heading between patches", () => {
    const still = instanceDrawShape(projectile, 0);
    const later = instanceDrawShape(projectile, 25);
    if (still.kind !== "circle" || later.kind !== "circle") throw new Error("cannon draws as a circle");
    expect(later.x).toBeGreaterThan(still.x);
  });

  it("caps extrapolation at one patch interval so a stalled patch cannot fling a shot", () => {
    const capped = instanceDrawShape(projectile, 5000);
    const oneInterval = instanceDrawShape(projectile, 1000 / 20);
    if (capped.kind !== "circle" || oneInterval.kind !== "circle") throw new Error("circle expected");
    expect(capped.x).toBeCloseTo(oneInterval.x);
  });

  it("draws by the weapon's own kind, so a stale row byte cannot pick the wrong shape", () => {
    // There is no beam in the shipped table, so the honest thing this can assert is the branch
    // itself: a row claiming to be a beam still draws `cannon`'s projectile circle, because the
    // definition decides. The previous version of this test paired `weaponId: "cannon"` with a BEAM
    // byte and got a polygon two of whose three vertices were NaN — `beamShapeAt` reading
    // `angleDeg` off a circle — and asserted only `kind === "polygon"`, so it passed on garbage.
    // `beamShapeAt`'s own rect/cone geometry is covered in shared's `shapes.test.ts`.
    const claimingBeam = { weaponId: "cannon", kind: WeaponKind.BEAM, x: 100, y: 100, angle: 0, extent: 200 };
    const shape = instanceDrawShape(claimingBeam, 0);
    expect(shape.kind).toBe("circle");
    if (shape.kind !== "circle") throw new Error("circle expected");
    expect(shape.radius).toBe(WEAPON_TABLE.cannon.hitbox.radius);
  });

  it("falls back to a small dot for an unrecognised weapon id rather than blanking the layer", () => {
    const shape = instanceDrawShape({ ...projectile, weaponId: "not-a-weapon" }, 0);
    expect(shape.kind).toBe("circle");
  });
});

describe("lockBracketArms", () => {
  it("returns two arms per corner", () => {
    expect(lockBracketArms(0, 0)).toHaveLength(8);
  });

  it("is centred on the point it is given", () => {
    const arms = lockBracketArms(500, 300);
    const xs = arms.flatMap((a) => [a.x1, a.x2]);
    const ys = arms.flatMap((a) => [a.y1, a.y2]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(500, 6);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(300, 6);
  });

  it("is a corner bracket, not a closed box", () => {
    // Every arm is shorter than the bracket's own side, so the four corners never join up. A closed
    // box reads as a selection rectangle and hides the car inside it.
    const arms = lockBracketArms(0, 0);
    const side = LOCK_BRACKET_HALF * 2;
    for (const a of arms) {
      expect(Math.hypot(a.x2 - a.x1, a.y2 - a.y1)).toBeLessThan(side / 2);
    }
  });

  it("clears a car hull, so the bracket frames the car rather than crossing it", () => {
    // Read from DRIVE_CONFIG rather than hardcoded as 48 x 32, so a chassis resize moves this
    // assertion instead of silently leaving the bracket inside the sprite.
    const halfDiagonal = Math.hypot(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight) / 2;
    expect(LOCK_BRACKET_HALF).toBeGreaterThan(halfDiagonal);
  });
});

describe("weaponFillOf", () => {
  it("draws every weapon in its own table colour", () => {
    for (const def of Object.values(WEAPON_TABLE)) {
      expect(weaponFillOf(def.id)).toBe(Number.parseInt(def.color.slice(1), 16));
    }
    expect(weaponFillOf("cannon")).toBe(0xe8590c);
  });

  it("is the same colour whoever fired it — a shot is never owner-coloured", () => {
    // The guard on the rule, not on the arithmetic: `weaponFillOf` takes only a weapon id, so no
    // caller can reach a player's colour through it. This fails to compile, not at run time, if a
    // future edit reintroduces an owner argument.
    expect(weaponFillOf.length).toBe(1);
    for (const color of COLOR_TABLE) {
      const playerFill = Number.parseInt(color.hex.slice(1), 16);
      for (const def of Object.values(WEAPON_TABLE)) expect(weaponFillOf(def.id)).not.toBe(playerFill);
    }
  });

  it("falls back to grey for an unrecognised weapon id rather than an invisible NaN fill", () => {
    expect(weaponFillOf("not-a-weapon")).toBe(0x555555);
    expect(Number.isNaN(weaponFillOf("not-a-weapon"))).toBe(false);
  });
});
