# Bot brain v7: a deterministic core

**Date:** 2026-10-09
**Status:** approved design, implemented 2026-10-10. Rulings corrected in place where the
implementation settled them differently; the measured numbers are in §15's implementation notes.
**Supersedes:** the decision layers of
[`2026-09-04-human-like-bot-behavior-design.md`](2026-09-04-human-like-bot-behavior-design.md)
(personalities, blunders, dice), [`2026-09-05-bot-situation-play-design.md`](2026-09-05-bot-situation-play-design.md)
(the objective weight table) and [`2026-09-05-bot-predictive-brain-design.md`](2026-09-05-bot-predictive-brain-design.md)
(the rollout planner, `proxyValue`, the EV-per-second fire gate). Their perception, prediction and
exact-solver rulings stand. `BOT_BRAIN_VERSION` goes to **7.0.0**.

Rulings are numbered **BB1–BB70**.

## 1. Why

The bot has two jobs: a practice partner for a player, and a balance instrument. The 6.x brain does
the first and fails the second, and the owner's diagnosis (2026-10-09) names why:

1. Three of twelve weapons never fire. The fire gate ranks expected damage per second, so a 16 s
   weapon loses to a 1 s gun forever.
2. It computes what nobody reads: an exact danger estimate per decision for the overlay only, five
   of six kit roles with no reader, a ram-intent roll drawn and discarded.
3. It cannot drive somewhere. Nine fixed inputs held ~0.4 s then coasted cannot express "go to
   that corner"; the hunt regression (G12) is open.
4. Its cheap shot model is wrong for the weapons that matter: aim off the nose even for turret
   rows, ticking beams under-counted 4-5x.
5. Sticky choices override its own maths (+200 on a scale of tens), while the target is re-picked
   every tick under a plan held for up to 24 ticks.
6. It is over its time budget.
7. The human-likeness is noise on an optimiser: delays and dice at four stages, three noise sources,
   five archetypes, 117 profile values and 48 weights. That gives a person's wobble, not a person's
   way of deciding, and it makes every balance number high-variance.

The verdict (BB1): **keep the shell, replace the decision core.** The fairness boundary, perception,
prediction and the exact shot solver answer "what may the bot know" and "would this press land",
and they are right. The middle (situation → weight vector → nine rollouts → proxy scoring → sticky
slot choice) is replaced by two small deterministic layers.

### Constraints the owner set

- **BB2 Not slower.** A balance run must not take longer than today (a 180 s hard six-bot
  deathmatch runs in ~66 s of wall time after the 2026-10-09 solver speedup). Faster is welcome.
  Met: the 30 s seed-7 hard deathmatch went from 8.2 s to 5.0 s of wall time (BB64).
- **BB3 Simpler over falsely smart.** Where a smarter rule risks false balance readings, the simple
  rule wins. But not braindead: every tier moves, shoots and reacts.
- **BB4 No cheating.** The bot decides from `BotView` and nothing else. `BotView` does not change.
- **BB5 Reaction is a skill parameter.** Every tier has a reaction delay, view staleness, acquire
  time and dodge reaction, laddered by tier. These stay, in the balance harness too (a zero-delay
  pilot would dodge every projectile on its spawn tick and undervalue every projectile weapon).
- **BB6 One bot, no dice.** The practice bot and the balance pilot are the same code and the same
  tier rows. Everything that was a coin flip becomes a threshold on observed state, and blunders,
  fidget and personality archetypes are deleted. What is left random is seeded skill modelling only
  (the aim-error sample and the state-estimation draws), so a seed replays and two seeds differ by
  hands, not by whether the bot bothered to react. (During brainstorming a `humanize: false` harness
  flag was proposed; with the dice gone there is nothing for it to switch off, so there is no flag.)
- **BB7 Rams are played.** A `ram` situation exists so `ramAttack`/`ramDefence` are measured.
- **BB8 Firing is greedy on hit chance.** No ult holding. A weapon that will land, fires.

## 2. Pipeline and modules

```
perceive (every tick)                      kept
  ↓ on the tier's recompute cadence
  predict      physicsPredictor(target), selfPredictor        kept
  solve        one exact FiringSolution per ready slot         kept
  assess       facts → one situation, by thresholds            rewritten (situation.ts)
  navigate     situation → Goal → steer/throttle               NEW (navigate.ts)
  shoot        greedy on hit chance + combo + turret bearing   rewritten (shooter.ts)
  ↓
humanize (every tick)                      kept as the delay line only
```

**BB9 Kept unchanged:** `types.ts` (minus the deletions in §11), `view.ts`, `view-ring.ts`, `rng.ts`,
`predict.ts`, `aim.ts`, `reach.ts`, `solution.ts`'s `solve`, `constantVelocityPredictor`,
`readyInTicksOf`, `marchTicksOf`, `turretTurnTicksOf` and everything they call.

**BB10 Deleted:** `planner.ts`, `objectives.ts`, `personality.ts`, `roles.ts`, `goals.ts` (replaced by
`target.ts`), `planner.bench.test.ts`, `legacy-octagon.fixture.ts` if nothing else reads it after
the rewrite; from `solution.ts`: `proxyValue`, `proxyDangerAgainst`, `dangerEvAgainst`,
`bestAchievableValueOf` and `CEILING_RANGE_FRACTIONS`; from `humanize.ts`: blunders and fidget; from
`controller.ts`: everything the old `plan()` did except glue; from `perception.ts`: the `dodgeChance`
roll and the `reacting` field's dice semantics; from `firing.ts`: `preferredRangeOf`, `isUlt`,
`isUltWeapon`, `chooseSlot`'s stickiness, ult hold and EV gate; from `movement.ts`: nothing, but
`wallAhead`/`spikesAhead` become thin wrappers over a new `wallPush` (BB31).

**BB11 New or rewritten:** `navigate.ts` (goal types and the steering law), `target.ts` (target
choice), `ranges.ts` (effective reach and the range band), `situation.ts` (adds `ram`, new inputs),
`shooter.ts` (the shooter; `firing.ts` is deleted), `controller.ts` (glue), `humanize.ts` (delay
only).

**BB12 Every tick:** `perceive`, `stepAimError`, the delay line. **Every recompute** (`recomputeTicks`,
67/200/400 ms by tier): everything else, including target choice (BB46), so the target and the
decision made about it are always from the same tick.

## 3. Fairness

**BB13** `BotView` is unchanged. Every input to every new function is a field of `BotView` or state
the bot derived from earlier views. In particular the shooter reads only its own slots' readiness
(own HUD), `readinessOf` for an opponent stays an inference from observed fires, and the ram
situation reads the opponent's `statuses` list (drawn on screen) and the bot's own slot timers.

**BB14 Remaining `rng()` draws, all unconditional and in fixed order per tick:** `stepAimError`
(two per tick, Box-Muller) and `physicsPredictor` (four per recompute). Nothing else draws. The
whole-brain determinism test (old P51) stays and is the guard.

## 4. Assess: situations

**BB15 The situations**, in priority order (lower index wins when two apply at once):

| # | Id | When | Fires? |
|---|---|---|---|
| 0 | `recover` | self dead, or carrying `phased`, `stunned`, `reeling` or `ramLock` | no |
| 1 | `evade` | a reacted-to shot in flight (BB19), or an incoming car (BB20) | yes |
| 2 | `unpin` | `wallPush` reports a wall, spike or corner ahead (BB33) | yes |
| 3 | `waitOut` | no hittable target noticed | no |
| 4 | `punish` | target `stunned` or `reeling`, or target HP ≤ `punishHpFraction` | yes |
| 5 | `reset` | own HP < `retreatHpFraction` (0 at easy: never) | yes |
| 6 | `ram` | target hittable, within `ramRangeUnits`, and the kit is dry (BB21) | yes |
| 7 | `fight` | the target is within raw reach of a usable slot, ready or not (7.1.0) | yes |
| 8 | `close` | target hittable and out of reach of every usable slot, ready or not | no |

`ram` is new. `evade` and `unpin` outrank `waitOut` so a hunting bot still dodges and un-pins:
`unpin` no longer needs a target and is no longer a coin flip. `punish` drops the "they just spent
a big gun" trigger and the ult concept with it.

**BB16 Hysteresis** keeps `pickSituation` exactly: the same situation re-commits every
`situationCommitTicks`; a higher-priority situation cuts in at once; a lower one waits out the
commit; `recover` and `waitOut` are left the moment their facts stop holding.

**BB17 Self control lost** reads the bot's own status list, which its HUD shows. Any of the four
statuses above forces `recover` and a coast, which is what a player under a stun or a ram lock
does anyway, and it stops the ram situation re-entering during its own `ramLock`.

**BB18 `hittable`** is a noticed car that is alive, not phased and on the other team. Dead and
phased cars are never targets: no ghost chasing, no `deadRespect`.

**BB19 Dodge is a timing fact, not a coin.** A threat is `reacting` iff its estimated time to reach
the bot, measured once when the bot first notices it, exceeds `dodgeReactionTicks`: `eta = distance
from the shot to the bot / the weapon's projectile speed`, in ticks. A weapon with no travel speed
has `eta = 0` and is never dodged; an attached speed-0 beam aimed at the bot is still tracked (it
takes a `trackedThreatLimit` place and records blame) but is never reacted to. A shot is a threat
at all only if `threatHeading` projects its closest approach, inside `dodgeHorizonTicks`, to within
a car's half-diagonal plus 16 u, which caps the ETA at `dodgeHorizonTicks` plus that slack (~3.5
ticks at a typical shot speed). So a shot is dodged when its ETA lies in `(dodgeReactionTicks,
dodgeHorizonTicks + ~3.5]` ticks at 60 Hz: easy (24, 27.5], medium (16, 39.5], hard (4, 51.5].
Easy practically never dodges (accepted: 6.x's 0.05 `dodgeChance` was the same in effect); hard
dodges nearly everything it sees coming. `trackedThreatLimit` still caps how many are tracked.
`dodgeChance`, `hearChance` and `incomingCarChance` are deleted.

**BB20 Incoming car** keeps `isIncomingCar` (closing speed and an ETA inside `dodgeHorizonTicks`),
and is always reacted to.

**BB21 Kit is dry** when no slot is ready now and none becomes ready within `ramDryWindowTicks`
(`readyInTicksOf` on the bot's own slots); a kit with no usable slot is dry by definition. The ram
also requires the bot not to be in `recover`
(BB17 already guarantees it) and the target within `ramRangeUnits`.

## 5. Navigate: goals and the steering law

**BB22 A `Goal`** is what a situation wants, and the only thing the navigator reads:

```ts
interface Goal {
  x: number; y: number;        // the point
  range: number;               // the distance to hold from it; 0 means arrive
  facing: "nose" | "orbit" | "free";
  reverseOk: boolean;          // may the car back toward/away from the point
  forwardOnly?: boolean;       // ram: never lift off
}
```

**BB23 Per-situation goals** (`controller.ts` builds them; `believed(t)` is the raw target
predictor's position `t` ticks ahead; the realised aim offset enters only through the steering
law's `nose` term (BB24), so nothing is counted twice; `lag` is `reactionDelayTicks`):

| Situation | point | range | facing | reverseOk |
|---|---|---|---|---|
| `recover` | none: emit coast | | | |
| `waitOut` | self + hunt heading × `awarenessRadiusUnits` (BB36) | 0 | nose | no |
| `evade` | self + dodge direction × `dodgeDistanceUnits` (BB34, BB35) | 0 | free | yes |
| `unpin` | self + last push direction × `unpinDistanceUnits` (BB33) | 0 | free | yes |
| `punish` | `believed(lag)` | `max(minEngageUnits, ownComfort × punishRangeFraction)` | nose | yes |
| `reset` | `believed(lag)` | `max(fightRange × resetRangeMultiplier, minEngageUnits)` | nose | yes |
| `ram` | target predicted at `min(d / own top speed, horizon)` ticks | 0 | nose | no, forwardOnly |
| `fight` | `believed(lag)` | `fightRange` (BB44) | nose if the shooter wants it (BB47), else orbit | yes |
| `close` | `believed(lag)` | `min(0.9 × reach, distance)`, where reach is the longest among slots ready within `soonReadyTicks`, else the kit's longest: never farther than the car already is (7.1.0) | nose | no |

**BB24 The steering law** turns a `Goal` into `steer` and `throttle`, both in `{-1, 0, 1}`:

```
d       = distance(self, goal);  e = d - goal.range;  band = rangeBandUnits
bearing = atan2(goal - self);    delta = signedDelta(self.angle, bearing)
canReverse = goal.reverseOk && !goal.forwardOnly
desiredOff = 0
nose:   delta += aimError.offsetRad                       // shaky hands wander the nose
orbit:  e < -band → backingOut = true;  e > +band → backingOut = false
        backingOut → reverse nose-on (desiredOff 0)       // out across the whole band
        e > band   → forward, desiredOff 0                // too far: straight at it
        else       → forward, desiredOff = orbitSide × orbitOffsetRad   // in, at an angle
free:   reversing → delta = signedDelta(self.angle + π, bearing)        // from the tail (BB26)
steer = latch(delta - desiredOff)                         // BB28
```

**Orbit is a weave, not a circle.** A constant-range circle needs the target 90° off the nose, which
is outside every turret's arc (BB27), so it is not attempted. The car drives in across the band
with the target held `orbitOffsetRad` off the nose; once it is a band too close it sets
`backingOut` and reverses nose-on (holding if it cannot reverse); `backingOut` clears only once it
is a band too far, and it drives in again. `NavState` is `{ orbitSide, steering, backingOut }`.

Steering is absolute in this sim (`flipSteeringInReverse: false`), so `steer = sign(delta)` yaws the
nose toward the bearing whether the car is moving forward or backward. That is what makes "reverse
with the nose on the target" one line.

**BB25 Throttle:**

- `nose`: `e > rangeBandUnits` → `+1`; `e < -rangeBandUnits` → `-1` if the car can reverse, else
  `0` (hold; there is no drive-away-at-an-angle branch); inside the band → `0`.
- `orbit`: `+1`, except while `backingOut` (BB24): `-1`, or `0` if the car cannot reverse.
- `free`: arrive. `d ≤ rangeBandUnits` → `0` and the wheel is released. Else if `|delta| ≤ π/2` or
  the car cannot reverse → `+1`; else → `-1` (the point is behind; back toward it).
- "Can reverse" is `reverseOk && !forwardOnly`, decided before any branch, so a ram never takes
  the tail-steer path; `forwardOnly` then overrides the throttle to `+1`.

**BB26 Reversing toward a point** measures the steering error from the tail: `delta_tail =
signedDelta(self.angle + π, bearing)`, so the car backs along the line to the point. For a `free`
goal the throttle (BB25) is decided first and the steering error is then measured from the nose or
the tail accordingly.

**BB27 `orbitSide`** is state (`+1` target kept on the `+angle` side, `-1` the other; `0` until an
orbit begins). It is set to the side the target is on when orbit begins, and flips only when the
target is on the other side by more than `π/2` (`sign(delta) ≠ orbitSide && |delta| > π/2`) or when
the reactive layer (BB32) steers away from a wall on the orbit's inside. The controller resets the
whole `NavState` on a situation change and on a target change, so a new goal is never steered by
an old one's side, wheel or back-out flag. `TURRET_CONFIG.maxSwingDeg` 60 is the TOTAL arc, so a
turret reaches ±30° (±0.524 rad) off the nose; `orbitOffsetRad` 0.45 keeps the target inside it
with a 4° margin, which is why every turret-armed chassis can shoot while weaving.

**BB28 The latch** stops wheel chatter: beyond `steerDeadbandRad` the wheel takes the error's sign;
under `steerDeadbandRad / 2` it lets go; between the two it holds only while the error keeps the
sign the wheel is held for, so an error that crosses zero inside the hold window releases it.

**BB29 Nothing rolls the drive model.** The steering law is closed-form on the current pose. The
cost per replan is a few hundred flops. The 760 `stepDrive` steps per hard plan are gone with the
planner.

**BB30 Why not the planner with better scoring.** Considered and rejected: a rollout planner is only
as good as its score, the score needs terms on one scale, and the one honest scale (expected HP
exchange) costs the exact solver per candidate per sample. A steering law expresses "drive there"
directly, which is the capability the planner lacked (G12, item 3), and costs nothing.

### Walls

**BB31 `wallPush(pose, arena, lookaheadUnits)`** (`movement.ts`) returns an `{x, y}` sum of unit
vectors pointing away from what is near: every boundary plane and plain obstacle within the hull
margin of the look-ahead point; every spike strip within the hull margin of the look-ahead point
sampled at both `1×` and `spikeLookaheadFactor×` `lookaheadUnits`, honouring the one-sided face rule
(a safe face does not count); and, when two or more boundary planes lie within `minEngageUnits` of
the car's own position, those planes' normals (a corner). It has any-hit semantics: it is
`undefined` only when nothing contributed, and when something did but the vectors cancel (a car
between two walls, or at a box's exact centre) it returns a unit push opposite the heading, so a
consumer backs up rather than reading "clear". `wallAhead`, `spikesAhead` and `inCorner` test the
hit counts of the same accumulators, not the vector, so two cancelling walls still read pinned and
their existing tests keep their meaning.

**BB32 The reactive layer** (`avoidWalls`). After the steering law, in every situation but `recover`
and `unpin`: if `wallPush` reports a push, `throttle` is `+1` and the push does not already point
along the heading (`heading · push ≤ 0`), steer toward the push's side (sign of
`cross(heading, push)`, latched) and flip `orbitSide` to match; if the push is nearly dead ahead
(`|cross| < 0.3` on unit vectors) set `throttle = -1` for this decision. This keeps a bot from
driving into a wall it is not yet pinned on; `unpin` handles the pinned case with a goal.

**BB33 `unpin`** is entered when `wallPush` at the tier's `wallLookaheadUnits` reports a push. Its
goal is the push direction at `unpinDistanceUnits`, facing free, reverse allowed. It reads the last
non-empty push (`lastPush`), so an `unpin` held through its commit window keeps its direction after
the push clears. A corner or a wall dead ahead therefore backs out, a wall off the nose turns away
from it.

### Dodging

**BB34 The dodge direction** is the unit vector of the sum of every reacting threat's `awayHeading`
and, for an incoming car (BB20), the heading perpendicular to its velocity on the side the bot is
already on (two shots from opposite sides cancel: nowhere to go, so the other situations decide).
When the sum is near zero, the first tracked threat's away heading is used alone. The dodge is a `free` goal so
the car takes whichever of forward or reverse is quicker.

**BB35 `evade` is an event**, as in 6.x: it holds for the commit window and then the situation
re-evaluates. Shot threats expire when the instance leaves the view or stops threatening. While a
held `evade` outlives its threats it keeps its last dodge direction (`lastDodge`), and backs straight
up if it never had one; `lastDodge` is cleared when `evade` ends.

### Hunting

**BB36 Hunt heading** keeps 6.x's order: last-known anchor, then the nearest heard shot (hearing is
always on), then the search waypoints with the same advance rule (within `minEngageUnits`). The
goal is projected at `awarenessRadiusUnits` along the heading, facing nose, forward only. The
steering law turns to it and drives (G12 closes by construction).

## 6. Shoot

**BB37 Solve** runs once per ready slot per recompute, as today, with the raw predictor. Nothing
else runs the solver per decision.

**BB38 Pressable** slot `i`: ready (`stocks ≥ 1`, past `refireLockUntilTick`), not the disabled
basic-attack slot, `hitChance ≥ hitChanceBar`, `expectedDamage > 0`.

**BB39 Press order.** At most one press per decision, after `burstGapTicks` since the last press and
outside the bot's own switch lock:

1. if the target is `stunned`: the pressable slot with the highest `expectedDamage`;
2. else if a pressable slot applies `stunned` to opponents (the kit's setup slot): that slot;
3. else: the pressable slot with the highest `expectedDamage`.

Cooldown never enters the ranking. A 16 s weapon that lands is pressed on its hit chance like any
other. No ult window, no discipline roll, no stickiness.

**BB40 Turret bearing** on a press is the solution's `turretBearingRad` plus the realised aim
offset, as in 6.x (TR25/TR26).

**BB41 `mayFire`** is the situation table's column: `recover`, `waitOut` and `close` hold fire.

## 7. Ranges

**BB42 `effectiveReachOf(weaponId, sigma, bar)`** is the farthest distance, on a
`effectiveReachSamples`-step sweep from `minEngageUnits` to the weapon's reach, at which `solve()`
against a stationary target straight ahead returns `hitChance ≥ bar`; `minEngageUnits` when no
sample clears the bar. The probe runs in an open arena with the shooter at its centre: a beam's wall
clip treats a point on the bounds edge as outside, and an earlier corner placement clipped every
beam to nothing. Memoised per `(weaponId, sigma, bar)` under the active bundle object (`cfg()`), the
server twin of the client's `memoOnBundle`, so it is computed once per weapon per tier per bundle
and a playground sibling bundle or a mode's weapon override never reads another bundle's reach. A
`range: 0` maneuver's reach is `contactTriggerUnits`, as today.

**BB43 `ownComfort`** is `comfortFraction ×` the smallest effective reach among slots ready within
`soonReadyTicks`; when none is, `comfortFraction ×` the kit's largest effective reach (stand off
while reloading). Standing where the shortest ready gun pays is what lets a kit fire all of itself,
which is the property a balance run needs. (6.x's `preferredRangeOf` sampled a proxy and read a
plateau edge; it is gone with the proxy.) Since 7.1.0 a bot reloading inside its kit's reach is in
`fight` (BB15), so `fight` is where the stand-off branch is read: it backs out to the kit's longest
effective reach while nothing is soon-ready, and the shooter presses nothing until a slot is ready.

**BB44 `theirKeepOut`** stays: the opponent's shortest known gun (chassis kit plus weapons seen
fired) × `opponentRangeRespect`. **`fightRange = max(ownComfort, theirKeepOut)`.**

**BB45 The band** is `rangeBandUnits` either side of the goal range.

## 8. Target choice

**BB46 `chooseTarget`** (`target.ts`) scores hittable cars on the recompute tick only: proximity (1 −
distance / awareness), wounded × `woundedBias` × 2, grudge × `vengefulness` × 2 (grudge decays over
`targetCommitTicks` since that car last shot at us, as today), stickiness × 1.5 for the held target
inside its commit window. No noise term. A fixed `targetSessionId` (practice) short-circuits as
today, except that a dead or phased fixed target yields no target rather than a ghost.

**BB47 The shooter tells the navigator whether to face.** `wantsNose` is true when some slot is
ready, has no turret, reaches the target, and is not pressable (it would land if the nose came
round). `fight` then uses `nose`; otherwise `orbit`.

## 9. Humanize

**BB48** `applyHumanize` is the delay line: the decided intent is emitted `reactionDelayTicks` later.
Blunders, the runner-up line, idle fidget and their state are deleted.

## 10. Configuration

**BB49 `BotProfile` v7**, 23 fields (from 39). Timing fields are authored in ms and resolved to ticks
as today.

| Field | easy | medium | hard | Change |
|---|---|---|---|---|
| `viewStalenessMs` | 133 | 100 | 67 | kept |
| `reactionDelayMs` | 300 | 200 | 133 | kept |
| `recomputeMs` | 400 | 200 | 67 | kept |
| `acquireMs` | 500 | 300 | 167 | kept |
| `awarenessRadiusUnits` | 600 | 700 | 900 | kept |
| `rearBlindHalfAngleRad` | 1.05 | 0.6 | 0 | kept |
| `trackedThreatLimit` | 1 | 2 | 4 | kept |
| `memoryMs` | 500 | 1500 | 3000 | kept |
| `stateEstimationSigma` | 0.25 | 0.1 | 0.03 | kept |
| `aimErrorSigmaRad` | 0.18 | 0.09 | 0.035 | kept |
| `aimErrorDriftMs` | 667 | 467 | 300 | kept |
| `burstGapMs` | 467 | 233 | 100 | kept |
| `hitChanceBar` | 0.3 | 0.5 | 0.7 | **new**, replaces `minShotValueFraction` (BB50) |
| `targetCommitMs` | 5000 | 2000 | 833 | kept |
| `woundedBias` | 0.1 | 0.5 | 0.9 | kept |
| `vengefulness` | 0.8 | 0.5 | 0.25 | kept |
| `wallLookaheadUnits` | 40 | 90 | 150 | kept |
| `retreatHpFraction` | 0 | 0.3 | 0.35 | kept |
| `punishHpFraction` | 0.4 | 0.4 | 0.4 | renamed from `ultWindowHpFraction` |
| `opponentRangeRespect` | 0 | 0.45 | 0.9 | kept |
| `dodgeReactionMs` | 400 | 267 | 67 | kept, now the dodge threshold (BB19) |
| `dodgeHorizonMs` | 400 | 600 | 800 | kept |
| `situationCommitMs` | 667 | 400 | 200 | kept |

**Deleted:** `minShotValueFraction`, `ultDisciplineChance`, `ramIntentChance`, `dodgeChance`,
`blunderChance`, `blunderMs`, `idleFidgetChance`, `scoreNoiseSigma`, `hearChance`, `deadRespect`,
`cornerRespect`, `incomingCarChance`, `slotStickMs`, `planHorizonMs`, `planDepth`,
`targetBranches`, `commitPenalty`.

**BB50 `hitChanceBar` is the one new knob and the one that gets calibrated.** `solve()`'s
`hitChance` is a sum of the five quadrature node weights (0.457 centre, 0.240 at ±1.15σ, 0.031 at
±2.37σ), so it is quantised: the bar is a statement about which nodes must land. The useful steps
are: in `(0.06, 0.457]` the exact aim must land; in `(0.457, 0.697]` one 1.15σ error must also land;
in `(0.697, 0.937]` both must. The starting values sit one per step, easy 0.3 / medium 0.5 /
hard 0.7, so the tiers differ in kind: easy fires when its best aim lands, hard only when a
1.15σ hand error on either side still lands. Calibration on the duel fixture kept all three: hard
kills a stationary dummy at 2.07× its kit's floor (BB60's bound is 5×) and easy still fires (§15's
implementation notes). Everything else carries its 6.x value.

**BB51 `BRAIN_CONSTANTS` v7:**

| Constant | Value | Reader |
|---|---|---|
| `minEngageUnits` | 70 | ranges, hunt arrive |
| `contactTriggerUnits` | 150 | `weaponReachOf`, `isIncomingCar` |
| `predictionHorizonMs` | 3000 | solver and ram predictor |
| `fullLockAngVelFraction` | 0.5 | `predict.ts` |
| `interceptFixedPointRounds` | 3 | `predict.ts` |
| `spikeLookaheadFactor` | 2 | `wallPush` |
| `comfortFraction` | 0.85 | BB43 |
| `punishRangeFraction` | 0.5 | BB23 |
| `resetRangeMultiplier` | 1.15 | BB23 |
| `rangeBandUnits` | 40 | BB25, BB45 |
| `steerDeadbandRad` | 0.06 | BB24, BB28 |
| `orbitOffsetRad` | 0.45 | BB24, BB27 (inside the turret's ±0.524 rad half-arc; `maxSwingDeg` 60 is the total) |
| `dodgeDistanceUnits` | 120 | BB23 |
| `unpinDistanceUnits` | 180 | BB23 |
| `soonReadyMs` | 1000 | BB23, BB43 |
| `ramDryWindowMs` | 1500 | BB21 |
| `ramRangeUnits` | 400 | BB15 |
| `effectiveReachSamples` | 12 | BB42 |

Deleted: `preferredRangePlateauFraction`, `preferredRangeSampleCount`, `preferredRangeMinStepUnits`,
`ultFireSlots`, `personalityJitter`, `assumedOpponentAimSigmaRad`,
`targetBranchMaxHeadingOffsetRad`, `trajectorySampleCount`, `commitWindowFraction`,
`minRolledHorizonMs`.

**BB52 The ladder test** (`bot-profiles.test.ts`'s `LADDER`) is rewritten for the 23 fields; the
"every probability in [0, 1]" tests go with the probabilities, and `hitChanceBar` joins the
unit-interval set.

## 11. Debug, wire and overlay

**BB53 `BotDebug`** becomes `{ tick, situation, targetSessionId, goalRange, goalFacing, firedSlot,
bestHitChance, hitChanceBar, steer, throttle }`. `personality`, `preferredRange`, `dangerEv`,
`plan`, `planTerms` and `shotEv` are gone, and so are `BotPersonality` and `PersonalityId`.

**BB54 `SituationId`** gains `"ram"`; shared's `SITUATIONS` list (the wire validator) gains it in the
same change.

**BB55 `BotDebugPayload`** becomes `{ tick, situation, goalRange, goalFacing, firedSlot,
bestHitChance, hitChanceBar, steer, throttle }` with `isBotDebugPayload` updated. The playground
overlay prints one line:

```
situation | range N facing | slot K | hit BEST/BAR | drive(+1,0)
```

`slot -` means held fire; `hit` is the best solved hit chance against the bar, which is the whole
holds-fire diagnostic now.

## 12. Harness and versioning

**BB56** `BOT_BRAIN_VERSION = "7.0.0"`. `botFingerprint` keeps hashing `BOT_PROFILES` plus the
version, so every 6.x balance report becomes incomparable, which is correct.

**BB57** The balance CLI does not change. `--skill` still maps to a tier and that tier is the
measurement pilot (BB6).

**BB58** `balance/match.test.ts`'s pinned seeds are re-measured once on the new brain and re-pinned
with the measured values; its determinism and "seeds differ" properties stay as written.

**BB59** `balance/README.md`'s "Before you trust a number" gets a 7.0.0 entry (greedy firing, rams
played, no dice, comparability) and loses the `proxyValue` turret-distortion entry.

## 13. Tests

**BB60 Tier characterisation** (`tiers.test.ts`) keeps these properties, rewritten against the new
core: hard dodges a shot easy ignores; hard resets when hurt and easy fights on; hard focuses the
wounded car and easy chases whoever shot it; the rest of the kit is used when the best slot is down;
a wall changes what hard does; easy closes on a visible target with throttle forward; hard Bastion
fights then punishes once the stun lands; presses rise with tier at a good angle; hard kills a
stationary target inside five times its kit's floor; hard fires at its range rather than parking;
hit rate rises above easy; whole-brain determinism per seed. The ult-burning test is deleted with
the concept.

**BB61 New unit tests:** `navigate.test.ts` (turns toward, holds the band, reverses when too close in
nose mode, weaves across the band, dodge goal, reverse-toward-a-point from the tail, the latch,
wall push steering and the dead-ahead reverse); `situation.test.ts` (priority, `ram` entry on a dry
kit, `recover` on own statuses, `unpin` without a target); `shooter.test.ts` (pressable, the three
press orders, a 16 s weapon fires when it lands, burst gap and switch lock); `ranges.test.ts`
(effective reach monotone in sigma, comfort picks the shortest ready gun); `target.test.ts`
(no noise, commit, no ghosts); `perception.test.ts` (reacting by ETA); `humanize.test.ts` (delay
only).

**BB62 Hunt (G12)** gets a passing test: a bot with a waypoint 150° behind it turns and drives
toward it within two seconds.

**BB63 Determinism** (old P51) stays.

**BB64 Bench.** `planner.bench.test.ts` is replaced by `brain.bench.test.ts`, which times a hard
`decide` on the duel fixture against the same reference-workload ratio method, with the ratio
re-measured. The acceptance number for BB2 is the harness itself: the 30 s seed-7 hard deathmatch
the 2026-10-09 speedup used (13-14 s then) is timed before and after and the figures recorded in
the README entry (BB59). Measured: 8.2 s on 6.8.0, 5.0 s on 7.0.0 (wall time of `npm run balance`,
same machine, startup included). A hard `decide` costs ~0.55 ms of CPU averaged over consecutive
ticks, dominated by `solve()` (~1.47 ms per `pepperbox` solve); the bench anchors to its own
measured ratio, and the old P33 budget, which covered the planner alone, no longer applies.

**BB65 Scope** per `CLAUDE.md`: this touches `bot/`, `rooms/` (overlay payload), `balance/` and
shared's wire list, so `npm test` plus `npm run test:slow` plus `npm run playtest -- --scope=all`
are owed. No playtest probe reads the bot; none should move. A single bot test file runs with
`cd packages/server && npx vitest run -c vitest.slow.config.ts <paths>` (the slow config; the
normal one excludes `src/bot/**`).

## 14. Documentation

**BB66** `docs/bot-behavior.md` is rewritten from scratch, short: the pipeline, the situation table,
the goal table, the steering law in prose, the profile table, the overlay line, and a complaint →
knob table with the surviving knobs only. The 6.x page's history paragraphs are not carried.

**BB67** `.claude/skills/bot-tuner/SKILL.md` is rewritten against the new knobs and overlay.

**BB68** `CLAUDE.md`'s Bot paragraph names the new pipeline (perceive → predict → solve → assess →
navigate → shoot → humanize), the `ram` situation, and that there are no dice; `docs/testing.md`
loses the G12 known-failure note; `packages/server/balance/README.md` per BB59; `docs/glossary.md`
gains `Goal`, `measurement pilot` and `hit-chance bar`.

## 15. Non-goals

**BB69** No change to `BotView`, `view.ts`, the vision model, the drive model, the sim, any weapon
or chassis number, the balance report format, or the harness CLI. No team play beyond today's
"shoot the other team". No new probe.

**BB70** The three 6.x specs stay in the repo as records; their rulings on perception (H7, H22,
P18-P21), prediction (P22-P24) and the exact solver (P1-P14, P43) remain in force and are not
renumbered here.

### Implementation notes (2026-10-10)

- **Effective reach (BB42), measured.** At hard (sigma 0.035, bar 0.7): `predator` 646.67,
  `lance` 1200, `magmablast` 900, `thumper` 893.33. At sigma 0.18 (easy's hands): 70 / 258 / 139 /
  173. The probe stands at the centre of an open arena and the memo is keyed on the active bundle.
- **Dodge windows (BB19).** A shot is dodged when its ETA at notice lies in `(dodgeReactionTicks,
  dodgeHorizonTicks + ~3.5]` ticks: easy (24, 27.5], medium (16, 39.5], hard (4, 51.5]. Easy
  practically never dodges, which was accepted; attached speed-0 beams are never dodged.
- **Calibration (BB50).** `hitChanceBar` stayed 0.3 / 0.5 / 0.7. On the duel fixture (seed 17):
  hard kills a stationary dummy at 2.07× its kit's floor; hit rates easy / medium / hard are
  0.571 / 0.700 / 0.750; presses over 300 ticks are 5 / 11 / 35.
- **Timing (BB2, BB64).** The 30 s seed-7 hard deathmatch: 8.2 s on 6.8.0, 5.0 s on 7.0.0, wall
  time of `npm run balance` on the same machine, startup included. A hard `decide` costs ~0.55 ms
  of CPU, dominated by `solve()` (~1.47 ms per `pepperbox` solve).
