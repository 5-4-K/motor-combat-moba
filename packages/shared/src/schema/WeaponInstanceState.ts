import { Schema, type } from "@colyseus/schema";
import { WeaponKind } from "../constants.js";

/**
 * One live hitbox as the client sees it. Deliberately minimal: speed, range, shape, dimensions,
 * colour and icon are all looked up client-side from `WEAPON_TABLE` by `weaponId`, so the row
 * carries only what cannot be derived.
 */
export class WeaponInstanceState extends Schema {
  @type("string") id = "";
  @type("string") ownerSessionId = "";
  @type("string") weaponId = "";
  @type("uint8") kind: WeaponKind = WeaponKind.PROJECTILE;
  /**
   * This row is its weapon's explosion rather than its shell (spec P27).
   *
   * On the wire because the client resolves a def from `weaponId`, which names the parent — a
   * projectile — so without this it would draw a 12 u dart where a 60 u disc belongs. Deriving it
   * instead (a row whose `kind` disagrees with its def's `kind` can only be an explosion) is true
   * today and rots the first time another weapon spawns a child instance.
   *
   * Frozen at spawn, so it is written on row creation and never patched after.
   */
  @type("boolean") isExplosion = false;
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") angle = 0;
  /** Beams: current reach. Projectiles: always 0. */
  @type("number") extent = 0;
  @type("uint32") spawnTick = 0;
  @type("boolean") alive = true;
}
