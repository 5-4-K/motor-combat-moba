import type { WeaponDef, WeaponId } from "./weapon-types.js";

/**
 * Every weapon in the game, mirroring `CAR_TABLE`. Balance lives here and nowhere else.
 *
 * `fireball` is the migrated pre-weapon-system shot, carrying its exact numbers: `fireRateHz: 2`
 * became `cooldownMs: 500`, and `lifetimeTicks: 30` became `range: 900` (one second of flight at
 * 900 u/s). Its hitbox is the one deliberate departure from that migration: it shipped as a 3-unit
 * circle, the smallest that kept the old point-hit feel while satisfying "every weapon has a
 * hitbox", and was later widened to 12 so the shot reads on screen — the client draws the hitbox
 * itself, never a sprite. A 24-unit disc is three quarters of a car's 32-unit width.
 *
 * `color` is the one render-only number here besides `name`. It is per weapon on purpose: every
 * car firing a fireball fires the same ember-orange shot. The two shipped colours are picked to be
 * unmistakable for any `COLOR_TABLE` player colour — ember orange leans darker and redder than
 * `Orange`/`Gold`, and no player can be teal — so a shot never reads as somebody's car paint.
 *
 * `damage` is what the weapon deals from a chassis at `COMBAT_CONFIG.attackBaseline` — an *average*
 * car, not every car. `damageFor` (`sim/damage.ts`) moves it +/-50% with the firing chassis's
 * `attack` rating. Fireball's 50 is solved, not chosen: an average chassis has 500 hull HP and
 * fireball fires twice a second, so 50 is the number that makes an average-vs-average kill take the
 * design target of 5 seconds. `splinter`'s 30 is solved from its own recharge rather than from
 * `fireball`: 30 damage per 400 ms is 75 sustained DPS, three quarters of the anchor, which is where
 * a 1.2x `attack` chassis wants its go-to. See `docs/superpowers/specs/2026-08-29-weapon-roster-design.md`.
 */
export const WEAPON_TABLE = {
  fireball: {
    id: "fireball",
    kind: "projectile",
    name: "Fireball",
    color: "#E8590C",
    unlocksAt: 1,
    damage: 50,
    damageFrequencyMs: 0,
    speed: 900,
    range: 900,
    startUpMs: 0,
    cooldownMs: 500,
    recoveryMs: 0,
    // The system would otherwise ship dark: `fireball` is the only weapon any chassis carries, so
    // leaving it off would put aim assist on the same never-seen-in-play list as beams, multi-pellet
    // volleys and `splinter`. Note the consequence -- every chassis carries `fireball`, so aim assist
    // is universal until a second weapon is authored.
    usesAimAssist: true,
    hitbox: { shape: "circle", radius: 12 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0, pelletsPerVolley: 1, spreadAngleDeg: 0 },
  },
  /**
   * Rectangle's slot 2. The table's first multi-volley, multi-pellet weapon, and the first place
   * `volleys` and `pelletsPerVolley` are both > 1.
   *
   * Sequential volleys exit on their own ticks, each from the car's pose AT that tick, so driving
   * straight clusters the six pellets and turning through the burst sprays them across an arc. The
   * skill expression is a consequence of the mechanic, not an added rule.
   *
   * Its all-pellets-connect sustained DPS is 83, deliberately BELOW `fireball`'s 100: a mid weapon
   * buys a chunk of damage inside a window the go-to cannot match (168 in 200 ms against
   * `fireball`'s 1.7 s for the same total), and pays for it in sustained output. Neither dominates.
   */
  pepperbox: {
    id: "pepperbox",
    kind: "projectile",
    name: "Pepperbox",
    color: "#B45309",
    unlocksAt: 1,
    damage: 28, // per pellet; 6 pellets == 168, 34% of an average car
    damageFrequencyMs: 0,
    speed: 800,
    range: 600,
    startUpMs: 0, // a drive-by must be instant
    cooldownMs: 1800,
    recoveryMs: 200,
    usesAimAssist: false,
    hitbox: { shape: "circle", radius: 7 },
    pierce: 0,
    volley: { volleys: 3, volleyIntervalMs: 100, pelletsPerVolley: 2, spreadAngleDeg: 10 },
  },
  /**
   * Rectangle's slot 3, and the FIRST BEAM THE GAME HAS EVER SHIPPED. Several paths in
   * `instances.ts` and `instanceDrawShape` run in live play for the first time because of this row.
   *
   * `attached: true` welds its origin and angle to the car every tick, so it sweeps as the driver
   * steers and dies the instant its owner is wrecked. Total life is `range / speed + lifetimeMs`
   * == 2.2 s; at a 200 ms damage interval that is about 11 ticks, 286 damage, 57% of an average car
   * — but only against a target held in the cone for the full duration.
   *
   * `usesAimAssist: false` is FORCED twice over: `range` (220) is below `AIM_CONFIG.lockRange`, and
   * a separate guard refuses aim assist on any attached beam. Do not "fix" this to true.
   *
   * `recoveryMs: 200` is deliberately small (L5). The beam lives on its own once spawned, so the
   * driver stays free to keep firing `fireball` into a target that is already burning.
   */
  afterburner: {
    id: "afterburner",
    kind: "beam",
    name: "Afterburner",
    color: "#D6336C",
    unlocksAt: 1,
    damage: 26, // per tick
    damageFrequencyMs: 200,
    speed: 1100, // extends its 220 range in 200ms
    range: 220,
    startUpMs: 0,
    cooldownMs: 13000,
    recoveryMs: 200,
    usesAimAssist: false,
    hitbox: { shape: "cone", angleDeg: 55 },
    attached: true,
    lifetimeMs: 2000,
  },
  /**
   * Oval's slot 1, and the table's only multi-stock weapon. It replaced `repeater`, which held this
   * reference role while carried by no car; a reachable reference is strictly better, because stock
   * bugs now surface in matches instead of only in `fire.test.ts`.
   *
   * `cooldownMs: 400` is the entire design and is not a knob to round off. One dart per 400 ms
   * sustains 75 DPS; dumping all three puts 90 damage out in 260 ms and then leaves a 1.2 s dry
   * spell at 62 DPS across the cycle. So tapping wins the long fight and dumping wins the moment,
   * which is the trigger discipline the weapon exists to ask for. At the 1.7 s first drafted for it
   * the weapon sustains 18 DPS against `fireball`'s 100 and is not a viable slot 1.
   */
  splinter: {
    id: "splinter",
    kind: "projectile",
    name: "Splinter",
    color: "#0CA5B0",
    unlocksAt: 1,
    damage: 30,
    damageFrequencyMs: 0,
    speed: 1100,
    range: 850, // >= AIM_CONFIG.lockRange (400), required for usesAimAssist
    startUpMs: 0,
    cooldownMs: 400, // 2.5 Hz, clear of the 1.25 Hz aim-assist cliff by 100%
    recoveryMs: 0, // a go-to never gates another slot (L5)
    usesAimAssist: true,
    hitbox: { shape: "circle", radius: 5 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0, pelletsPerVolley: 1, spreadAngleDeg: 0 },
    stock: { max: 3, refireDelayMs: 130 },
  },
  /**
   * Oval's slot 2. The table's first `pierce` and first `ellipse` hitbox.
   *
   * `pierce: 1` is TWO CARS, not one and not three — the field counts opponents passed through
   * after the first. Authoring it as 2 would let a 110-damage shot deal 396 from Oval's 1.2x
   * `attack` and beat `lance`, which is the chassis's actual ultimate.
   *
   * Aim assist is off on purpose rather than by constraint: `range` (1100) clears
   * `AIM_CONFIG.lockRange` easily, so this row COULD take it. Lining two cars up is meant to be the
   * highest-value press in the game, and handing that to the lock would give it away.
   */
  skewer: {
    id: "skewer",
    kind: "projectile",
    name: "Skewer",
    color: "#1864AB",
    unlocksAt: 1,
    damage: 110,
    damageFrequencyMs: 0,
    speed: 1400,
    range: 1100,
    startUpMs: 250, // rounds up to 8 ticks == 266ms at 30Hz
    cooldownMs: 2400,
    recoveryMs: 200,
    usesAimAssist: false,
    hitbox: { shape: "ellipse", radiusAlong: 22, radiusAcross: 5 },
    pierce: 1,
    volley: { volleys: 1, volleyIntervalMs: 0, pelletsPerVolley: 1, spreadAngleDeg: 0 },
  },
  /**
   * Oval's slot 3, and the table's first DETACHED beam: it stamps into the world at its fire-tick
   * pose and never moves again, unlike `afterburner` which rides the car. It is also the only row
   * with a `lifetimeMs` short enough to read as a flash rather than a zone.
   *
   * The 700 ms wind-up leaves a 300 HP chassis standing still and visible, and `recoveryMs: 1000`
   * means a miss also costs a second of silence. That pair is the whole risk budget — `lance` has
   * no lingering presence to fall back on, unlike the roster's other two ultimates, so its
   * commitment has to be paid up front and afterward rather than during (L5).
   */
  lance: {
    id: "lance",
    kind: "beam",
    name: "Lance",
    color: "#6741D9",
    unlocksAt: 1,
    damage: 180, // 36% of an average car; 72% if it catches two
    damageFrequencyMs: 0,
    speed: 6000, // crosses its full 1200 range in 200ms — a flash, not a sweep
    range: 1200,
    startUpMs: 700,
    cooldownMs: 16000,
    recoveryMs: 1000,
    usesAimAssist: false,
    hitbox: { shape: "rect", width: 20 },
    attached: false,
    lifetimeMs: 150,
  },
  /**
   * Hexagon's slot 1. A fat, slow slug: the 20-unit radius is the largest hitbox in the table and
   * makes it near-unmissable in a brawl, while 450 u/s over 550 units means 1.2 s of flight and a
   * genuinely dodgeable shot at range. It buys pressure, not a ranged win — but Hexagon is 90 u/s
   * slower than Oval and 225 slower than Rectangle, so without one weapon that reaches at all, the
   * slowest chassis has no answer to a patient opponent.
   *
   * `cooldownMs: 1000` IS CONSTRAINED, not chosen for feel. The aim-assist cliff guard rejects any
   * assisted weapon whose `1000 / cooldownMs` is within 15% of `1000 / AIM_CONFIG.lockTimeoutMs`,
   * which forbids every value between 696 and 941. This row was first drafted at 900 and would have
   * failed the suite. Do not "round it down" to 900 without re-reading that guard.
   */
  thumper: {
    id: "thumper",
    kind: "projectile",
    name: "Thumper",
    color: "#495057",
    unlocksAt: 1,
    damage: 75,
    damageFrequencyMs: 0,
    speed: 450,
    range: 550, // >= AIM_CONFIG.lockRange (400), required for usesAimAssist
    startUpMs: 0,
    cooldownMs: 1000, // 1.0 Hz — 20% clear of the 1.25 Hz cliff
    recoveryMs: 0,
    usesAimAssist: true,
    hitbox: { shape: "circle", radius: 20 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0, pelletsPerVolley: 1, spreadAngleDeg: 0 },
  },
  /**
   * Hexagon's slot 2. The widest hitbox in the game and the shortest-lived: a 140-degree cone that
   * hugs the chassis for a quarter second and hits each car once. It is not aimed so much as
   * triggered — it only needs opponents to be near — which is the point on a chassis that cannot
   * disengage.
   *
   * `usesAimAssist: false` is FORCED, same as `afterburner`: `range` (150) is far below
   * `AIM_CONFIG.lockRange`, and attached beams are refused assist by a separate guard.
   */
  shockwave: {
    id: "shockwave",
    kind: "beam",
    name: "Shockwave",
    color: "#5C940D",
    unlocksAt: 1,
    damage: 100,
    damageFrequencyMs: 0, // one hit per car, not a ticking field
    speed: 1500, // extends its 150 range in 100ms; +150ms linger == 250ms of total life
    range: 150,
    startUpMs: 0,
    cooldownMs: 5000,
    recoveryMs: 200,
    usesAimAssist: false,
    hitbox: { shape: "cone", angleDeg: 140 },
    attached: true,
    lifetimeMs: 150,
  },
  /**
   * Hexagon's slot 3, and the table's only DETACHED TICKING beam — the combination that makes it a
   * zone rather than a shot. It stamps into the world and sits there for 3.5 s total, re-arming
   * against anything still inside every 400 ms.
   *
   * The weapon only works because `canDamage` returns false for `ownerId === targetId` and there is
   * no friendly fire: **the owner can park inside their own bulwark.** It is not a symmetric
   * hazard, it is an asymmetric exclusion zone, and that asymmetry is most of the design (L6). Its
   * damage output is secondary to the ground it denies, but it must never read as a safe wall to
   * drive through — 8 ticks is 280, matching `afterburner`'s ceiling.
   */
  bulwark: {
    id: "bulwark",
    kind: "beam",
    name: "Bulwark",
    color: "#862E9C",
    unlocksAt: 1,
    damage: 35, // per tick
    damageFrequencyMs: 400,
    speed: 500, // grows out over a full second, so it is visible before it is dangerous
    range: 500,
    startUpMs: 0,
    cooldownMs: 15000,
    recoveryMs: 200,
    usesAimAssist: false,
    hitbox: { shape: "cone", angleDeg: 60 },
    attached: false,
    lifetimeMs: 2500,
  },
} as const satisfies Record<WeaponId, WeaponDef>;

/**
 * Own-property check, deliberately not `value in WEAPON_TABLE`: `in` walks the prototype chain, so
 * inherited names like `"constructor"` would pass as weapon ids and resolve to undefined stats.
 * Same rule as `isCarId`.
 */
export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(WEAPON_TABLE, value);
}

export function weaponDefOf(id: WeaponId): WeaponDef {
  return WEAPON_TABLE[id];
}
