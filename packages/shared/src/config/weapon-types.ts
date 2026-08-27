/** Every weapon in the game. Add an id here and a row in `WEAPON_TABLE`. */
export type WeaponId = "fireball" | "repeater";

/**
 * Optional charge system. Absent means single-stock, which is exactly the pre-weapon-system
 * behaviour: fire, wait out `cooldownMs`, fire again.
 *
 * `refireDelayMs` lives here rather than on the base because for a single-stock weapon the next
 * shot is already gated by the recharge, so the field would be provably redundant there — any
 * value below `cooldownMs` does nothing and any value above it could have been a cooldown edit.
 */
export interface StockDef {
  /** How many shots may be banked. Validated >= 2; a max of 1 is the absent case. */
  max: number;
  /** Minimum gap between consecutive shots of THIS weapon when firing from stock. */
  refireDelayMs: number;
}

/** One press: `volleys` groups of `pelletsPerVolley`, fanned across `spreadAngleDeg`. */
export interface VolleyDef {
  /** Sequential groups. 1 = a single shot or a single shotgun blast. */
  volleys: number;
  /** Gap between sequential groups. Ignored when `volleys` is 1. */
  volleyIntervalMs: number;
  /** Simultaneous instances per group. 1 = not a shotgun. */
  pelletsPerVolley: number;
  /** Total fan width, split evenly and symmetrically about the car's heading. */
  spreadAngleDeg: number;
}

/** Projectiles are fixed-size, so they configure their full extent. */
export type ProjectileHitbox =
  | { shape: "circle"; radius: number }
  | { shape: "ellipse"; radiusAlong: number; radiusAcross: number };

/**
 * Beams configure their CROSS-SECTION only. The axial extent is the current expansion, growing
 * 0 -> `range` at `speed`, so `range` means one thing everywhere and cannot contradict a length.
 */
export type BeamHitbox =
  | { shape: "rect"; width: number }
  | { shape: "cone"; angleDeg: number };

export type Hitbox = ProjectileHitbox | BeamHitbox;

interface WeaponBase {
  id: WeaponId;
  /** Display name. Render-only: `stepSim` never reads it, so it is not a schema field. */
  name: string;
  /**
   * The colour every instance of this weapon draws in, `#RRGGBB`. Render-only like `name`, so it is
   * not a schema field — the client resolves it from `weaponId`, which is already on the wire.
   *
   * Deliberately per WEAPON, not per player: two cars carrying the same weapon fire identically
   * coloured shots. An instance is drawn as its own hitbox (D19), so what a shot's colour has to
   * answer is "what is coming at me", not "who sent it" — the car that fired is the thing on screen
   * wearing the player colour. Keep these clear of `COLOR_TABLE`'s six player colours, and dark
   * enough to read against the light arena floors.
   */
  color: string;
  /** In-match level at which this weapon unlocks. Validated >= 1. */
  unlocksAt: number;
  damage: number;
  /** 0 = each car may be damaged by one instance exactly once. > 0 = re-arm on that interval. */
  damageFrequencyMs: number;
  /** World units per second: travel speed (projectile) or expansion speed (beam). */
  speed: number;
  /** World units: max travel (projectile) or max extent (beam). */
  range: number;
  /** Press -> the weapon actually fires. Driving is unaffected; the press cannot be cancelled. */
  startUpMs: number;
  /** Recharge interval for one stock. */
  cooldownMs: number;
  /** Lockout before a DIFFERENT weapon may fire. Not a universal lockout — see `StockDef`. */
  recoveryMs: number;
  /**
   * true = this weapon fires at the car's current lock (A1); false = its exit angle is welded to
   * the car's heading, which is how every weapon behaved before aim assist existed.
   *
   * Required rather than optional on purpose: every row must state its answer, so authoring a new
   * weapon cannot silently inherit a targeting behaviour nobody chose.
   */
  usesAimAssist: boolean;
  stock?: StockDef;
}

export interface ProjectileWeaponDef extends WeaponBase {
  kind: "projectile";
  hitbox: ProjectileHitbox;
  /** Additional opponents passed through after damaging one. 0 = dies on the first car it damages. */
  pierce: number;
  volley: VolleyDef;
}

export interface BeamWeaponDef extends WeaponBase {
  kind: "beam";
  hitbox: BeamHitbox;
  /** true = origin and angle follow the firing car every tick, and it dies with its owner. */
  attached: boolean;
  /** Linger AFTER full extension. Total life = range/speed + this. */
  lifetimeMs: number;
}

export type WeaponDef = ProjectileWeaponDef | BeamWeaponDef;
