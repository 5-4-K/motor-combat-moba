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
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") angle = 0;
  /** Beams: current reach. Projectiles: always 0. */
  @type("number") extent = 0;
  @type("uint32") spawnTick = 0;
  @type("boolean") alive = true;
}
