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

Values a person typed into a file. **Two of them shape turning and are per-car: `handling` and
`speed`.** Two more per-car values, `coastHalfLifeSeconds` and `brakeDecel`, joined `CAR_TABLE` with
the 2026-09-06 vector-drive rework — they shape how a chassis rolls and stops, not how it turns, so
they get their own table below rather than a row in the ratings one. Every other authored value that
shapes turning is global, and the turning/non-turning split is the first thing to check before an
edit — it decides whether you are moving one chassis or all three.

**Per-car ratings** — `CAR_TABLE`, one value per chassis:

| Rating | Bullseye | Mirage | Bastion |
|---|---|---|---|
| `handling` (turn rate) | 65 | 85 | 50 |
| `speed` (the other half of radius) | 65 | 85 | 50 |

**Per-car direct values** — also `CAR_TABLE`, one value per chassis, but neither is a 0-100 rating and
neither feeds a turn-rate or radius cell below; they're here because they shape the same chassis feel
this page is about, and because changing either now obliges an edit to this page (see
[Keeping this page honest](#keeping-this-page-honest)):

| Value | Bullseye | Mirage | Bastion |
|---|---|---|---|
| `coastHalfLifeSeconds` — coast half-life (s) | 1.0 | 1.2 | 1.5 |
| `brakeDecel` — brake deceleration (u/s²) | 520 | 500 | 430 |

**Global** — one value, applied to the whole roster:

| Knob | Where | Value | What it does |
|---|---|---|---|
| `baseTurnRate` | `DRIVE_CONFIG` | 3.6 | Flat part of every car's turn rate |
| `turnRatePerRating` | `DRIVE_CONFIG` | 0.054 | What one point of `handling` buys |
| `stopTurnRatio` | `DRIVE_CONFIG` | 0.5 | Steering at rest, as a fraction of the moving rate |
| `authorityFloor` | `RAM_CONFIG` | 0.35 | Most steering a ram can strip |
| `spinMaxRate` | `RAM_CONFIG` | 6 rad/s | Cap on ram-imposed rotation |
| `baseMaxSpeed` | `DRIVE_CONFIG` | 80 | Radius only — no effect on turn rate |
| `speedPerRating` | `DRIVE_CONFIG` | 2.2 | Radius only — what one point of `speed` buys |
| `reverseSpeedRatio` | `DRIVE_CONFIG` | 0.65 | Reverse radius only |

Two more `DRIVE_CONFIG` globals sit beside these but don't feed a rate or radius cell on this page:
`steeringGrip` (1.0 — how completely the velocity vector tracks heading; the radius formulas below
assume it stays at 1, i.e. steering stays "on rails") and `impactGripDecel` (250 u/s² — how fast
ram-imposed sideways velocity bleeds off, unrelated to steering). Neither has a table row to check
against, so moving either doesn't fail `turn-tuning-doc.test.mjs` — but both are tracked in
[Keeping this page honest](#keeping-this-page-honest) anyway, because a `steeringGrip` below 1 would
invalidate the "steering is exempt from the grip budget" assumption every radius number here rests on.

**A global knob is not a blunt version of a per-car one.** `turnRatePerRating` multiplies the
rating, so raising it hands the most to whoever already has the most: pushing it from 0.054 to 0.072
would take Mirage's radius from 32.6 u to 27.5 u, but would also pull Bastion's from 30.2 u to
26.4 u — tightening the car that already needs it least, since Bastion finishes with the roster's
tightest radius either way.

**That is the trade Mirage's 2026-08-31 rating edit avoided, historically.** Its radius was 91.4 u,
the roster's widest at the time, purely because its speed was 88; the fix was `handling` 50 -> 60,
taking it to 84.2 u with speed untouched and the other two chassis untouched. Those figures moved
several times more since: the 2026-09-01 half-speed cut took the same pair to 45.7 u -> 42.1 u, and
the 2026-09-02 rewrite reset Mirage's `handling` again, to 85 (matching its `speed`), landing it at
54.9 u — the roster's widest again, now by design rather than as something to fix. The 2026-09-06
heavy-car pass (`baseMaxSpeed` 135 -> 80, `speedPerRating` 3.7 -> 2.2) then cut every car's radius by
the same ~41%, without moving a single `handling` rating, taking Mirage to today's 32.6 u — still the
roster's widest, now comfortably under one car length (48 u). A global knob could not have made the
2026-08-31 fix: Mirage was sitting on `handling` 50, the anchor rating at the time, so the standard
"widen the spread" move (raise `turnRatePerRating`, lower `baseTurnRate` to hold the pivot) would have
left it exactly where it was.

**To change one car, change its rating. Reach for a global knob only when the whole roster is
wrong** — as it was before the 2026-08-31 1.5x raise.

### Derived

Nothing here is typed anywhere — all of it is computed from the ratings and global-knob tables above.
The direct-values table (coast half-life, brake deceleration) feeds none of it: neither term appears
in a turn-rate or radius formula.

| Stat | Formula | Bullseye | Mirage | Bastion |
|---|---|---|---|---|
| **Turn rate** | `baseTurnRate + handling × turnRatePerRating` | 7.11 rad/s | **8.19 rad/s** | 6.3 rad/s |
| — in degrees | × 180/π | 407.4°/s | 469.3°/s | 361.0°/s |
| — per tick | ÷ `TICK_RATE_HZ` (30) | 0.237 rad | 0.273 rad | 0.21 rad |
| — degrees per tick | ″ | 13.58° | 15.64° | 12.03° |
| **Turn rate at rest** | `turnRate × stopTurnRatio` | 3.555 rad/s | 4.095 rad/s | 3.15 rad/s |
| — in degrees | ″ | 203.7°/s | 234.6°/s | 180.5°/s |
| Top speed | `baseMaxSpeed + speed × speedPerRating` | 223 u/s | **267 u/s** | 190 u/s |
| Reverse top speed | `× reverseSpeedRatio` | 145 u/s | 173.6 u/s | 123.5 u/s |
| **Turn radius** | `topSpeed / turnRate` | 31.4 u | 32.6 u | **30.2 u** |
| Reverse turn radius | `reverseSpeed / turnRate` | 20.4 u | 21.2 u | 19.6 u |
| 180° while moving | `π / turnRate` | 0.44 s | 0.38 s | 0.5 s |
| 360° while moving | `2π / turnRate` | 0.88 s | 0.77 s | 1 s |
| 180° from standstill | `π / turnRateAtStop` | 0.88 s | 0.77 s | 1 s |
| Rate at ram authority floor | `× 0.35` | 2.488 rad/s | 2.866 rad/s | 2.205 rad/s |

**The 2026-09-02 rewrite removed the split.** `speed` and `handling` now move together per car (65/65,
85/85, 50/50), so turn rate and turn radius order the roster the *same* way: Mirage highest/widest,
Bastion lowest/tightest. Bastion still finishes with the tightest radius — its lower speed outweighs
its lower rate — but only by 2.4 u against Mirage, not the 20+ u gap the old inverse ratings produced.
The "slow tank that out-turns everyone" identity (T6) is gone; Bastion's tank role now rests on hp and
mass alone. Watch this if a future edit reaches for `handling` to give Bastion back an edge here —
that used to be a rating move, and now it would be reintroducing the split on purpose.

**The 2026-09-06 heavy-car pass (stage 1 of the vector-drive rework) left every radius gap in the same
proportion.** Cutting `baseMaxSpeed`/`speedPerRating` roughly 41% scales every car's radius down by
the same factor — turn rate untouched — so Mirage-to-Bastion narrowed from 4.1 u (54.9 vs 50.8, right
after 2026-09-02) to 2.4 u (32.6 vs 30.2) rather than closing outright: the *ordering* and *relative*
spacing the 2026-09-02 rewrite established are exactly what this pass preserved, on top of pulling
every absolute radius down to comfortably under one car length (48 u). The same pass also cut `accel`
(`baseAccel`/`accelPerRating`), which roughly triples time-to-top-speed roster-wide — that is a
straight-line number, not a turning one, so it is not tabulated on this page.

## What to reach for, by outcome

| You want… | Tune | Why |
|---|---|---|
| Whole roster reorients/aims faster | `baseTurnRate` **+** `turnRatePerRating` together | Keeps a point of `handling` worth the same on every car |
| One chassis more agile than the others | that car's `handling` rating | Moves it within the triangle, roster scale untouched |
| `handling` to *matter more* between chassis | raise `turnRatePerRating`, lower `baseTurnRate` to hold the pivot | Widens the spread without moving the average car |
| Tighter corners without faster aim | lower `speed` (rating, or `baseMaxSpeed`/`speedPerRating`) | Radius is `speed / rate`; this is the other half |
| Snappier pivots when stopped or crawling | `stopTurnRatio` (0.5) | Only touches at-rest steering — a scale change does not reach it |
| Braking into a corner to feel rewarding | that car's `brakeDecel` against its `coastHalfLifeSeconds` | Slower entry is a smaller radius; the *situational* radius lever, and per-car since the 2026-09-06 vector-drive rework |
| Aiming easier without changing driving at all | `AIM_CONFIG.coneDeg`, `lockRange` | Assist and lock, entirely outside the drive model |
| Getting rammed to feel less helpless | `RAM_CONFIG.authorityFloor` (0.35) | Caps how much steering a ram can strip |

## What is *not* a knob

There is no grip, slip or traction value to tune for cornering. `DRIVE_CONFIG.steeringGrip` is a grip
term, but it governs how completely the velocity vector follows the heading while steering, not
lateral slip, and it ships pinned at 1 (fully "on rails") — every radius number on this page assumes
it stays there. `impactGripDecel` is the drive model's one real grip-and-slip mechanic, and it only
ever touches externally imposed motion (ram recovery), never steering. Steering itself is still
binary (`-1 | 0 | 1`), so turn rate is literally radians per second of rotation — a car either turns
at its rate or it does not turn. "The car understeers" has no direct control; it is a radius symptom,
so read it against speed.

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
suite until it has a column in the per-car ratings table and the derived table** — the two the test
reads — and the ordered row list means an inserted or reordered row fails rather than going silently
unchecked. The per-car direct-values table isn't test-checked, but a fourth chassis owes it a column
too; nothing catches that one going stale except this page's own honesty.

**Update the tables in [Current values](#current-values) whenever you change:**

| Config | Fields |
|---|---|
| `CAR_TABLE` | any car's `handling`, `speed`, `coastHalfLifeSeconds` or `brakeDecel` |
| `DRIVE_CONFIG` | `baseTurnRate`, `turnRatePerRating`, `stopTurnRatio`, `baseMaxSpeed`, `speedPerRating`, `reverseSpeedRatio`, `steeringGrip`, `impactGripDecel` |
| `STATUS_TABLE` | any status carrying a `turnRate` modifier, which needs a new row — no row does today; `overheated`'s left with the 2026-09-01 status overhaul |
| `RAM_CONFIG` | `authorityFloor`, `spinMaxRate` |
| shared | `TICK_RATE_HZ` (the per-tick rows only) |

Adding a fourth chassis means a new column in all three per-car tables (ratings, direct values, and
derived) — only the first and third are test-checked; see above.

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
