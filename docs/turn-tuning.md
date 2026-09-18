# Turn tuning

Which knob to reach for when the driving feels wrong. Every value named here lives in
[`config-reference.md`](config-reference.md) — this page is the index by *outcome*, not a second copy
of the numbers.

## `handling` and turn rate are the same quantity

They are not two knobs. `handling` is the per-car rating; `baseTurnRate`/`turnRatePerRating` is the
global scale that rating is multiplied through:

```
turnRateOf(id) = baseTurnRate + handling × turnRatePerRating
```

**Rating moves one car's place in the triangle. Scale moves the whole roster's absolute feel.** That
is the altitude question to settle first: "Bastion should out-turn Mirage by more" is a `handling`
edit, "every car is sluggish" is a scale edit. Doing the second one via three ratings works and gives
the roster three chances to drift out of its intended spacing.

When you do move the scale, **move both halves together**. Raising `baseTurnRate` alone compresses
the roster toward uniform handling, because the flat part grows while the per-rating part does not.
The 2026-08-31 1.5x raise scaled the pair, which is why the ordering and spacing came through it
untouched.

## Sharper turning is two different outcomes

Turn rate directly controls only one of them:

- **How fast the car reorients** — aim speed, snap-arounds, tracking a strafing target. Pure rate.
- **How tight an arc it carves at speed** — cornering, orbiting, dodging. That is
  `forwardMaxSpeedOf(id) / turnRateOf(id)`, and **speed is half of it**.

The first one is also the aiming model. Shots fire along `player.angle` and there is no independent
turret, so **turn rate literally is aim speed** — which is why "aiming feels heavy" is a drive-model
complaint before it is a combat one.

**As of the 2026-09-18 Unity drive-model port, the two orderings no longer disagree — they barely
differ at all.** `speed` and `handling` have carried the same rating per car since 2026-09-02, and
this port's own turn-rate anchors (`baseTurnRate`/`turnRatePerRating`, retuned below) happen to land
every chassis within **0.02 u** of the same ~89.9 u radius: Bullseye 89.87 u, Mirage 89.86 u, Bastion
89.88 u. That spread is real, not a display artifact, but it is smaller than a single rating point's
worth of noise — read the roster's turn radius as effectively uniform today, not as a design axis. A
"this car corners differently" complaint is a rate complaint now, full stop; see
[Current values](#current-values) for the figures.

## Current values

**These tables are hand-maintained, and `scripts/turn-tuning-doc.test.mjs` checks every cell in them
against shared. See [Keeping this page honest](#keeping-this-page-honest) below before you change a
config value.**

### Authored in config

Values a person typed into a file. **Two of them shape turning and are per-car: `handling` and
`speed`.** `brakeDecel` joined `CAR_TABLE` with the 2026-09-06 vector-drive rework and still shapes
how a chassis stops, not how it turns, so it gets its own table below rather than a row in the
ratings one. `coastHalfLifeSeconds` used to sit beside it there — the 2026-09-18 Unity drive-model
port deleted that field outright, and `accel`'s job is now `dragRate` (`dragRateOf`): one rate that
sets top speed, wind-up AND roll together, so it joins that same table in `coastHalfLifeSeconds`'s
old place. Unlike the pair it replaces, `dragRate` is not a dead end for this page — several rows in
[Derived](#derived) below are computed straight from it. Every other authored value that shapes
turning is global, and the turning/non-turning split is the first thing to check before an edit — it
decides whether you are moving one chassis or all three.

**Per-car ratings** — `CAR_TABLE`, one value per chassis:

| Rating | Bullseye | Mirage | Bastion | Taurus | Anvil | Prowler | Cleaver | Skorpios | Caprico |
|---|---|---|---|---|---|---|---|---|---|
| `handling` (turn rate) | 65 | 85 | 50 | 50 | 50 | 85 | 85 | 65 | 50 |
| `speed` (the other half of radius) | 65 | 85 | 50 | 50 | 50 | 85 | 85 | 65 | 50 |

**The last six columns are unreleased prototypes** (`isActive: false`, no kit yet), and every one of
them is a placeholder STAT CLONE of a shipped chassis — Taurus, Anvil and Caprico of Bastion, Prowler
and Cleaver of Mirage, Skorpios of Bullseye. They are on this page because
`scripts/turn-tuning-doc.test.mjs` reads `CAR_TABLE` whole, and because the day one of them is
actually tuned is the day its column stops being a duplicate. Read the three shipped columns for the
roster's shape; the other six say nothing yet.

**Per-car direct values** — one value per chassis, but neither is a 0-100 rating. `brakeDecel` is
still authored directly on `CAR_TABLE` and still feeds no turn-rate or radius cell below. `dragRate`
is different: it's read out of `driveOf(id)` rather than typed, since it's derived from each car's
`accel` rating (`dragRateOf`), and — unlike `brakeDecel` — several rows in [Derived](#derived) below
are computed straight from it. Both are here because they shape the same chassis feel this page is
about, and because changing either now obliges an edit to this page (see
[Keeping this page honest](#keeping-this-page-honest)):

| Value | Bullseye | Mirage | Bastion | Taurus | Anvil | Prowler | Cleaver | Skorpios | Caprico |
|---|---|---|---|---|---|---|---|---|---|
| `dragRate` — drag (1/s) | 1.0416 | 1.2848 | 0.8896 | 0.8896 | 0.8896 | 1.2848 | 1.2848 | 1.0416 | 0.8896 |
| `brakeDecel` — brake deceleration (u/s²) | 520 | 500 | 430 | 430 | 430 | 500 | 500 | 520 | 430 |

**Global** — one value, applied to the whole roster:

| Knob | Where | Value | What it does |
|---|---|---|---|
| `baseTurnRate` | `DRIVE_CONFIG` | 0.667 | Flat part of every car's turn rate |
| `turnRatePerRating` | `DRIVE_CONFIG` | 0.0169 | What one point of `handling` buys |
| `spinMaxRate` | `RAM_CONFIG` | 6 rad/s | Cap on ram-imposed rotation |
| `baseMaxSpeed` | `DRIVE_CONFIG` | 60 | Flat part of every car's top speed — radius only, no effect on turn rate |
| `speedPerRating` | `DRIVE_CONFIG` | 1.518 | Radius only — what one point of `speed` buys |
| `baseDrag` | `DRIVE_CONFIG` | 0.768 | Drag rate at `accel` 0 — sets top speed, wind-up time and roll together |
| `dragPerRating` | `DRIVE_CONFIG` | 0.00608 | What one point of `accel` buys — more drag, sooner to top speed, shorter roll |
| `lateralGripRate` | `DRIVE_CONFIG` | 3.0 | The drift knob — how fast sideways velocity bleeds off |
| `reverseAccelFactor` | `DRIVE_CONFIG` | 0.4 | Reverse push as a fraction of forward — sets reverse top speed too |
| `reverseEpsilon` | `DRIVE_CONFIG` | 6.0 | Forward speed below which Down reverses instead of braking |

**A global knob is not a blunt version of a per-car one.** `turnRatePerRating` multiplies the
rating, so raising it hands the most to whoever already has the most: pushing it from today's 0.0169
to 0.0225 (a comparable ~33% bump to the one this section used to illustrate against the old anchors)
would take Mirage's radius from 89.86 u to 73.28 u, but would also pull Bastion's from 89.88 u to
75.84 u — tightening the car that supposedly needs it least by nearly as much, since today's port
left the roster with no chassis that clearly "needs it least" any more (see
[Sharper turning is two different outcomes](#sharper-turning-is-two-different-outcomes) above).

**That is the trade Mirage's 2026-08-31 rating edit avoided, historically.** Its radius was 91.4 u,
the roster's widest at the time, purely because its speed was 88; the fix was `handling` 50 -> 60,
taking it to 84.2 u with speed untouched and the other two chassis untouched. Those figures moved
several times more since: the 2026-09-01 half-speed cut took the same pair to 45.7 u -> 42.1 u, and
the 2026-09-02 rewrite reset Mirage's `handling` again, to 85 (matching its `speed`), landing it at
54.9 u — the roster's widest again, now by design rather than as something to fix. The 2026-09-06
heavy-car pass (`baseMaxSpeed` 135 -> 80, `speedPerRating` 3.7 -> 2.2) then cut every car's radius by
the same ~41%, without moving a single `handling` rating, taking Mirage to 32.6 u — still the
roster's widest, now well under one car length (60 u since the 2026-09-16 hull resize). The
2026-09-16 cut (`baseMaxSpeed` 80 -> 60, `speedPerRating` 2.2 -> 1.518) did the same thing again, turn
rate untouched for a third consecutive pass, landing Mirage at 23.1 u, with the whole roster cornering
inside a 1.5 u band (Bastion 21.6, Bullseye 22.3, Mirage 23.1) — under a tenth of a car length. That
was the state of play going into today.

**The 2026-09-18 Unity drive-model port broke the run of "speed moves, turn rate doesn't."** It
retuned `baseTurnRate`/`turnRatePerRating` themselves (0.667/0.0169, replacing 3.6/0.054) to pitch
every chassis at about 1.5 car lengths of radius at its own top speed — and because `speed` and
`handling` are equal per car, that arithmetic returns the SAME radius for all three: ~89.9 u
(Bullseye 89.87, Mirage 89.86, Bastion 89.88 — a 0.02 u spread, arithmetic noise). "All three cars
corner the same" stopped being an approximation and became exactly true. This is the port's own
known, chosen state, not a bug: the project owner was shown two roster-spreading alternatives and
picked uniform, to revisit during this port's own stage-5 tuning pass (spec §9.2 of
`docs/superpowers/specs/2026-09-18-unity-driving-and-ram-physics-port-design.md`). Widening it back
out later is a `handling` (or `baseTurnRate`/`turnRatePerRating`) edit, not a speed one — **do not
"fix" this silently**.

A global knob could not have made the 2026-08-31 fix, historically: Mirage was sitting on `handling`
50, the anchor rating at the time, so the standard "widen the spread" move (raise
`turnRatePerRating`, lower `baseTurnRate` to hold the pivot) would have left it exactly where it was.

**To change one car, change its rating. Reach for a global knob only when the whole roster is
wrong** — as it was before the 2026-08-31 1.5x raise, and, on radius specifically, as it is again
today.

### Derived

Nothing here is typed anywhere — all of it is computed from the ratings and global-knob tables above.
The direct-values table splits down the middle now: `brakeDecel` still feeds nothing below — no
turn-rate or radius formula reads it — but `dragRate` feeds four of the rows here ("Engine push",
"Time to 90% of top speed", "Roll distance from top speed" and "Slip angle at full lock"), since it
is the one rate the Unity drive-model port uses to set top speed, wind-up and roll together.

| Stat | Formula | Bullseye | Mirage | Bastion | Taurus | Anvil | Prowler | Cleaver | Skorpios | Caprico |
|---|---|---|---|---|---|---|---|---|---|---|
| **Turn rate** | `baseTurnRate + handling × turnRatePerRating` | 1.765 rad/s | **2.103 rad/s** | 1.512 rad/s | 1.512 rad/s | 1.512 rad/s | 2.103 rad/s | 2.103 rad/s | 1.765 rad/s | 1.512 rad/s |
| — in degrees | × 180/π | 101.2°/s | 120.5°/s | 86.6°/s | 86.6°/s | 86.6°/s | 120.5°/s | 120.5°/s | 101.2°/s | 86.6°/s |
| — per tick | ÷ `TICK_RATE_HZ` (30) | 0.0588 rad | 0.0701 rad | 0.0504 rad | 0.0504 rad | 0.0504 rad | 0.0701 rad | 0.0701 rad | 0.0588 rad | 0.0504 rad |
| — degrees per tick | ″ | 3.37° | 4.02° | 2.89° | 2.89° | 2.89° | 4.02° | 4.02° | 3.37° | 2.89° |
| **Engine push** | `topSpeed × dragRate` | 165.27 u/s² | **242.87 u/s²** | 120.9 u/s² | 120.9 u/s² | 120.9 u/s² | 242.87 u/s² | 242.87 u/s² | 165.27 u/s² | 120.9 u/s² |
| Time to 90% of top speed | `ln(10) / dragRate` | 2.21 s | 1.79 s | 2.59 s | 2.59 s | 2.59 s | 1.79 s | 1.79 s | 2.21 s | 2.59 s |
| Top speed | `baseMaxSpeed + speed × speedPerRating` | 158.67 u/s | **189.03 u/s** | 135.9 u/s | 135.9 u/s | 135.9 u/s | 189.03 u/s | 189.03 u/s | 158.67 u/s | 135.9 u/s |
| Roll distance from top speed | `topSpeed / dragRate` | 152.3 u | 147.1 u | 152.8 u | 152.8 u | 152.8 u | 147.1 u | 147.1 u | 152.3 u | 152.8 u |
| Reverse top speed | `topSpeed × reverseAccelFactor` | 63.5 u/s | 75.6 u/s | 54.4 u/s | 54.4 u/s | 54.4 u/s | 75.6 u/s | 75.6 u/s | 63.5 u/s | 54.4 u/s |
| **Turn radius** | `topSpeed / turnRate` | 89.9 u | 89.9 u | 89.9 u | 89.9 u | 89.9 u | 89.9 u | 89.9 u | 89.9 u | 89.9 u |
| Reverse turn radius | `reverseTopSpeed / turnRate` | 35.9 u | 35.9 u | 36 u | 36 u | 36 u | 35.9 u | 35.9 u | 35.9 u | 36 u |
| Slip angle at full lock | `atan(turnRate / (dragRate + lateralGripRate))` | 23.6° | **26.1°** | 21.2° | 21.2° | 21.2° | 26.1° | 26.1° | 23.6° | 21.2° |
| 180° while moving | `π / turnRate` | 1.78 s | 1.49 s | 2.08 s | 2.08 s | 2.08 s | 1.49 s | 1.49 s | 1.78 s | 2.08 s |
| 360° while moving | `2π / turnRate` | 3.56 s | 2.99 s | 4.16 s | 4.16 s | 4.16 s | 2.99 s | 2.99 s | 3.56 s | 4.16 s |

**Four rows above replace ones the Unity drive-model port made meaningless.** "Turn rate at rest"
(and its degrees row) and "180° from standstill" used to read `turnRateAtStop`, a field `ChassisDrive`
no longer has: yaw is speed-independent under this model, so there is no separate at-rest rate any
more — a car turns at the same `turnRate` parked or at top speed, full stop. "Rate while reeling"
used to read `STATUS_TABLE.reeling`'s `turnRate` multiplier through `modifiersOf`; that status still
carries one (0.4 — a rammed car really does turn 0.4x as fast while reeling), it is simply no longer
tabulated on this page, the same way most individual status effects never got a row here. If a
future status needs its own scaled-rate row, it does not have a home on this page today.

**Top speed is no longer a ceiling anyone hits.** It is the equilibrium where the engine's push
("Engine push" above, `engineAccel`) exactly balances drag (`dragRate`) — `engineAccel === topSpeed ×
dragRate` by construction (`engineAccelOf`) — and a car only ever decays toward it, never truly
arrives. "Time to 90% of top speed" (`ln(10) / dragRate`) is the number worth reading instead of a
made-up "seconds to top": it is when the car is within 10% of its ceiling, close enough that nobody
driving it can tell the difference. "Roll distance from top speed" is the mirror image, off the
throttle: `topSpeed / dragRate` is how far a car coasts from a dead sprint before drag alone would
(asymptotically) stop it — a real distance for "how much does letting off feel like braking", not a
`coastHalfLifeSeconds` half-life any more.

**"Slip angle at full lock" is the drift a car settles into cornering flat-out, forever.** It is
**not** `atan(turnRate / lateralGripRate)` — see [Grip and drift](#grip-and-drift) below for why
`dragRate` belongs in that denominator too. The figures above are the continuous prediction; the real
per-tick integration lands a few degrees higher because of ordinary discretization (measured for
Mirage at these anchors: 26.1° continuous against 28.2° at steady state after 10 real seconds of full
lock) — close enough that this page tracks the closed form rather than a simulated fixed point.

**The 2026-09-02 rewrite removed the speed/handling split.** `speed` and `handling` began moving
together per car (65/65, 85/85, 50/50), so turn rate and turn radius started ordering the roster the
*same* way: Mirage highest/widest, Bastion lowest/tightest. Bastion still finished with the tightest
radius at that point — its lower speed outweighed its lower rate — but only by a few units against
Mirage, not the 20+ u gap the old inverse ratings produced. The "slow tank that out-turns everyone"
identity (T6) was gone from that point on; Bastion's tank role rests on hp and its two ram ratings —
`ramAttack` 70 and `ramDefence` 90, both the roster's highest, which replaced the single `mass`
rating in stage 3 of the 2026-09-06 car-physics rework. **That ordering itself is gone too now** —
see the port paragraph in [Authored in config](#authored-in-config) above; there is no chassis with a
tightest radius left to give an edge back to.

**The 2026-09-06 heavy-car pass (stage 1 of the vector-drive rework) left every radius gap in the
same proportion, at the time.** Cutting `baseMaxSpeed`/`speedPerRating` roughly 41% scaled every
car's radius down by the same factor — turn rate untouched — so Mirage-to-Bastion narrowed from 4.1 u
(54.9 vs 50.8, right after 2026-09-02) to 2.4 u (32.6 vs 30.2) rather than closing outright: the
*ordering* and *relative* spacing the 2026-09-02 rewrite established survived that pass, on top of
pulling every absolute radius down to comfortably under one car length (48 u at the time; the hull
was 48 u long until the 2026-09-16 resize to 60 u). The same pass also cut `accel`
(`baseAccel`/`accelPerRating`, both since deleted outright by the 2026-09-18 port — see
`baseDrag`/`dragPerRating` in [Authored in config](#authored-in-config) above), which lengthened
time-to-top-speed roster-wide by roughly 3-4x at the time (Mirage 0.44 -> 1.49 s, Bullseye
0.50 -> 1.81 s, Bastion 0.57 -> 2.16 s). "Time to 90% of top speed" in the table above is that same
question's current answer — asymptotic now rather than a hard cap, and read straight off `dragRate`.

## What to reach for, by outcome

| You want… | Tune | Why |
|---|---|---|
| Whole roster reorients/aims faster | `baseTurnRate` **+** `turnRatePerRating` together | Keeps a point of `handling` worth the same on every car |
| One chassis more agile than the others | that car's `handling` rating | Moves it within the triangle, roster scale untouched |
| `handling` to *matter more* between chassis | raise `turnRatePerRating`, lower `baseTurnRate` to hold the pivot | Widens the spread without moving the average car |
| Tighter corners without faster aim | lower `speed` (rating, or `baseMaxSpeed`/`speedPerRating`) | Radius is `speed / rate`; this is the other half |
| Snappier pivots once fully stopped | *(no longer a knob)* | Yaw is speed-independent under the 2026-09-18 Unity drive-model port — there is no separate at-rest rate any more, and no `stopTurnRatio` to reach for. A car turns at the same `turnRate` parked or at top speed; a sluggish pivot is a `handling` or scale complaint like any other |
| Braking into a corner to feel rewarding | that car's `brakeDecel` against its `dragRate` | Slower entry is a smaller radius; the *situational* radius lever, and per-car. `dragRate` now also sets coast-off roll ("Roll distance from top speed" above) in place of the deleted per-car `coastHalfLifeSeconds` |
| A car to drift more (or less) through a turn | `lateralGripRate`, or that car's `accel`/`dragRate` | The new grip/slip mechanic — see [Grip and drift](#grip-and-drift) below |
| Getting rammed to feel less helpless | `STATUS_TABLE.reeling`'s `turnRate`/`accel` multipliers (0.4/0.4) for how bad it is; `RAM_CONFIG.ramUncontrolMs` (1000) for how long | Since stage 3b of the car-physics rework a ram applies the `reeling` status. Severity and duration are separate knobs on purpose — raise the multipliers to keep the victim steering, cut the ms to make it brief. **The multipliers only move in ONE direction:** both already sit exactly AT their `STATUS_LIMITS` floors (0.4 on `turnRate`, 0.4 on `accel`), so anything lower is silently clamped back by `modifiersOf` and the sim behaves as if you had not typed it. `status-config.ts` says so on the row and forbids widening the floors to get past it — they are documented guarantees, so "harsher" has to come from duration or from the physics, never from that number. `RAM_CONFIG`'s falloff knobs (`drWindowMs`, `durationDrScale`, `impulseDrScale`, and their floors) are the third lever: they are what stops a repeated ram reading as a lock |

## Grip and drift

There is now a real slip mechanic, where the old model had none. `DRIVE_CONFIG.lateralGripRate`
(3.0) is how fast the sideways component of velocity bleeds off each tick — lower drifts more, and 0
is a hockey puck — and it is what "Slip angle at full lock" in the derived table above tabulates:

```
slipAngle = atan(turnRate / (dragRate + lateralGripRate))
```

**`dragRate` belongs in that denominator alongside `lateralGripRate`, not instead of it.** Drag acts
on the WHOLE velocity vector every tick (`stepDrive`'s step 2), so a car's own drag rate bleeds its
sideways motion exactly as it bleeds its forward motion — grip is the EXTRA sideways rate on top of
that, not the only channel slowing the drift. `atan(turnRate / lateralGripRate)` alone — ignoring
drag — overstates the drift by about a third at these anchors (roughly 35° against the real ~26°).
This is also a real coupling the old model never had: **raising a car's `accel` (its `dragRate`)
narrows its own drift**, alongside speeding its wind-up and shortening its roll — one rating now
touches three feels at once, not one. Steering itself is still binary (`-1 | 0 | 1`), and turn rate is
still literally radians per second of rotation, so "the car understeers" is still primarily a radius
symptom (read it against speed) — but it now has a second, genuine cause: not enough grip relative to
how hard the car is turning.

## Reading a complaint

| Symptom | Usually |
|---|---|
| "Aiming is heavy", "I can't track anyone" | Rate. There is no aim assist to reach for instead — every shot leaves along the heading, so turn rate IS the aiming knob |
| "Fine slow, wide at speed" | Radius. Lower that car's `speed`; raising rate again over-serves the slow chassis |
| "Sluggish in tight spaces" | Nothing, any more — as of the 2026-09-18 port, turn rate is the same parked or moving, and there is no `stopTurnRatio` or at-rest branch left to check. Read it as a radius complaint (that car's `speed`) or a drift complaint (`lateralGripRate`) instead |
| "I lose control when hit" | The `reeling` status a ram applies — `STATUS_TABLE.reeling`'s `turnRate`/`accel` for severity, `RAM_CONFIG.ramUncontrolMs` for length. If the complaint is really "and then it happened again", it is the falloff knobs, not these |
| "This one car feels wrong" | Its `handling` rating, never the scale |

## Keeping this page honest

**The tables above are hand-written, and `scripts/turn-tuning-doc.test.mjs` reads them back out of
this file and recomputes every cell from built shared.** Change any value in the list below without
editing the tables and `npm test` fails, naming the row and the chassis:

```
derived "Turn rate" / mirage: page says 2.10, config gives 2.58
```

It checks values rather than a fingerprint. The players' guide can hash its inputs because it is
generated, so a matching `balanceStamp` proves the builder re-ran; nothing generates this page, so a
stamp would only prove someone typed a new stamp. Reading the numbers back is also the stronger
check — it catches a hand-edit that updated four cells and missed the fifth.

Precision comes from each cell, so the page stays free to print 6.84 in one row and 0.1704 in
another. The chassis columns are matched against `CAR_TABLE` by name, so **a fourth chassis fails the
suite until it has a column in all three per-car tables** — ratings, direct values, and derived —
and the ordered row list means an inserted or reordered row fails rather than going silently
unchecked.

**Update the tables in [Current values](#current-values) whenever you change:**

| Config | Fields |
|---|---|
| `CAR_TABLE` | any car's `handling`, `speed`, `accel` or `brakeDecel` |
| `DRIVE_CONFIG` | `baseTurnRate`, `turnRatePerRating`, `baseMaxSpeed`, `speedPerRating`, `baseDrag`, `dragPerRating`, `lateralGripRate`, `reverseAccelFactor`, `reverseEpsilon` |
| `RAM_CONFIG` | `spinMaxRate` |
| shared | `TICK_RATE_HZ` (the per-tick rows only) |

Adding a fourth chassis means a new column in all three per-car tables (ratings, direct values, and
derived) — all three are test-checked; see above.

`STATUS_TABLE.reeling`'s `turnRate` multiplier used to owe this page a "Rate while reeling" row. That
row — and the doc test's `modifiersOf` read behind it — is gone as of the 2026-09-18 Unity
drive-model port, because the row it scaled (`turnRateAtStop`) no longer exists. `reeling` still
slows a car's turning exactly as before; that number simply is not tabulated here any more, and a
future status carrying its own `turnRate` multiplier does not automatically owe this page a row the
way it used to.

Do not retype the derived numbers by hand — build shared and print them:

```bash
npm run build -w @motor-combat-moba/shared
```

```bash
node -e "import('./packages/shared/dist/index.js').then(({CAR_TABLE,DRIVE_CONFIG,TICK_RATE_HZ,driveOf})=>{for(const id of Object.keys(CAR_TABLE)){const d=driveOf(id),deg=(r)=>r*180/Math.PI,rev=d.maxSpeed*DRIVE_CONFIG.reverseAccelFactor;console.log(id,{rate:+d.turnRate.toFixed(3),deg:+deg(d.turnRate).toFixed(1),perTick:+(d.turnRate/TICK_RATE_HZ).toFixed(4),engineAccel:+d.engineAccel.toFixed(2),timeTo90:+(Math.log(10)/d.dragRate).toFixed(2),top:+d.maxSpeed.toFixed(2),roll:+(d.maxSpeed/d.dragRate).toFixed(1),rev:+rev.toFixed(1),radius:+(d.maxSpeed/d.turnRate).toFixed(1),revRadius:+(rev/d.turnRate).toFixed(1),slip:+deg(Math.atan(d.turnRate/(d.dragRate+DRIVE_CONFIG.lateralGripRate))).toFixed(1),s180:+(Math.PI/d.turnRate).toFixed(2),s360:+(2*Math.PI/d.turnRate).toFixed(2)});}})"
```

The same edits almost always owe a `npm run build:manual` too — that page is generated and
fingerprinted, so the suite will tell you about it as well.

**What no test covers: numbers in prose.** This page argues from figures inside sentences — what
raising `turnRatePerRating` to 0.0225 would do to Bastion, how far the roster's turn-radius history
narrowed before the 2026-09-18 port erased it outright. A table parser will never see those. They
stay a review-time responsibility, so re-read the prose after a tuning pass even when the suite is
green.

## Before you commit to a number

Turn rate reaches `stepDrive`, so it moves what the playtest probes measure — steering sweeps,
collision depth, ram trigger rates, prediction error. Run `npm run playtest` and read what moved; see
[`packages/server/playtest/README.md`](../packages/server/playtest/README.md). `npm run ttk` will not
show it — nothing moves in that model, so no turn edit can ever change a number on it.

Turn numbers also print in the players' guide, so a scale or rating edit owes a
`npm run build:manual` and a committed page.
