# Chassis rename, restat, and weapon redistribution

**Date:** 2026-08-30
**Status:** implemented; four figures corrected in review — see below
**Supersedes in part:** the roster halves of
[`2026-08-29-weapon-roster-design.md`](2026-08-29-weapon-roster-design.md) (L1–L7). The rules there
still hold; the assignments do not.

Decisions in this document are numbered **T1–T22** ("the type reimagining"), continuing the repo's
convention of one letter series per design (D = weapon system, A = aim assist, L = roster,
R = ram CC).

> ### Corrections found in review (2026-08-30)
>
> This document is a record of decisions, so the three figures below are **struck rather than
> silently overwritten** — the fact that they were caught after the code shipped is itself part of
> the record. **The shipped sim is authoritative in every case; the decisions themselves stand.**
>
> Two of the three share one root cause: **the sim scales damage per tick and per wave, never once
> over a total.** `damageFor` runs on each hit as it lands and rounds there, so a total computed at
> the baseline and multiplied by the chassis's attack scale afterwards is a different number from
> the one a player takes.
>
> | Where | The spec said | The code does | Note |
> |---|---|---|---|
> | [T18](#t18--bulwark) | bulwark deals **322** on Bastion | **320** | `damageFor(42, 35)` = 32 per tick × 10 ticks. The spec scaled the 350 total once. |
> | [T15](#t15--shockwave) | shockwave deals **152** on Mirage | **153** | `damageFor(63, 45)` = 51 per wave × 3. Same root cause, rounding the other way. |
> | [T11](#t11--needler-was-splinter) | dumping needler's stocks "owes a 900 ms dry spell" | **a 133 ms pause**, and the same 73 DPS | Not a rounding slip: the mechanism never worked that way. See T11. |
> | [T16](#t16--thumper) | thumper's `stunned` ships at **900 ms**, "the roster's longest CC," and `reapply: "ignore"` means "it still cannot be chained" | **450 ms** | 900 ms against this row's own 1000 ms cooldown is a **90% duty cycle** — a Bastion can hold a car stunned and disarmed almost permanently. `ignore` blocks re-*extension*, not re-*application*; it never bounded the duty cycle. This one is a real balance defect, not a rounding slip — see T16. |
>
> None of these changed a balance value, except T16, which did: thumper's `stunned` duration moved
> 900 ms → 450 ms as part of this correction. Whether `needler` *should* charge for a dump is an open
> design question left to the user (T11).

---

## Why

The three chassis shipped as shapes — `rectangle`, `oval`, `hexagon` — with ratings that read as a
spread rather than as three answers to a question. This design gives each one a **role**, a name that
states it, and a kit and stat line built to serve it, and then wires the three roles into an explicit
rock-paper-scissors with named counterplay on every edge.

It also closes two gaps the roster could not express before: cars could not differ in how they
**corner** or how they **launch**, because turn rate and acceleration were single global constants.

---

## The three types

No car is a preset archetype in the fiction; the types are a design tool for keeping the roster
legible.

| Type | Chassis | Identity |
|---|---|---|
| **1** | **Bullseye** | Moderate damage, long range. Sustained pressure from outside the fight. |
| **2** | **Mirage** | Burst damage, high mobility. Picks a moment, closes, finishes. |
| **3** | **Bastion** | Crowd control. Slower, tankier, turns on a coin. |

### T1 — the weakness chart, and the counterplay on every edge

Rock-paper-scissors, but **no type is helpless against its counter**. Each edge names both the
advantage and the way out.

| Edge | Why it holds | Counterplay for the loser |
|---|---|---|
| **3 beats 2** | Mirage's whole kit is short range, so it must enter Bastion's. It cannot out-damage or out-turn Bastion there, and its low HP and low CC-resistance make Bastion's stuns decisive. | In-and-out to bait Bastion's committed abilities (bulwark, skewer), then strike in the gap. |
| **2 beats 1** | Mirage dodges Bullseye's shots and closes the gap fast, and Bullseye's 300 HP hull dies quickly once reached. | Kite. Bullseye's reach and speed advantage over Bastion do not apply here, so it must use range and terrain to deny the approach. |
| **1 beats 3** | Bullseye outranges every weapon Bastion carries, and Bastion cannot catch it. | Land a CC skillshot (thumper's stun), then close and finish inside the window. |

**Bait-ability is deliberately asymmetric.** Bastion's baitable presses are `bulwark` (15 s) and
`skewer` (2.4 s). `thumper` at 1 s is *not* baitable — Mirage must dodge it rather than drain it.
That is what stops "in and out" from being a free solution to Type 3.

---

## Names, ids, and art

### T2 — the three renames

| Was | Becomes | Art file |
|---|---|---|
| `rectangle` / "Rectangle" | `mirage` / **"Mirage"** | `cars/rectangle.png` → `cars/mirage.png` |
| `oval` / "Oval" | `bullseye` / **"Bullseye"** | `cars/oval.png` → `cars/bullseye.png` |
| `hexagon` / "Hexagon" | `bastion` / **"Bastion"** | `cars/hexagon.png` → `cars/bastion.png` |

The `CarId` union, the `CAR_TABLE` keys, `DEFAULT_CAR_ID`, the manifest keys `car.<id>`, and the
file names all move together. **The art itself is unchanged** — each chassis keeps the sprite it has
today, under a new name.

The procedural fallback shapes in `car-visual.ts` keep their geometry as well: Mirage still falls
back to a rect, Bullseye to an ellipse, Bastion to a hex. The shape is no longer *what the car is*,
so the mapping is now a rendering detail rather than an identity, and its comment should say so.

`DEFAULT_CAR_ID` stays on the chassis that was `rectangle` — now `mirage`. This is a rename, not a
change of default: server tick and client prediction must agree on it, and moving it is a separate
decision nobody has asked for.

### T3 — one weapon rename

`splinter` → `needler`, `"Splinter"` → `"Needler"`, and `weapon-icons/splinter.png` →
`weapon-icons/needler.png` with its manifest key.

**The icon art is unchanged.** A splinter and a needle read closely enough that re-importing is a
judgement call for a person looking at the HUD, not something this change should force. Its colour
(`#0CA5B0`) is also unchanged, so no icon/`WEAPON_TABLE.color` drift is introduced.

---

## Chassis ratings

### T4 — two new ratings: `handling` and `accel`

`CarDef` gains two fields, both 0–100 with 50 as average, matching the four already there:

- **`handling`** — how fast the chassis rotates. Drives `turnRate` and `turnRateAtStop`.
- **`accel`** — how hard the engine pushes. Drives `accel` and `reverseAccel`.

`accel` is a **rating of its own rather than a function of `speed`**, deliberately. Deriving it from
`speed` would reproduce this roster exactly — the three cars' accel ordering and speed ordering are
the same ordering — but it would make "fastest top speed, worst launch" and "slow but twitchy"
structurally impossible for any future chassis. The 150-point budget that used to police rating
combinations was deleted on 2026-08-29 and not replaced, so roster fairness is already a review-time
judgement; a sixth free axis does not change that standing.

`handling` cannot be derived from anything. Bullseye is medium-speed with the **lowest** turn rate
and Bastion is the slowest with the **highest**, so no existing rating correlates with it in either
direction.

### T5 — the ratings

| | `speed` | `accel` | `handling` | `attack` | `hp` | `mass` |
|---|---|---|---|---|---|---|
| **Bullseye** | 52 | 45 | 28 | 55 | 30 | 30 |
| **Mirage** | 88 | 85 | 50 | 63 | 48 | 48 |
| **Bastion** | 30 | 20 | 82 | 42 | 82 | 90 |

These are first-pass and meant to be re-tuned from play.

### T6 — what they derive to

| | top speed | accel | turn rate | **turn radius** | time to top | hull HP | damage | ram mass |
|---|---|---|---|---|---|---|---|---|
| **Bullseye** | 414 u/s | 744 | 3.41 | 121 u | 0.56 s | 300 | 1.05× | 300 |
| **Mirage** | 576 u/s | 1032 | 4.20 | 137 u | 0.56 s | 480 | 1.13× | 480 |
| **Bastion** | 315 u/s | 564 | 5.35 | **59 u** | 0.56 s | 820 | 0.92× | 900 |

**Turn rate is not turn radius, and the difference is the design.** Radius is `speed / turnRate`, so
Bullseye has the lowest turn rate but *not* the widest arc — Mirage's is wider, because Mirage is far
faster. Both readings are wanted:

- Bullseye **reorients slowly**, which is what makes holding a diving Mirage inside its aim cone a
  real skill test rather than a formality.
- Mirage **arcs wide**, which is what stops it safely orbiting a Bastion at speed.
- Bastion turns inside 59 units — the best tracker in the game. That is how the slowest chassis
  punishes a diver, and it is the mechanical reason "3 beats 2" holds.

Time to top speed lands at 0.56 s for all three. That is a consequence of the ratings, not a
constraint: the roster's accel ordering happens to track its speed ordering, so every car takes about
as long to wind up while Mirage gains speed nearly twice as fast in absolute terms.

### T7 — the scales, anchored at rating 50

New knobs replace `DRIVE_CONFIG`'s four flat constants:

```
turnRateOf(id)        = baseTurnRate + handling × turnRatePerRating   // 2.4 + h × 0.036
turnRateAtStopOf(id)  = turnRateOf(id) × stopTurnRatio                // × 0.5
accelOf(id)           = baseAccel     + accel    × accelPerRating     // 420 + a × 7.2
reverseAccelOf(id)    = accelOf(id)   × reverseAccelFactor            // × 1.41
```

Both forward scales are chosen so **rating 50 reproduces today's shipped constant exactly** —
`turnRateOf` at 50 is 4.2, `accelOf` at 50 is 780. The roster moves around a fixed pivot rather than
drifting off one, and "rating 50 drives like the game does today" stays true as a reading aid.

`reverseAccelFactor: 1.41` yields 1099.8 at rating 50 against the 1100 that shipped. That 0.02%
rounding is deliberate and stated rather than hidden; the exact ratio is `1100/780`, which is not a
number anyone should have to read in a config file.

`stopTurnRatio: 0.5` preserves today's `turnRateAtStop / turnRate` exactly (2.1 / 4.2).

### T8 — `RAM_REFERENCE` moves, and that is the design working

`RAM_REFERENCE` is derived as `RAM_REFERENCE_MASS × max(forwardMaxSpeedOf)`. The roster's fastest car
goes from 540 to 576 u/s, so the momentum that saturates ram severity rises 6.7% and every ram
becomes slightly less severe for the same impact.

This is the derived-not-typed property behaving as documented, but it is still a **real balance
change to ramming that nobody asked for**, arriving as a side effect of Mirage's top speed. It is
called out here so it is not discovered in play. It is also one of the numbers the ram playtest probe
measures — see T22.

---

## T9 — `stepDrive` stops reading the roster

`stepDrive` takes `carId` today only to look up six numbers. It will instead take those six numbers
as one resolved value:

```ts
export interface ChassisDrive {
  maxSpeed: number;
  reverseMaxSpeed: number;
  accel: number;
  reverseAccel: number;
  turnRate: number;
  turnRateAtStop: number;
}

export function driveOf(id: CarId): ChassisDrive;
```

`stepSim` resolves it once (`driveOf(ctx.carId)`) at **the single production call site** in
[`sim/step.ts`](../../../packages/shared/src/sim/step.ts); every other caller of `stepDrive` in the
repo is a test.

**Why this is worth doing as part of this change.** `golden.test.ts` freezes drive numbers to nine
decimal places and its header says no expectation in it may be edited — a rule that exists so the ram
and status work could only ever *add terms that vanish at neutral*, never alter the integration
itself. That rule is only safe while the drive constants cannot legitimately move. Per-car `accel`
moves them, and `drive.test.ts` and `status/channels.test.ts` pin literals against a named car too.
Re-recording expected values across three test files in the same commit that changes the physics is
exactly the situation in which a genuine regression is indistinguishable from an intended one.

With `ChassisDrive`, all three files pass a frozen fixture reproducing today's `rectangle`
(540 / 351 / 780 / 1100 / 4.2 / 2.1) and **every existing expectation survives untouched** — not just
through this change, but through every future balance edit. `golden.test.ts` goes back to testing the
one thing it was written to test: the shape of the equation.

This strengthens invariant 2 rather than bending it. Balance still lives in shared config; the sim
now receives it instead of reaching into the roster table for it.

---

## Weapons

### T10 — the redistribution

Kits stay **exclusive** (L1): no weapon appears on two chassis. The move is a clean three-way swap.

| | Slot 1 | Slot 2 | Slot 3 |
|---|---|---|---|
| **Bullseye** | `needler` | `pepperbox` ← *from Mirage* | `lance` |
| **Mirage** | `fireball` | `shockwave` ← *from Bastion* | `afterburner` |
| **Bastion** | `thumper` | `skewer` ← *from Bullseye* | `bulwark` |

### T11 — `needler` (was `splinter`)

Bullseye's slot 1, and the roster's spam weapon.

| Field | Was | Now |
|---|---|---|
| `hitbox` | `circle r5` | `ellipse 9 × 3` — a small thin dart |
| `damage` | 30 | 22 |
| `cooldownMs` | 400 | **300** |
| `speed` | 1100 | 1300 |
| `stock` | 3 @ 130 ms | 3 @ **110 ms** |
| `applies` | `spiked` 3000 ms | **removed** |

73 sustained DPS, essentially splinter's 75 anchor.

> **CORRECTED IN REVIEW — the paragraph struck below was false, and was measured against the shipped
> sim rather than re-derived.** It read:
>
> > ~~Dumping three stocks puts 66 damage out in 220 ms and then owes a 900 ms dry spell — the same
> > trigger-discipline question splinter asked, tightened.~~
>
> It was inherited word for word from `splinter` and was never true of the mechanism either row
> shipped on. `releaseShots` sets `rechargeEndsTick` **only when it is 0** (`sim/weapons/fire.ts`),
> so the recharge starts at the **first** shot of a dump and runs concurrently with it instead of
> after it. Holding the trigger from full stocks at tick 100, the sim fires on ticks
> **100, 104, 108, 112, 118, 127, 136, 145** — gaps of 133, 133, 133, 200, then 300 ms forever. Three
> darts leave inside 267 ms, the pause after them is **133 ms**, a fourth dart lands at tick 112 off
> the stock that arrived at 109, and the cadence settles onto the 9-tick cooldown at exactly the
> **73 DPS a tapping player has had the whole time.** Dumping and tapping converge; neither wins the
> long fight.
>
> So the magazine is a one-off credit of two extra darts — 88 damage inside the first 400 ms against
> a tapper's 44 — that never compounds and costs nothing afterwards. That is a real choice about
> **when** your damage lands, not the trigger-discipline trade this decision described.
>
> **Open question for the user, deliberately not resolved here.** Whether dumping the magazine
> *ought* to cost something is a design call, and nothing about this row was retuned to make the
> original sentence true. If it should, the lever is `fire.ts` restarting the recharge on the last
> shot of a burst rather than the first — a mechanism change, not a number. The code is authoritative
> as it stands, and `weapon-config.ts` carries the same correction on the row itself.

**Losing `spiked` is a deliberate nerf.** "Spikes" moves to `bulwark` (T17). Leaving it on both would
make Bullseye's spam weapon a debuff applicator, which fights the clean-sustained-pressure role slot
1 exists to fill.

Aim assist stays **on**: range 850 ≥ `lockRange` 400, and 3.33 Hz is 167% clear of the 1.25 Hz cliff.

### T12 — `pepperbox`

Moves to Bullseye's slot 2. Stops being a sequential burst and becomes a single fan.

| Field | Was | Now |
|---|---|---|
| `volley` | 3 volleys × 2 pellets, 100 ms apart | **1 volley × 3 pellets** |
| `spreadAngleDeg` | 10 | 12 |
| `hitbox` | `circle r7` | `circle r6` (−10%) |
| `damage` | 28 | 45 |
| `usesAimAssist` | false | **true** |

135 per press against the old 168, and 75 sustained — deliberately level with `needler`'s 73, because
the two are Bullseye's paired mid-range pressure rather than a go-to and an alternative.

The weapon loses its steer-through-the-burst skill expression, which was a consequence of sequential
volleys. That is the cost of the requested shape; the fan is now decided entirely at the press.

Aim assist is legal: range 600 ≥ 400, and 0.56 Hz is 56% clear of the cliff.

### T13 — `lance`

Stays on Bullseye (slot 3). Bigger, and now assisted.

| Field | Was | Now |
|---|---|---|
| `hitbox.width` | 20 | **23** (+15%) |
| `damage` | 180 | **170** |
| `usesAimAssist` | false | **true** |
| charge orb `maxRadius` (render) | 18 | **21** (+15%) |

The charge orb grows with the beam so the telegraph keeps matching what it warns about.

Aim assist is legal here where it is refused elsewhere: the "no assist on a beam" guard refuses
**attached** beams only, and `lance` is detached. Range 1200 clears `lockRange` easily.

The 10-damage trim pays for a wider beam *and* a lock arriving together on the game's hardest single
press. Note the assist only reaches 400 units against `lance`'s 1200 — beyond that it is still fully
manual, which is where most of its value lives.

### T14 — `fireball`

Mirage's slot 1. `cooldownMs` 500 → **550** (+10%). Nothing else changes.

Its damage was solved from the old cooldown (50 × 2/s = 100 DPS = a 5 s kill on an average 500 HP
hull). At 550 ms it sustains 91 DPS, so **the derivation comment on the row is now wrong and must be
rewritten**, not left to describe a number the row no longer produces.

1.82 Hz stays 45% clear of the cliff.

### T15 — `shockwave`

Moves to Mirage's slot 2, and becomes three waves.

| Field | Was | Now |
|---|---|---|
| `volley` | — (beams had none) | **3 volleys, 500 ms apart** |
| `damage` | 100 | **45** per wave |
| `cooldownMs` | 5000 | **5500** (+10%) |
| `applies` | `stunned` 700 ms | **`corroded` 2500 ms, final wave only** |

Each wave is its own disc instance: expands to 150 units in 100 ms, lingers 150 ms, dies. Waves are
500 ms apart, so they never overlap and the weapon reads as three distinct pulses. One press spans
1.25 s and deals at most 135 (**153**, not the ~~152~~ first written here, on Mirage's 1.13× attack)
against a target that eats all three.

> **CORRECTED IN REVIEW: 152 → 153. The code is authoritative.** `damageFor` scales and rounds
> **each wave on its own** — `damageFor(63, 45)` is 51, and 3 × 51 = **153**. The 152 came from
> scaling the 135 total once (`135 × 1.13`), which is not what the sim does. The decision is
> unchanged; only the figure was wrong.

**The stun is gone.** Hard CC belongs to Type 3 now, and `stunned` moves to `thumper` (T16). Mirage
keeps `corroded` as its setup tool, which is a debuff that makes a focus rather than one that makes a
kill — matching "CC duration low".

Aim assist stays off, and is doubly forced: range 150 is far below `lockRange`, and it is an attached
beam.

### T16 — `thumper`

Bastion's slot 1, and now its CC engager.

| Field | Was | Now |
|---|---|---|
| `damage` | 75 | **60** |
| `applies` | — | **`stunned` 900 ms, opponents** |

> ~~900 ms against shockwave's old 700: Bastion carries the roster's longest CC, which is the whole
> identity of Type 3. `stunned` is `reapply: "ignore"`, so it still cannot be chained — two Bastions
> cannot hold a car parked between them.~~
>
> **CORRECTED IN REVIEW — the paragraph struck above was false, and shipped a real balance defect
> rather than a documentation slip.** 900 ms against this row's own 1000 ms cooldown is a **90% duty
> cycle**: a single Bastion can hold one car stunned (and disarmed, since `stunned` carries that flag)
> almost permanently, far past the W7 playtest probe's 60% threshold and well above shockwave's old
> 700-on-5000 (14%). `reapply: "ignore"` blocks a running stun from being **re-extended** by a second
> hit; it says nothing about how often the stun can **restart**, so it never bounded the duty cycle
> and the "cannot be chained" claim does not follow from it. The shipped fix is **`durationMs: 450`**
> (14 ticks against this row's 30-tick cooldown, a 47% duty cycle) — a real interrupt window, bounded
> by thumper's own recharge because a stun longer than its cooldown is a lock. Bastion's "longest CC"
> identity now rests on `bulwark` (`spiked` 3000 ms, `fortified` 4500 ms), which are still the
> roster's longest durations. `status-config.ts` and `weapon-config.ts` carry the same correction on
> the rows themselves.

**`cooldownMs` stays at 1000 and must not be "rounded down".** The aim-assist cliff guard rejects any
assisted weapon between 696 ms and 941 ms; 1000 sits 20% clear and 900 would fail the suite.

### T17 — `skewer`

Moves to Bastion's slot 2, and stops being a long-range weapon.

| Field | Was | Now |
|---|---|---|
| `range` | 1100 | **650** |
| `speed` | 1400 | **1000** |
| `usesAimAssist` | false | **true** |

**Cutting the range is what makes T1's "1 beats 3" edge true.** At 1100 units Bastion would carry the
second-longest weapon in the game on the chassis specifically designed to lose at range — Bullseye's
`needler` reaches 850 and `lance` 1200, so a long skewer would let the tank trade with the kiter it
is supposed to be unable to reach. At 650 it is a heavy committed lunge and the kite works.

`pierce: 1` is unchanged, and still means **two cars**, not one and not three. On Bastion's 0.92×
attack that is 101 per car, 202 through a line — still the highest-value non-ultimate press in the
game, and now one that must be earned inside 650 units after a 250 ms wind-up.

Aim assist is legal: 650 ≥ 400, and 0.42 Hz is 67% clear of the cliff.

### T18 — `bulwark`

Stays on Bastion (slot 3). Bigger, faster to deploy, lingers longer, and corrodes no more.

| Field | Was | Now |
|---|---|---|
| `range` | 500 | **550** (+10%) |
| `speed` | 500 | **550** (+10%) |
| `lifetimeMs` | 2500 | **2875** (+15%) |
| `applies` (opponents) | `corroded` 2500 ms | **`spiked` 3000 ms** |
| `applies` (self) | `fortified` 4000 ms | `fortified` **4500 ms** |

`spiked` is slow-plus-bleed, which suits an exclusion zone far better than a damage-taken debuff: it
punishes standing in the zone on its own terms instead of only setting up someone else's shot.

The zone's damage ceiling rises with its life. Total life becomes 117 ticks against a 12-tick damage
interval, so a car held for the whole duration takes **10 ticks = 350** (**320**, not the ~~322~~
first written here, after Bastion's 0.92×), up from 315. Bastion's ultimate leading the damage table
remains the price of the slowest chassis.

> **CORRECTED IN REVIEW: 322 → 320. The code is authoritative.** `damageFor` scales and rounds
> **each tick on its own** — `damageFor(42, 35)` is 32, and 10 × 32 = **320**. The 322 came from
> scaling the 350 total once (`350 × 0.92`), which is not what the sim does. The decision is
> unchanged; only the figure was wrong. `weapon-config.ts` states the same arithmetic on the row.

### T19 — `afterburner` is unchanged

Mirage's slot 3 already overheats and already refuses aim assist. Zero edits. It is listed here so
its absence from the diff is visibly intentional.

### T20 — the status table does not change

All six rows are untouched, and all six stay reachable:

| Status | Applied by |
|---|---|
| `overheated` | `afterburner` (Mirage) |
| `corroded` | `shockwave` wave 3 (Mirage) |
| `stunned` | `thumper` (Bastion) |
| `spiked` | `bulwark` (Bastion) |
| `fortified` | `bulwark`, self (Bastion) |
| `overhauled` | nothing — still the pickup row |

**Per-chassis CC duration needs no new mechanism.** A status does not own its duration; the applier
does, and kits are exclusive — so "Mirage's CC is short, Bastion's is long" falls out of authoring
each weapon's `durationMs`. Mirage applies 1500 ms and 2500 ms; Bastion applies 900 ms, 3000 ms and
4500 ms.

---

## New structure

### T21 — beams gain volleys, and statuses gain a wave gate

Two additions, both required by T15 and neither reachable by tuning.

**(a) Volleys move to `WeaponBase`.** Today `VolleyDef` lives on `ProjectileWeaponDef` and bundles
four fields; `beginFire` hardcodes `volleys = 1` for beams and `weaponTicksOf` zeroes their
`volleyInterval`. The type splits along what each kind can actually answer for:

```ts
/** Sequential groups from one press. 1 = a single shot, blast, or wave. */
export interface VolleyDef {
  volleys: number;
  volleyIntervalMs: number;
}

/** Projectiles only: instances per group, and how they fan. */
export interface PelletDef {
  pelletsPerVolley: number;
  spreadAngleDeg: number;
}
```

`WeaponBase.volley: VolleyDef`; `ProjectileWeaponDef.pellets: PelletDef`. Splitting rather than
putting the whole four-field block on the base follows the rule the codebase already states for
`BeamStyle` vs `GlowStyle`: a merged type makes every author answer for the half that cannot apply to
their row. A beam should not be authoring `pelletsPerVolley: 1`.

`beginFire` then reads `def.volley.volleys` for every weapon, and `weaponTicksOf` converts
`volleyIntervalMs` for every weapon.

**(b) `StatusApplication` gains `onWave`.**

```ts
onWave?: "all" | "final";   // absent === "all"
```

Absent means today's behaviour, so every existing row is unaffected.

The wave a shot belongs to is carried the same way `damage` and `ownerTeam` are — **frozen at spawn,
sim-only, never networked**:

- `ShotOrder` gains `volleyIndex` and `finalVolley`. `releaseShots` already knows both:
  `finalVolley === (pending.shotsLeft === 1)`.
- `WeaponInstance` gains `finalWave: boolean`, set by `spawnInstances` from the order.
- `applyOpponentStatuses` and `applySelfStatuses` take it and skip `onWave: "final"` entries when it
  is false.

No schema field, no extra patch traffic, and no client change: the client already draws instances by
`weaponId` and hitbox.

Three properties this inherits for free and should be asserted rather than assumed:

- Each wave is an independent instance with its own `spawnTick`, so each dies 250 ms after its own
  birth rather than all three dying together.
- `damageFrequencyMs: 0` means one hit per car **per instance**, so three waves can hit the same car
  three times. That is the intent, and it is why per-wave damage had to fall from 100 to 45.
- Cooldown and recovery start from the **last** volley, so `cooldownMs` still means "time until
  another press" rather than partly serving its own wave sequence. A Mirage wrecked mid-sequence
  loses the remaining waves (`cancelPending`), which is correct.

---

## T22 — blast radius

### Shared

- `config/types.ts` — `CarId` union; `CarDef` gains `accel`, `handling`.
- `config/car-config.ts` — `CAR_TABLE`, `DEFAULT_CAR_ID`, new `turnRateOf` / `accelOf` /
  `reverseAccelOf` / `driveOf`, `ChassisDrive`.
- `config/drive-config.ts` — flat `turnRate` / `turnRateAtStop` / `accel` / `reverseAccel` replaced by
  `baseTurnRate`, `turnRatePerRating`, `stopTurnRatio`, `baseAccel`, `accelPerRating`,
  `reverseAccelFactor`. The coupling doc-comment needs rewriting: turn radius and time-to-top are now
  per-car.
- `config/weapon-types.ts` — `VolleyDef` / `PelletDef` split; `StatusApplication.onWave`.
- `config/weapon-config.ts` — nine rows, one rename, and several derivation comments that no longer
  describe their own numbers (`fireball`, `splinter`/`needler`, `pepperbox`, `shockwave`, `bulwark`).
- `config/weapon-ticks.ts` — `volleyInterval` for every kind.
- `sim/drive.ts` — takes `ChassisDrive`.
- `sim/step.ts` — resolves `driveOf(ctx.carId)`.
- `sim/weapons/fire.ts` — beam volleys; `ShotOrder` / `PendingFire` carry the wave.
- `sim/weapons/instances.ts` — `finalWave` on the instance; `pellets` instead of `volley` for fanning.
- `sim/combat.ts` — the two status-application helpers gate on `onWave`.

**No schema change.** Invariant 8 holds: nothing new that `stepSim` reads crosses the wire, because
`finalWave` is frozen at spawn on a sim-only object, exactly like `damage` and `ownerTeam`.

### Client

`car-visual.ts` (shape map + its comment), `reveal-view.ts` and `results-view.ts` (`FALLBACK_CAR`),
`combat-visual.ts` (lance charge `maxRadius`, and comments naming old car names),
`ArenaScene.ts` (comments), `public/art/manifest.json` (four keys).

### Assets

Three car PNGs and one weapon icon renamed. No pixels change.

### Docs

Root `CLAUDE.md`, the three package `CLAUDE.md`s, `docs/config-reference.md`,
`docs/combat-model.md`, `docs/asset-pipeline.md`, `docs/glossary.md`, and this spec.

### Skills

`.claude/skills/process-car-asset/` (car ids in `SKILL.md` and `preflight.mjs`) and
`.claude/skills/weapon-forger/SKILL.md` (cites `splinter`).

### The generated guide

`balanceStamp` hashes `CAR_TABLE`, `WEAPON_TABLE`, `DRIVE_CONFIG`, `COMBAT_CONFIG`, `STATUS_TABLE`,
`AIM_CONFIG.lockRange`, `TICK_RATE_HZ` and `ARENA_WIDTH` whole, so it moves on nearly every input
here. `npm run build:manual` must run and the page must be committed, or `manual-page.test.mjs` fails
with the command to run.

`build-cars-and-weapons.mjs` also needs **two new chassis stat rows** (Accel, Handling) beside the
four it renders today.

### Playtest probes — flag loudly, do not run

All seven files in `packages/server/playtest/` reference car ids and will not compile:
`weapons.ts`, `weapons2.ts`, `collision.ts`, `geometry.ts`, `ram.ts`, `prediction.ts`, `lan.ts`.

Compile breaks get fixed on the spot — a probe that does not build measures nothing. Thresholds,
comments and report strings quoting numbers this change moves get updated so a probe's `OK` still
means what it says.

Every probe here measures something this change moves, several of them severely:

| Probe | What moved |
|---|---|
| `ram.ts` | `RAM_REFERENCE` +6.7% (T8); every car's mass and top speed; per-car turn rate changes approach angles. |
| `collision.ts` | Per-car top speed and accel change contact depth and sub-tick phase. |
| `geometry.ts` | Every weapon's reach; `skewer` 1100 → 650; `lance` 15% wider; `shockwave` is three instances. |
| `weapons.ts`, `weapons2.ts` | Every kit changed chassis; `pepperbox` volley shape; `needler` cooldown; new status appliers. |
| `prediction.ts` | Per-car accel and turn rate are new prediction inputs. |

**`npm run playtest` is the user's call, not a step taken on their behalf.** The recommendation to
run it belongs in the final summary, named probe by probe.

---

## Testing

Beyond updating the suites that name the old ids, the change should add or keep guards for:

- `driveOf` returns the numbers `CAR_TABLE` + `DRIVE_CONFIG` imply, for every car.
- `turnRateOf(50) === 4.2` and `accelOf(50) === 780` — the anchors in T7, asserted so a future scale
  edit cannot silently move the pivot.
- `golden.test.ts`, `drive.test.ts`, `status/channels.test.ts` keep **every existing expectation**,
  now driven by a frozen `ChassisDrive` fixture (T9).
- Kit exclusivity (L1) still holds across the new assignments, and every weapon is on exactly one
  chassis.
- The three aim-assist authoring guards still pass for the four rows that newly opt in
  (`pepperbox`, `lance`, `skewer`, and `needler`'s changed cooldown): range ≥ `lockRange`, outside the
  cliff band, and not an attached beam.
- A beam with `volleys > 1` emits that many instances, spaced by `volleyIntervalMs`, each with its own
  `spawnTick`.
- `onWave: "final"` applies on the last wave only, and an absent `onWave` still applies on every wave.
- `CAMERA_CONFIG.freeRoamSpeed` still exceeds the fastest car (1050 > 576).

---

## Out of scope

- **New art.** No sprite or icon is redrawn; files are renamed only.
- **Per-chassis CC resistance as a mechanism.** Delivered through weapon durations (T20). A
  `statusDuration` channel would be a real feature and nobody has asked for one.
- **Moving `DEFAULT_CAR_ID`.** It follows the rename and nothing else.
- **Retuning ram from `RAM_REFERENCE`'s 6.7% shift** (T8). Flagged, measured by the probe, left for
  play to decide.
- **`overhauled` gaining an applier.** Still the pickup row; pickups are still future work.
