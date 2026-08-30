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
 * `attack` rating. `fireball` is still the anchor every other row is read against: 50 damage per
 * 550 ms is `50 * 1000 / 550` == 91 sustained DPS, so an average chassis's 500 hull HP takes
 * `500 / 91` == 5.5 s to grind down average-on-average. That was 5.0 s at the 500 ms cooldown this
 * row shipped with; the +10% is Mirage paying for `shockwave` arriving in its slot 2 (T14), and the
 * kill time moved with it rather than the damage being re-solved to hold 5 s.
 *
 * `needler`'s 22 is solved from its own recharge rather than from `fireball`: 22 damage per 300 ms
 * is 73 sustained DPS, four fifths of the anchor, which is where a skirmisher wants a go-to it fires
 * from outside the fight. See `docs/superpowers/specs/2026-08-29-weapon-roster-design.md` for the
 * roster rules and `docs/superpowers/specs/2026-08-30-chassis-rename-and-weapon-redistribution-design.md`
 * for the type triangle these numbers now serve.
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
    cooldownMs: 550, // 1.82 Hz, 45% clear of the 1.25 Hz aim-assist cliff
    recoveryMs: 0,
    // `fireball` is Mirage's slot 1 only, not a universal weapon. Aim assist is not universal
    // either, though the redistribution tipped it into the majority: six of the nine rows take it
    // (`fireball`, `needler`, `pepperbox`, `lance`, `skewer`, `thumper`) and three refuse it. The
    // three that refuse are all beams: `afterburner` and `shockwave` are attached and so are
    // refused by the guard, and `bulwark` opts out by choice — a zone is aimed at ground, and a
    // lock that swung it onto a car would aim it at the one thing that can drive out of it.
    usesAimAssist: true,
    hitbox: { shape: "circle", radius: 12 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0 },
    pellets: { pelletsPerVolley: 1, spreadAngleDeg: 0 },
  },
  /**
   * Bullseye's slot 2, moved off Mirage by T12. A single fan: one volley of three pellets, 12
   * degrees apart, all leaving on the same tick.
   *
   * **It used to be three sequential volleys of two, 100 ms apart, and that skill expression is
   * gone.** Each volley exited from the car's pose at ITS tick, so driving straight clustered the
   * six pellets and turning through the burst sprayed them across an arc — steering *was* the aim.
   * A single volley cannot express that: the fan is decided entirely at the press, and the driver's
   * only input is where the nose points on that one tick. That is the cost of the shape T12 asked
   * for, paid knowingly, and it is the reason this row can take aim assist at all — there is no
   * mid-burst steering left for a lock to override.
   *
   * 3 x 45 == 135 per press against the old 168, and `135 * 1000 / 1800` == 75 sustained DPS,
   * deliberately level with `needler`'s 73. The two are Bullseye's paired mid-range pressure, not a
   * go-to and an alternative, so neither should out-sustain the other; they differ in shape (one
   * dart at 850 units versus a cone of three at 600) rather than in output.
   *
   * Aim assist is legal: range 600 >= `AIM_CONFIG.lockRange` (400), and 0.56 Hz is 56% clear of the
   * 1.25 Hz cliff. The lock steers the fan's centre line; the spread still decides what connects.
   */
  pepperbox: {
    id: "pepperbox",
    kind: "projectile",
    name: "Pepperbox",
    color: "#B45309",
    unlocksAt: 1,
    damage: 45, // per pellet; 3 pellets == 135, 27% of an average car
    damageFrequencyMs: 0,
    speed: 800,
    range: 600, // >= AIM_CONFIG.lockRange (400), required for usesAimAssist
    startUpMs: 0, // a drive-by must be instant
    cooldownMs: 1800, // 0.56 Hz, 56% clear of the 1.25 Hz aim-assist cliff
    recoveryMs: 200,
    usesAimAssist: true,
    // 10% smaller than the r7 it fired at two-per-volley. Three pellets in one tick overlap far
    // more than two did, so the same radius would have made the fan read as one wide slug.
    hitbox: { shape: "circle", radius: 6 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0 },
    pellets: { pelletsPerVolley: 3, spreadAngleDeg: 12 },
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
   * `cooldownMs: 300` is the entire design and is not a knob to round off. One dart per 300 ms
   * sustains `22 * 1000 / 300` == 73 DPS, essentially the 75 this row anchored on before T11 and
   * four fifths of `fireball`'s 91. Dumping all three stocks puts 66 damage out in 220 ms (two
   * 110 ms refire gaps) and then owes a 900 ms refill — three 300 ms recharges — for 66 damage per
   * 1120 ms, 59 DPS across the cycle. So tapping wins the long fight and dumping wins the moment,
   * which is the trigger discipline the weapon exists to ask for. The 22/300 pair is a tightened
   * restatement of the 30/400 it shipped with, not a new question.
   *
   * **It no longer applies `spiked`.** Three stocks landing on one `refresh` debuff made the
   * skirmisher's spam weapon a debuff applicator as well, which fights the clean sustained-pressure
   * job slot 1 exists to do. "Spikes" is `bulwark`'s now (T18), where a bleed suits an exclusion
   * zone. Losing it here is a deliberate nerf, not an oversight.
   *
   * 3.33 Hz is 167% clear of the 1.25 Hz cliff, the widest margin in the assisted half of the table.
   */
  needler: {
    id: "needler",
    kind: "projectile",
    name: "Needler",
    color: "#0CA5B0",
    unlocksAt: 1,
    damage: 22,
    damageFrequencyMs: 0,
    speed: 1300,
    range: 850, // >= AIM_CONFIG.lockRange (400), required for usesAimAssist
    startUpMs: 0,
    cooldownMs: 300, // 3.33 Hz, clear of the 1.25 Hz aim-assist cliff by 167%
    recoveryMs: 0, // a go-to never gates another slot (L5)
    usesAimAssist: true,
    // A dart rather than a pellet: long and thin along its own flight, so it reads as a needle at
    // 1300 u/s and is genuinely thinner across than the r5 circle it replaced.
    hitbox: { shape: "ellipse", radiusAlong: 9, radiusAcross: 3 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0 },
    pellets: { pelletsPerVolley: 1, spreadAngleDeg: 0 },
    stock: { max: 3, refireDelayMs: 110 },
  },
  /**
   * Bastion's slot 2, moved off Bullseye by T17, and the table's first `pierce`.
   *
   * `pierce: 1` is TWO CARS, not one and not three — the field counts opponents passed through
   * after the first. Authoring it as 2 would put `3 * 101` == 303 into a line of three off a 2.4 s
   * cooldown — ultimate-scale output from a slot that is not the chassis's ultimate.
   *
   * **Cutting `range` from 1100 to 650 is what makes T1's "1 beats 3" edge true, and is the single
   * most load-bearing number in the redistribution.** At 1100 the tank carried the second-longest
   * weapon in the game, on the chassis specifically designed to lose at range: Bullseye reaches 850
   * with `needler` and 1200 with `lance`, so a long skewer let Bastion trade with the kiter it is
   * supposed to be unable to reach. At 650 — behind 850, and below the 1200 lance — it is a heavy
   * committed lunge and the kite works. `speed` drops 1400 -> 1000 with it, so the shot still takes
   * 650/1000 == 0.65 s to cross its reach and stays dodgeable rather than becoming a hitscan poke.
   *
   * **Aim assist is now ON, reversing the argument that used to sit here.** That argument was that
   * lining two cars up should be the highest-value press in the game and not something handed to the
   * lock. It held for an 1100-unit poke on a fast, precise skirmisher. It does not hold for a
   * 650-unit lunge on the slowest chassis in the roster: Bastion has to be inside a Mirage's
   * preferred range, after a 250 ms wind-up, on a car that cannot reposition to fix a miss, and the
   * lock only ever reaches 400 of those 650 units. The line-up is still the player's to find — the
   * assist nudges the shot, it does not choose the pair. 650 >= 400 and 0.42 Hz is 67% clear of the
   * 1.25 Hz cliff, so the row is legal on both guards.
   */
  skewer: {
    id: "skewer",
    kind: "projectile",
    name: "Skewer",
    color: "#1864AB",
    unlocksAt: 1,
    damage: 110, // 101 per car on Bastion's 0.92x, 202 through a line of two
    damageFrequencyMs: 0,
    speed: 1000,
    range: 650, // >= AIM_CONFIG.lockRange (400), required for usesAimAssist
    startUpMs: 250, // rounds up to 8 ticks == 266ms at 30Hz
    cooldownMs: 2400, // 0.42 Hz, 67% clear of the 1.25 Hz aim-assist cliff
    recoveryMs: 200,
    usesAimAssist: true,
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
   *
   * T13 made it 15% wider (20 -> 23) and handed it the lock, and trimmed 180 -> 170 to pay for both
   * arriving at once on the game's hardest single press. The render side moves with the hitbox: the
   * charge orb's `maxRadius` in `combat-visual.ts` goes 18 -> 21, the same 15%, so the telegraph
   * keeps matching what it warns about.
   *
   * **Aim assist is legal here where it is refused on `afterburner` and `shockwave`,** because the
   * guard refuses ATTACHED beams and this one is `attached: false` — it stamps at the fire-tick pose
   * and never re-derives an angle from the car. It is also worth much less than it sounds: the lock
   * only reaches `AIM_CONFIG.lockRange` (400) against this row's 1200 range, so two thirds of the
   * beam's reach is still fully manual, which is where most of its value lives. 0.06 Hz sits 95%
   * clear of the 1.25 Hz cliff.
   */
  lance: {
    id: "lance",
    kind: "beam",
    name: "Lance",
    color: "#6741D9",
    unlocksAt: 1,
    damage: 170, // 34% of an average car; 68% if it catches two
    damageFrequencyMs: 0,
    speed: 6000, // crosses its full 1200 range in 200ms — a flash, not a sweep
    range: 1200, // >= AIM_CONFIG.lockRange (400), required for usesAimAssist
    startUpMs: 700,
    cooldownMs: 16000, // 0.06 Hz, 95% clear of the 1.25 Hz aim-assist cliff
    recoveryMs: 1000,
    usesAimAssist: true,
    hitbox: { shape: "rect", width: 23 }, // +15%; the charge orb's maxRadius tracks it at 21
    volley: { volleys: 1, volleyIntervalMs: 0 },
    attached: false,
    origin: "muzzle",
    lifetimeMs: 150,
  },
  /**
   * Bastion's slot 1, and after T16 the roster's CC engager. A fat, slow slug: the 20-unit radius is
   * the largest hitbox in the table and makes it near-unmissable in a brawl, while 450 u/s over 550
   * units means 1.2 s of flight and a genuinely dodgeable shot at range. It buys pressure, not a
   * ranged win — but Bastion is 99 u/s slower than Bullseye and 261 slower than Mirage, so without
   * one weapon that reaches at all, the slowest chassis has no answer to a patient opponent.
   *
   * **The stun is this row's now, taken from `shockwave` when that moved to Mirage.** Hard CC is
   * Type 3's whole identity, so it belongs on the tank rather than on the speedster, and 900 ms
   * against shockwave's old 700 makes Bastion the longest-CC chassis in the roster on purpose —
   * that is the shape of the "1 beats 3" counterplay, where Bastion's answer to a kiter is to land
   * a skillshot and close inside the window it buys. `stunned` is `reapply: "ignore"`, so two
   * Bastions still cannot chain it and park a car between them; a stun is a window, not a sentence.
   *
   * `damage` drops 75 -> 60 to pay for it: 55 on Bastion's 0.92x attack, a shot that opens a fight
   * rather than one that wins an exchange on its own.
   *
   * `cooldownMs: 1000` IS CONSTRAINED, not chosen for feel, and 1 s is also what keeps this press
   * un-baitable — Mirage must dodge it rather than drain it, which is what stops in-and-out being a
   * free solution to Type 3 (T1). The aim-assist cliff guard rejects any assisted weapon whose
   * `1000 / cooldownMs` is within 15% of `1000 / AIM_CONFIG.lockTimeoutMs`, which forbids every
   * value between 696 and 941. This row was first drafted at 900 and would have failed the suite.
   * Do not "round it down" to 900 without re-reading that guard.
   */
  thumper: {
    id: "thumper",
    kind: "projectile",
    name: "Thumper",
    color: "#495057",
    unlocksAt: 1,
    damage: 60,
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
    applies: [{ statusId: "stunned", target: "opponents", durationMs: 900 }],
  },
  /**
   * Mirage's slot 2 after T15, and the table's only MULTI-WAVE weapon: one press schedules three
   * separate aura instances 500 ms apart. Each wave expands to 150 units in 100 ms, lingers 150 ms
   * and dies, so at 500 ms spacing they never overlap — the weapon reads as three distinct pulses
   * rather than one long field, and each car can be caught once per wave. One press spans 1.25 s
   * from the first wave's birth to the third wave's death (`2 * 500` + 250).
   *
   * This is the row that makes Task 5's split load-bearing: `volley` moved onto `WeaponBase` so a
   * beam could carry `volleys`, and until this row shipped, `beginFire` reading the table and
   * hardcoding 1 were indistinguishable. `fire.test.ts` asserts the three waves for that reason.
   *
   * `damage: 45` per wave is a ceiling of `3 * 45` == 135 against a target that eats all three, up
   * from the single 100 it dealt as Bastion's slot 2 — but only for a target that stays inside a
   * 150-unit ring across a second and a quarter, which is a very different ask on the roster's
   * fastest chassis than a single instant pulse was on its slowest. `cooldownMs` goes 5000 -> 5500
   * to pay for the longer press. `damageFor` scales each wave on its own, so Mirage's 1.13x attack
   * makes it `3 * 51` == 153, not `135 * 1.13` rounded once.
   *
   * **The stun is gone, and did not become weaker — it moved.** Hard CC belongs to Type 3, so
   * `stunned` is `thumper`'s now (T16). What Mirage keeps is `corroded` for 2500 ms, a debuff that
   * sets up a focus rather than one that decides an exchange, matching "burst damage, high mobility,
   * short CC". `onWave: "final"` puts it on the THIRD wave only: the first two are the commitment,
   * and the payoff lands only if the target is still there at the end. Absent, it would fire on all
   * three and `refresh` would make the debuff free the moment any wave connected.
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
    damage: 45, // per wave; 3 waves == 135 at the baseline, 153 on Mirage's 1.13x
    damageFrequencyMs: 0, // one hit per car per wave, not a ticking field
    speed: 1500, // expands its 150 radius in 100ms; +150ms linger == 250ms per wave
    range: 150,
    startUpMs: 0,
    cooldownMs: 5500,
    recoveryMs: 200,
    usesAimAssist: false,
    // The table's first AURA: a `disc` hitbox anchored at `origin: "center"`, so it expands as a
    // ring out of the car rather than as a fan out of its nose.
    //
    // It shipped as a 140-degree forward cone and became a ring on 2026-08-30, which reaches behind
    // the car as well. The radius is unchanged at 150, barely wider than a car is long; a ring on
    // Mirage rewards driving THROUGH a fight rather than facing it, which is the shape the chassis
    // already wants. The cost of the extra arc is still the first thing to re-tune from play.
    // Reverting is a two-line edit back to `{ shape: "cone", angleDeg: 140 }` and `"muzzle"`.
    hitbox: { shape: "disc" },
    volley: { volleys: 3, volleyIntervalMs: 500 },
    attached: true,
    origin: "center",
    lifetimeMs: 150, // per wave: 100ms of expansion + 150ms of linger
    // Corrosion, not concussion: 1.3x damage taken for 2.5 s, which is Mirage setting up the burst
    // it is about to land rather than taking the target's car away. `onWave: "final"` means only
    // the third wave applies it — `refresh` would otherwise hand the full duration to whichever
    // wave connected first and make the other two free.
    applies: [
      { statusId: "corroded", target: "opponents", durationMs: 2500, onWave: "final" },
    ],
  },
  /**
   * Bastion's slot 3, and the table's only DETACHED TICKING beam — the combination that makes it a
   * zone rather than a shot. It stamps into the world and sits there for 3.875 s total, re-arming
   * against anything still inside every 400 ms.
   *
   * The weapon only works because `canDamage` returns false for `ownerId === targetId` and there is
   * no friendly fire: **the owner can park inside their own bulwark.** It is not a symmetric
   * hazard, it is an asymmetric exclusion zone, and that asymmetry is most of the design (L6). Its
   * damage output is secondary to the ground it denies, but it must never read as a safe wall to
   * drive through — **10 ticks is 350**, the hardest single press in the table.
   *
   * The arithmetic, because it is not the obvious one. `resolveInstanceHits` damages on the FIRST
   * tick the beam covers a car and only then arms the clock, so the opening tick is free and the
   * count is `floor((life - 1) / interval) + 1`, not `life / interval`. Total life is
   * `msToTicks(range / speed * 1000) + msToTicks(lifetimeMs)` == `30 + 87` == **117 ticks** against
   * a 12-tick interval, so `floor(116 / 12) + 1` == **10 ticks == 350**. T18's +15% `lifetimeMs`
   * (2500 -> 2875) is what crossed that boundary: at 105 ticks it was `floor(104 / 12) + 1` == 9
   * and 315. `damageFor` scales each tick on its own, so on Bastion's 0.92x attack a tick is
   * `round(35 * 0.92)` == 32 and the real ceiling is **320**, not the 322 you get by scaling the
   * 350 total once — the design doc quotes the latter. Bastion's ultimate leading the damage table
   * is a fair price for the slowest chassis.
   *
   * `range` and `speed` both rise 10% together (500 -> 550), so the zone is 10% bigger and still
   * takes exactly one second to grow out: visible before it is dangerous, as before.
   */
  bulwark: {
    id: "bulwark",
    kind: "beam",
    name: "Bulwark",
    color: "#862E9C",
    unlocksAt: 1,
    damage: 35, // per tick; 10 ticks == 350 at the baseline, 320 on Bastion's 0.92x
    damageFrequencyMs: 400,
    speed: 550, // grows out over a full second, so it is visible before it is dangerous
    range: 550,
    startUpMs: 0,
    cooldownMs: 15000,
    recoveryMs: 200,
    usesAimAssist: false,
    hitbox: { shape: "cone", angleDeg: 60 },
    volley: { volleys: 1, volleyIntervalMs: 0 },
    attached: false,
    origin: "muzzle",
    lifetimeMs: 2875,
    // The zone spikes whoever stands in it, and deploying it hardens the car that deployed it.
    // `spiked` rather than the `corroded` this shipped with (T18): slow-plus-bleed punishes standing
    // in the zone on the zone's own terms, where a damage-taken debuff only set up somebody else's
    // shot. It is also `needler`'s old rider — the skirmisher's spam weapon should not have been a
    // debuff applicator, and an exclusion zone is where a bleed belongs.
    //
    // The `self` entry is the roster's only one, and it is what makes the weapon a stand-and-hold
    // rather than a place-and-run: the buff arrives whether or not the zone ever catches anybody.
    // 4500 ms is 4000 + the 15% the zone's own life gained, so the buff still outlasts the deploy.
    applies: [
      { statusId: "spiked", target: "opponents", durationMs: 3000 },
      { statusId: "fortified", target: "self", durationMs: 4500 },
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
