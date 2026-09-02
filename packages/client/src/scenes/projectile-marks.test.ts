import { describe, expect, it } from "vitest";
import { WEAPON_TABLE, weaponDefOf, type WeaponId } from "@motor-combat-moba/shared";
import {
  WEAPON_PROJECTILE_STYLES,
  isProjectileWeapon,
  projectileDrawLayers,
  type DrawableInstance,
} from "./combat-visual.js";

/**
 * The one rule every marking has to obey: it may never draw outside the hitbox.
 *
 * That is the half of D19 that protects a player — no shot can hurt you from somewhere you cannot
 * see it. The other half (that the drawn shape FILLS the hitbox) was deliberately relaxed for
 * `skewer`, whose spindle covered 43% of its ellipse; that weapon was retired outright by the
 * 2026-09-01 roster cutover (O17), and `thumper` — the table's one surviving styled weapon — fills
 * its hull fully, so the exception has no live example today. Nothing here asserts coverage, and
 * that is on purpose.
 *
 * Every scale in the table is a fraction of `radiusAlong` or `radiusAcross`, so this holds for any
 * future re-tune of a hitbox as well as for today's numbers.
 */

/** Absorbs the floating-point slack in rotating a vertex out to world space and back. */
const SLACK = 1e-9;

function insideHitbox(id: WeaponId, along: number, across: number): boolean {
  const def = weaponDefOf(id);
  if (def.kind !== "projectile" || def.hitbox.shape === "circle") return false;
  const { radiusAlong, radiusAcross } = def.hitbox;
  if (def.hitbox.shape === "ellipse") {
    return (along / radiusAlong) ** 2 + (across / radiusAcross) ** 2 <= 1 + SLACK;
  }
  // A capsule is a slug: rounded at the NOSE, cut flat across the tail. Written out here rather than
  // reusing the renderer's own helper on purpose -- a test that shares the geometry it is checking
  // cannot catch the geometry being wrong, which is how the flat tail was missed.
  if (along < -radiusAlong - SLACK) return false;
  const noseCentre = radiusAlong - radiusAcross;
  if (along <= noseCentre) return Math.abs(across) <= radiusAcross + SLACK;
  return (along - noseCentre) ** 2 + across ** 2 <= radiusAcross ** 2 + SLACK;
}

/** The styled weapons, so a new entry in the table is covered without editing this file. */
const styled = Object.keys(WEAPON_PROJECTILE_STYLES) as WeaponId[];

/** Angles chosen to catch a rotation that leaks along one axis only. */
const ANGLES = [0, 0.4, Math.PI / 2, 2.1, Math.PI, -1.3];

function instanceAt(weaponId: WeaponId, angle: number): DrawableInstance {
  return { weaponId, x: 500, y: 300, angle, extent: 0 };
}

describe("projectile markings", () => {
  it("covers every non-circular projectile in the roster or leaves it deliberately flat", () => {
    // "bar" is excluded here, not just unstyled: `projectileDrawLayers` refuses it at source (same
    // early return as "circle") because the hull/tip/band/disc/spikes vocabulary below assumes an
    // along/across ellipse-ish geometry a bar does not have. It is architecturally never a candidate
    // for this table, so it does not belong in the universe this list is checking.
    const shaped = (Object.keys(WEAPON_TABLE) as WeaponId[]).filter((id) => {
      const def = weaponDefOf(id);
      return def.kind === "projectile" && def.hitbox.shape !== "circle" && def.hitbox.shape !== "bar";
    });
    // Not an assertion that every one of these is styled forever -- it is the list that keeps this
    // file honest about what it is covering, so removing a style shows up here rather than silently.
    // `pepperbox` (ellipse) is the one shaped projectile still deliberately flat: its hitbox moved
    // to an ellipse in the 2026-09-01 roster cutover specifically because a round-glow table cannot
    // own it, and nothing has authored it a marking since. `predator` gained one on 2026-09-02.
    expect(shaped.sort()).toEqual(["pepperbox", "predator", "thumper"]);
    expect(styled.sort()).toEqual(["predator", "thumper"]);
  });

  it("keeps every authored vertex inside its own hitbox, at every heading", () => {
    for (const id of styled) {
      for (const angle of ANGLES) {
        const instance = instanceAt(id, angle);
        const layers = projectileDrawLayers(instance, 0);
        expect(layers.length).toBeGreaterThan(0);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        for (const layer of layers) {
          for (const point of layer.points) {
            // Back out of world space through the instance's own heading, so the check is against
            // the hitbox in its own frame rather than an axis-aligned box around it.
            const dx = point.x - instance.x;
            const dy = point.y - instance.y;
            const along = dx * cos + dy * sin;
            const across = -dx * sin + dy * cos;
            expect(insideHitbox(id, along, across)).toBe(true);
          }
        }
      }
    }
  });

  it("gives thumper a hull layer, so its markings sit on a filled body", () => {
    expect(WEAPON_PROJECTILE_STYLES.thumper?.layers[0]?.shape).toBe("hull");
  });

  it("returns nothing for a beam, a round projectile, or an unknown id", () => {
    // Each of these has another table that owns it; two tables answering for one weapon would draw
    // it twice. `lance` is a beam, `magmablast` is a circle with a `GlowStyle` (empty today, but the
    // table it belongs to regardless).
    for (const id of ["lance", "magmablast"] as WeaponId[]) {
      expect(projectileDrawLayers(instanceAt(id, 0.5), 0)).toEqual([]);
    }
    expect(
      projectileDrawLayers({ weaponId: "not-a-weapon", x: 0, y: 0, angle: 0, extent: 0 }, 0),
    ).toEqual([]);
  });

  it("agrees with the renderer's fork about which weapons are projectiles", () => {
    for (const id of Object.keys(WEAPON_TABLE) as WeaponId[]) {
      expect(isProjectileWeapon(id)).toBe(weaponDefOf(id).kind === "projectile");
    }
    expect(isProjectileWeapon("not-a-weapon")).toBe(false);
  });

  it("carries the markings along with the shot as it is extrapolated", () => {
    // The markings must ride the same extrapolation as the hull. A thumper covers real, visible
    // distance in one patch interval (~15 units at its 450 u/s in 33ms), so a mark left at the
    // un-extrapolated position would visibly detach.
    const still = projectileDrawLayers(instanceAt("thumper", 0), 0);
    const moved = projectileDrawLayers(instanceAt("thumper", 0), 33);
    const dx = moved[0]!.points[0]!.x - still[0]!.points[0]!.x;
    expect(dx).toBeGreaterThan(0);
    for (const [i, layer] of moved.entries()) {
      for (const [j, point] of layer.points.entries()) {
        expect(point.x - still[i]!.points[j]!.x).toBeCloseTo(dx, 9);
      }
    }
  });
});
