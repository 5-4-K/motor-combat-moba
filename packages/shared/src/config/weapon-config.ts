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
 * car firing a given weapon fires the same shot colour. All nine shipped colours are picked to be
 * unmistakable against any `COLOR_TABLE` player colour — `fireball`'s ember orange leans darker and
 * redder than `Orange`/`Gold`, `needler`'s teal has no player counterpart at all, and the rest
 * follow the same rule — so a shot never reads as somebody's car paint.
 *
 * `damage` is what the weapon deals from a chassis at `COMBAT_CONFIG.attackBaseline` — an *average*
 * car, not every car. `damageFor` (`sim/damage.ts`) moves it +/-50% with the firing chassis's
 * `attack` rating. Fireball's 50 is solved, not chosen: an average chassis has 500 hull HP and
 * fireball fires twice a second, so 50 is the number that makes an average-vs-average kill take the
 * design target of 5 seconds. `needler`'s 30 is solved from its own recharge rather than from
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
    // `fireball` is Mirage's slot 1 only, not a universal weapon. Aim assist is not universal
    // either: exactly three of the nine weapons use it (`fireball`, `needler`, `thumper`). The
    // other six -- every beam, `pepperbox`'s multi-pellet volleys, and the wind-ups `skewer` and
    // `lance` -- are real, shipped rows now, not a hypothetical never-seen-in-play list.
    usesAimAssist: true,
    hitbox: { shape: "circle", radius: 12 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0 },
    pellets: { pelletsPerVolley: 1, spreadAngleDeg: 0 },
  },
  /**
   * Mirage's slot 2. The table's first multi-volley, multi-pellet weapon, and the first place
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
    volley: { volleys: 3, volleyIntervalMs: 100 },
    pellets: { pelletsPerVolley: 2, spreadAngleDeg: 10 },
  },
  /**
   * Mirage's slot 3, and the FIRST BEAM THE GAME HAS EVER SHIPPED. Several paths in
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
    // Amber rather than the magenta this shipped with: the flame drawn by `WEAPON_BEAM_STYLES`
    // fills its outer layer with this exact hex, so the colour, the layered look and the HUD icon
    // all describe one weapon. Clear of `COLOR_TABLE` -- deeper and redder than the `Gold` player
    // colour, which is the only one it sits near.
    color: "#F59F00",
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
    volley: { volleys: 1, volleyIntervalMs: 0 },
    attached: true,
    origin: "muzzle",
    lifetimeMs: 2000,
    // A flamethrower that cooks the car it is pointed at. `refresh` on `overheated` is what makes a
    // ticking source work: each 200 ms tick tops the clock back up, so the debuff holds for as long
    // as the target stays in the flame and lapses 1.5 s after they break away.
    applies: [{ statusId: "overheated", target: "opponents", durationMs: 1500 }],
  },
  /**
   * Bullseye's slot 1, and the table's only multi-stock weapon. It replaced `repeater`, which held this
   * reference role while carried by no car; a reachable reference is strictly better, because stock
   * bugs now surface in matches instead of only in `fire.test.ts`.
   *
   * `cooldownMs: 400` is the entire design and is not a knob to round off. One dart per 400 ms
   * sustains 75 DPS; dumping all three puts 90 damage out in 260 ms and then leaves a 1.2 s dry
   * spell at 62 DPS across the cycle. So tapping wins the long fight and dumping wins the moment,
   * which is the trigger discipline the weapon exists to ask for. At the 1.7 s first drafted for it
   * the weapon sustains 18 DPS against `fireball`'s 100 and is not a viable slot 1.
   */
  needler: {
    id: "needler",
    kind: "projectile",
    name: "Needler",
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
    volley: { volleys: 1, volleyIntervalMs: 0 },
    pellets: { pelletsPerVolley: 1, spreadAngleDeg: 0 },
    stock: { max: 3, refireDelayMs: 130 },
    // Darts that stay in. Three stocks at a 130 ms refire all land on the same `spiked`, and
    // `refresh` means dumping the magazine buys duration rather than a bigger bleed — the weapon's
    // own trigger-discipline question, asked again in the status layer.
    applies: [{ statusId: "spiked", target: "opponents", durationMs: 3000 }],
  },
  /**
   * Bullseye's slot 2. The table's first `pierce` and first `ellipse` hitbox.
   *
   * `pierce: 1` is TWO CARS, not one and not three — the field counts opponents passed through
   * after the first. Authoring it as 2 would let a 110-damage shot deal 396 from Bullseye's 1.2x
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
    volley: { volleys: 1, volleyIntervalMs: 0 },
    pellets: { pelletsPerVolley: 1, spreadAngleDeg: 0 },
  },
  /**
   * Bullseye's slot 3, and the table's first DETACHED beam: it stamps into the world at its fire-tick
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
    volley: { volleys: 1, volleyIntervalMs: 0 },
    attached: false,
    origin: "muzzle",
    lifetimeMs: 150,
  },
  /**
   * Bastion's slot 1. A fat, slow slug: the 20-unit radius is the largest hitbox in the table and
   * makes it near-unmissable in a brawl, while 450 u/s over 550 units means 1.2 s of flight and a
   * genuinely dodgeable shot at range. It buys pressure, not a ranged win — but Bastion is 90 u/s
   * slower than Bullseye and 225 slower than Mirage, so without one weapon that reaches at all, the
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
    volley: { volleys: 1, volleyIntervalMs: 0 },
    pellets: { pelletsPerVolley: 1, spreadAngleDeg: 0 },
  },
  /**
   * Bastion's slot 2. The widest hitbox in the game and the shortest-lived: a 140-degree cone that
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
    // The navy the HUD icon is built out of (`art/weapon-icons/shockwave.png`), so the ring on the
    // floor and the slot in the bar read as one weapon. Icons ship `colorMode: "none"` and nothing
    // typed ties the two together, so a re-imported icon can silently drift from this.
    color: "#0B3D8A",
    unlocksAt: 1,
    damage: 100,
    damageFrequencyMs: 0, // one hit per car, not a ticking field
    speed: 1500, // expands its 150 radius in 100ms; +150ms linger == 250ms of total life
    range: 150,
    startUpMs: 0,
    cooldownMs: 5000,
    recoveryMs: 200,
    usesAimAssist: false,
    // The table's first AURA: a `disc` hitbox anchored at `origin: "center"`, so it expands as a
    // ring out of the car rather than as a fan out of its nose.
    //
    // **This is a change in what the weapon does, not only in how it is drawn.** It shipped as a
    // 140-degree forward cone and now reaches behind the car as well, which is a real buff to
    // Bastion's slot 2 — a chassis that cannot disengage no longer has to face its attacker to
    // answer them. The radius is unchanged at 150, barely wider than a car is long, and the
    // 5 s cooldown is unchanged; the cost of the extra arc is the first thing to re-tune from play.
    // Reverting is a two-line edit back to `{ shape: "cone", angleDeg: 140 }` and `"muzzle"`.
    hitbox: { shape: "disc" },
    volley: { volleys: 1, volleyIntervalMs: 0 },
    attached: true,
    origin: "center",
    lifetimeMs: 150,
    // A concussive blast: it stops you dead rather than wearing you down. `ignore` on `stunned`
    // means two Bastions cannot chain it, and 700 ms is short enough to be a window rather than a
    // sentence — see the design note on the row.
    applies: [{ statusId: "stunned", target: "opponents", durationMs: 700 }],
  },
  /**
   * Bastion's slot 3, and the table's only DETACHED TICKING beam — the combination that makes it a
   * zone rather than a shot. It stamps into the world and sits there for 3.5 s total, re-arming
   * against anything still inside every 400 ms.
   *
   * The weapon only works because `canDamage` returns false for `ownerId === targetId` and there is
   * no friendly fire: **the owner can park inside their own bulwark.** It is not a symmetric
   * hazard, it is an asymmetric exclusion zone, and that asymmetry is most of the design (L6). Its
   * damage output is secondary to the ground it denies, but it must never read as a safe wall to
   * drive through — **9 ticks is 315**, the hardest single press in the table.
   *
   * That ceiling was written as "8 ticks is 280, matching `afterburner`'s" until 2026-08-30, on
   * arithmetic that divided the 3.5 s life by the 400 ms interval and lost the opening tick. The sim
   * never did that: `resolveInstanceHits` damages on the first tick the beam covers a car and only
   * then arms the clock, so a car held for the full life takes `floor((105 - 1) / 12) + 1 = 9`. The
   * weapon has always dealt 315; only the comment was wrong. Kept at 315 rather than retuned back
   * down — Bastion's ultimate leading the damage table is a fair price for the slowest chassis.
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
    volley: { volleys: 1, volleyIntervalMs: 0 },
    attached: false,
    origin: "muzzle",
    lifetimeMs: 2500,
    // The zone corrodes whoever stands in it, and deploying it hardens the car that deployed it.
    // The `self` entry is the roster's only one, and it is what makes the weapon a stand-and-hold
    // rather than a place-and-run: the buff arrives whether or not the zone ever catches anybody.
    applies: [
      { statusId: "corroded", target: "opponents", durationMs: 2500 },
      { statusId: "fortified", target: "self", durationMs: 4000 },
    ],
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
