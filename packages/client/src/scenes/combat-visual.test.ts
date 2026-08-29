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
  beamDrawLayers,
  chargeOrbBands,
  instanceDrawShape,
  instanceGlowBands,
  WEAPON_BEAM_STYLES,
  WEAPON_GLOW_STYLES,
  lockBracketArms,
  LOCK_BRACKET_HALF,
  SHOW_LOCK_BRACKET,
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
  const SPEED = WEAPON_TABLE.fireball.speed;

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
  const projectile = { weaponId: "fireball", x: 100, y: 100, angle: 0, extent: 0 };

  it("extrapolates a projectile along its own heading between patches", () => {
    const still = instanceDrawShape(projectile, 0);
    const later = instanceDrawShape(projectile, 25);
    if (still.kind !== "circle" || later.kind !== "circle") throw new Error("fireball draws as a circle");
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
    // itself: a row claiming to be a beam still draws `fireball`'s projectile circle, because the
    // definition decides. The previous version of this test paired `weaponId: "fireball"` with a BEAM
    // byte and got a polygon two of whose three vertices were NaN — `beamShapeAt` reading
    // `angleDeg` off a circle — and asserted only `kind === "polygon"`, so it passed on garbage.
    // `beamShapeAt`'s own rect/cone geometry is covered in shared's `shapes.test.ts`.
    const claimingBeam = { weaponId: "fireball", kind: WeaponKind.BEAM, x: 100, y: 100, angle: 0, extent: 200 };
    const shape = instanceDrawShape(claimingBeam, 0);
    expect(shape.kind).toBe("circle");
    if (shape.kind !== "circle") throw new Error("circle expected");
    expect(shape.radius).toBe(WEAPON_TABLE.fireball.hitbox.radius);
  });

  it("falls back to a small dot for an unrecognised weapon id rather than blanking the layer", () => {
    const shape = instanceDrawShape({ ...projectile, weaponId: "not-a-weapon" }, 0);
    expect(shape.kind).toBe("circle");
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
    expect(weaponFillOf("fireball")).toBe(0xe8590c);
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
  const RADIUS = WEAPON_TABLE.fireball.hitbox.radius;

  it("returns nothing for a weapon with no authored look, so it keeps its flat disc", () => {
    // `splinter` is the whole point of this assertion: styles are per weapon, not a shared formula
    // over `color`, so a second weapon must NOT silently inherit the fireball's bands.
    expect(instanceGlowBands("splinter", 3, 0, 0)).toEqual([]);
  });

  it("returns nothing for an unrecognised weapon id rather than throwing", () => {
    expect(instanceGlowBands("not-a-weapon", 12, 0, 0)).toEqual([]);
  });

  it("draws the fireball outermost first, so each band is filled over the last", () => {
    const bands = instanceGlowBands("fireball", RADIUS, 0, 0);
    expect(bands.length).toBe(WEAPON_GLOW_STYLES.fireball!.bands.length);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]!.radius).toBeLessThan(bands[i - 1]!.radius);
    }
  });

  it("never draws outside the hitbox, at any point in the flicker", () => {
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

  it("flickers between the full hitbox and one flicker depth inside it", () => {
    const outer: number[] = [];
    for (let ms = 0; ms < 1000; ms += 0.5) outer.push(instanceGlowBands("fireball", RADIUS, 0, ms)[0]!.radius);
    const depth = WEAPON_GLOW_STYLES.fireball!.flickerDepth;
    expect(Math.max(...outer)).toBeCloseTo(RADIUS, 2);
    expect(Math.min(...outer)).toBeCloseTo(RADIUS * (1 - depth), 2);
  });

  it("puts shots spawned on different ticks out of phase, so a stream does not pulse in lockstep", () => {
    const a = instanceGlowBands("fireball", RADIUS, 100, 0)[0]!.radius;
    const b = instanceGlowBands("fireball", RADIUS, 101, 0)[0]!.radius;
    expect(a).not.toBeCloseTo(b, 3);
  });

  it("scales the whole glow with the hitbox, so a re-tuned radius cannot strand a band", () => {
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

  it("returns nothing for a beam with no authored look, so it keeps its flat polygon", () => {
    // `shockwave` and `bulwark` are cones with no style yet. A beam must NOT inherit another
    // weapon's layers, the same rule `instanceGlowBands` holds for bands.
    expect(beamDrawLayers("shockwave", 0, 0, 0, 150, 0)).toEqual([]);
    expect(beamDrawLayers("bulwark", 0, 0, 0, 500, 0)).toEqual([]);
  });

  it("returns nothing for a projectile, so a mis-branched caller falls back rather than throwing", () => {
    expect(beamDrawLayers("fireball", 0, 0, 0, 100, 0)).toEqual([]);
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

  it("fills its outer layer with the weapon's own table colour", () => {
    expect(WEAPON_BEAM_STYLES.afterburner!.layers[0]!.color.toUpperCase()).toBe(
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
    // afterburner is a beam with layers but no wind-up and no orb; shockwave has neither.
    expect(chargeOrbBands("afterburner", EXIT, PRESS)).toEqual([]);
    expect(chargeOrbBands("shockwave", EXIT, PRESS)).toEqual([]);
    expect(chargeOrbBands("fireball", EXIT, PRESS)).toEqual([]);
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

  it("wears the same three colours as the beam it is charging", () => {
    // The orb has to read as the shot gathering, not as a separate effect.
    const beam = WEAPON_BEAM_STYLES.lance!.layers.map((l) => l.color.toUpperCase());
    const orb = CHARGE.bands.map((b) => b.color.toUpperCase());
    expect(orb).toEqual(beam);
    // And the outermost is the weapon's own table colour, as everywhere else.
    expect(orb[0]).toBe(WEAPON_TABLE.lance.color.toUpperCase());
  });

  it("costs three fills per charging car, however long the wind-up runs", () => {
    for (const tick of [PRESS, PRESS + 7, PRESS + 14, EXIT - 1]) {
      expect(orbAt(tick)).toHaveLength(3);
    }
  });
});

describe("lance beam layers", () => {
  it("nests by WIDTH, since narrowing a rect's length would hide it inside itself", () => {
    const layers = beamDrawLayers("lance", 0, 0, 0, 1200, 0);
    expect(layers).toHaveLength(3);
    const halfWidths = layers.map((l) => Math.max(...l.points.map((p) => Math.abs(p.y))));
    const lengths = layers.map((l) => Math.max(...l.points.map((p) => p.x)));
    for (let i = 1; i < layers.length; i++) {
      expect(halfWidths[i]!).toBeLessThan(halfWidths[i - 1]!);
      // Every layer runs the beam's full length; only the width varies.
      expect(lengths[i]!).toBeCloseTo(lengths[0]!, 6);
    }
  });

  it("never draws past the rect hitbox", () => {
    const lance = WEAPON_TABLE.lance;
    if (lance.kind !== "beam" || lance.hitbox.shape !== "rect") throw new Error("lance is a rect beam");
    const halfWidth = lance.hitbox.width / 2;
    for (const layer of beamDrawLayers("lance", 0, 0, 0, 1200, 0)) {
      for (const point of layer.points) {
        expect(Math.abs(point.y)).toBeLessThanOrEqual(halfWidth + 1e-9);
        expect(point.x).toBeLessThanOrEqual(1200 + 1e-9);
        expect(point.x).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });
});
