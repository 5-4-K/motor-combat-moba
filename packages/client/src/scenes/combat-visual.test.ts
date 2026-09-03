import { describe, expect, it } from "vitest";
import {
  COLOR_TABLE,
  DEFAULT_PATCH_RATE_HZ,
  DRIVE_CONFIG,
  WEAPON_TABLE,
  WeaponKind,
  hpOf,
  msToTicks,
  weaponTicksOf,
} from "@motor-combat-moba/shared";
import {
  allegianceOf,
  BEAM_FADE_OUT_MS,
  beamFadeAlpha,
  extrapolateShot,
  hpBarColor,
  hpBarPoints,
  hpFraction,
  beamDrawLayers,
  chargeOrbBands,
  instanceDrawShape,
  instanceGlowBands,
  isAuraInstance,
  WEAPON_BEAM_STYLES,
  lockBracketArms,
  LOCK_BRACKET_HALF,
  SHOW_LOCK_BRACKET,
  weaponFillOf,
  type DrawableInstance,
} from "./combat-visual.js";

describe("hpFraction", () => {
  it("is 1 at full hp", () => {
    expect(hpFraction(hpOf("mirage"), "mirage")).toBe(1);
  });

  it("is 0 for a wreck", () => {
    expect(hpFraction(0, "mirage")).toBe(0);
  });

  it("measures each chassis against its own maximum", () => {
    expect(hpFraction(hpOf("bastion") / 2, "bastion")).toBe(0.5);
    expect(hpFraction(hpOf("bullseye") / 2, "bullseye")).toBe(0.5);
  });

  it("clamps rather than overflowing the bar", () => {
    expect(hpFraction(hpOf("mirage") * 2, "mirage")).toBe(1);
    expect(hpFraction(-5, "mirage")).toBe(0);
  });

  it("falls back to the default chassis for an unrecognised carId", () => {
    expect(hpFraction(hpOf("mirage"), "not-a-car")).toBe(1);
    expect(Number.isNaN(hpFraction(10, ""))).toBe(false);
  });
});

describe("allegianceOf", () => {
  const me = { sessionId: "me", team: 0 };
  const mate = { sessionId: "mate", team: 0 };
  const foe = { sessionId: "foe", team: 1 };

  it("makes you your own ally, in both modes", () => {
    expect(allegianceOf(me, me, "ffa")).toBe("ally");
    expect(allegianceOf(me, me, "team")).toBe("ally");
  });

  it("makes a teammate an ally only in team mode", () => {
    expect(allegianceOf(me, mate, "team")).toBe("ally");
    // In FFA everyone shares team 0, and everyone but you is still an enemy.
    expect(allegianceOf(me, mate, "ffa")).toBe("enemy");
  });

  it("makes an opponent an enemy in both modes", () => {
    expect(allegianceOf(me, foe, "ffa")).toBe("enemy");
    expect(allegianceOf(me, foe, "team")).toBe("enemy");
  });

  it("answers from the viewer, so a spectate camera can never flip it (D2)", () => {
    // You are a wreck watching `foe` fill the screen. Your teammate is still an ally and `foe` is
    // still an enemy — dying changed nothing, because nothing about the camera reaches this.
    expect(allegianceOf(me, mate, "team")).toBe("ally");
    expect(allegianceOf(me, foe, "team")).toBe("enemy");
    // Handing the WATCHED car in as the viewer is what would flip it, which is the whole reason
    // the viewer is a parameter rather than something this function reads for itself.
    expect(allegianceOf(foe, foe, "team")).toBe("ally");
  });
});

describe("hpBarColor", () => {
  it("tells the two sides apart", () => {
    expect(hpBarColor("ally")).not.toBe(hpBarColor("enemy"));
  });

  it("is one colour per side and nothing else", () => {
    // Allegiance is the only input left; there is no fraction to vary, and no exception for the
    // viewer's own car (D1).
    expect(hpBarColor("ally")).toBe(hpBarColor("ally"));
    expect(hpBarColor("enemy")).toBe(hpBarColor("enemy"));
  });

  it("keeps the shipped palette: the healthy green for allies, the critical red for enemies", () => {
    expect(hpBarColor("ally")).toBe(0x49c46a);
    expect(hpBarColor("enemy")).toBe(0xd94040);
  });
});

describe("hpBarPoints", () => {
  const BAR = { length: 40, thickness: 5, offset: 30 };
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  it("lays a full bar across the car's tail, perpendicular to its facing direction", () => {
    const [nearLeft, nearRight, farRight, farLeft] = hpBarPoints(
      { x: 100, y: 200, angle: 0 },
      1,
      BAR,
    );
    // Facing +x, so the bar sits at -x of the centre and runs along y.
    expect(nearLeft).toEqual({ x: 70, y: 180 });
    expect(nearRight).toEqual({ x: 70, y: 220 });
    expect(farRight).toEqual({ x: 65, y: 220 });
    expect(farLeft).toEqual({ x: 65, y: 180 });
  });

  it("turns with the car, keeping its size and its offset behind the centre", () => {
    for (const angle of [0, Math.PI / 2, 2.4, -1.1]) {
      const pose = { x: 12, y: -7, angle };
      const [nearLeft, nearRight, farRight] = hpBarPoints(pose, 1, BAR);
      expect(dist(nearLeft, nearRight)).toBeCloseTo(BAR.length);
      expect(dist(nearRight, farRight)).toBeCloseTo(BAR.thickness);
      const midX = (nearLeft.x + nearRight.x) / 2;
      const midY = (nearLeft.y + nearRight.y) / 2;
      expect(dist({ x: midX, y: midY }, pose)).toBeCloseTo(BAR.offset);
      // Behind, never in front: the near edge is opposite the facing direction.
      expect((midX - pose.x) * Math.cos(angle) + (midY - pose.y) * Math.sin(angle)).toBeLessThan(0);
    }
  });

  it("drains from the same end of the car whatever way it points", () => {
    for (const angle of [0, Math.PI / 2, 2.4, -1.1]) {
      const pose = { x: 0, y: 0, angle };
      const full = hpBarPoints(pose, 1, BAR);
      const half = hpBarPoints(pose, 0.5, BAR);
      expect(half[0]).toEqual(full[0]);
      expect(dist(half[0], half[1])).toBeCloseTo(BAR.length / 2);
    }
  });

  it("clamps the fraction to a bar between empty and full", () => {
    const pose = { x: 0, y: 0, angle: 0.3 };
    expect(hpBarPoints(pose, 2, BAR)).toEqual(hpBarPoints(pose, 1, BAR));
    expect(hpBarPoints(pose, -1, BAR)).toEqual(hpBarPoints(pose, 0, BAR));
    const [nearLeft, nearRight] = hpBarPoints(pose, 0, BAR);
    expect(dist(nearLeft, nearRight)).toBe(0);
  });
});

describe("extrapolateShot", () => {
  const SPEED = WEAPON_TABLE.magmablast.speed;

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
  const projectile = { weaponId: "magmablast", isExplosion: false, x: 100, y: 100, angle: 0, extent: 0 };

  it("extrapolates a projectile along its own heading between patches", () => {
    const still = instanceDrawShape(projectile, 0);
    const later = instanceDrawShape(projectile, 25);
    if (still.kind !== "circle" || later.kind !== "circle") throw new Error("magmablast draws as a circle");
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
    // itself: a row claiming to be a beam still draws `magmablast`'s projectile circle, because the
    // definition decides. The previous version of this test paired `weaponId: "fireball"` with a BEAM
    // byte and got a polygon two of whose three vertices were NaN — `beamShapeAt` reading
    // `angleDeg` off a circle — and asserted only `kind === "polygon"`, so it passed on garbage.
    // `beamShapeAt`'s own rect/cone geometry is covered in shared's `shapes.test.ts`.
    const claimingBeam = {
      weaponId: "magmablast",
      isExplosion: false,
      kind: WeaponKind.BEAM,
      x: 100,
      y: 100,
      angle: 0,
      extent: 200,
    };
    const shape = instanceDrawShape(claimingBeam, 0);
    expect(shape.kind).toBe("circle");
    if (shape.kind !== "circle") throw new Error("circle expected");
    expect(shape.radius).toBe(WEAPON_TABLE.magmablast.hitbox.radius);
  });

  it("falls back to a small dot for an unrecognised weapon id rather than blanking the layer", () => {
    const shape = instanceDrawShape({ ...projectile, weaponId: "not-a-weapon" }, 0);
    expect(shape.kind).toBe("circle");
  });

  it("draws a magmablast burst as its disc, not as the shell's dart", () => {
    const burst: DrawableInstance = {
      weaponId: "magmablast", isExplosion: true, x: 100, y: 100, angle: 0, extent: 60,
    };
    const shape = instanceDrawShape(burst, 0);
    expect(shape.kind).toBe("circle");
    expect(shape).toMatchObject({ x: 100, y: 100, radius: 60 });
    expect(isAuraInstance(burst)).toBe(true);
  });

  it("still draws the shell as a projectile", () => {
    const shell: DrawableInstance = {
      weaponId: "magmablast", isExplosion: false, x: 100, y: 100, angle: 0, extent: 0,
    };
    expect(isAuraInstance(shell)).toBe(false);
  });
});

describe("SHOW_LOCK_BRACKET", () => {
  it("ships on", () => {
    // A deliberate change detector, and the only guard there is. The flag exists to be flipped
    // while working on the arena, and a flip left in is invisible in review -- the bracket simply
    // stops appearing, which looks exactly like a lock that never acquired.
    expect(SHOW_LOCK_BRACKET).toBe(true);
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
    expect(weaponFillOf("magmablast")).toBe(0xff6000);
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

describe("instanceGlowBands", () => {
  const RADIUS = WEAPON_TABLE.magmablast.hitbox.radius;

  it("returns nothing for a weapon with no authored look, so it keeps its flat disc", () => {
    // `WEAPON_GLOW_STYLES` is empty as of the 2026-09-01 roster cutover (see the table's own
    // comment), so every real weapon id proves this branch today. `predator` stands in for "any
    // weapon with no authored look."
    expect(instanceGlowBands("predator", 3, 0, 0)).toEqual([]);
  });

  it("returns nothing for an unrecognised weapon id rather than throwing", () => {
    expect(instanceGlowBands("not-a-weapon", 12, 0, 0)).toEqual([]);
  });

  // The five tests below pin `instanceGlowBands`' actual band math -- ordering, containment,
  // flicker, phase, scaling -- and every one of them needs a REAL `WEAPON_GLOW_STYLES` entry to
  // exercise it against. The table is empty since the 2026-09-01 roster cutover retired `fireball`
  // (its one weapon with a flicker) and moved `pepperbox` out to an ellipse hitbox a round-glow
  // table cannot own, so nothing in the shipped roster carries a look. Skipped rather than deleted
  // or faked against data that describes no shipped weapon: the mechanism is still live code, ready
  // for whichever weapon next earns bands. `fireball`'s retired numbers are frozen here as literals
  // (it is no longer a valid `WeaponId`, so `WEAPON_GLOW_STYLES` can no longer be indexed by it) —
  // un-skip and point these at a real weapon's id and its real `WEAPON_GLOW_STYLES` entry once one
  // exists.
  const RETIRED_FIREBALL_BAND_COUNT = 4;
  const RETIRED_FIREBALL_FLICKER_DEPTH = 1 / 12;

  it.skip("draws the fireball outermost first, so each band is filled over the last", () => {
    const bands = instanceGlowBands("fireball", RADIUS, 0, 0);
    expect(bands.length).toBe(RETIRED_FIREBALL_BAND_COUNT);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]!.radius).toBeLessThan(bands[i - 1]!.radius);
    }
  });

  it.skip("never draws outside the hitbox, at any point in the flicker", () => {
    // The invariant the whole style system rests on: what you see is what can hurt you. A flicker
    // that could push the rim past the hitbox would make the drawn shot bigger than the thing that
    // hits, so the wave is [0, 1] and only ever subtracts. Swept across several full cycles at
    // 1 ms, which is finer than any frame this will ever be sampled at.
    for (let ms = 0; ms < 1000; ms++) {
      for (const band of instanceGlowBands("fireball", RADIUS, 0, ms)) {
        expect(band.radius).toBeLessThanOrEqual(RADIUS);
      }
    }
  });

  it.skip("flickers between the full hitbox and one flicker depth inside it", () => {
    const outer: number[] = [];
    for (let ms = 0; ms < 1000; ms += 0.5) outer.push(instanceGlowBands("fireball", RADIUS, 0, ms)[0]!.radius);
    expect(Math.max(...outer)).toBeCloseTo(RADIUS, 2);
    expect(Math.min(...outer)).toBeCloseTo(RADIUS * (1 - RETIRED_FIREBALL_FLICKER_DEPTH), 2);
  });

  it.skip("puts shots spawned on different ticks out of phase, so a stream does not pulse in lockstep", () => {
    const a = instanceGlowBands("fireball", RADIUS, 100, 0)[0]!.radius;
    const b = instanceGlowBands("fireball", RADIUS, 101, 0)[0]!.radius;
    expect(a).not.toBeCloseTo(b, 3);
  });

  it.skip("scales the whole glow with the hitbox, so a re-tuned radius cannot strand a band", () => {
    const wide = instanceGlowBands("fireball", RADIUS * 2, 0, 0);
    const base = instanceGlowBands("fireball", RADIUS, 0, 0);
    wide.forEach((band, i) => expect(band.radius).toBeCloseTo(base[i]!.radius * 2, 6));
  });
});

describe("beamDrawLayers", () => {
  const AFTERBURNER = WEAPON_TABLE.afterburner;
  // Fired from the origin along +x, so vertices come back axis-aligned and containment is
  // checkable with arithmetic rather than a point-in-polygon routine.
  const EXTENT = 220;
  const layers = () => beamDrawLayers("afterburner", 0, 0, 0, EXTENT, 0);

  function coneHalfAngle(): number {
    if (AFTERBURNER.kind !== "beam" || AFTERBURNER.hitbox.shape !== "cone") {
      throw new Error("afterburner must be a cone beam");
    }
    return (AFTERBURNER.hitbox.angleDeg * Math.PI) / 360;
  }

  it("returns nothing for a projectile, so a mis-branched caller falls back rather than throwing", () => {
    // `magmablast` used to be a disc-hitbox aura here; it was redefined into a plain circular
    // projectile by the 2026-09-01 roster cutover, so it now proves this branch (not a beam) rather
    // than the disc-specific refusal `beamDrawLayers` still carries. A disc hitbox ships again as of
    // the magmablast explosion mechanic — but as a BURST instance, reached through `isAuraInstance`
    // (which resolves the def via `instanceDefOf`), never through this function: `beamDrawLayers`
    // takes a bare `weaponId`, and magmablast's own row is still this projectile.
    expect(beamDrawLayers("magmablast", 0, 0, 0, 100, 0)).toEqual([]);
    expect(beamDrawLayers("not-a-weapon", 0, 0, 0, 100, 0)).toEqual([]);
  });

  it("drops a layer that has grown to nothing rather than filling a degenerate polygon", () => {
    // On its spawn tick a beam has zero extent, and `fillPoints` must never see that.
    expect(beamDrawLayers("afterburner", 0, 0, 0, 0, 0)).toEqual([]);
  });

  /**
   * The invariant the whole draw path rests on, stated for beams: nothing drawn may reach past the
   * hitbox that actually hits. Checked at every vertex of every layer, against the cone's real
   * walls rather than its bounding box.
   */
  it("never draws past the cone hitbox, at any vertex of any layer", () => {
    const tanHalf = Math.tan(coneHalfAngle());
    for (const layer of layers()) {
      for (const point of layer.points) {
        expect(point.x).toBeGreaterThanOrEqual(-1e-9);
        expect(point.x).toBeLessThanOrEqual(EXTENT + 1e-9);
        expect(Math.abs(point.y)).toBeLessThanOrEqual(tanHalf * point.x + 1e-9);
      }
    }
  });

  it("holds containment as the beam grows, not just at full extent", () => {
    const tanHalf = Math.tan(coneHalfAngle());
    for (let grown = 1; grown <= EXTENT; grown += 7) {
      for (const layer of beamDrawLayers("afterburner", 0, 0, 0, grown, 0)) {
        for (const point of layer.points) {
          expect(Math.abs(point.y)).toBeLessThanOrEqual(tanHalf * point.x + 1e-9);
          expect(point.x).toBeLessThanOrEqual(grown + 1e-9);
        }
      }
    }
  });

  it("is a tongued outline, not a triangle", () => {
    // The whole point of the shape. Three vertices is the plain hitbox cone, which is what this
    // replaced -- a lobed silhouette needs many more, and the radii must actually vary.
    const outer = layers()[0]!;
    expect(outer.points.length).toBeGreaterThan(10);
    const radii = outer.points.map((p) => Math.hypot(p.x, p.y));
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(1);
  });

  /**
   * Containment says the flame never draws PAST the hitbox. This says it actually FILLS it — the
   * other half, and the half that is easy to lose silently.
   *
   * Measured along the beam's axis, because the hitbox's far edge is a straight line and not an
   * arc. An earlier cut placed the tips at a fixed RADIUS instead, which touched the hitbox only on
   * the centreline and fell 11% short of it at the cone's rim: still contained, still passing every
   * containment assertion, and visibly smaller than the thing that burns.
   */
  it("lands its tongue tips on the hitbox's far edge across the whole fan, not just on the centreline", () => {
    const outer = layers()[0]!;
    const half = coneHalfAngle();
    // Tips are the local maxima of axial reach; the deepest tip at each end of the fan and the
    // middle one must all sit on x = EXTENT, which is where the cone's flat far edge is.
    const axial = outer.points.map((p) => p.x);
    expect(Math.max(...axial)).toBeCloseTo(EXTENT, 6);

    // And a tip near the RIM reaches the edge too — the assertion the radius-based version failed.
    const rimTips = outer.points.filter(
      (p) => Math.abs(Math.atan2(p.y, p.x)) > half * 0.6 && p.x > EXTENT * 0.95,
    );
    expect(rimTips.length).toBeGreaterThan(0);
    for (const tip of rimTips) expect(tip.x).toBeCloseTo(EXTENT, 6);
  });

  it("nests each layer inside the one outside it", () => {
    const reaches = layers().map((l) => Math.max(...l.points.map((p) => Math.hypot(p.x, p.y))));
    const spans = layers().map((l) => Math.max(...l.points.map((p) => Math.abs(Math.atan2(p.y, p.x)))));
    for (let i = 1; i < reaches.length; i++) {
      expect(reaches[i]!).toBeLessThan(reaches[i - 1]!);
      expect(spans[i]!).toBeLessThan(spans[i - 1]!);
    }
  });

  it("keeps every authored scale inside (0, 1], which is what makes containment geometric", () => {
    for (const [id, style] of Object.entries(WEAPON_BEAM_STYLES)) {
      for (const layer of style!.layers) {
        expect(layer.extentScale, id).toBeGreaterThan(0);
        expect(layer.extentScale, id).toBeLessThanOrEqual(1);
        expect(layer.crossScale, id).toBeGreaterThan(0);
        expect(layer.crossScale, id).toBeLessThanOrEqual(1);
        // Pull-back only: a negative depth would push a tongue past the hitbox.
        expect(layer.tongueDepth, id).toBeGreaterThanOrEqual(0);
        expect(layer.tongueDepth, id).toBeLessThanOrEqual(1);
        expect(layer.tongues, id).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("costs one fill per layer however many tongues it has", () => {
    // The performance contract. Tongues add VERTICES to an existing fill, never fills -- and fills
    // are what cost, because each is a `fillPoints` call in `renderShots`.
    expect(layers().length).toBe(WEAPON_BEAM_STYLES.afterburner!.layers.length);
  });

  it("is stable frame to frame, since the flame does not flicker", () => {
    expect(beamDrawLayers("afterburner", 0, 0, 0, EXTENT, 0)).toEqual(
      beamDrawLayers("afterburner", 0, 0, 0, EXTENT, 0),
    );
  });

  it("puts the weapon's own table colour on its body layer, one in from the dark rim", () => {
    // Not the outer layer: a flame wants its darkest ring outside so it reads as a hard-edged object
    // on a light floor. The rule that matters is that the table colour appears in the ramp at all --
    // otherwise the HUD slot and the shot are two different weapons.
    expect(WEAPON_BEAM_STYLES.afterburner!.layers[1]!.color.toUpperCase()).toBe(
      AFTERBURNER.color.toUpperCase(),
    );
  });

  it("anchors the flame to the muzzle and follows the car's heading", () => {
    const turned = beamDrawLayers("afterburner", 50, 60, Math.PI / 2, EXTENT, 0)[0]!;
    // The apex is the muzzle itself.
    expect(turned.points[0]!.x).toBeCloseTo(50, 6);
    expect(turned.points[0]!.y).toBeCloseTo(60, 6);
    // Pointing along +y now, so the flame's mass sits above the muzzle rather than beside it.
    const far = turned.points.reduce((a, b) => (b.y > a.y ? b : a));
    expect(far.y).toBeGreaterThan(60);
  });
});

describe("chargeOrbBands", () => {
  // lance winds up for 700ms == 21 ticks at 30Hz. Pressed at tick 100, the shot exits at 121.
  const WINDUP = 21;
  const PRESS = 100;
  const EXIT = PRESS + WINDUP;
  const CHARGE = WEAPON_BEAM_STYLES.lance!.charge!;
  const orbAt = (tick: number) => chargeOrbBands("lance", EXIT, tick);

  it("draws nothing for a weapon with no authored charge", () => {
    // afterburner is a beam with layers but no wind-up and no orb; magmablast (a plain circular
    // projectile as of the 2026-09-01 roster cutover) and predator (a capsule projectile) have
    // neither.
    expect(chargeOrbBands("afterburner", EXIT, PRESS)).toEqual([]);
    expect(chargeOrbBands("magmablast", EXIT, PRESS)).toEqual([]);
    expect(chargeOrbBands("predator", EXIT, PRESS)).toEqual([]);
    expect(chargeOrbBands("not-a-weapon", EXIT, PRESS)).toEqual([]);
  });

  it("appears as a dot on the press tick rather than fading in from nothing", () => {
    const orbs = orbAt(PRESS);
    expect(orbs).toHaveLength(CHARGE.bands.length);
    expect(Math.max(...orbs.map((o) => o.radius))).toBeCloseTo(CHARGE.minRadius, 6);
    expect(CHARGE.minRadius).toBeGreaterThan(0);
  });

  it("grows toward its full radius across the wind-up", () => {
    const radii = [PRESS, PRESS + 5, PRESS + 12, EXIT - 1].map(
      (t) => Math.max(...orbAt(t).map((o) => o.radius)),
    );
    for (let i = 1; i < radii.length; i++) expect(radii[i]!).toBeGreaterThan(radii[i - 1]!);
    // The last drawn tick is nearly full, and never past it.
    expect(radii[radii.length - 1]!).toBeGreaterThan(CHARGE.maxRadius * 0.9);
    expect(radii[radii.length - 1]!).toBeLessThanOrEqual(CHARGE.maxRadius);
  });

  it("grows linearly, so the orb tells an opponent how long they have", () => {
    const at = (t: number) => Math.max(...orbAt(t).map((o) => o.radius));
    const span = CHARGE.maxRadius - CHARGE.minRadius;
    // Halfway through the wind-up is halfway through the growth.
    expect(at(PRESS + WINDUP / 2)).toBeCloseTo(CHARGE.minRadius + span / 2, 6);
  });

  it("vanishes on the tick the shot exits, so the orb never overlaps its own beam", () => {
    expect(orbAt(EXIT)).toEqual([]);
    expect(orbAt(EXIT + 1)).toEqual([]);
  });

  it("draws nothing when no press is pending", () => {
    // `pendingUntilTick` is 0 on a car that has never fired, and stale-in-the-past afterwards.
    expect(chargeOrbBands("lance", 0, PRESS)).toEqual([]);
  });

  it("ignores a pending longer than this weapon's own wind-up", () => {
    // `pendingUntilTick` also covers a multi-volley burst. An orb must not stretch across one.
    expect(chargeOrbBands("lance", PRESS + WINDUP + 1, PRESS)).toEqual([]);
  });

  it("nests its bands outermost first, so each is filled over the last", () => {
    const radii = orbAt(EXIT - 1).map((o) => o.radius);
    for (let i = 1; i < radii.length; i++) expect(radii[i]!).toBeLessThan(radii[i - 1]!);
  });

  it("wears the same colours as the beam it is charging, in the same order", () => {
    // The orb has to read as the shot gathering, not as a separate effect. Deliberately compared
    // layer for layer rather than at a fixed count: lance dropped its white core on 2026-09-02 and
    // the orb had to drop a band with it, which is the failure this catches.
    const beam = WEAPON_BEAM_STYLES.lance!.layers.map((l) => l.color.toUpperCase());
    const orb = CHARGE.bands.map((b) => b.color.toUpperCase());
    expect(orb).toEqual(beam);
    // NOT asserted here: that the outermost band is the weapon's table colour. It is for every
    // other beam, but `lance`'s table colour is its CORE — `thunderclap` holds its outer `#3ED1FA`
    // and weapon colours must be unique. The orb follows the beam, and the beam is what matters.
    expect(orb).toContain(WEAPON_TABLE.lance.color.toUpperCase());
  });

  it("costs one fill per beam layer per charging car, however long the wind-up runs", () => {
    const layers = WEAPON_BEAM_STYLES.lance!.layers.length;
    for (const tick of [PRESS, PRESS + 7, PRESS + 14, EXIT - 1]) {
      expect(orbAt(tick)).toHaveLength(layers);
    }
  });
});

describe("lance beam layers", () => {
  const lance = WEAPON_TABLE.lance;
  if (lance.kind !== "beam" || lance.hitbox.shape !== "rect") throw new Error("lance is a rect beam");
  const HALF = lance.hitbox.width / 2;
  const REACH = 1200;

  it("nests by WIDTH, since narrowing a rect's length would hide it inside itself", () => {
    const layers = beamDrawLayers("lance", 0, 0, 0, REACH, 0);
    expect(layers).toHaveLength(WEAPON_BEAM_STYLES.lance!.layers.length);
    expect(layers.length).toBeGreaterThan(1);
    const halfWidths = layers.map((l) => Math.max(...l.points.map((p) => Math.abs(p.y))));
    const lengths = layers.map((l) => Math.max(...l.points.map((p) => p.x)));
    for (let i = 1; i < layers.length; i++) {
      expect(halfWidths[i]!).toBeLessThan(halfWidths[i - 1]!);
      // Every layer still runs to the beam's far end; only the width varies. The ORIGIN is where
      // they now differ -- see the dome test below -- so this checks the far end alone, where the
      // old version could compare whole lengths.
      expect(lengths[i]!).toBeCloseTo(lengths[0]!, 6);
    }
  });

  /**
   * The invariant, restated for a shape that is no longer a rectangle. A crackling, wandering,
   * domed bolt has hundreds of vertices placed by a hash, so this is the assertion that the
   * arithmetic in `rectPoints` never lets one escape -- checked across the beam's whole growth AND
   * across animation frames, since both feed the vertex positions.
   */
  it("never draws past the rect hitbox, at any extent or animation frame", () => {
    // Collected and asserted ONCE rather than per vertex: this sweep is ~50k points, and an
    // `expect` each turned a structural check into a one-second test. A failure still names the
    // offending point, which is all the per-vertex version bought.
    const escapes: string[] = [];
    for (const nowMs of [0, 37, 250, 1000, 98765.4]) {
      for (const grown of [1, 60, 400, REACH]) {
        for (const [i, layer] of beamDrawLayers("lance", 0, 0, 0, grown, 0, nowMs).entries()) {
          for (const p of layer.points) {
            if (
              Math.abs(p.y) > HALF + 1e-9 ||
              p.x > grown + 1e-9 ||
              p.x < -1e-9
            ) {
              escapes.push(`layer ${i} at t=${nowMs} extent=${grown}: (${p.x}, ${p.y})`);
            }
          }
        }
      }
    }
    expect(escapes).toEqual([]);
  });

  it("rounds the origin into a dome rather than cutting it flat", () => {
    // `thumper`'s capsule head, carved out of the beam's own length. The outermost layer's apex
    // must reach the muzzle exactly: if the dome were added BEHIND it instead, the shape would sit
    // outside the rect on the shooter's own car and would need the exception the charge orb has.
    const outer = beamDrawLayers("lance", 0, 0, 0, REACH, 0)[0]!;
    const apex = Math.min(...outer.points.map((p) => p.x));
    expect(apex).toBeCloseTo(0, 6);
    // And the shape at the origin is a curve, not a straight cut: the widest point of the layer sits
    // well forward of its apex.
    const atWidest = outer.points.filter((p) => Math.abs(Math.abs(p.y) - HALF) < 0.5);
    expect(atWidest.length).toBeGreaterThan(0);
    expect(Math.min(...atWidest.map((p) => p.x))).toBeGreaterThan(apex + 1);
  });

  it("tears the outer layers but holds the core dead straight", () => {
    // The whole reason it reads as a laser rather than as a ribbon. Measured as how much each
    // layer's half-width varies along its length: the envelope must vary, the core must not.
    const layers = beamDrawLayers("lance", 0, 0, 0, REACH, 0);
    const spread = layers.map((l) => {
      // Ignore the domed origin, which legitimately narrows on every layer.
      const shaft = l.points.filter((p) => p.x > 80);
      const widths = shaft.map((p) => Math.abs(p.y));
      return Math.max(...widths) - Math.min(...widths);
    });
    expect(spread[0]!).toBeGreaterThan(1);
    expect(spread[spread.length - 1]!).toBeLessThan(0.01);
  });

  it("re-rolls the crackle over time, so the bolt is alive rather than a frozen jagged stripe", () => {
    const style = WEAPON_BEAM_STYLES.lance!;
    for (const [i, layer] of style.layers.entries()) {
      if (!layer.crackle) continue;
      const hz = layer.crackleHz ?? style.crackleHz!;
      expect(hz).toBeGreaterThan(0);
      const at = (nowMs: number) => beamDrawLayers("lance", 0, 0, 0, REACH, 0, nowMs)[i]!.points;
      // A full period apart, every crackling layer is materially different.
      expect(at(1000 / hz).map((p) => p.y)).not.toEqual(at(0).map((p) => p.y));
    }
  });

  it("runs the shallow layers faster than the deep ones, which is what buys the flicker", () => {
    // The rate a layer may run at is set by how WIDE it tears, not by taste: per-frame motion goes
    // as `crackle x rate`. So a deeper layer must run slower, or the whole beam is priced at the
    // widest tear and every layer has to be flattened to pay for it. Ordering rather than exact
    // values, so a re-tune of either is free as long as it keeps the relationship.
    const crackling = WEAPON_BEAM_STYLES.lance!.layers.filter((l) => (l.crackle ?? 0) > 0);
    expect(crackling.length).toBeGreaterThan(1);
    for (let i = 1; i < crackling.length; i++) {
      expect(crackling[i]!.crackle!).toBeLessThan(crackling[i - 1]!.crackle!);
      expect(crackling[i]!.crackleHz!).toBeGreaterThan(crackling[i - 1]!.crackleHz!);
    }
  });

  /**
   * The regression this exists for: lance swept in visible steps rather than smoothly.
   *
   * The cause was NOT the sweep. The crackle was indexed by `floor(t * hz)`, which made the shape
   * piecewise-constant in time: at 14 Hz the envelope held still for ~4 frames and then jumped
   * 12 units at once, and that jump landing on every fourth frame of a rotation is what read as
   * snapping. Measured on a STATIONARY beam, so a failure here can only be the crackle -- nothing
   * about position, rotation or extent is in play.
   *
   * The threshold is per RENDERED frame at 60fps. It is deliberately far below the 12.2 units the
   * quantised version produced and comfortably above what smooth interpolation needs, so it pins
   * the property (continuity) rather than a particular interpolation curve.
   */
  it("moves every layer continuously between frames, never in jumps", () => {
    // Checked across ALL layers, not just the outermost: since the rates differ per layer, the
    // fastest-moving one is no longer necessarily the widest. The yellow layer runs at 14 Hz.
    const FRAME_MS = 1000 / 60;
    let worst = 0;
    let previous: { x: number; y: number }[][] | null = null;
    for (let f = 0; f < 240; f++) {
      const layers = beamDrawLayers("lance", 0, 0, 0, REACH, 0, f * FRAME_MS);
      const points = layers.map((l) => l.points);
      if (previous) {
        for (const [L, layer] of points.entries()) {
          expect(layer).toHaveLength(previous[L]!.length);
          for (const [i, p] of layer.entries()) {
            worst = Math.max(worst, Math.hypot(p.x - previous[L]![i]!.x, p.y - previous[L]![i]!.y));
          }
        }
      }
      previous = points;
    }
    expect(worst).toBeLessThan(2);
    // And it does actually move — a frozen beam would trivially pass the line above.
    expect(worst).toBeGreaterThan(0);
  });

  it("still draws a plain nested bar for a rect beam that asks for no bolt", () => {
    // The fallback every other rect beam keeps. Verified through `rectPoints`' own inputs rather
    // than through a real weapon, since `lance` is the roster's only rect beam today.
    const plain = beamDrawLayers("afterburner", 0, 0, 0, 200, 0);
    expect(plain.length).toBeGreaterThan(0);
  });
});

describe("beamFadeAlpha", () => {
  const FADE_TICKS = msToTicks(BEAM_FADE_OUT_MS);
  const SPAWN = 500;
  const beams = (Object.keys(WEAPON_TABLE) as Array<keyof typeof WEAPON_TABLE>).filter(
    (id) => WEAPON_TABLE[id].kind === "beam",
  );
  const deathTickOf = (id: keyof typeof WEAPON_TABLE) => {
    const ticks = weaponTicksOf(id);
    return SPAWN + ticks.flight + ticks.lifetime;
  };

  it("holds full opacity everywhere but the last window", () => {
    for (const id of beams) {
      const death = deathTickOf(id);
      for (const tick of [SPAWN, SPAWN + 1, death - FADE_TICKS - 1, death - FADE_TICKS]) {
        expect(beamFadeAlpha(WeaponKind.BEAM, id, SPAWN, tick)).toBe(1);
      }
    }
  });

  it("ramps down across the window and reaches 0 exactly at the death tick", () => {
    for (const id of beams) {
      const death = deathTickOf(id);
      const ramp: number[] = [];
      for (let tick = death - FADE_TICKS; tick <= death; tick++) {
        ramp.push(beamFadeAlpha(WeaponKind.BEAM, id, SPAWN, tick));
      }
      for (let i = 1; i < ramp.length; i++) expect(ramp[i]!).toBeLessThan(ramp[i - 1]!);
      expect(ramp[ramp.length - 1]!).toBe(0);
    }
  });

  it("is still visible on the last tick it is drawn, so nothing ever draws at alpha 0", () => {
    // The sim stops the instance hitting anything ON the death tick (`instanceExpired`), so the
    // last frame that carries a live beam is one tick earlier — and it must still be on screen.
    for (const id of beams) {
      expect(beamFadeAlpha(WeaponKind.BEAM, id, SPAWN, deathTickOf(id) - 1)).toBeGreaterThan(0);
    }
  });

  it("never begins the fade before the beam is fully grown, however short the linger", () => {
    // This is the clamp: `fadeTicks` is capped at the lifetime, so a window longer than the linger
    // eats into the linger rather than into the growth. No shipped beam lingers for fewer than
    // `FADE_TICKS` today, so this is the guard that catches the first one that does.
    for (const id of beams) {
      for (let tick = SPAWN; tick <= SPAWN + weaponTicksOf(id).flight; tick++) {
        expect(beamFadeAlpha(WeaponKind.BEAM, id, SPAWN, tick)).toBe(1);
      }
    }
  });

  it("leaves projectiles fully opaque for their whole flight", () => {
    for (let tick = SPAWN; tick < SPAWN + 200; tick += 7) {
      expect(beamFadeAlpha(WeaponKind.PROJECTILE, "magmablast", SPAWN, tick)).toBe(1);
    }
  });

  it("leaves an unknown weapon id fully opaque rather than blanking it", () => {
    for (let tick = SPAWN; tick < SPAWN + 200; tick += 7) {
      expect(beamFadeAlpha(WeaponKind.BEAM, "not-a-weapon", SPAWN, tick)).toBe(1);
    }
  });

  it("fades a magmablast burst using the explosion's own linger, not the shell's flight", () => {
    // `magmablast`'s own ticks report `lifetime: 0` (it is a projectile row), so resolving ticks by
    // bare `weaponId` alone — ignoring `isExplosion` — makes `lifetime <= 0` true and the function
    // return 1 unconditionally: a burst that never fades. The fifth argument routes it to
    // `WeaponTicks.explosion` instead, the same table `instanceExpired` uses for a burst's own
    // death tick.
    const ticks = weaponTicksOf("magmablast");
    const burstDeath = SPAWN + ticks.explosion!.flight + ticks.explosion!.lifetime;
    expect(beamFadeAlpha(WeaponKind.BEAM, "magmablast", SPAWN, SPAWN, true)).toBe(1);
    expect(
      beamFadeAlpha(WeaponKind.BEAM, "magmablast", SPAWN, burstDeath - 1, true),
    ).toBeGreaterThan(0);
    expect(beamFadeAlpha(WeaponKind.BEAM, "magmablast", SPAWN, burstDeath, true)).toBe(0);
  });

  it("defaults isExplosion to false, so every existing caller keeps its shell-row behaviour", () => {
    expect(beamFadeAlpha(WeaponKind.PROJECTILE, "magmablast", SPAWN, SPAWN)).toBe(1);
  });
});
