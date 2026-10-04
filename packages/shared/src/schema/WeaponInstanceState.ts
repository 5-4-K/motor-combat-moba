import { Schema, type } from "@colyseus/schema";
import { WeaponKind } from "../constants.js";

/**
 * One live hitbox as the client sees it. Deliberately minimal: speed, range, shape, dimensions,
 * colour and icon are all looked up client-side from `WEAPON_TABLE` by `weaponId`, so the row
 * carries only what cannot be derived — plus `isExplosion`, which is derivable today but networked
 * as a hedge against future weapons spawning different kinds of child instances.
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
  /**
   * `true` on every row in flight. `false` only on an ENDED row: the shot has ended, and the row is
   * held at its end pose for `NET_CONFIG.endedShotRowMs`, then removed. Protocol 5 sent a shot that
   * ended on its own birth tick (at the muzzle, or inside its NR37 fast-forward) this way, written on
   * row creation; since protocol 8 (G5) every ending is — a shot that lived has this flag patched on
   * its own row. Never drawn as a shot, only as the impact (`isShotEnding`) and as the confirm that
   * ends the shooter's provisional (NR39). A row that vanishes is not an ending: it may only have left
   * the client's view.
   */
  @type("boolean") alive = true;
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
  /**
   * Ticks this instance is older than `spawnTick` says (NR37 shot compensation; 0 for an
   * uncompensated shot). Appended in protocol 4. The client's beam fade reads it so its death tick
   * matches `instanceExpired`'s: `spawnTick + flight + lifetime - lifeOffsetTicks`. `spawnTick` is
   * left at the press tick because NR39's provisional-shot match keys on it. Frozen at spawn.
   */
  @type("uint8") lifeOffsetTicks = 0;
}
