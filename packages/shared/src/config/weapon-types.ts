import type { StatusId } from "./status-types.js";

/** Every weapon in the game. Add an id here and a row in `WEAPON_TABLE`. */
export type WeaponId =
  | "shockwave"
  | "pepperbox"
  | "lance"
  | "predator"
  | "thunderclap"
  | "afterburner"
  | "thumper"
  | "roadblock"
  | "wildcharge"
  | "tremor";

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
  | { shape: "ellipse"; radiusAlong: number; radiusAcross: number }
  /**
   * A slug: rounded at the nose, cut flat across the tail. `radiusAlong` is half its total length
   * and `radiusAcross` half its width, matching `ellipse`, so the two are read the same way.
   *
   * The nose is a semicircle of `radiusAcross`, which means `radiusAlong` must be at least
   * `radiusAcross` — below that the cap would have to reach behind the tail and the polygon stops
   * being convex, which SAT silently mis-answers rather than rejecting. `weapon-config.test.ts`
   * guards the ratio.
   *
   * It exists because a shot is drawn AS its hitbox (D19), so a weapon whose icon is a flat-backed
   * capsule cannot be given that silhouette by the renderer alone — the shape has to be real, or
   * what you see stops being what can hurt you.
   */
  | { shape: "capsule"; radiusAlong: number; radiusAcross: number }
  /**
   * A wall sweeping forward: long axis PERPENDICULAR to flight, travelling along its short axis.
   * `radiusAlong` is half its thickness along the flight direction and `radiusAcross` half its
   * length across it, so the two are read the same way as `ellipse`/`capsule`. Guarded
   * `radiusAcross >= radiusAlong` — a bar thicker than it is wide is an ellipse job.
   */
  | { shape: "bar"; radiusAlong: number; radiusAcross: number };

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
  /**
   * This weapon's own aim-assist reach, world units. Required exactly when `usesAimAssist` is
   * true (test-enforced both ways). Lock ACQUISITION uses the car's largest value
   * (`carAimRangeOf`); at fire time a lock farther than this fires straight ahead. Every row in
   * this pass authors 400 — `AIM_CONFIG.lockRange`'s value, written literally because importing
   * aim-config here is a cycle — so behavior is identical until the numbers diverge.
   */
  aimRangeUnits?: number;
  /**
   * Muzzle directions, degrees off the heading. Absent means `[0]`. Each muzzle emits the full
   * pellet fan (or its own beam instance). More than one requires `usesAimAssist: false` — a lock
   * cannot steer four directions at once.
   */
  muzzles?: readonly number[];
  /**
   * Exempt from the stun interrupt sweep (O8). Absent = false; `wildcharge` is the one shipped row
   * that authors `true`.
   *
   * `stepDrive`'s DASH branch (`stepDash`, `sim/drive.ts`) never consults `mods.fullStop` — a stun
   * landing mid-dash has nothing to override there. Safe today only because the O8 sweep clears
   * every INTERRUPTIBLE maneuver, dashes included, the moment a fresh stun lands, and the one
   * uninterruptable row is a charge, not a dash: `stepDash` is never reached with `fullStop` active
   * in practice. An uninterruptable dash would need that gap closed.
   */
  isUnInterruptable?: boolean;
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
 * - `ownerInside` — the firing car, re-applied every tick its own hull stands inside this weapon's
 *   live BEAM instance. The presence-buff seam (`tremor`'s fortified): author a duration a little
 *   past one tick and `refresh` keeps it up exactly while the owner holds the zone, lapsing moments
 *   after they leave. Beams only — a zone is a place to stand, and a travelling projectile is not.
 *   It cannot ride the damage list (`canDamage` refuses the owner by design), so `runCombat` runs a
 *   dedicated owner-hull-vs-beam test for it each tick.
 *
 * There is deliberately no `teammates` member. Reaching a teammate means changing `canDamage`, which
 * is the one predicate deciding friendly fire for the whole game, and that is a design decision
 * nobody has made yet. Shipping the member as a value that silently does nothing would be worse than
 * not having it: adding a union member later is a one-line change the compiler will help with.
 */
export type StatusTarget = "self" | "opponents" | "ownerInside";

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

/** Homing guidance for a projectile fired with a lock (spec: Homing). */
export interface HomingDef {
  /** Max steering rate toward the frozen target, degrees per second. The counterplay dial. */
  turnRateDegPerSec: number;
  /** Guidance window after spawn. Afterwards the shot flies straight forever. */
  durationMs: number;
}

/** Wall-bouncing flight: reflect off level geometry; expire on this clock instead of at `range`. */
export interface BounceDef {
  /** Total flight time. Guarded < `cooldownMs` so two instances can never coexist. */
  lifetimeMs: number;
}

export interface ProjectileWeaponDef extends WeaponBase {
  kind: "projectile";
  hitbox: ProjectileHitbox;
  /** Additional opponents passed through after damaging one. 0 = dies on the first car it damages. */
  pierce: number;
  pellets: PelletDef;
  homing?: HomingDef;
  bounce?: BounceDef;
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
  /**
   * The car is held (no translation, steering only) from the press until the beam dies — the
   * HOLD maneuver, O10. Lance is the intended user; absent = false.
   */
  holdsDuringFire?: boolean;
}

export type ManeuverSpec =
  | { type: "dash" }
  | {
      type: "charge";
      /** How long the charged state lasts (also ended early by the first slam, O2). */
      durationMs: number;
      /** May this weapon's hard slam land on a stunned victim (O3/O18)? */
      slamsStunned: boolean;
    };

/**
 * A weapon that moves the CAR instead of spawning an instance (spec: Maneuvers). The press rides
 * the same fire state machine as every other weapon — stocks, cooldown, recovery — and `damage`
 * is what its contact deals, resolved in `runCombat` like any hit. `speed` is the dash speed;
 * `aimRangeUnits` doubles as the dash distance. A charge uses neither.
 */
export interface ManeuverWeaponDef extends WeaponBase {
  kind: "maneuver";
  maneuver: ManeuverSpec;
}

export type WeaponDef = ProjectileWeaponDef | BeamWeaponDef | ManeuverWeaponDef;
