import type { StatusId } from "./status-types.js";

/**
 * Every weapon in the game. Add an id here and a row in `WEAPON_TABLE`.
 *
 * **One flat list on purpose.** A weapon is not an ability or a basic attack by virtue of its id —
 * it is whichever the chassis carrying it makes it. `CarDef.weapons` is the three-slot ability kit
 * and `CarDef.basicAttack` is the basic-attack slot; any id below may sit in either, and a chassis
 * may point `basicAttack` at a weapon another chassis carries as an ability. Code that needs to
 * know which weapons are somebody's basic attack derives it from `CAR_TABLE` (see
 * `basicAttackIds()`), never from the id.
 *
 * The nine ids after `tremor` are the seed names the nine chassis were handed when the slot
 * shipped. They are names, nothing more.
 */
export type WeaponId =
  | "magmablast"
  | "pepperbox"
  | "lance"
  | "predator"
  | "thunderclap"
  | "afterburner"
  | "thumper"
  | "roadblock"
  | "wildcharge"
  | "tremor"
  | "basic-attack-bullseye"
  | "basic-attack-mirage"
  | "basic-attack-bastion"
  | "basic-attack-taurus"
  | "basic-attack-anvil"
  | "basic-attack-prowler"
  | "basic-attack-cleaver"
  | "basic-attack-skorpios"
  | "basic-attack-caprico";

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

/**
 * Fires from the car's turret along a player-chosen world bearing (spec TR2). Presence IS the flag.
 * `additionalOffset` pushes the spawn point further out along the line of fire, on top of
 * `TURRET_CONFIG.defaultOffset`. Legal only on a single-muzzle projectile row (TR3,
 * `turret-config.test.ts`).
 */
export interface TurretDef {
  additionalOffset: number;
}

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
   * Muzzle directions, degrees off the heading. Absent means `[0]`. Each muzzle emits the full
   * pellet fan (or its own beam instance).
   */
  muzzles?: readonly number[];
  /** Fire from the turret rather than a fixed muzzle (spec TR2). Absent = a fixed muzzle. */
  turret?: TurretDef;
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
  /**
   * The push this weapon imparts on contact, if any. Absent means this weapon pushes nothing — the
   * default for every weapon that only damages or applies statuses. See `ImpulseDef`.
   */
  impulse?: ImpulseDef;
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

/**
 * One status an impulse applies.
 *
 * **Deliberately NOT `StatusApplication`.** That type carries `target` and `wave`, and on this path
 * both can only ever hold one value: an impulse acts on exactly one car — the one it pushed — and
 * lands exactly once, so there is no volley to select and no second target to name. A field that can
 * hold one value is a rule hiding as a knob, and policing it with a config test is the defect this
 * restructure exists to remove, not a mitigation of it. The field NAMES match
 * `StatusApplication`'s on purpose, so the two read as kin.
 */
export interface ImpulseStatusApplication {
  statusId: StatusId;
  /** Converted to whole ticks once, in `WEAPON_TICKS`. */
  durationMs: number;
}

/**
 * One push a weapon imparts, and to whom, and how hard. The declarative sibling of `applies`.
 *
 * **This is now the only thing that produces an `Impulse`.** It is the *authored* half — fixed
 * numbers a designer writes on a row — and since the 2026-09-18 Unity ram port (spec §7.4) it is
 * also the whole of it: ordinary ramming left `applyImpulse` entirely and hands the bridge a
 * `RamResolution` instead, because "the attacker stops dead" cannot be said in a struct whose whole
 * meaning is "add this to what you had". (It used to share the applier, deriving its magnitude from
 * a contest between both cars' `ramAttack`/`ramDefence`, a side bonus and a falloff stack.) Ram feel
 * and weapon feel stay independently tunable, now by not sharing a derivation at all. See spec
 * principle D.
 */
export interface ImpulseDef {
  /** Magnitude as a Δv in u/s. Negative pulls the victim toward the source. */
  speed: number;
  /**
   * `"radial"` pushes away from a source point through the victim — the attacker's hull for a
   * contact impulse, the blast centre for an explosion, the impact point for a shell. That source
   * point is DERIVED from the weapon's own geometry and never declared here.
   *
   * `"alongAim"` punches every target the same way instead of splaying them, which is what a
   * shotgun wants.
   */
  direction: "radial" | "alongAim";
  /**
   * Torque scale from the contact-point lever arm. 0 = a clean straight punt, no rotation.
   *
   * **LIVE since 2026-09-19 (stage 4, Task 2): a non-zero value here rotates the victim for real.**
   * `sim/contact.ts` derives `ContactHit.push.contactX/Y` with `contactPointOn` — the same helper
   * every ordinary ram uses — so `applyImpulse` measures a genuine lever arm off the victim's hull
   * and `nextSpin` turns it into yaw. This was inert until then, because the event carried the
   * victim's own centre and the arm was exactly zero; that is history, and **authoring a spinning
   * contact impulse is now a table edit, not a physics change.**
   *
   * `wildcharge` still authors `0`, and that is a BALANCE decision rather than a limitation: a clean
   * straight punt is the ult's signature (spec P28/P31). `weapon-config.test.ts` holds every row at
   * `0` for the same reason — it pins the shipped roster, and re-pitching the slam's feel means
   * moving the assertion and the row together, deliberately.
   *
   * One asymmetry to know before authoring one: `applyImpulse` divides the torque by the victim's
   * `ramDefence` whatever `defenceScaled` says, so a row that punts every chassis identically
   * (`defenceScaled: false`) still SPINS each chassis differently. `defenceScaled` governs the
   * linear Δv alone.
   */
  spin: number;
  /**
   * Does the target's `ramDefence` reduce this push? **Renamed from `massScaled` (spec R10) — `mass`
   * no longer exists.** Ram: yes, conceptually — a defensive chassis is meant to be harder to shove.
   * A hard slam: no, it punts every chassis identically.
   *
   * The designer's escape hatch, and the place where "weapons get to break physics" becomes a
   * checkbox instead of a special case.
   *
   * **`sim/ram.ts` builds no `Impulse` at all any more, so "ram: yes" above is the concept, not a
   * flag anyone sets.** An ordinary ram already divides by the victim's `ramDefence` inside
   * `shoveOf`, and since the 2026-09-18 Unity ram port (spec §7.4) it hands the bridge a
   * `RamResolution` — velocities to write — rather than a push to be applied, so there is no
   * `defenceScaled` on that path to be `false`. (Under the contest there was, and it was `false`, for
   * the same no-double-division reason.)
   *
   * This `ImpulseDef` field is therefore the authored escape hatch for a WEAPON's own fixed push —
   * `wildcharge`'s slam, and any future explosion or shell — and the only thing that still reaches
   * `applyImpulse.defenceScaled`. `wildcharge` authors it `false`: a slam punts every chassis
   * identically.
   */
  defenceScaled: boolean;
  /**
   * Applied to the pushed car the moment the push lands. An empty list is legal and means a push
   * that only pushes.
   *
   * **The bridge names no status of its own.** Until the 2026-09-19 restructure this was
   * `uncontrolMs: number` and `ram-bridge.ts` supplied the id `"reeling"` in code, so a row could
   * say how long but not which — the one place a weapon's effect was decided outside its row.
   */
  applies: ImpulseStatusApplication[];
  /**
   * Applied if the pushed car meets level geometry within `windowMs` of taking the push.
   *
   * A **deferred conditional application**: unlike `applies`, whose statuses land at once, these
   * wait and may never land at all. `ram-bridge.ts` arms a per-victim record when the push lands and
   * sweeps it each tick until the window closes; the first tick the car's hull is within
   * `IMPULSE_CONFIG.wallContactPad` of an obstacle or boundary, these apply and the window shuts, so
   * one push can stun at most once.
   *
   * Omit for a push that cannot. Absent must mean absent — a `windowMs: 0` would arm a sweep that
   * can never fire, which is worse than not arming one.
   */
  onWallImpact?: { windowMs: number; applies: ImpulseStatusApplication[] };
  /** A car pushed by this cannot be pushed by it again within this. */
  retriggerImmunityMs?: number;
}

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

/** Homing guidance for a projectile (spec: Homing, and 2026-09-02 P1-P9). */
export interface HomingDef {
  /**
   * How this shot finds a target. One mode today:
   *
   * - `"proximity"` — no target at spawn. Each tick the shot takes the nearest eligible car within
   *   `acquireRadius` of ITSELF, then commits to it. The driver aims the launch; the shot finds
   *   the victim.
   *
   * Written as a one-member union rather than dropped: a second acquisition rule is a plausible
   * future weapon, and a row that has to name its mode cannot silently inherit one nobody chose.
   */
  acquire: "proximity";
  /**
   * Proximity only: how near a car must come to the SHOT to be grabbed, world units. Required
   * when `acquire: "proximity"` (test-enforced).
   *
   * Deliberately its own number. The two answer different
   * questions — one is how far the driver may bracket, the other is how near the missile must pass —
   * and coupling them means a balance edit to either silently moves the other.
   */
  acquireRadius?: number;
  /** Max steering rate toward the target, degrees per second. The counterplay dial. */
  turnRateDegPerSec: number;
  /** Guidance window after spawn. Afterwards the shot flies straight forever. */
  durationMs: number;
}

/**
 * How an explosion's per-target damage clock behaves (spec LZ4, LZ5).
 *
 * `"onceEver"` is the original rule and the right answer for a burst too brief to leave and
 * re-enter: a car pays once, and the clock is never re-armed.
 *
 * `"perEntry"` is what makes a LINGERING field a place rather than a moment. A car pays on the tick
 * it enters, pays nothing for standing there however long it stays, and pays again if it leaves and
 * comes back. Deliberately not a damage-over-time interval: a frequency punishes the car that is
 * stuck, where an entry rule punishes the car that chose to cross — and "go around" is the
 * counterplay the field is for.
 */
export type ExplosionDamageMode = "onceEver" | "perEntry";

/**
 * An area effect left where a projectile died (spec P13-P21).
 *
 * It is spawned as a real `WeaponInstance` — a detached, centre-origin `disc` beam — rather than
 * resolved inline, so it inherits every rule already written for instances: the per-target damage
 * clock, damage frozen at spawn, friendly fire, status application, networking and rendering. The
 * synthesis lives in `instanceDefOf`.
 *
 * There is deliberately no damage-FREQUENCY knob — `damageMode` is a two-value rule, not an
 * interval. A repeating explosion was argued for on its own terms in the 2026-09-09 lava field
 * design and the answer it reached was per-ENTRY, not per-tick; see `ExplosionDamageMode`.
 */
export interface ExplosionDef {
  /** Radius of the field, world units. It is the synthesized beam's `range`. */
  radius: number;
  /** Damage to every car caught, before chassis and status scaling. */
  damage: number;
  /**
   * How long the field persists. Mostly for the eye, but not only: the per-target clock is
   * once-ever, so a car that drives in during the linger is caught.
   */
  lingerMs: number;
  /**
   * Required rather than defaulted, for the reason `BeamWeaponDef.origin` is: an explosion that
   * inherits a damage rule nobody chose is exactly the silent mistake this interface's own comment
   * was written to prevent. See `ExplosionDamageMode`.
   */
  damageMode: ExplosionDamageMode;
  /**
   * Statuses the field applies. `opponents` only — `self` means the shooter, whom `canDamage`
   * refuses, and `ownerInside` is a presence buff for a zone the owner stands in, which a brief
   * burst at a remote impact point is not. Guarded in `weapon-config.test.ts`.
   */
  applies?: readonly StatusApplication[];
  /**
   * The push this burst imparts on every car it catches, if any. Absent means this explosion pushes
   * nothing. See `ImpulseDef`.
   */
  impulse?: ImpulseDef;
}

export interface ProjectileWeaponDef extends WeaponBase {
  kind: "projectile";
  hitbox: ProjectileHitbox;
  /** Additional opponents passed through after damaging one. 0 = dies on the first car it damages. */
  pierce: number;
  pellets: PelletDef;
  homing?: HomingDef;
  /**
   * Total flight time. When present the shot expires on this clock instead of at `range`, which is
   * what lets a weapon be authored as "no range, just lifetime".
   *
   * Hoisted off the old `BounceDef` (2026-09-02): a bouncing shot needs a clock because `range` is
   * meaningless once it reflects, but a clock is not a fact about bouncing. `predator` uses one
   * without bouncing at all.
   */
  lifetimeMs?: number;
  /**
   * Wall-bouncing flight: reflect off level geometry rather than dying on it. Requires `lifetimeMs`,
   * and `weapon-config.test.ts` holds that lifetime strictly under `cooldownMs` so two bouncing
   * instances of one weapon can never coexist. Absent is false.
   */
  bounces?: boolean;
  /**
   * The world never destroys this shot: level geometry and the arena bounds alike, it flies
   * through, and only its own `range` clock ends it. Absent is false — dying on the first wall
   * stays the projectile default.
   *
   * Authored for a shot whose lateral extent dwarfs its travel axis (`roadblock`'s 120u bar):
   * without it, firing within a wingtip's reach of a wall killed the instance on its own spawn
   * tick — cooldown spent, nothing on the wire, a press that visibly did nothing. It is also a
   * design lever in its own right: a wall-piercing shot reaches the car camping behind cover.
   * Nothing rendered outside the bounds is ever visible (the camera is clamped to the arena), so
   * a shot crossing the outer wall simply reads as absorbed by it.
   *
   * Projectile-only on purpose: beams already have their own wall rule (`wallClipDistance`
   * clipping), and a maneuver spawns no instance.
   */
  piercesWalls?: boolean;
  /** Detonate on ANY death — enemy, wall, bounds or max range (spec P13). */
  explosion?: ExplosionDef;
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
   * Required on beams rather than defaulted: a beam that grows out of the wrong point is a silent,
   * hard-to-see mistake, and every row should have to say which it is.
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
