import { TICK_RATE_HZ } from "../constants.js";
import type { BeamWeaponDef, WeaponDef, WeaponId } from "./weapon-types.js";

/**
 * Every weapon in the game, mirroring `CAR_TABLE`. Balance lives here and nowhere else.
 *
 * `color` is the one render-only number here besides `name`. It is per weapon on purpose: every
 * car firing a given weapon fires the same shot colour. All nine shipped colours are picked to be
 * unmistakable against any `COLOR_TABLE` player colour, so a shot never reads as somebody's car
 * paint.
 *
 * `damage` is what the weapon deals from a chassis at `COMBAT_CONFIG.attackBaseline` — an *average*
 * car, not every car. `damageFor` (`sim/damage.ts`) moves it +/-50% with the firing chassis's
 * `attack` rating.
 *
 * This is the nine-row roster from the 2026-09-01 weapon-status overhaul (O1-O17): `fireball`,
 * `needler`, `skewer` and `bulwark` are retired outright, their comment history living in git
 * rather than here. See
 * `docs/superpowers/specs/2026-08-29-weapon-roster-design.md` for the original roster rules and
 * `docs/superpowers/specs/2026-08-30-chassis-rename-and-weapon-redistribution-design.md` for the
 * type triangle these numbers now serve.
 */
export const WEAPON_TABLE = {
  /**
   * Bullseye's slot 1 as of the 2026-09-02 loadout swap (it was Mirage's before): the proximity
   * seeker. It leaves the muzzle as an ordinary fast dart aimed by the lock, carries no target, and
   * grabs the first eligible car to come within 200 u of ITSELF — then chases that one until it hits
   * something or its 2 s clock runs out.
   *
   * It has no range in any sense a player experiences: `range` is authored as `speed x lifetime`
   * (900 x 2 s) purely because `WEAPON_TICKS.flight`, the guide's reach figure and the
   * `range >= aimRangeUnits` validator all read it. At 1800 the flight count is exactly the
   * lifetime, so the two clocks cannot disagree. That clears arena-01's 1469 u diagonal; it would
   * not clear arena-02's, so "no range" is a statement about the shipped arena, not the engine.
   *
   * `turnRateDegPerSec: 300` is the counterplay dial. Turn radius is `speed / turnRate`, so at
   * 900 u/s this arcs at 172 u — tight enough to convert a 200 u grab. The old 120 deg/s would arc
   * at 430 u and sail past everything it acquired. ⚙
   *
   * 1.0 Hz sits 20% clear of the 1.25 Hz aim cliff — it passes the guard's 15% floor, but it is the
   * tightest margin in the table, and this is the fastest aim-assisted row the roster carries. Do
   * not retune this cooldown toward 800 ms without re-reading that guard.
   *
   * Its 2 s life on a 1000 ms cooldown means up to two in the air at once — which is why the
   * two-instances guard is scoped to bouncing rows.
   */
  predator: {
    id: "predator",
    kind: "projectile",
    name: "Predator",
    // The icon's missile body, not its flame: `WEAPON_PROJECTILE_STYLES` fills the capsule hull
    // with this and lays the icon's red nose stripe across the middle as a band.
    color: "#606060",
    unlocksAt: 1,
    damage: 30,
    damageFrequencyMs: 0,
    speed: 900,
    range: 1800, // = speed x lifetimeMs; see the comment above for why this is authored at all
    startUpMs: 0,
    cooldownMs: 1000,
    recoveryMs: 0,
    usesAimAssist: true,
    aimRangeUnits: 800,
    // 38 units long, of which the rear 10 are the exhaust plume the client draws (2026-09-04).
    // Grown from 14 deliberately and as a BUFF, not a wash: the plume was drawn first as art
    // trailing behind a 28-unit hitbox, which would have made the shot's most legible feature the
    // one part of it that could not hurt anyone. Lengthening the hitbox to contain it keeps D19
    // intact — what you see is still exactly what hits you — at the cost of +36% hit length on a
    // homing, aim-assisted projectile. Nothing was trimmed to pay for it; measure it with
    // `npm run balance` rather than pre-compensating. The art is authored against these two numbers
    // (`predatorMissileLayers` in the client's `combat-visual.ts`) and scales with them.
    hitbox: { shape: "capsule", radiusAlong: 19, radiusAcross: 6 },
    pierce: 0,
    lifetimeMs: 2000,
    homing: { acquire: "proximity", acquireRadius: 200, turnRateDegPerSec: 300, durationMs: 2000 },
    volley: { volleys: 1, volleyIntervalMs: 0 },
    pellets: { pelletsPerVolley: 1, spreadAngleDeg: 0 },
  },
  /**
   * Mirage's slot 2: the dash (O12/O13). `speed` is the dash speed and `aimRangeUnits` the dash
   * distance — 400 units in ~8 ticks, snapped toward the lock when one is held. First enemy hull
   * contact deals `damage` + 1 s stun and ends the dash; a wall ends it cold. The car's own hull
   * is the hit volume; no instance spawns. 0.2 Hz, 84% clear of the aim cliff.
   */
  thunderclap: {
    id: "thunderclap",
    kind: "maneuver",
    name: "Thunderclap",
    // Its icon's electric blue. A maneuver spawns no instance, so nothing in the world is filled
    // with this — the dash's ghost outlines are stroked in the CAR's own paint on purpose. It
    // reaches the HUD slot and the players' guide, and nowhere else.
    color: "#3ED1FA",
    unlocksAt: 1,
    damage: 90,
    damageFrequencyMs: 0,
    speed: 1600, // ⚙ dash speed
    range: 400, // = the dash distance, for the guide's reach figure
    startUpMs: 0,
    cooldownMs: 5000, // ⚙
    recoveryMs: 200,
    usesAimAssist: true,
    aimRangeUnits: 400,
    maneuver: { type: "dash" },
    volley: { volleys: 1, volleyIntervalMs: 0 },
    applies: [{ statusId: "stunned", target: "opponents", durationMs: 1000 }],
  },
  /**
   * Mirage's slot 3, and the FIRST BEAM THE GAME HAS EVER SHIPPED. Several paths in
   * `instances.ts` and `instanceDrawShape` run in live play for the first time because of this row.
   *
   * `attached: true` welds its origin and angle to the car every tick, so it sweeps as the driver
   * steers and dies the instant its owner is wrecked. Total life is `range / speed + lifetimeMs`
   * == 2.2 s; at a 500 ms damage interval that is 5 pulses, 245 base damage, about a third of an
   * average car — but only against a target held in the cone for the full duration. The pulses were
   * 11 × 26 every 200 ms until the 2026-09-01 balance pass chunked them: same-ish press total,
   * but escaping between pulses is now worth something and grazing the cone costs real HP.
   *
   * `usesAimAssist: false` is FORCED twice over: the attached-beam guard (it re-derives its angle
   * from the owner every tick, so a lock would have nothing to decide) and the multi-muzzle guard
   * (`muzzles.length > 1` forces assist off, same as `pepperbox`). Do not "fix" this to true.
   *
   * `recoveryMs: 200` is deliberately small (L5). The beam lives on its own once spawned, so the
   * driver stays free to keep firing `afterburner` into a target that is already burning.
   *
   * `muzzles: [0, 180]` fires two mirrored cones off the car's nose and tail every press, each its
   * own instance with its own damage clock. The per-cone numbers above are unchanged; the per-press
   * ceiling only doubles against a target somehow held inside both cones at once.
   */
  afterburner: {
    id: "afterburner",
    kind: "beam",
    name: "Afterburner",
    // The MIDDLE of the three flame colours sampled from its icon (#FF6000 edge, this, #FFC000
    // core), because a weapon's table colour is its body and on a flame the body is one layer in.
    // Clear of `COLOR_TABLE` -- the `Gold` player colour is the only one it sits near.
    color: "#FF9000",
    unlocksAt: 1,
    damage: 49, // per pulse
    damageFrequencyMs: 500,
    speed: 1100, // extends its 220 range in 200ms
    range: 220,
    startUpMs: 0,
    cooldownMs: 13000,
    recoveryMs: 200,
    usesAimAssist: false,
    muzzles: [0, 180],
    hitbox: { shape: "cone", angleDeg: 55 },
    volley: { volleys: 1, volleyIntervalMs: 0 },
    attached: true,
    origin: "muzzle",
    lifetimeMs: 2000,
    // A flamethrower that cooks the car it is pointed at. `refresh` on `overheated` is what makes a
    // ticking source work: each 500 ms pulse tops the clock back up, so the debuff holds for as long
    // as the target stays in the flame and lapses 1.5 s after they break away.
    applies: [{ statusId: "overheated", target: "opponents", durationMs: 1500 }],
  },
  /**
   * Mirage's slot 1 as of the 2026-09-02 loadout swap (it was Bullseye's before): the explosive
   * shell. It flies as an ordinary aimed dart and detonates on ANY death — a car, a wall, the arena
   * edge, or its own 900 u range — leaving a 60 u corroding field for 150 ms.
   *
   * A direct hit costs contact AND splash, 65 base plus the corrode: the burst is born at full
   * extent on the tick the shell dies, so the car that stopped it is standing inside it. Excluding
   * the victim would have made a perfect shot the one way to not apply your own weapon's effect.
   *
   * The field passes through level geometry, and that is not a special case: a `disc` has no axis
   * for the wall raycast to follow, so it never had a clip to skip. A car hugging the far side of
   * a wall within 60 u takes the splash.
   *
   * 0.625 Hz sits 50% clear of the 1.25 Hz aim cliff, comfortably outside the guard's 15% floor.
   * `predator` carries the table's tightest margin now, not this row.
   */
  magmablast: {
    id: "magmablast",
    kind: "projectile",
    name: "Magma Blast",
    // The fireball icon's body. `WEAPON_GLOW_STYLES` rings it with the icon's own radial ramp:
    // #C02000 at the hitbox edge, this, then #FFA800 at the core.
    color: "#FF6000",
    unlocksAt: 1,
    damage: 50,
    damageFrequencyMs: 0,
    speed: 600,
    range: 900, // >= aimRangeUnits, required for usesAimAssist
    startUpMs: 0,
    cooldownMs: 1600,
    recoveryMs: 0,
    usesAimAssist: true,
    aimRangeUnits: 400,
    hitbox: { shape: "circle", radius: 12 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0 },
    pellets: { pelletsPerVolley: 1, spreadAngleDeg: 0 },
    explosion: {
      radius: 60,
      damage: 15,
      lingerMs: 150,
      applies: [{ statusId: "corroded", target: "opponents", durationMs: 2000 }],
    },
  },
  /**
   * Bullseye's slot 2, moved off Mirage by T12, and a four-muzzle spray as of the 2026-09-01
   * overhaul (O9): the same one-volley, three-pellet, 12-degree fan fires from all four muzzles at
   * once, so one press throws 12 darts across 4 fans rather than one. Per-target reality is
   * unchanged — the four muzzles are 90 degrees apart, so at most one fan lines up with any single
   * target, and that fan is still the same 135 damage a press has always landed.
   *
   * **It used to be three sequential volleys of two, 100 ms apart, and that skill expression is
   * gone.** Each volley exited from the car's pose at ITS tick, so driving straight clustered the
   * six pellets and turning through the burst sprayed them across an arc — steering *was* the aim.
   * A single volley cannot express that: the fan is decided entirely at the press, and the driver's
   * only input is where the nose points on that one tick. That is the cost of the shape T12 asked
   * for, paid knowingly.
   *
   * 3 x 45 == 135 per press against the old 168, and `135 * 1000 / 1800` == 75 sustained DPS,
   * deliberately level with the old `needler`'s 73 — needler is retired now, but the number this
   * row was tuned against is worth keeping on the record.
   *
   * `usesAimAssist: false` is FORCED by the multi-muzzle guard (O9): a lock cannot steer a spray
   * firing in four directions at once, so `aimRangeUnits` is deleted along with it.
   */
  pepperbox: {
    id: "pepperbox",
    kind: "projectile",
    name: "Pepperbox",
    color: "#C04818", // the revolver icon's rust barrel
    unlocksAt: 1,
    damage: 45, // per pellet; 3 pellets per fan == 135, 27% of an average car
    damageFrequencyMs: 0,
    speed: 800,
    range: 600,
    startUpMs: 0, // a drive-by must be instant
    cooldownMs: 1800,
    recoveryMs: 200,
    usesAimAssist: false,
    muzzles: [0, 90, 180, 270],
    // needler's dart silhouette, carried over now that needler is retired: long and thin along its
    // own flight, distinct from every circular hitbox in the table.
    hitbox: { shape: "ellipse", radiusAlong: 9, radiusAcross: 3 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0 },
    pellets: { pelletsPerVolley: 3, spreadAngleDeg: 12 },
  },
  /**
   * Bullseye's slot 3, and the table's first DETACHED beam becomes its first HELD one as of the
   * 2026-09-01 overhaul (O10): `attached: true` plus `holdsDuringFire: true` welds the beam's
   * origin and angle to the car every tick while the HOLD maneuver keeps the car itself still, so
   * the player sweeps the beam by steering rather than by aiming a single stamped angle.
   *
   * The 700 ms wind-up leaves a 300 HP chassis standing still and visible, and `recoveryMs: 1000`
   * means a miss also costs a second of silence. Now the hold itself adds to that budget: windup
   * 700 + growth 200 (1200 range at 6000 u/s) + `lifetimeMs: 1500` of held linger is about 2.4 s
   * committed end to end — the roster's biggest single-press risk, still paid up front and
   * afterward and now also during (L5).
   *
   * T13 made it 15% wider (20 -> 23) and handed it the lock, and trimmed 180 -> 170 to pay for both
   * arriving at once on the game's hardest single press. The render side moves with the hitbox: the
   * charge orb's `maxRadius` in `combat-visual.ts` goes 18 -> 21, the same 15%, so the telegraph
   * keeps matching what it warns about.
   *
   * **The T13 aim-assist argument is superseded (O10).** It held while the beam stamped once at a
   * fixed pose; now it sweeps live under the driver's own steering while the car is held, which is
   * a strictly stronger form of aim than a lock ever offered. `usesAimAssist: false`, and
   * `aimRangeUnits` is deleted with it.
   *
   * **It TICKS now, and the 170-in-one-touch reading above is history.** `damageFrequencyMs: 500`
   * is `afterburner`'s cadence exactly, deliberately: the two ticking beams pulse on the same clock
   * so a player learns one rhythm rather than two. 43 x 4 == 172 replaces the old single 170, so a
   * target held for the whole sweep pays what it always did, while a car that clips the edge for
   * one tick now pays 43 instead of the lot.
   *
   * The pulse count is RANGE-DEPENDENT, and that is a consequence of the cadence rather than an
   * oversight. `resolveInstanceHits` arms a target's clock on the tick it is first covered, and the
   * beam grows over 6 ticks, so a car standing at the muzzle is hit at relative tick 0 and takes
   * 4 pulses (0/15/30/45, inside the 51-tick life), while one at the 1200-unit tip is not touched
   * until tick 6 and its 4th pulse would land at 51 — one tick past expiry. Full connect is 172 up
   * close and 129 at maximum reach. A single tick more of `lifetimeMs` (1500 -> 1533) would make it
   * 4 everywhere; not taken, because 2.4 s committed is already the roster's biggest press.
   */
  lance: {
    id: "lance",
    kind: "beam",
    name: "Lance",
    // Its icon's electric yellow -- the beam's CORE, not its #3ED1FA outer edge, which is the one
    // place this table breaks its own "the table colour is the outer layer of a beam" habit. The
    // outer layer would be the natural pick, but `thunderclap` already holds that exact hex and
    // `weapon-config.test.ts` requires every weapon's colour to be unique. The core is the other
    // colour the beam actually draws, so the HUD slot still names something on screen.
    color: "#F0FF00",
    unlocksAt: 1,
    damage: 43, // per pulse; 4 x 43 == 172 on a full close-range connect, 3 x 43 == 129 at the tip
    damageFrequencyMs: 500, // afterburner's cadence, so both ticking beams pulse on one clock
    speed: 6000, // crosses its full 1200 range in 200ms — a flash, not a sweep
    range: 1200,
    startUpMs: 700,
    cooldownMs: 16000, // 0.06 Hz
    recoveryMs: 1000,
    usesAimAssist: false,
    hitbox: { shape: "rect", width: 57.5 }, // 2.5x wider; the charge orb deliberately does NOT track it
    volley: { volleys: 1, volleyIntervalMs: 0 },
    attached: true,
    origin: "muzzle",
    lifetimeMs: 1500,
    holdsDuringFire: true,
  },
  /**
   * Bastion's slot 1, and after T16 the roster's CC engager, though as of the 2026-09-01 overhaul
   * the CC itself has moved on. A fat, slow slug: at 48 x 30 it is still the largest hitbox in the
   * table and near-unmissable in a brawl, while 450 u/s over its 1305-unit bounce reach means a
   * genuinely dodgeable shot at range. It buys pressure, not a ranged win — but Bastion is 99 u/s
   * slower than Bullseye and 261 slower than Mirage, so without one weapon that reaches at all, the
   * slowest chassis has no answer to a patient opponent.
   *
   * **The stun's whole history paragraph is superseded (O16).** Hard CC now enters Bastion's kit
   * through `roadblock`, not this row — Type 3's identity no longer rests on thumper holding a lock.
   * Thumper is the bouncing pressure shot that spikes instead: `spiked` (0.6 topSpeed, no bleed) for
   * 3 s, a slow that keeps a target inside the fight rather than a stop that takes the fight away.
   *
   * `damage` drops 75 -> 60 to pay for it: 55 on Bastion's 0.92x attack, a shot that opens a fight
   * rather than one that wins an exchange on its own.
   *
   * `bounces: true` with `lifetimeMs: 2900` — the shot expires on a wall-bouncing flight clock rather
   * than at `range`, guarded strictly under the 3000 ms cooldown so two bouncing instances can never
   * coexist. `range: 1305` is `450 u/s x 2.9 s`, the honest reach figure now that expiry is
   * clock-based and `range` is otherwise unread by a bouncing shot. Read plainly, that makes 1305
   * the largest `range` value in the whole roster — bigger than `lance`'s straight 1200 — even
   * though it is a bounced total-path length, not a poke Bastion can threaten with;
   * `weapon-config.test.ts`'s straight-line-reach guard excludes it for exactly that reason, and
   * whether a bouncing 1305 should out-rank a straight 1200 in play is an open balance question,
   * not settled here.
   *
   * The cooldown is still CONSTRAINED at the low end. The aim-assist cliff guard rejects any assisted
   * weapon whose `1000 / cooldownMs` is within 15% of `1000 / AIM_CONFIG.lockTimeoutMs`, which
   * forbids every value between 696 and 941. This row was first drafted at 900 and would have failed
   * the suite. Do not "round it down" to 900 without re-reading that guard.
   */
  thumper: {
    id: "thumper",
    kind: "projectile",
    name: "Thumper",
    color: "#FFD800", // the icon's gold shell
    unlocksAt: 1,
    damage: 60,
    damageFrequencyMs: 0,
    speed: 450,
    range: 1305, // 450 u/s x 2.9 s — the honest reach figure now that expiry is clock-based
    startUpMs: 0,
    cooldownMs: 3000, // 0.33 Hz, 73% clear of the 1.25 Hz cliff
    recoveryMs: 0,
    usesAimAssist: true,
    aimRangeUnits: 400,
    hitbox: { shape: "capsule", radiusAlong: 24, radiusAcross: 15 },
    pierce: 0,
    bounces: true,
    lifetimeMs: 2900, // just under the 3000ms cooldown — a second bouncing instance can never coexist
    volley: { volleys: 1, volleyIntervalMs: 0 },
    pellets: { pelletsPerVolley: 1, spreadAngleDeg: 0 },
    applies: [{ statusId: "spiked", target: "opponents", durationMs: 3000 }],
  },
  /**
   * Bastion's slot 2: a wall that stops what it touches (O15). The bar is 120 wide by 12 thick,
   * travels along its short axis, pierces everything, and stuns each car it crosses for 1 s. Aim
   * assist is deliberately OFF: a 120-unit face aims itself, and skewer's old "help the slowest
   * chassis" argument is answered by width here. ⚙ speed/range/cooldown are first-pass.
   *
   * `pierce: 4` reaches all five possible opponents: pierce counts cars after the first, so the
   * first hit is free and each further hit spends one — `pierce: 5` would have reached SIX cars,
   * which cannot exist in a six-player game once the shooter is excluded. Corrected from an
   * authoring off-by-one (the original "5 = max players minus the shooter" comment counted total
   * hits, not the pierce budget past the first).
   */
  roadblock: {
    id: "roadblock",
    kind: "projectile",
    name: "Roadblock",
    color: "#D89000", // the barrier icon's construction gold
    unlocksAt: 1,
    damage: 100,
    damageFrequencyMs: 0,
    speed: 600,
    range: 500,
    startUpMs: 0,
    cooldownMs: 6000,
    recoveryMs: 200,
    usesAimAssist: false,
    hitbox: { shape: "bar", radiusAlong: 6, radiusAcross: 60 },
    pierce: 4,
    // The wall stops for nothing: cars are pierced (above) and level geometry too — the bar's 60u
    // wingtips otherwise killed it in `hitsWorld` the tick it spawned whenever Bastion fired
    // within a wingtip of a wall, reading as a dud press that still spent the 6 s cooldown. Range
    // alone ends it, and a camper's cover is no cover from it.
    piercesWalls: true,
    volley: { volleys: 1, volleyIntervalMs: 0 },
    pellets: { pelletsPerVolley: 1, spreadAngleDeg: 0 },
    applies: [{ statusId: "stunned", target: "opponents", durationMs: 1000 }],
  },
  /**
   * Bastion's slot 3: the one-hit ultimate (O2). One press opens a 10 s window: Fortified rides
   * it (self, 10 s — ended early WITH the window), the car wears the charge outline, and the
   * first enemy hull contact hard-slams for a fixed impulse plus 250 damage (230 on Bastion's
   * 0.92x), ending the window. `isUnInterruptable` (O8): a stun stops the car dead but the state
   * holds — the roster's only exemption. `slamsStunned` (O3): the one slam that lands on a
   * stunned victim, safe because it cannot chain. `speed`/`range` are 0: a charge dashes nowhere.
   */
  wildcharge: {
    id: "wildcharge",
    kind: "maneuver",
    name: "Wild Charge",
    // The bull icon's orange. Drawn in the world too, despite this weapon spawning no instance:
    // `maneuverOutline` strokes the charging car's hull footprint with this exact hex.
    color: "#F06000",
    unlocksAt: 1,
    damage: 250,
    damageFrequencyMs: 0,
    speed: 0,
    range: 0,
    startUpMs: 0,
    cooldownMs: 20000, // ⚙ must exceed the 10 s window (guarded)
    recoveryMs: 200,
    usesAimAssist: false,
    isUnInterruptable: true,
    maneuver: { type: "charge", durationMs: 10000, slamsStunned: true },
    volley: { volleys: 1, volleyIntervalMs: 0 },
    applies: [{ statusId: "fortified", target: "self", durationMs: 10000 }],
  },
  /**
   * The retired `bulwark`'s silhouette reborn as a presence zone, CARRIED BY NO CHASSIS — the
   * table's one deliberately unassigned row, waiting on a loadout decision. Inert but legal:
   * nothing can press it until a `CAR_TABLE` kit lists it (and the players' guide only shows
   * carried weapons, so it is invisible to players until then).
   *
   * Geometry and cadence are bulwark's exactly (60° detached cone, 492/492 so the zone grows out
   * over one full second, 2.875 s linger, 15 s cooldown). The damage is re-solved for a round
   * total: total life is `msToTicks(1000) + msToTicks(2875)` == 30 + 87 == 117 ticks against a
   * 12-tick interval, and `resolveInstanceHits` damages on the first covered tick before arming
   * the clock, so the count is `floor(116 / 12) + 1` == 10 ticks — **25 × 10 == 250 base on a
   * full connect**, the authored design figure.
   *
   * Both riders are PRESENCE effects — on while you are in the zone, gone moments after you leave:
   *
   * - `spiked` on opponents rides the 400 ms damage tick with a 600 ms duration, so `refresh`
   *   holds it exactly while a target stands in the zone and it lapses ≤0.6 s after they break
   *   out — the `afterburner`/`overheated` pattern.
   * - `fortified` via `ownerInside`: `runCombat` re-applies it every tick the OWNER's hull stands
   *   inside the live zone (300 ms duration, ~0.3 s lapse after stepping out). The owner is not
   *   automatically inside — the cone grows from the nose, so holding the buff means driving into
   *   your own zone and staying, which is the stand-and-hold identity the old bulwark only gestured
   *   at.
   */
  tremor: {
    id: "tremor",
    kind: "beam",
    name: "Tremor",
    // Dark bronze, and the one weapon colour NOT taken from an icon: `tremor` has no manifest row
    // yet, so there is nothing to sample. Unique among weapons, clear of COLOR_TABLE, dark enough
    // for a light floor. Re-derive it from the art whenever an icon lands.
    color: "#8A6D12",
    unlocksAt: 1,
    damage: 25, // per tick; 10 ticks == 250 base on a target that stays the whole life
    damageFrequencyMs: 400,
    speed: 492, // grows out over a full second — visible before it is dangerous (bulwark's rule)
    range: 492,
    startUpMs: 0,
    cooldownMs: 15000,
    recoveryMs: 200,
    usesAimAssist: false, // a zone is aimed at ground; a lock would drag it onto the one thing that can leave
    hitbox: { shape: "cone", angleDeg: 60 },
    volley: { volleys: 1, volleyIntervalMs: 0 },
    attached: false,
    origin: "muzzle",
    lifetimeMs: 2875,
    applies: [
      { statusId: "spiked", target: "opponents", durationMs: 600 },
      { statusId: "fortified", target: "ownerInside", durationMs: 300 },
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

/**
 * The def that describes one LIVE instance — which is not always its weapon's own row.
 *
 * A weapon's explosion is spawned as an instance carrying its parent's `weaponId`, so a plain
 * `weaponDefOf` lookup would describe the shell when the thing in the world is the burst: a
 * 12-unit dart where a 60-unit disc belongs, and — worse — a `def.explosion` that is still
 * populated, so the burst's own expiry would spawn another burst, every tick, forever (P25a).
 *
 * Routing every instance-side lookup through here makes that unrepresentable rather than merely
 * unlikely: what comes back for a burst is a `BeamWeaponDef`, and a `BeamWeaponDef` has no
 * `explosion` field for the recursion to read.
 */
export function instanceDefOf(id: WeaponId, isExplosion: boolean): WeaponDef {
  if (!isExplosion) return WEAPON_TABLE[id];
  const burst = ACTIVE_BURST_DEFS[id];
  if (!burst) throw new Error(`instanceDefOf: ${id} authors no explosion`);
  return burst;
}

/**
 * Synthesized once at module load, not per call, so the returned def is referentially stable and
 * free — the same reasoning as `WEAPON_TICKS`.
 *
 * The fields a `WeaponDef` requires but an explosion has no opinion about are fixed here rather
 * than left to the author. `id` and `color` are the PARENT's: the burst is Magma Blast in every
 * lookup keyed by weapon, and only its shape and stats differ. The fire-control clocks are inert —
 * a burst is spawned, never fired — and take the parent's values rather than zeroes, so a future
 * reader who does reach for one finds a coherent number instead of a trap.
 *
 * Built with an explicit loop rather than a `filter`/`fromEntries` chain: `WEAPON_TABLE` is typed
 * `as const satisfies Record<WeaponId, WeaponDef>`, so indexing it with a bare `WeaponId` yields a
 * union of the individual rows' literal types rather than the plain `WeaponDef` interface union,
 * and a `.filter` callback's narrowing does not carry into a later `.map` over the same array. Going
 * through `weaponDefOf` first (declared to return `WeaponDef`) sidesteps that: ordinary discriminated
 * narrowing on `.kind` and `.explosion` then works exactly as it does everywhere else in this file.
 */
const BURST_DEFS: Partial<Record<WeaponId, BeamWeaponDef>> = buildBurstDefs();

/** `BURST_DEFS` itself until playground tuning overrides a weapon row, and again once it clears. */
let ACTIVE_BURST_DEFS: Partial<Record<WeaponId, BeamWeaponDef>> = BURST_DEFS;

/**
 * Playground tuning only (spec PG12) — see `rebuildResolvedDrive`/`rebuildWeaponTicks` for why
 * `hasOverrides` is passed in rather than read back from the tuning store. Without this,
 * `weapon.magmablast.explosion.radius`/`.damage` sliders would move `WEAPON_TABLE` and change
 * nothing: `BURST_DEFS` copies those numbers out at module load and is otherwise never revisited.
 */
export function rebuildBurstDefs(hasOverrides: boolean): void {
  ACTIVE_BURST_DEFS = hasOverrides ? buildBurstDefs() : BURST_DEFS;
}

function buildBurstDefs(): Partial<Record<WeaponId, BeamWeaponDef>> {
  const bursts: Partial<Record<WeaponId, BeamWeaponDef>> = {};
  for (const id of Object.keys(WEAPON_TABLE) as WeaponId[]) {
    const parent = weaponDefOf(id);
    if (parent.kind !== "projectile" || !parent.explosion) continue;
    const blast = parent.explosion;
    const burst: BeamWeaponDef = {
      id: parent.id,
      kind: "beam",
      name: parent.name,
      color: parent.color,
      unlocksAt: parent.unlocksAt,
      damage: blast.damage,
      // Once per car, ever. See ExplosionDef for why there is no knob.
      damageFrequencyMs: 0,
      // Derived so `WEAPON_TICKS.flight` is exactly one tick (P25b): a beam expires at
      // `flight + lifetime`, so a small speed here would give a burst that outlives the match.
      // Growth itself is irrelevant — the instance is spawned at full extent.
      speed: blast.radius * TICK_RATE_HZ,
      range: blast.radius,
      startUpMs: parent.startUpMs,
      cooldownMs: parent.cooldownMs,
      recoveryMs: parent.recoveryMs,
      usesAimAssist: false,
      hitbox: { shape: "disc" },
      attached: false,
      origin: "center",
      lifetimeMs: blast.lingerMs,
      volley: { volleys: 1, volleyIntervalMs: 0 },
      ...(blast.applies ? { applies: blast.applies } : {}),
    };
    bursts[id] = Object.freeze(burst);
  }
  return Object.freeze(bursts);
}
