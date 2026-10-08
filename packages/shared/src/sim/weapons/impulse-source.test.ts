import { beforeEach, describe, expect, it } from "vitest";
import { instanceDefOf } from "../../config/weapon-config.js";
import type { WeaponId } from "../../config/weapon-types.js";
import { installMode } from "../../modes/active.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../../modes/registry.js";
import { spawnInstances, type WeaponInstance } from "./instances.js";
import { radialSourceOf } from "./impulse-source.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

/** A real instance of `weaponId`, born from a real press, then moved to a chosen origin and angle. */
function instanceOf(
  weaponId: WeaponId,
  at: { x: number; y: number; angle: number },
  isExplosion = false,
): WeaponInstance {
  const born = spawnInstances(
    { weaponId, slot: 0, finalVolley: true, pressId: "aaa#100#0" },
    { sessionId: "aaa", team: 0, carId: "mirage", x: 0, y: 0, angle: 0 },
    100,
    0,
  ).instances[0]!;
  return { ...born, ...at, isExplosion };
}

describe("radialSourceOf", () => {
  it("a beam cone/rect sources the perpendicular foot on its fire axis", () => {
    // Tremor is a cone. Axis from O = (100, 200) heading +x: a victim at (350, 260) sits 60 off the
    // line, so its foot is (350, 200) — and a NEGATIVE-speed radial impulse, which moves the victim
    // along (victim - source) scaled by speed, therefore pulls it onto the centreline.
    const tremor = instanceOf("tremor", { x: 100, y: 200, angle: 0 });
    const def = instanceDefOf("tremor", false);
    const foot = radialSourceOf(def, tremor, 350, 260);
    expect(foot.x).toBeCloseTo(350, 9);
    expect(foot.y).toBeCloseTo(200, 9);
  });

  it("projects onto a rotated axis, and does not clamp behind the origin", () => {
    // Axis at 90 degrees (+y) from O = (0, 0): victim (30, -40) is BEHIND the origin, and an
    // unclamped point-to-line projection puts its foot at (0, -40), not at O.
    const tremor = instanceOf("tremor", { x: 0, y: 0, angle: Math.PI / 2 });
    const def = instanceDefOf("tremor", false);
    const foot = radialSourceOf(def, tremor, 30, -40);
    expect(foot.x).toBeCloseTo(0, 9);
    expect(foot.y).toBeCloseTo(-40, 9);

    // A 45 degree axis: victim (10, 0) projects onto t = 10*cos45, foot = t*(cos45, sin45) = (5, 5).
    const diagonal = instanceOf("tremor", { x: 0, y: 0, angle: Math.PI / 4 });
    const f2 = radialSourceOf(def, diagonal, 10, 0);
    expect(f2.x).toBeCloseTo(5, 9);
    expect(f2.y).toBeCloseTo(5, 9);
  });

  it("a disc beam sources its own centre", () => {
    // Shockwave is the roster's centre-origin disc beam (an aura): its centre is the instance origin,
    // whatever the angle and wherever the victim stands.
    const ring = instanceOf("shockwave", { x: 640, y: 360, angle: 1.2 });
    const def = instanceDefOf("shockwave", false);
    expect(def.kind === "beam" && def.hitbox.shape).toBe("disc");
    const src = radialSourceOf(def, ring, 700, 400);
    expect(src).toEqual({ x: 640, y: 360 });
  });

  it("a projectile/explosion sources its muzzle/blast origin", () => {
    const shell = instanceOf("predator", { x: 500, y: 120, angle: 0.7 });
    expect(radialSourceOf(instanceDefOf("predator", false), shell, 560, 90)).toEqual({ x: 500, y: 120 });

    // magmablast's detonation is a disc beam synthesized by instanceDefOf; it is an explosion, so it
    // sources the blast centre (the same answer as any disc, reached through the explosion flag).
    const blast = instanceOf("magmablast", { x: 300, y: 310, angle: 0 }, true);
    expect(radialSourceOf(instanceDefOf("magmablast", true), blast, 330, 330)).toEqual({ x: 300, y: 310 });
  });
});
