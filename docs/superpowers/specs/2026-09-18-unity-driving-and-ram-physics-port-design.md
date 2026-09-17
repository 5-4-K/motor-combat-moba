# Unity Driving and Ram Physics Port — Design

**Status:** approved 2026-09-18. Supersedes the 2026-09-06 car-physics rework's stage 5 and its
parked restitution stage (see §3).

**Source material:** `E:\Work\motor-combat-3D\Assets\_Project\Scripts\` — a 3D Unity build of this
same game, whose driving the user wants here. Driving is three files (`Driving/DriveConfig.cs`,
`Driving/DrivePhysics.cs`, `Driving/DrivingModule.cs`); the ram rules are `Ramming/RamConfig.cs`,
`Ramming/RamRules.cs`, `Ramming/RammingModule.cs`; the control-loss states are `Core/CarAbilities.cs`
and `Effects/ReelingEffect.cs`. Unity's physics engine contributes only two things to that build: a
semi-implicit Euler step, and collision response through a **zero-friction, zero-bounce** material.
Both already exist here, so **no physics engine is added and none is needed** (root `CLAUDE.md`,
"Stop and ask before").

## 1. What this changes, in one paragraph

A car stops having a hard speed cap, a per-car coast curve and an on-rails velocity that always
follows its nose. It gains **one drag rate that is always on** — setting its top speed, its wind-up
and its roll together — and **a grip rate that bleeds sideways velocity**, so a turning car drifts.
Walls and cars stop bouncing. A ram stops being a two-sided push contest and becomes Unity's rule:
strike someone with your nose above a threshold speed and the victim is flung, spun and left a
passenger for a second, while **you stop dead and lose your own controls for half of one**.

## 2. Decisions taken before this spec was written

Each was put to the user and answered. The plans must not re-litigate them.

- **U1. Scope is driving, wall/bump response, and rams.**
- **U2. Magnitudes are tuned for this arena, not copied from Unity.** The model is ported faithfully;
  the numbers are pitched against a 1132 × 612 playable area and a 60 × 40 hull. Unity's own figures
  are recorded throughout as the reference they are; §9 derives the starting values from them.
- **U3. The "no drift" rule is dropped.** `DRIVE_CONFIG.steeringGrip: 1` and the car-physics rework's
  exit criterion "Turning is precise at any speed — no wash, no fighting your own momentum" are
  deliberately overturned. Drift is the feature.
- **U4. One drag per car ("pure Unity").** Launch and roll are the same number, set by `accel`.
  `CarDef.coastHalfLifeSeconds` is deleted. A car cannot have a snappy launch and a long roll.
- **U5. Diminishing returns on rams stays**, applied to the new shove, the new spin and the new reel
  duration.
- **U6. `wildcharge`'s slam keeps its own rules** — authored push, no diminishing returns, attacker
  neither stopped nor locked. Only the meaning of the reeling it applies changes.
- **U7. This lands now, at 30 Hz, built tick-rate independent.** Every per-tick value derives from a
  per-second rate and `TICK_RATE_HZ`, and a test pins that 30 Hz and 60 Hz produce the same
  trajectory within tolerance. The netcode rewrite's plans need a refresh against current code
  regardless — phase 1's fixtures still name `speed`, `shoveX`, `shoveY` and `authority`, deleted by
  the car-physics rework's stage 1.
- **U8. Steering flips in reverse, behind a switch:** `DRIVE_CONFIG.flipSteeringInReverse`, exactly
  as Unity's `DriveConfig.flipSteeringInReverse`.
- **U9. `handling` keeps meaning turn rate**, now at the same rate at every speed including at rest.
  `stopTurnRatio`, `ChassisDrive.turnRateAtStop` and `turnRateAtStopOf` are deleted.
- **U10. Grip is one global rate to start.** No per-chassis drift rating; if the type triangle later
  needs one it is a `CarDef` field added then.
- **U11. `ramAttack`/`ramDefence` become Unity's `strength`/`resistance`** in the shove, keeping their
  current names.

## 3. Relationship to the car-physics rework

Stages 1–4 of the 2026-09-06 rework are merged. **This work replaces its stage 5
(`05-tune-and-reconcile.md`) and its parked restitution stage.**

- **Superseded:** stage 5 Task 1's playground pass (it tunes the contest and the drive model this
  spec replaces), and the parked restitution fix — §6 answers the same question by setting
  restitution to 0.
- **Inherited by this work's stage 5, not dropped:** the guide rebuild, the probe honesty pass, the
  balance re-baseline, the `CLAUDE.md` update, the `docs/turn-tuning.md` rewrite, the
  `wildcharge.impulse.speed` re-pitch (stage 4 left 520 provisional), and the deferred
  `DRIVE_CONFIG.dashSubstepMaxUnits` 16 → 8 judgement. That last one is untouched by this port — it
  concerns the dash and the collision resolver — and carries over unchanged.
- **Survives from stages 1–4 and must not be undone:** `vx`/`vy` as canonical velocity;
  `sim/velocity.ts` as the only place the world/car-frame conversion is written; the
  `Impulse`/`ImpulseDef` seam (slams keep it); edge-triggered contacts; per-victim diminishing
  returns; `ramAttack`/`ramDefence` as ratings; `ramDefence`-weighted positional separation; the
  spike shove-credit window.

## 4. The drive model

### 4.1 The step, in order

`stepDrive` keeps its signature and its three maneuver branches (DASH, HOLD, CHARGE). Its ordinary
branch becomes Unity's `DrivingModule.Tick` followed by PhysX's semi-implicit Euler step, in exactly
this order (**U12**):

1. **Decide the engine command** from the throttle and the car's current forward speed.
2. **Drag:** multiply the WHOLE velocity — forward and lateral alike — by `dragPerTick`.
3. **Grip:** multiply the LATERAL component by `gripPerTick`, unless the car is `gripless`.
4. **Yaw:** set `angVel` from the steer input, unless the car is `spinFree`, in which case the
   existing `angVel` decays instead. Then `angle += angVel * dt`.
5. **Integrate:** `v += command * dt` along the heading, then `x += v * dt`.

Three details are load-bearing (**U13**):

- **The velocity is decomposed and recomposed in the OLD heading** (`forwardOf`/`lateralOf`/`toWorld`
  at `body.angle`, not the new angle). Rotating the car must not rotate its velocity — that gap IS
  the drift. This replaces `DRIVE_CONFIG.steeringGrip`, which is deleted.
- **The engine command is applied along the old heading too**, matching Unity, where `FlatForward()`
  is sampled at the top of the tick.
- **There is no speed clamp anywhere.** Top speed is where command and drag balance:
  `maxSpeed = engineAccel / dragRate`. `accelerateForward`'s clamp is deleted, and with it the
  behaviour where a slow snapped an over-speed car down on its next throttled tick.

The two surviving maneuver branches inherit the same rules (**U37**): `stepHold` steers at the single
`turnRate` rather than a separate at-rest rate, and both `stepHold` and `stepDash` decay `angVel` by
`RAM_CONFIG.reelingSpinDecayRate` where they used to call `nextAngVel`. A dash's exit speed is
`chassis.maxSpeed * mods.topSpeed`, which still resolves — `maxSpeed` remains a resolved field even
though nothing clamps to it.

### 4.2 The engine command

Mirroring `DrivePhysics.DriveForce`:

| Throttle | Condition | Command |
|---|---|---|
| `+1` | always | `+engineAccel` |
| `-1` | forward speed > `reverseEpsilon` | `-brakeDecel` |
| `-1` | otherwise | `-reverseAccel` |
| `0` | always | `0` — drag alone |

`DRIVE_CONFIG.reverseHoldTicks` and `SimBody.reverseHold` are **deleted** (**U14**). Unity's
brake-versus-reverse threshold is the same `reverseEpsilon` the steering flip reads; a second hold
delay on top is a different model, not a tuning of this one. `reverseHold` is a networked schema
field, so this is a schema change — §10.

`reverseAccel = engineAccel * DRIVE_CONFIG.reverseAccelFactor`, so reverse top speed is **emergent**:
`maxSpeed * reverseAccelFactor`. `DRIVE_CONFIG.reverseSpeedRatio` and `reverseMaxSpeedOf` are deleted
(**U15**) — under one drag rate the push and the ceiling cannot be set independently, and Unity sets
only the push.

### 4.3 Steering

```
sense   = flipSteeringInReverse && forwardSpeed < -reverseEpsilon ? -1 : 1
angVel  = steer * turnRate * mods.turnRate * sense        // when not `spinFree`
angle  += angVel * dt
```

`forwardSpeed` is read AFTER drag, as Unity reads it after its own drag step. Turn rate does not
depend on speed magnitude, so a car turns on the spot at full rate (U9).

**`angVel` stops being an independent spin channel that steering adds to, and becomes the car's
actual yaw rate** (**U16**). A car under control has exactly the yaw rate its steering asks for, so an
injected ram spin is erased the moment control returns — Unity's behaviour, and the reason its spin
is legible. `nextAngVel`'s countersteer-accelerated decay is therefore deleted: while `spinFree`
there is no steering to counter with, and outside it there is no spin left to fight. A `spinFree` car
decays its spin at `RAM_CONFIG.reelingSpinDecayRate` per second and snaps to 0 below
`RAM_CONFIG.spinEpsilon`. `RAM_CONFIG.spinHalfLifeSeconds`, `counterSteerHalfLifeSeconds`, `RamDecay`,
`RAM_DECAY`, `resolveRamDecay`, `ramDecay()` and `rebuildRamDecay` go with it.

### 4.4 Rest

Exponential decay never reaches zero, so `DRIVE_CONFIG.stopEpsilon` survives with a widened job: at
the end of the step, if the whole velocity's magnitude is below it and the throttle is neutral, both
components snap to 0 (**U17**). Without this a coasting car creeps forever and no car is ever exactly
at rest.

### 4.5 Status channels

`Modifiers` maps onto Unity's single `TopSpeed` stat like this (**U18**):

- `mods.topSpeed` scales `engineAccel` only — top speed moves, the time constant does not.
- `mods.accel` scales `engineAccel` AND `dragRate` by the same factor — the time constant moves, top
  speed does not.
- `mods.turnRate` scales the turn rate and `mods.brakeDecel` the brake, as today.

Both channels stay meaningful under a model with one fewer degree of freedom: `topSpeed` is the
ceiling, `accel` is the responsiveness.

**A scaled drag rate is applied as a power, not as a scaled per-tick factor** (**U36**):
`exp(-k·m·dt)` equals `exp(-k·dt)^m`, so a car under an `accel` modifier multiplies its velocity by
`Math.pow(chassis.dragPerTick, mods.accel)` — exact, and it keeps the common case a plain multiply by
the precomputed factor. Scaling `dragPerTick` itself (`dragPerTick * mods.accel`) is the obvious and
wrong version: it is not the same function, and at `mods.accel` of 0 it would stop the car dead
rather than remove its drag.

**This changes what `accel: 0` means, and one caller depends on the old meaning** (**U34**).
`packages/server/src/bot/brain/predict.ts` freezes a prediction `Modifiers` with `accel: 0` and
`brakeDecel: 0`, meaning "assume the observed car neither accelerates nor brakes". Under U18,
`accel: 0` would also zero the drag, and the predicted car would coast forever at constant speed. The
frozen set must be rebuilt against the new semantics — `accel: 1` with the throttle held neutral is
the faithful translation — and its justification comment rewritten. `STATUS_LIMITS.accel.min` is a
floor on statuses, not on this internal caller, so nothing guards it.

`mods.immobilised` zeroes the throttle (drag, brake and grip still run). `mods.fullStop` still forces
the velocity to 0 every tick: **`stunned` is deliberately NOT changed** to Unity's apply-once
semantics (**U19**), because it is applied by weapons this port does not otherwise touch.

### 4.6 Per-car resolution

`ChassisDrive` becomes seven fields: `maxSpeed`, `engineAccel`, `reverseAccel`, `dragRate`,
`dragPerTick`, `brakeDecel`, `turnRate`. `coastPerTick`, `turnRateAtStop` and `reverseMaxSpeed` are
gone; `dragRate` and `dragPerTick` are both carried because the first is what a status scales and the
second is what an unmodified tick multiplies by.

```
dragRate(id)    = DRIVE_CONFIG.baseDrag + CAR_TABLE[id].accel * DRIVE_CONFIG.dragPerRating
maxSpeed(id)    = DRIVE_CONFIG.baseMaxSpeed + CAR_TABLE[id].speed * DRIVE_CONFIG.speedPerRating
engineAccel(id) = maxSpeed(id) * dragRate(id)
turnRate(id)    = DRIVE_CONFIG.baseTurnRate + CAR_TABLE[id].handling * DRIVE_CONFIG.turnRatePerRating
dragPerTick     = Math.exp(-dragRate / TICK_RATE_HZ)
```

`CarDef.coastHalfLifeSeconds` is deleted from all nine rows (U4); `CarDef.brakeDecel` stays.

**Resolver renames** (**U35**): `accelOf` now returns a drag rate, so it becomes `dragRateOf`, and a
new `engineAccelOf` returns the push. `reverseMaxSpeedOf` and `turnRateAtStopOf` are deleted. Three
consumers break and must move in the same commit:

- `packages/client/src/ui/car-select-view.ts` renders Top speed / Reverse speed / Acceleration / Turn
  rate / Turn radius from these resolvers. Its Reverse speed row loses `reverseMaxSpeedOf` and reads
  `maxSpeed * DRIVE_CONFIG.reverseAccelFactor`; its Acceleration row reads `engineAccelOf`.
- `scripts/build-cars-and-weapons.mjs` renders the same figures for the guide — **and `.mjs` is not
  typechecked, so a missed rename ships as `NaN` on the page rather than as a build error.**
- `packages/shared/src/index.ts` exports them.

## 5. Grip and drift

One global rate (U10): `DRIVE_CONFIG.lateralGripRate`, in 1/s, applied as
`gripPerTick = Math.exp(-lateralGripRate / TICK_RATE_HZ)`.

The steady-state slip angle while holding full lock is `atan(turnRate / lateralGripRate)` — at any
speed, a property of the two rates alone, which is what makes this tunable as "how much does the car
drift" rather than per-speed guesswork. Unity's 90°/s against 6/s gives ~15°.

A `gripless` car (§8) skips step 3 entirely, so imposed sideways velocity survives until drag alone
bleeds it. `DRIVE_CONFIG.impactGripDecel` and `bleedLateral` are deleted (**U20**): grip is now one
mechanism for both, which is the point of the port.

## 6. Walls and bumps

`applyContact` already reflects the whole velocity vector: `v' = v - (1 + e)(v·n)n`. At
**`DRIVE_CONFIG.restitution: 0`** that is exactly Unity's zero-bounce, zero-friction material — the
speed into the surface is removed, the speed along it untouched, so a car slides along a wall instead
of rebounding (**U22**). **No code change in `collide.ts`**: the port sets the constant and keeps the
resolver.

Two consequences worth recording: it is idempotent, so relaxation passes can no longer compound a
rebound; and it structurally answers the rework's "attacker thrown backwards" finding — there is no
reflection left to throw anyone backwards, and the rammer's stop is authored by §7 instead.

`shareOf`'s `ramDefence`-weighted positional separation is unchanged.

## 7. The ram model

### 7.1 Classification

Ported from `RamRules.cs`. For each car in a fresh contact:

- **Region** — which face the contact point lies nearest, in that car's own frame, with a corner band
  where a front or rear face meets a side: `front`, `frontCorner`, `side`, `rearCorner`, `rear`
  (**U23**). This replaces `impactSideOf`'s three-way split. Band width is
  `RAM_CONFIG.cornerBandUnits`.
- **Drive-in speed** — `max(0, dot(preCollisionVelocity, flatForward))`, from the same
  `approachVelocities` cache the current code threads through: still required, never defaulted.
- **May it attack** — not `ramBlocked` (§8), which covers both a reeling victim and a car inside its
  own attacker lock.

A car **qualifies as an attacker** when it may attack, its own struck region is `front` or
`frontCorner`, and its drive-in speed is at least `RAM_CONFIG.minRamSpeed` (**U24**). This is a real
change of rule: today the attacker is whoever drives in harder, with any face. A flank-first slide
into someone is now a plain bump.

The **type** follows from the victim's region and the angle between headings
(`RAM_CONFIG.headOnAngleDeg`): a front hit within the angle is `headOn`, a rear hit within it is
`rear`, everything else is `flank`. When both cars qualify, any head-on classification makes it a
head-on for both; otherwise the faster car attacks; an exact tie is a head-on.

### 7.2 What a ram writes

**Flank and rear** (`RamRules.ApplyRam`):

| Car | Effect |
|---|---|
| Attacker | Velocity set to **zero**. `ramLock` for `RAM_CONFIG.attackerLockMs`. Spin unchanged |
| Victim | Velocity set to **pre-collision velocity + shove**. Spin set to **pre-collision spin + spinDelta**. `reeling` for `RAM_CONFIG.ramUncontrolMs`, falloff-scaled. Shove credit recorded for the spikes |

```
shove     = attackerFlatForward * attackerDriveIn * typeScale * globalScale
            * ramAttackOf(attacker) / (ramDefenceOf(victim) * victimDefenceMult)
spinDelta = spinScale * cross(contactPoint - victimCentre, shove) / inertiaRadiusSquared
inertiaRadiusSquared = (DRIVE_CONFIG.carWidth² + DRIVE_CONFIG.carHeight²) / 12
```

`victimDefenceMult` is the victim's `ramDefence` status multiplier (`Modifiers.ramDefence`, 1 for a
car in no status) — the same reading `contactCarsOf` already threads through as `defenceMult`.
`typeScale` is `headOnScale` / `flankScale` / `rearScale`. `globalScale` is the single calibration
knob reconciling Unity's 1-vs-1 `strength`/`resistance` with this roster's 45–70 and 30–90 ratings
(**U25**). Spin is clamped to `RAM_CONFIG.spinMaxRate` as today — Unity has no clamp and does not need
one at its scale; here it is a playability guard (**U26**).

**Head-on** (`RamRules.ApplyHeadOn`): each car's velocity is set to the shove the OTHER car's heading,
speed and `ramAttack` produce against its own `ramDefence`, at `headOnScale`. Both are locked.
**Neither spins and neither reels** — Unity applies no Reeling on a head-on, and that is kept
(**U27**): a head-on is a mutual stop, not a mutual delete. Each car records the other as its shover
for the spike credit window, since each was put where it ends up by the other (**U38**).

**A ram deals no damage** (**U28**). `RamConfig.flankDamage`/`rearDamage` exist in Unity and are 0
there; they are not ported at all, so "cars never damage each other by contact" needs no guard. Spike
damage stays the only thing a shove can cost you, charged to the shover through the existing credit
window.

### 7.3 Diminishing returns

Unchanged in mechanism (U5): per victim, across attackers, rolling `RAM_CONFIG.drWindowMs`.
`impulseScale` multiplies the **shove magnitude and the spin**, so a chained ram neither throws nor
spins at full strength; `durationScale` scales the reel, with the existing floors. A head-on counts
as a ram against each car and scales each car's own shove by that car's own stack. Slams neither read
nor write the stack (U6).

### 7.4 What the ram path no longer does

`resolveRam`'s contest (`pushOf`, `impactOn`, the face bonuses, `defencePushScale`,
`minApproachSpeed`) is deleted, as is `RamHit.attackerImpulse` — the attacker's outcome is a rule
("you stop"), not a computed push. `Impulse` and `applyImpulse` survive **for slams only**; a ram
writes velocities directly in `ram-bridge.ts`, where Unity's "set, don't add" semantics can be
expressed honestly. `RAM_CONFIG.inertiaCoefficient` and the inert `knockMaxSpeed` are replaced by the
hull-derived `inertiaRadiusSquared` above (**U29**), so the inertia term cannot drift from the hull it
describes.

**The pair loop's return type changes with it** (**U39**). `applyRams` and `resolveContacts` stop
returning per-victim `Impulse` entries for rams and return a `RamResolution` instead —
`{ attackerId, victimId, type, shove: Vec2, spin, headOn }` — which is what lets the bridge write
"set to pre-collision velocity plus shove" rather than accumulating a push. `resolveContacts` keeps
its dash and slam arms unchanged: a `ContactHit` for a dash, a `SlamEvent` for a charge, both still
carrying the OBB contact geometry the bridge cannot recompute. A car in any maneuver therefore never
reaches the ram arm, which is why `ramLock` can never strand a dashing or charging car.

## 8. Statuses

Three new flags on `StatusFlag`, `Modifiers` and `modifiersOf`, mirroring Unity's ability bits
(**U30**):

| Flag | Meaning |
|---|---|
| `gripless` | Step 3 of the drive step is skipped: no lateral grip |
| `spinFree` | Step 4 does not write yaw from steering; existing `angVel` decays instead |
| `ramBlocked` | This car cannot qualify as a ram attacker |

Two rows change or arrive:

- **`reeling`** becomes `flags: ["immobilised", "steeringLocked", "gripless", "spinFree",
  "ramBlocked"]`, `modifiers: {}`, `reapply: "ignore"` (**U31**) — Unity's Reeling exactly: a
  passenger, sliding and spinning, unable to ram, still able to shoot. The rule that a flag-carrying
  debuff must be `"ignore"` therefore applies, which **costs one behaviour**: a re-ram landing while a
  reel is still running no longer extends it. That is acceptable and arguably better —
  `applyStatus`'s `Math.max(endsTick, …)` already discarded every falloff-scaled duration on that
  path, so the only case lost is a full-strength re-ram extending a live reel, precisely the chain
  diminishing returns exists to discourage. Falloff keeps scaling the shove, the spin, and the
  duration of a ram landing after a reel has lapsed.
- **`ramLock`** is a new debuff: `flags: ["immobilised", "steeringLocked", "ramBlocked"]`,
  `modifiers: {}`, `reapply: "ignore"`, applied to a ram's attacker and to both cars in a head-on for
  `RAM_CONFIG.attackerLockMs` (**U32**). Unity's `BlockRefresh.KeepLonger` becomes `"ignore"` for the
  same structural reason; with one fixed duration they differ only while a lock is already running,
  where "ignore" is the safer choice.

`ramLock` is player-visible — your car goes dead for half a second after you connect — so it is
published in the guide's Effects section through an authored `EFFECT_SOURCES` line, as `reeling` and
`phased` already are (**U33**). `EFFECT_SOURCES.reeling`'s existing line ("Every ram, and Wild
Charge's slam.") stays true and needs no edit.

`stunned`, `armored`, `phased`, `fortified`, `spiked`, `corroded`, `overhauled` and `overheated` are
untouched.

## 9. Starting values, and how they were derived

**Every number here is provisional and exists so the tuning stage has somewhere to start.** Stage 5
settles them in the playground with the user. Unity's own value is given for each, converted at
**12.9 u/m** — this game's 60-unit hull length against Unity's 4.66 m car.

### 9.1 Kept as they are

Top speeds stay where three tuning passes put them (Mirage 189.0, Bullseye 158.7, Bastion 135.9 u/s),
so `baseMaxSpeed: 60` and `speedPerRating: 1.518` are unchanged — Unity's 25 m/s would be ~322 u/s
here, crossing the 1132-unit arena in 3.5 s. `CarDef.brakeDecel` (500 / 520 / 430) stays: Unity's
brake works out at ~430 u/s², so the roster already sits on it.

### 9.2 New and changed

| Knob | Value | Where it comes from |
|---|---|---|
| `baseDrag` | 0.768 | With `dragPerRating`, targets ~1.8 s to 90% of top speed for Mirage and ~2.6 s for Bastion — between today's 1.0–1.5 s and Unity's 2.3 s |
| `dragPerRating` | 0.00608 | Anchored on `accel` ratings 85 and 20, so Bullseye's 45 falls out at 1.04 (2.2 s) |
| `lateralGripRate` | 7.0 | ~17° of slip at Mirage's turn rate, against Unity's ~15° |
| `baseTurnRate` | 0.667 | With `turnRatePerRating`, puts every chassis's turn radius near 1.5 car lengths at its own top speed — between Unity's 3.4 and today's 0.38 |
| `turnRatePerRating` | 0.0169 | Anchored on `handling` 85 → 2.10 rad/s and 50 → 1.51 rad/s; Bullseye's 65 falls out at 1.77 |
| `reverseAccelFactor` | 0.4 | Unity's `reversePower / enginePower` (12000 / 30000), replacing 0.6. Reverse top speed becomes 0.4 of forward, against today's 0.65 |
| `reverseEpsilon` | 6.0 u/s | Unity's 0.5 m/s |
| `restitution` | 0 | Unity's zero-bounce material |
| `flipSteeringInReverse` | `true` | Unity's default |
| `stopEpsilon` | 1e-3 | Unchanged |

Derived per car, for the record: engine accel 242 / 165 / 120 u/s² (Mirage / Bullseye / Bastion)
against today's 179 / 123 / 88; roll distance after lifting off at top speed ≈ 147 / 152 / 154 u,
about 2.5 car lengths.

### 9.3 Ram

| Knob | Value | Where it comes from |
|---|---|---|
| `minRamSpeed` | 39 u/s | Unity's 3 m/s |
| `headOnAngleDeg` | 45 | Unity |
| `cornerBandUnits` | 4 | Unity's 0.3 m |
| `headOnScale` / `flankScale` / `rearScale` | 0.2 / 1.5 / 1.2 | Unity |
| `globalScale` | 0.5 | Pitched so a Bastion flanking a Bullseye at top speed throws it ~237 u/s — about 4 car lengths of slide, not across the arena. **Re-measure in stage 5; do not re-derive** |
| `spinScale` | 0.3 | Pitched so a typical flank ram lands ~4 rad/s against the 6 rad/s clamp |
| `spinMaxRate` | 6 | Unchanged |
| `attackerLockMs` | 500 | Unity |
| `ramUncontrolMs` | 1000 | Unity's `reelSeconds`; unchanged from today |
| `reelingSpinDecayRate` | 2.0 | Unity's `EffectsConfig.reelingSpinDecayRate` |
| `contactPad`, `spinEpsilon`, `drWindowMs`, `durationDrScale`, `durationDrFloorMs`, `impulseDrScale`, `impulseDrFloor` | unchanged | U5 |

`wildcharge.impulse.speed` (520) and `uncontrolMs` (1400) are re-pitched in stage 5 against the new
ram scale — the obligation inherited from the rework's stage 4, now sharper: under U31 its 1.4 s of
reeling is a total loss of control, and a 520 u/s punt with no grip will carry a victim into a wall,
and often the spikes, far more reliably than today.

## 10. Wire and prediction

- `SimBody.reverseHold` and `PlayerState.reverseHold` are removed (U14). Invariant 8 is satisfied in
  the other direction: a field `stepSim` no longer reads has no business on the wire. Movers:
  `packages/client/src/net/prediction.ts` (snaps it on both the snap and ease paths),
  `net/interpolation.ts`, `scenes/ArenaScene.ts`'s pose struct, `server/src/sim/tick.ts`'s
  `bodyOf`/`writeBody`, `playtest/prediction.ts`'s field-by-field `bodyOf`, `schema.test.ts`,
  `docs/schema-reference.md` and `docs/networking.md`.
- No field is added. Drag, grip and the new flags are config- or status-derived, and statuses are
  already networked in full.
- Client prediction needs no change of its own: both halves of the lockstep call the same
  `stepDrive`. Rams remain server-authoritative and unpredicted.
- `stepSim`'s dash substepping, `resolveWorld`'s ordering contract and the maneuver fields are
  untouched.

## 11. Staging

Five stages, each independently mergeable, each leaving `npm test` green.

1. **Drive model.** `drive.ts`'s ordinary branch; `DRIVE_CONFIG`; `ChassisDrive` and its resolvers
   (U35's renames included); `CarDef.coastHalfLifeSeconds` removal; the three new flags, declared and
   read by the drive step with no row setting them yet; `reverseHold` removal; the bot's frozen
   prediction modifiers (U34); the 30/60 Hz equivalence test; the golden fixture re-pin.
2. **Walls and bumps.** `restitution: 0` and the contact tests that pin the old value, including
   `collide.test.ts`'s "one restitution per distinct surface" and the golden `resolveWorld` traces.
3. **Rams.** `sim/ram.ts` rewritten to the Unity rule; `ram-bridge.ts` writing velocities directly;
   `RAM_CONFIG` reshaped; `reeling` redefined; `ramLock` added.
4. **Slam and effects reconciliation.** `wildcharge`'s `ImpulseDef` re-pitch; the `EFFECT_SOURCES`
   line for `ramLock`; the guide's Effects section; the HUD's status chips.
5. **Tune and reconcile.** The playground pass with the user; `docs/turn-tuning.md` rewritten and its
   parser test updated; the guide rebuilt; the playtest probes made honest; a fresh balance baseline;
   `CLAUDE.md`, `docs/combat-model.md`, `docs/config-reference.md`, `docs/glossary.md`,
   `docs/bot-behavior.md`, `packages/shared/CLAUDE.md` and the rework's `EXECUTION.md` updated; the
   inherited `dashSubstepMaxUnits` judgement; the `bot-tuner` pass.

## 12. Obligations this work incurs

**`docs/turn-tuning.md` and `scripts/turn-tuning-doc.test.mjs`.** The test selects tables by header
label and compares rows by **ordered equality**, so the page and the test move together or the suite
fails:

- The per-car direct-values table exists only for `coastHalfLifeSeconds` and `brakeDecel`; with the
  former deleted the table keeps one row, and if it were emptied the selector would find no table and
  fail — so the `it()` block is edited, not just its expectations.
- The global-knob table pins `stopTurnRatio` and `reverseSpeedRatio`, both deleted, and must gain
  `baseDrag`, `dragPerRating` and `lateralGripRate`.
- The derived table's 14 rows are matched positionally: `Turn rate at rest`, its degrees row and
  `180° from standstill` go with `turnRateAtStop`; `Rate while reeling` goes because `reeling` no
  longer carries a `turnRate` multiplier; new rows are owed for the drag rate, time to 90% of top
  speed, roll distance and slip angle.
- The page's prose argues from figures no test can see — turn radii, the "1.5 u band", the
  time-to-top-speed history, the `steeringGrip`/`impactGripDecel` paragraph and the whole "What is
  *not* a knob" section, which asserts no grip value exists for cornering and becomes false.

**The players' guide.** `balanceStamp` hashes `DRIVE_CONFIG`, the active `CAR_TABLE` rows,
`STATUS_TABLE` and the copy — but **not** `RAM_CONFIG` — so stages 1, 3 and 4 each owe
`npm run build:manual`. The builder also calls the renamed resolvers and is not typechecked (U35).

**The bot.** `predict.ts` forward-models the drive step (U34); `planner.ts` and `objectives.ts` each
carry a scoring term calibrated against `steeringGrip === 1.0`, one of them saying in capitals to
re-derive every weight if a physics pass lowers it — this is that pass. A ram that stops the attacker
dead also changes whether ramming is worth planning. `BOT_BRAIN_VERSION` is bumped, and a `bot-tuner`
pass follows stage 5's tuning. **Three bot tests are already red** from the 2026-09-16 top-speed cut
and the aim-lock merge; this work does not make them green and must not silently re-pin them.

**The playtest probes.** `packages/server/playtest/` measures ram trigger rates, collision depth and
prediction error against the real pipeline, and every one is invalidated. `prediction.ts` rebuilds a
`SimBody` field-by-field and breaks first; `collision.ts` computes its sweep from
`atan(sqrt(restitution))`, which is `atan(0)` at restitution 0 and needs rethinking, not re-aiming;
`ram.ts` already carries a STALE banner; `weapons2.ts` hardcodes `6` for the spin ceiling instead of
reading `spinMaxRate`. Compile breaks are fixed on the spot; expectations are updated only where this
work fixed what the probe measured; judgement calls go to the user with the probe and the number
named. **No new probe or scenario is created.**

**The balance harness.** `configFingerprint` hashes `CAR_TABLE`, `DRIVE_CONFIG` and `RAM_CONFIG`
whole, so every stored baseline becomes incomparable and the `--baseline` refusal is correct. A fresh
baseline is handed over, not acted on. `match.test.ts`'s seed-stability comments name the last
physics pass's flipped seeds and will flip again.

**The playground.** `tuning-walker.ts` enumerates every `RAM_CONFIG` key and every non-hull
`DRIVE_CONFIG` key automatically, so the panel follows the new knobs for free — but
`tuning-walker.test.ts` pins the emitted set, and `storage.test.ts` uses `ram.defencePushScale` as a
fixture path.

**Docs describing a model that will no longer exist:** `docs/combat-model.md`,
`docs/config-reference.md`, `docs/schema-reference.md`, `docs/networking.md`, `docs/bot-behavior.md`,
`docs/glossary.md` (already stale: it says "six drive numbers" where `ChassisDrive` has eight),
`packages/shared/CLAUDE.md`, the root `CLAUDE.md`, and the rework's `EXECUTION.md`.

**One client duplicate to keep in step:** `packages/client/src/scenes/impact-feedback.ts` decides when
to play impact VFX using `RAM_CONFIG.contactPad`, a client-side copy of the ram contact test.

## 13. What is explicitly NOT in scope

- Any change to `stunned` (U19), to weapons, to damage, or to friendly fire.
- Any per-chassis grip rating (U10), any ram damage (U28), any new probe or scenario.
- The netcode rewrite's 60 Hz change (U7) and any of its fourteen phases.
- The arena polygons, the spike config and the hull dimensions. The port is tuned against them; it
  does not move them.

## 14. Exit criteria

- A car takes noticeably longer to reach top speed than today, and rolls about two and a half car
  lengths after the throttle is released.
- Holding full lock at speed leaves the car visibly sliding, at a slip angle that reads as deliberate
  rather than as a loss of control.
- A car turns on the spot at full rate; reversing steers like a real car with `flipSteeringInReverse`
  on and like a tank with it off.
- Driving into a wall at any angle slides along it; nothing rebounds.
- A nose-first flank ram at speed stops the attacker dead, flings and spins the victim, and leaves it
  a passenger for about a second. A flank-first slide into someone does nothing but bump.
- A head-on stops both cars and reels neither.
- Chained rams fall off; three seconds later they do not.
- `wildcharge` is still clearly harder than the best ordinary ram.
- The same inputs at 30 Hz and 60 Hz produce the same trajectory within tolerance.
