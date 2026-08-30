import type { StatusId } from "./status-types.js";

/** Every weapon in the game. Add an id here and a row in `WEAPON_TABLE`. */
export type WeaponId =
  | "fireball"
  | "pepperbox"
  | "afterburner"
  | "needler"
  | "skewer"
  | "lance"
  | "thumper"
  | "shockwave"
  | "bulwark";

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

/**
 * One press fires `volleys` sequential groups, `volleyIntervalMs` apart. 1 = a single shot, a single
 * shotgun blast, or a single beam.
 *
 * On `WeaponBase` rather than on projectiles alone, so a beam can be a WAVE SEQUENCE: `shockwave`
 * pulses three rings out of the car half a second apart. Each group is a fresh instance emitted from
 * the car's pose at ITS OWN tick, which is what makes a sequence steerable.
 */
export interface VolleyDef {
  volleys: number;
  volleyIntervalMs: number;
}

/**
 * Projectiles only: how many instances one group emits, and how wide they fan.
 *
 * Kept apart from `VolleyDef` rather than merged into one four-field block on the base, for the
 * reason `BeamStyle` is kept apart from `GlowStyle`: a merged type makes every author answer for the
 * half that cannot apply to their row, and a beam has no pellets to fan.
 */
export interface PelletDef {
  pelletsPerVolley: number;
  spreadAngleDeg: number;
}

/** Projectiles are fixed-size, so they configure their full extent. */
export type ProjectileHitbox =
  | { shape: "circle"; radius: number }
  | { shape: "ellipse"; radiusAlong: number; radiusAcross: number };

/**
 * Beams configure their CROSS-SECTION only. The axial extent is the current expansion, growing
 * 0 -> `range` at `speed`, so `range` means one thing everywhere and cannot contradict a length.
 *
 * `disc` is the exception that proves the rule and the shape an AURA is made of: it has no cross
 * section, because it is radially symmetric, so the growing extent IS its radius. A disc is the only
 * beam shape with no direction, which is why it is also the only one that ignores the wall clip —
 * `wallClipDistance` raycasts along a single angle, and a disc does not have one.
 */
export type BeamHitbox =
  | { shape: "rect"; width: number }
  | { shape: "cone"; angleDeg: number }
  | { shape: "disc" };

export type Hitbox = ProjectileHitbox | BeamHitbox;

/** Where a beam grows from. See `BeamWeaponDef.origin`. */
export type BeamOrigin = "muzzle" | "center";

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
  volley: VolleyDef;
  /**
   * Statuses this weapon applies, and to whom, and for how long.
   *
   * **The weapon owns the duration, not the status.** `STATUS_TABLE` says what being overheated
   * does; this says how long *this* weapon overheats you for. The same status can therefore be a
   * flicker from a fast repeating source and a real window from a heavy one, without the status
   * table growing a near-duplicate row per duration.
   *
   * Absent means the weapon applies nothing, which is how most of the roster behaves. Optional
   * rather than required, unlike `usesAimAssist`: "this weapon also debuffs" is an addition to a
   * weapon, not a targeting behaviour every row has to take a position on.
   *
   * A weapon may deal damage, apply statuses, or both. A pure applicator authors `damage: 0` and
   * still works — a status rides the hit, not the number — and `weapon-config.test.ts` enforces the
   * one thing that would be a bug either way: a weapon must do *something*.
   */
  applies?: readonly StatusApplication[];
}

/**
 * Who a status application reaches.
 *
 * - `opponents` — every car this instance DAMAGES, on the tick the damage lands. It rides the damage
 *   list, so it inherits every rule already there for free: friendly fire, the shooter's own
 *   immunity, wrecks, pierce, and the per-target damage clock that stops a lingering beam
 *   re-applying every single tick.
 * - `self` — the firing car, on the tick a shot actually goes out. No hit test is involved, so it
 *   works for any weapon whether or not it hits anything.
 *
 * There is deliberately no `teammates` member. Reaching a teammate means changing `canDamage`, which
 * is the one predicate deciding friendly fire for the whole game, and that is a design decision
 * nobody has made yet. Shipping the member as a value that silently does nothing would be worse than
 * not having it: adding a union member later is a one-line change the compiler will help with.
 */
export type StatusTarget = "self" | "opponents";

/** One status a weapon applies: which, to whom, for how long. */
export interface StatusApplication {
  statusId: StatusId;
  target: StatusTarget;
  /** Converted to whole ticks once, in `WEAPON_TICKS`. Capped by `STATUS_CONFIG.maxDurationMs`. */
  durationMs: number;
  /**
   * Which volley of a multi-wave press this application rides.
   *
   * - `"all"` (the default when absent) — every wave applies it. Correct for anything a lingering or
   *   repeating source should keep topping up.
   * - `"final"` — only the last wave. This is what lets a wave sequence build to something: the
   *   early pulses are pressure and the last one is the payload, without needing two weapon rows.
   *
   * Absent means `"all"`, so adding this field changed no shipped row.
   */
  onWave?: "all" | "final";
}

export interface ProjectileWeaponDef extends WeaponBase {
  kind: "projectile";
  hitbox: ProjectileHitbox;
  /** Additional opponents passed through after damaging one. 0 = dies on the first car it damages. */
  pierce: number;
  pellets: PelletDef;
}

export interface BeamWeaponDef extends WeaponBase {
  kind: "beam";
  hitbox: BeamHitbox;
  /** true = origin and angle follow the firing car every tick, and it dies with its owner. */
  attached: boolean;
  /**
   * Where the beam is anchored. `"muzzle"` is the car's nose, which is where every shot in the game
   * comes from and the only sensible answer for anything directional. `"center"` is the car's own
   * centre — the other half of what makes an AURA, alongside a `disc` hitbox.
   *
   * Required on beams rather than defaulted, for the reason `usesAimAssist` is: a beam that grows
   * out of the wrong point is a silent, hard-to-see mistake, and every row should have to say which
   * it is.
   */
  origin: BeamOrigin;
  /** Linger AFTER full extension. Total life = range/speed + this. */
  lifetimeMs: number;
}

export type WeaponDef = ProjectileWeaponDef | BeamWeaponDef;
