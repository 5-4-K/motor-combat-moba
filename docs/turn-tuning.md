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

The two orderings disagree on the live roster, and that disagreement is the design: Bullseye has the
lowest turn rate of the three and *still* corners tighter than Mirage, because Mirage's speed carries
it wide. Reading a radius complaint as a rate complaint is the easiest mistake to make here.

## Current values

**These tables are hand-maintained, and `scripts/turn-tuning-doc.test.mjs` checks every cell in them
against shared. See [Keeping this page honest](#keeping-this-page-honest) below before you change a
config value.**

### Authored in config

Values a person typed into a file. **Exactly two of them are per-car; every other authored value that
shapes turning is global**, and that split is the first thing to check before an edit — it decides
whether you are moving one chassis or all three.

**Per-car** — `CAR_TABLE`, one value per chassis:

| Rating | Bullseye | Mirage | Bastion |
|---|---|---|---|
| `handling` (turn rate) | 28 | 60 | 82 |
| `speed` (the other half of radius) | 52 | 88 | 30 |

**Global** — one value, applied to the whole roster:

| Knob | Where | Value | What it does |
|---|---|---|---|
| `baseTurnRate` | `DRIVE_CONFIG` | 3.6 | Flat part of every car's turn rate |
| `turnRatePerRating` | `DRIVE_CONFIG` | 0.054 | What one point of `handling` buys |
| `stopTurnRatio` | `DRIVE_CONFIG` | 0.5 | Steering at rest, as a fraction of the moving rate |
| `authorityFloor` | `RAM_CONFIG` | 0.35 | Most steering a ram can strip |
| `spinMaxRate` | `RAM_CONFIG` | 6 rad/s | Cap on ram-imposed rotation |
| `baseMaxSpeed` | `DRIVE_CONFIG` | 180 | Radius only — no effect on turn rate |
| `speedPerRating` | `DRIVE_CONFIG` | 4.5 | Radius only — what one point of `speed` buys |
| `reverseSpeedRatio` | `DRIVE_CONFIG` | 0.65 | Reverse radius only |

**A global knob is not a blunt version of a per-car one.** `turnRatePerRating` multiplies the
rating, so raising it hands the most to whoever already has the most: pushing it from 0.054 to 0.072
to pull Mirage's radius to 80 u would also drag Bastion's from 39.2 u to 33.1 u — buying one car's
fix by buffing the car that least needs it.

**That is the trade Mirage's 2026-08-31 rating edit avoided.** Its radius was 91.4 u, the roster's
widest, purely because its speed is 88; the fix was `handling` 50 -> 60, taking it to 84.2 u with
speed untouched and the other two chassis untouched. A global knob could not have done it: Mirage was
sitting on `handling` 50, the anchor rating, so the standard "widen the spread" move (raise
`turnRatePerRating`, lower `baseTurnRate` to hold the pivot) would have left it exactly where it
was.

**To change one car, change its rating. Reach for a global knob only when the whole roster is
wrong** — as it was before the 2026-08-31 1.5x raise.

### Derived

Nothing here is typed anywhere — all of it is computed from the two tables above.

| Stat | Formula | Bullseye | Mirage | Bastion |
|---|---|---|---|---|
| **Turn rate** | `baseTurnRate + handling × turnRatePerRating` | 5.112 rad/s | 6.84 rad/s | **8.028 rad/s** |
| — in degrees | × 180/π | 292.9°/s | 391.9°/s | 460.0°/s |
| — per tick | ÷ `TICK_RATE_HZ` (30) | 0.1704 rad | 0.228 rad | 0.2676 rad |
| — degrees per tick | ″ | 9.76° | 13.06° | 15.33° |
| **Turn rate at rest** | `turnRate × stopTurnRatio` | 2.556 rad/s | 3.42 rad/s | 4.014 rad/s |
| — in degrees | ″ | 146.4°/s | 196.0°/s | 230.0°/s |
| Top speed | `baseMaxSpeed + speed × speedPerRating` | 414 u/s | 576 u/s | 315 u/s |
| Reverse top speed | `× reverseSpeedRatio` | 269.1 u/s | 374.4 u/s | 204.8 u/s |
| **Turn radius** | `topSpeed / turnRate` | 81.0 u | 84.2 u | **39.2 u** |
| Reverse turn radius | `reverseSpeed / turnRate` | 52.6 u | 54.7 u | 25.5 u |
| 180° while moving | `π / turnRate` | 0.61 s | 0.46 s | 0.39 s |
| 360° while moving | `2π / turnRate` | 1.23 s | 0.92 s | 0.78 s |
| 180° from standstill | `π / turnRateAtStop` | 1.23 s | 0.92 s | 0.78 s |
| Rate at ram authority floor | `× 0.35` | 1.789 rad/s | 2.394 rad/s | 2.810 rad/s |

The split is the point: **Bastion has the highest authored `handling` and the tightest derived
radius, but Bullseye's radius still beats Mirage's despite a rating 32 points lower** — because
`speed` is the other input, and Mirage's 88 carries it wide. That inversion narrowed from 10.4 u to
3.2 u when Mirage went to `handling` 60, and it is worth watching: it is part of what makes
Bullseye's skirmisher identity work, and another 5 points on Mirage erases it.

## What to reach for, by outcome

| You want… | Tune | Why |
|---|---|---|
| Whole roster reorients/aims faster | `baseTurnRate` **+** `turnRatePerRating` together | Keeps a point of `handling` worth the same on every car |
| One chassis more agile than the others | that car's `handling` rating | Moves it within the triangle, roster scale untouched |
| `handling` to *matter more* between chassis | raise `turnRatePerRating`, lower `baseTurnRate` to hold the pivot | Widens the spread without moving the average car |
| Tighter corners without faster aim | lower `speed` (rating, or `baseMaxSpeed`/`speedPerRating`) | Radius is `speed / rate`; this is the other half |
| Snappier pivots when stopped or crawling | `stopTurnRatio` (0.5) | Only touches at-rest steering — a scale change does not reach it |
| Braking into a corner to feel rewarding | `brakeDecel` against `drag` | Slower entry is a smaller radius; the *situational* radius lever |
| Aiming easier without changing driving at all | `AIM_CONFIG.coneDeg`, `lockRange` | Assist and lock, entirely outside the drive model |
| Getting rammed to feel less helpless | `RAM_CONFIG.authorityFloor` (0.35) | Caps how much steering a ram can strip |

## What is *not* a knob

There is no grip, slip or traction value to tune. Steering is binary (`-1 | 0 | 1`) and the car has no
lateral slide, so turn rate is literally radians per second of rotation — a car either turns at its
rate or it does not turn. "The car understeers" has no direct control; it is a radius symptom, so
read it against speed.

## Reading a complaint

| Symptom | Usually |
|---|---|
| "Aiming is heavy", "I can't track anyone" | Rate — or `AIM_CONFIG`, if you would rather not touch driving |
| "Fine slow, wide at speed" | Radius. Lower that car's `speed`; raising rate again over-serves the slow chassis |
| "Sluggish in tight spaces" | `stopTurnRatio` — the slowest the game ever feels |
| "I lose control when hit" | `RAM_CONFIG` authority, not turn rate |
| "This one car feels wrong" | Its `handling` rating, never the scale |

## Keeping this page honest

**The tables above are hand-written, and `scripts/turn-tuning-doc.test.mjs` reads them back out of
this file and recomputes every cell from built shared.** Change any value in the list below without
editing the tables and `npm test` fails, naming the row and the chassis:

```
derived "Turn rate" / mirage: page says 6.3, config gives 6.84
```

It checks values rather than a fingerprint. The players' guide can hash its inputs because it is
generated, so a matching `balanceStamp` proves the builder re-ran; nothing generates this page, so a
stamp would only prove someone typed a new stamp. Reading the numbers back is also the stronger
check — it catches a hand-edit that updated four cells and missed the fifth.

Precision comes from each cell, so the page stays free to print 6.84 in one row and 0.1704 in
another. The chassis columns are matched against `CAR_TABLE` by name, so **a fourth chassis fails the
suite until it has a column in both tables**, and the ordered row list means an inserted or reordered
row fails rather than going silently unchecked.

**Update the two tables in [Current values](#current-values) whenever you change:**

| Config | Fields |
|---|---|
| `CAR_TABLE` | any car's `handling` or `speed` |
| `DRIVE_CONFIG` | `baseTurnRate`, `turnRatePerRating`, `stopTurnRatio`, `baseMaxSpeed`, `speedPerRating`, `reverseSpeedRatio` |
| `STATUS_TABLE` | any status carrying a `turnRate` modifier, which needs a new row — no row does today; `overheated`'s left with the 2026-09-01 status overhaul |
| `RAM_CONFIG` | `authorityFloor`, `spinMaxRate` |
| shared | `TICK_RATE_HZ` (the per-tick rows only) |

Adding a fourth chassis means a new column in both tables.

Do not retype the derived numbers by hand — build shared and print them:

```bash
npm run build -w @motor-combat-moba/shared
```

```bash
node -e "const s=require('./packages/shared/dist/index.js');for(const id of ['bullseye','mirage','bastion']){const d=s.driveOf(id),r=(n,p=3)=>+n.toFixed(p);console.log(id,{rate:r(d.turnRate),deg:r(d.turnRate*180/Math.PI,1),perTick:r(d.turnRate/s.TICK_RATE_HZ,4),atStop:r(d.turnRateAtStop),top:d.maxSpeed,rev:r(d.reverseMaxSpeed,1),radius:r(d.maxSpeed/d.turnRate,1),revRadius:r(d.reverseMaxSpeed/d.turnRate,1),s180:r(Math.PI/d.turnRate,2),s360:r(2*Math.PI/d.turnRate,2)});}"
```

The same edits almost always owe a `npm run build:manual` too — that page is generated and
fingerprinted, so the suite will tell you about it as well.

**What no test covers: numbers in prose.** This page argues from figures inside sentences — how far
the Bullseye/Mirage radius inversion narrowed, what raising `turnRatePerRating` to 0.072 would do to
Bastion. A table parser will never see those. They stay a review-time responsibility, so re-read the
prose after a tuning pass even when the suite is green.

## Before you commit to a number

Turn rate reaches `stepDrive`, so it moves what the playtest probes measure — steering sweeps,
collision depth, ram trigger rates, prediction error. Run `npm run playtest` and read what moved; see
[`packages/server/playtest/README.md`](../packages/server/playtest/README.md). `npm run ttk` will not
show it — nothing moves in that model, so no turn edit can ever change a number on it.

Turn numbers also print in the players' guide, so a scale or rating edit owes a
`npm run build:manual` and a committed page.
