# Bot behaviour

Which knob to reach for when a bot feels wrong. The config file is the source of truth:
[`packages/server/src/config/bot-profiles.ts`](../packages/server/src/config/bot-profiles.ts).
This page is a transcription — re-check it whenever a tier value changes.

**Unlike `docs/turn-tuning.md`, nothing tests this page.**

One brain, three rows of numbers. Feel complaints belong in the
[`bot-tuner`](../.claude/skills/bot-tuner/SKILL.md) skill, which reads the live table and proposes
knob moves — not a Hard-only branch.

Design: [`docs/superpowers/specs/2026-09-05-bot-situation-play-design.md`](superpowers/specs/2026-09-05-bot-situation-play-design.md)
(S1–S28). Firing solutions, prediction and the planner: P1–P58 of
[`docs/superpowers/specs/2026-09-05-bot-predictive-brain-design.md`](superpowers/specs/2026-09-05-bot-predictive-brain-design.md).
Fairness / hands / personalities: H1–H8 and H16–H48 of
[`docs/superpowers/specs/2026-09-04-human-like-bot-behavior-design.md`](superpowers/specs/2026-09-04-human-like-bot-behavior-design.md).

Copied from `bot-profiles.ts` on 2026-09-07. `BOT_BRAIN_VERSION` is `4.3.0`.

## Reading a complaint

**Read the overlay first, then name a knob.** As of 4.3.0 the playground prints the two readings
that answer most complaints outright — `ev best/threshold` (is this bot declining shots, and by how
much) and the winning plan's per-term breakdown (what it thought it was doing instead). See
[Overlay](#overlay). Naming a factor from the symptom alone is now the second-best method.

| Symptom | Knob(s) |
|---|---|
| "Medium is too hard to hit" | `aimErrorSigmaRad` up. `minShotValueFraction` is not a straightforward easier/harder dial: lowering it widens what the bot will attempt (more shots, more misses); raising it makes the bot *pickier and therefore MORE deadly per shot*, not less |
| "Hard is a laser" | Same knobs the other way on `hard` |
| "Hard isn't attacking / holds fire" | Read `ev best/threshold` on the overlay. Below 1, the bot is *correctly* declining the shot and `minShotValueFraction` down is the tune; at or above 1 with `slot -`, that is a bug in `chooseSlot` / `solve()`, not a knob |
| "Shots are all over the place" | **Not a knob any more.** The solver decides hit chance and value; if it is firing shots that miss, that is a solver bug to investigate (`bot/brain/solution.ts`), not a value to tune |
| "It misses me when I turn" / "it shoots where I was" | `stateEstimationSigma` down on that tier — **not** `aimErrorSigmaRad`. Leading a car through a curve is PREDICTION (how well it reads your speed and turn rate, `bot/brain/predict.ts`); `aimErrorSigmaRad` is steady-state hands and will not fix a lead that is aimed at the wrong place to begin with. If it misses you equally badly while you drive STRAIGHT, that is the hands after all |
| "It doesn't set up its shots" | **Planning** — a third factor as of 4.3.0. `planHorizonTicks` is how long an arc the bot can express at all; `targetBranches` is how hard it hedges against what you do next. Easy's 0 is a one-tick rollout by design (see [Known limitations](#known-limitations)) |
| "It weaves / circles me" | Usually correct now. Circling is emergent: the planner turns because the arc that sweeps its nose across you scores better than the one that does not. A stutter — the wheel flapping rather than an arc — is planner *chatter*: raise `commitPenalty`. `orbitBias` does not exist |
| "It ults my corpse / spawn shield" | `deadRespect` up (Hard should already be 1) |
| "It sits in a corner while I approach" | `cornerRespect` up; the overlay should read `unpin`, with `wallPenalty` dominating its terms |
| "It never dodges" | `dodgeChance`, `dodgeReactionTicks`, `dodgeHorizonTicks`, `incomingCarChance`. Those decide WHETHER it reacts; `threatAvoid`'s weight in `objectives.ts` decides how hard, and is not per-tier |
| "It fights at the wrong distance" | `opponentRangeRespect` (how much of *their* shortest gun it insists on clearing) and `awarenessRadiusUnits`. The bot's own comfortable range is **derived**, not dialled — see [`preferredRangeOf`](#preferredrangeof-the-standoff-is-derived-now) |
| "It charges in / never closes" | `opponentRangeRespect` down to close, up to stand off. Nothing in the shipped profile can make a bot stand *closer* than its own derived comfort — see [Known limitations](#known-limitations) |
| "It runs away from nothing" | `opponentRangeRespect` down on that tier. It scales `theirEv`, the planner's continuous danger term, so a high value makes every candidate that walks into a firing solution score worse. Read the overlay's `danger` and the `theirEv` term first |
| "It walks into obvious fire" | `opponentRangeRespect` up. If the overlay's `danger` reads 0 while you are aimed at it from inside your weapon's reach, that is a solver bug (`dangerEvAgainst` in `bot/brain/solution.ts`), not a knob to tune |
| "It lost me and drove around" | `memoryTicks`, `hearChance` — hunt is last-known / shots / quadrants, never the arena centre |
| "It wastes its ult" | `ultDisciplineChance` up, `ultWindowHpFraction` (the HP that counts as a dump window) |
| "It never punishes a stun" | Overlay should flip to `punish`; if it stays `fight`, `situationCommitTicks` is not the issue (punish preempts) |
| "It feels robotic" | `aimErrorDriftTicks`, `scoreNoiseSigma`, `idleFidgetChance`, `blunderChance` |
| "It never uses its second weapon" | personality `slotWeights`, `slotStickTicks` (too high = glued to one gun) |
| "All three tiers feel the same" | Read [`tiers.test.ts`](../packages/server/src/bot/brain/tiers.test.ts). If that passes, the complaint is a parameter *value*. |

**Knobs that no longer exist. Do not propose them, and do not restore a row that names one.**
`fireConeRad` and `fireDisciplineChance` (4.0.0, replaced by the EV gate); `leadFactor` (4.2.0,
replaced by the physics solve — `aim.ts`'s `interceptPoint` went with it, unused, in 4.3.0);
`orbitBias` (deleted with the angular fire gate); and, all in 4.3.0 with the desire model and the
anticipatory evade, `standoffFraction`, `deadbandFraction`, `aimToleranceRad`,
`BRAIN_CONSTANTS.deadzoneFloorFraction`, `deadzoneCapMultiplier`, `closeLeadHorizonFraction`,
`dangerEvadeFraction` and `dangerEvadeCooldownTicks`.

## Pipeline

```
perceive (every tick)
  → predict: roll the target through the real drive model; one firing solution per ready slot
  → assess: facts → one situation → that situation's objective (a weight vector)
  → plan: roll nine candidate arcs, score each against that objective, emit the winner's first input
  → fire: one slot, only if the play allows fire and they are hittable
  → humanize (every tick)
```

Perception and humanization run every tick; predict / assess / plan / fire run on `recomputeTicks`
(H6), and `humanize.ts`'s delay line then holds the emitted input for `reactionDelayTicks` ticks.
Practice, playground, and the balance harness all call `HumanController.decide(BotView)`.

**There is exactly one mover.** The desire-vector blend (`blendHeading`, `goalDesire`,
`wallDesire`, `reduceToIntent`, `compensateForLag`) is gone: a situation states an objective and
`planner.ts` is the only thing that turns an objective into `steer` and `throttle`. `movement.ts`
keeps one export, `wallAhead`, and it is the predicate the `unpin` situation is classified from,
not a mover.

**Expect hard to fire noticeably less often than it used to, and hit vastly more** (P42). The
trigger used to be an angle (`fireConeRad`); it is now a FRACTION of the shooter's own kit's
best-achievable expected damage per second (`minShotValueFraction`, gated against
`bestAchievableValueOf(carId, aimErrorSigmaRad)`), so a shot that will not land — or is not worth
the gun time relative to what this car could do at its best — is not taken at all. Fewer, deadlier
shots is what the EV gate buys. **This is the intended shape of the version, not a regression, and
must not be reported as one.**

**The threshold is RELATIVE to the shooter's own chassis, not an absolute number** (fix round 2,
2026-09-06, R20). A kit's best-achievable `value` varies roughly 4x across the roster (Bullseye's
pepperbox ~78, Bastion's thumper ~18), so comparing every chassis's shot quality against one shared
absolute number made a hard Bastion — whose best possible shot anywhere sat below the old absolute
threshold — never fire at all. `minShotValueFraction` divides by each shooter's OWN ceiling instead.

## Situations (highest priority wins)

A situation no longer picks a heading. It picks an **objective**: the weight vector `objectives.ts`
hands the planner, plus the range that vector's `rangeError` term is measured against. Everything
else about how the car moves falls out of scoring nine candidate arcs against it.

| Id | When | Objective | Fire |
|---|---|---|---|
| `recover` | self dead or phased | nothing but `wallPenalty` 60; the intent is forced to coast anyway | off |
| `waitOut` | nobody hittable | `rangeError` 0.375 against a synthetic hunt waypoint projected at `awarenessRadiusUnits`, with `preferredRange` 0 — "arrive"; `wallPenalty` 240 | **off** |
| `evade` | a noticed shot in flight (rolled `dodgeChance`), or an incoming car (`incomingCarChance`) | `threatAvoid` 0.6 and `theirEv` 4 — get off the line, and out of their solution; `rangeError` 0 | still fires |
| `unpin` | on a bound/corner with a target, `cornerRespect` | `wallPenalty` **2400** — the play whose entire content is "leave"; `rangeError` 0 | fight rules |
| `punish` | stunned, low HP, or they just spent a 5s+ gun | `myEv` 3 and `lockKeep` 12, at half its own comfortable range (`punishRangeFraction`) | dump, including ult |
| `reset` | own HP < `retreatHpFraction` (0 = Easy fights to zero) | `theirEv` 3 against `myEv` 0.4 — the disengagement is carried by the weights, not the range, which gives up only 15% (`resetRangeMultiplier`) | fight rules |
| `fight` | a ready gun's **aim/player** reach covers them | `myEv` 2, `theirEv` 0.6, `lockKeep` 8, `rangeError` 0.3 against `fightRange` | `chooseSlot` |
| `close` | they're up but not in reach yet | `rangeError` 0.875 against `minEngageUnits` — drive to contact | off |

HUD lock is never a veto. A big gun is `cooldownMs >= 5000` (not predator).

Own reach uses `aimRangeUnits` when the gun has aim assist (predator fights around 800, not 1800).
Opponent keep-out is their **shortest** gun × `opponentRangeRespect`, and `fightRange` is
`max(ownComfort, theirKeepOut)`: stand where MY kit works, but never inside the range their shortest
gun keeps me out of.

**`evade` is an EVENT again.** Its third clause — "I am standing in a loaded gun's firing solution",
with four gates and a 120-tick refractory period bolted on to stop a STANDING condition from
occupying an event's priority slot — is deleted, apparatus and all. Danger is scored continuously
now, as the `theirEv` weight on every candidate the planner rolls, so the bot leans off a line by
degrees on every tick instead of declaring an excursion once every four seconds. Do not port the
gates back: they were scaffolding for a shape that no longer exists.

### The weight table (`objectives.ts`, not per-tier)

Base weights, identical across every tier. `weightsFor()` then scales exactly one of them by the
profile — `theirEv × opponentRangeRespect` (P38). A tier may change how strongly it feels a
pressure; it may never change what a situation is for.

| Situation | `myEv` | `theirEv` | `rangeError` | `wallPenalty` | `lockKeep` | `threatAvoid` | `preferredRange` |
|---|---|---|---|---|---|---|---|
| `recover` | 0 | 0 | 0 | 60 | 0 | 0 | 0 |
| `waitOut` | 0 | 0.5 | 0.375 | 240 | 0 | 0 | 0 (arrive at the waypoint) |
| `evade` | 0.3 | 4 | 0 | 360 | 0 | 0.6 | `fightRange` |
| `unpin` | 0.2 | 1 | 0 | 2400 | 0 | 0 | `fightRange` |
| `punish` | 3 | 0.25 | 0.5 | 240 | 12 | 0 | `max(70, ownComfort × 0.5)` |
| `reset` | 0.4 | 3 | 0.625 | 360 | 2 | 0 | `max(fightRange × 1.15, 70)` |
| `fight` | 2 | 0.6 | 0.3 | 300 | 8 | 0 | `fightRange` |
| `close` | 1 | 0.75 | 0.875 | 300 | 4 | 0 | 70 (`minEngageUnits`) |

The weights are not on one scale and are not meant to be: `myEv` and `theirEv` are EV per second
(0–75 in a duel), `rangeError` is world units, `wallPenalty` is a squared normalised overlap
(0.017 in a corner — which is why its weight runs to the hundreds), `lockKeep` is 0 or 1, and
`threatAvoid` is a displacement in units. Every row was derived against a MEASURED term scale, and
`rangeError` has been re-derived three times because the quantity under it moved three times. Read
the comment at the top of `objectives.ts` before touching a row, and re-derive rather than nudge.

Four terms are read as MOMENTS along the candidate arc — `myEv` and `lockKeep` at their best,
`theirEv` and `wallPenalty` at their worst. `rangeError` and `threatAvoid` are DESTINATIONS, read
at the terminus. That split is measured, not stylistic; `plan`'s doc comment in `planner.ts`
carries the table of the three other readings that were tried and rejected.

### `preferredRangeOf`: the standoff is derived now

`standoffFraction × reach` is gone. `preferredRangeOf` (`bot/brain/firing.ts`) samples its own
kit's value across its own reach at this bot's own `aimErrorSigmaRad`, and returns **the far edge of
the plateau where that value peaks** — the farthest sampled range still clearing
`BRAIN_CONSTANTS.preferredRangePlateauFraction` (0.95) of the peak, floored at `minEngageUnits` and
capped at `awarenessRadiusUnits`.

So the per-tier ladder those fractions used to encode now falls out of `aimErrorSigmaRad` on its
own: shakier hands make the kit's value curve peak closer in, because the shots stop paying sooner.
Measured at neutral slot weights (chassis, easy / medium / hard): bullseye 70 / 170 / 470, mirage
86.7 / 186.7 / 220, bastion 90.8 / 132.5 / 132.5. Bastion's medium/hard tie is a property of its kit
(a 150 u `wildcharge` beside a 400/500 u pair), not of the sampling grid.

The personality's `slotWeights` reach this function, which is the whole reason the plateau bar is a
fraction rather than an exact tie: under an exact tie the answer was provably a veto by the
shortest-reaching ready slot, and the weights could not move the standoff at all.

## Parameter table

### Perception

| Field | easy | medium | hard |
|---|---|---|---|
| `viewStalenessTicks` | 4 | 3 | 2 |
| `reactionDelayTicks` | 9 | 6 | 4 |
| `recomputeTicks` | 12 | 6 | 2 |
| `acquireTicks` | 15 | 9 | 5 |
| `awarenessRadiusUnits` | 600 | 700 | 900 |
| `rearBlindHalfAngleRad` | 1.05 | 0.6 | 0 |
| `trackedThreatLimit` | 1 | 2 | 4 |
| `memoryTicks` | 15 | 45 | 90 |

Easy's radius was 520 until R-P14 (2026-09-07) and that was not a taste call: the closed-loop duel
opens with 553 units between the cars, so an easy bot began every engagement blind, and at
`planHorizonTicks: 0` it could not turn around to find anyone. 600 is mid-plateau on a 21-duel
sweep, and still 100 short of medium.

### Aim (hands)

| Field | easy | medium | hard |
|---|---|---|---|
| `aimErrorSigmaRad` | 0.18 | 0.09 | 0.035 |
| `aimErrorDriftTicks` | 20 | 14 | 9 |
| `stateEstimationSigma` | 0.25 | 0.1 | 0.03 |

`stateEstimationSigma` is filed under **Perception** in `bot-profiles.ts`, not Aim — it is a
reading-the-world knob whose effect lands on the gun. It sits here because the knob it is constantly
confused with, `aimErrorSigmaRad`, is one row up, and telling them apart is the whole diagnostic
(see the complaint table above).

The realized aim error now steers the BODY as well as spreading the shot (R-O5). With the desire
model's heading gone, the offset had no consumer, and dropping it would have deleted "shaky hands
wander the nose" as a steering behaviour — so the planner is handed a target predictor rotated
rigidly about the bot's own position by `aimError.offsetRad`. `solve()` still gets the RAW
predictor: it integrates over `aimErrorSigmaRad` statistically, and feeding it the realized sample
too would count the same error twice. The trigger sees the distribution; the wheels see the sample.

`stateEstimationSigma` is how wrong a bot's read of an opponent is, **as a fraction** — two gaussian
draws per predictor construction (four `rng()` calls: Box-Muller draws a pair each) scale the
observed `speed` and the observed turn rate before the rollout runs. Reading exact `speed` off
another car every tick is the one place a bot sees more precisely than a person, and this is the
answer to that.

The turn half is the one that reads a **corner**, and it works by moving the observation across
`BRAIN_CONSTANTS.fullLockAngVelFraction`: the noised rate — not the raw one — is what
`steerFromObservedTurn` reconstructs a held wheel from, so a bad enough read misjudges *whether* the
car is steering at all, and near the threshold *which way*. Above the threshold the read is quantised
to a -1/0/1 steer, so a small error there changes nothing; below it the residual is a ram's spin and
the error scales it continuously. That reconstruction lives inside `physicsPredictor`, after the
draws, precisely so the noise reaches it. For a target at full lock, misjudging *whether* it is
steering needs a draw beyond roughly `-0.5 / stateEstimationSigma` standard deviations — about 2.3%
of constructions at easy's 0.25, but roughly 5 sigma (~3e-7) at medium's 0.10 and roughly 16.7 sigma
(never, in practice) at hard's 0.03 — so on medium and hard this half is moving the *magnitude* of an
already-correctly-classified curve, not the decision that it is curving at all.

It is **not confined to [0, 1]** (a fraction above 1 is a wild misread, not an invalid value), so it
is deliberately absent from `personality.ts`'s `UNIT_INTERVAL_FIELDS` and from
`bot-profiles.test.ts`'s `PROBABILITY_FIELDS` — exactly as `aimErrorSigmaRad` is, and for the same
reason.

**A car spinning from a ram is read as a car that MEANT to turn, and is mispredicted.** The bot infers
turn rate from two observed poses (`observedAngVelOf`), assumes `authority` and shove neutral because
those are not numbers a person reads off a screen, and above
`BRAIN_CONSTANTS.fullLockAngVelFraction` of the chassis's own turn rate treats the result as a held
wheel. Just after a ram all of that is wrong at once, and the next shot misses. That is P19 and it is
**kept on purpose** — it is a very human error obtained for free. Do not file it as a prediction bug.

### Planning

| Field | easy | medium | hard |
|---|---|---|---|
| `planHorizonTicks` | 0 | 8 | 22 |
| `planDepth` | 1 | 1 | 1 |
| `targetBranches` | 1 | 1 | 3 |
| `commitPenalty` | 0.072 | 0.126 | 0.18 |

`planHorizonTicks` (K) is **the number that makes the tiers differ in kind rather than degree**, and
it is a number precisely so that no module has to branch on a difficulty name (H8). 0 is a reflex
agent: `plan` still floors the per-segment roll at one tick, so a K=0 bot avoids a wall it is driving
into, but no candidate on its menu expresses a manoeuvre. Hard's 22 is load-bearing in a way a
casual retune will not see — the commitment-window plateau it was measured on is only two ticks
wide — so **changing K obliges re-running round 5's seven-seed window sweep**, not just eyeballing
a match.

`planDepth` splits the horizon into that many committed windows: 1 is "commit, then coast to rest",
2 is "commit, commit again, then coast" — 81 sequences instead of 9. **No tier ships 2** (see
[Known limitations](#known-limitations)). The dial and its machinery stay; it is the knob P33 names
for whoever earns the budget back.

`targetBranches` is how many of the target's plausible inputs the planner takes the worst case over
(P28). Only hard hedges; `hedgedThreats` returns early at 1, so this is a hard-only cost and a
hard-only caution.

`commitPenalty` is the anti-chatter bonus for repeating last tick's action, **as a fraction of the
candidate score spread** (`maxScore - medianScore`), not a raw addend. It has been re-scaled three
times, twice because it had become a latch rather than hysteresis — at 0.8 a hard bot froze on
whatever it happened to be doing and fired 0 shots in 300 ticks. The ladder's SHAPE is what is
maintained (a better player commits harder); the common scale factor is what moves. It is
calibrated against that specific spread measure, so **swapping the normaliser obliges re-measuring
this knob**, not reusing these numbers.

### Shared constants (`BRAIN_CONSTANTS`, not per-tier)

In `bot-profiles.ts`. Editing any of these retunes **every** tier at once — and note that
`botFingerprintInput()` (`packages/server/balance/fingerprint.ts`) hashes only `BOT_PROFILES` and
`BOT_BRAIN_VERSION`, so a `BRAIN_CONSTANTS` edit does not move `botFingerprint`: bump
`BOT_BRAIN_VERSION` yourself, or two balance reports will compare as if the same pilot played both.

Planning — feeds `planner.ts`:

| Field | Value | What it does |
|---|---|---|
| `commitWindowFraction` | 0.52 | How much of the horizon a candidate COMMITS to before its terminal policy (coast to rest) takes over, as a fraction of `planHorizonTicks`, split across `planDepth` windows. Hard's K=22 gives 12 committed and 10 coasting. The middle of an axis whose two ends both fail — a whole-horizon hold puts a 13-degree correction off the menu, a `recomputeTicks`-length hold puts a U-turn off it — and the plateau is two ticks wide. |
| `trajectorySampleCount` | 4 | How many points along a candidate's arc are scored, geometrically spaced. NOT the end pose alone, which is what broke the bot: end-scored, `steer: 0` won every tick. 3 is a cliff (the earliest sample lands after the sweep is over); 4, 5 and 6 are a plateau and 4 is the cheapest cell on it. |
| `targetBranchMaxHeadingOffsetRad` | π/2 | Cap on how far a hedged branch turns the TARGET's heading before re-reading its danger. The raw offset is derived from `turnRateOf × elapsed`, and **it saturates this cap at every shipped configuration** — read it as the constant it is. It becomes operative again only below about K=8. |

Ranges — feeds `preferredRangeOf` (`firing.ts`) and `preferredRangeFor` (`controller.ts`):

| Field | Value | What it does |
|---|---|---|
| `minEngageUnits` | 70 | The closest range a bot will ever choose to hold, roughly one and a half car lengths. Also `close`'s target range. |
| `preferredRangePlateauFraction` | 0.95 | The fraction of its kit's PEAK sampled value a bot will keep in exchange for standing further off. Not 1: an exact tie is provably a veto by the shortest-reaching ready slot, which makes the personality's `slotWeights` inert. Minimum perturbation that satisfies that — 0.92 and 0.90 buy no extra live cell and 0.90 breaks a balance fixture. |
| `preferredRangeSampleCount` | 24 | Resolution of the only grid the standoff is ever read off. Stable to within a car length across an eightfold change, and it does NOT explain Bastion's medium/hard tie. |
| `preferredRangeMinStepUnits` | 10 | Floor on that grid's step. Provably inert on the shipped roster (the smallest step today is Mirage's 16.7 u); a guard against a future short-reach kit. |
| `punishRangeFraction` | 0.5 | `punish` walks in to half its own comfortable range, floored at `minEngageUnits` — the play's premise is that the window closes, and travel time wastes it. |
| `resetRangeMultiplier` | 1.15 | `reset` gives up 15% of ground, not a lap. The disengagement is in the WEIGHTS (`theirEv` 3 against `myEv` 0.4); this only stops the range term pulling the bot back into the fight it left. |
| `contactTriggerUnits` | 150 | Range at which a `range: 0` weapon (`wildcharge`) is worth pressing; also the closing distance `isIncomingCar` measures an ETA to. |

Danger — feeds `dangerEvAgainst` in `bot/brain/solution.ts` and the planner's `theirEv` term:

| Field | Value | What it does |
|---|---|---|
| `assumedOpponentAimSigmaRad` | 0.06 | The aim error a bot assumes of an OPPONENT when reading danger, instead of projecting its own hands. One shared number because the bot cannot know who it is facing — so it sits between medium's `aimErrorSigmaRad` (0.09) and hard's (0.035), over-reading an easy or medium opponent's threat and under-reading a hard one's by ~1.7x. Accepted asymmetry, not "assume competence". |

Prediction — feeds `physicsPredictor` / `selfPredictor` / `interceptTicks` in `bot/brain/predict.ts`,
both predictors built in `controller.ts`'s `plan()`:

| Field | Value | What it does |
|---|---|---|
| `predictionHorizonTicks` | 90 | How far ahead a firing solution rolls a target. How far a SHOT flies, not how far a bot thinks — that is `planHorizonTicks`. Verified against `WEAPON_TABLE`: the longest flight on the roster is `thumper`'s 87 ticks (1305 u at 450 u/s = 2.9 s), `predator` next at 60. **A tick count, so a `TICK_RATE_HZ` change does not rescale it**: thumper becomes 174 ticks at 60 Hz and this would silently truncate every long solve. Re-derive it if the netcode rewrite's phase 1 lands. |
| `fullLockAngVelFraction` | 0.5 | Fraction of a chassis's own turn rate an observed turn must reach before it reads as deliberate STEERING rather than a ram's residual spin. A half, because the sim has no partial steer — `stepDrive`'s steer is only ever -1/0/1, so a car genuinely turning is at FULL lock and there is nothing between the two cases to discriminate. Per-chassis by construction: Bastion's bar is lower than Mirage's. |
| `observationTopSpeedHeadroom` | 4 | Multiplier on the `topSpeed` channel inside a prediction, so the speed CAP cannot clip an observation. At a neutral 1 every POSITIVE estimation error on a car already at its cap was thrown away — measured, `+25%` and `+50%` both moved a Mirage prediction 0.00 units while `-25%` moved it 168.56 — which biased every tier toward under-leading. |
| `interceptFixedPointRounds` | 3 | Rounds of fixed-point iteration behind "how many ticks ahead do I aim". A curving path has no closed form, so this converges what a straight-line intercept solves in one shot. Fixed rather than looped to a tolerance because the solver must do bounded work every tick (H21). |
| `personalityJitter` | 0.25 | How far an archetype may move a parameter from its tier value. |
| `ultCooldownMs` | 5000 | `cooldownMs` at or above which a weapon counts as an ult for discipline purposes. |

### Fire economy

| Field | easy | medium | hard |
|---|---|---|---|
| `burstGapTicks` | 14 | 7 | 3 |
| `minShotValueFraction` | 0.01 | 0.05 | 0.3 |
| `ultDisciplineChance` | 0 | 0.5 | 0.9 |
| `ultWindowHpFraction` | 0.4 | 0.4 | 0.4 |

`minShotValueFraction` is the FRACTION of `bestAchievableValueOf(self.carId, aimErrorSigmaRad)` —
this shooter's own kit's best-achievable expected damage per second, at this shooter's own aim
quality — a shot must clear before this bot takes it. It replaced `fireDisciplineChance`, which
gated on distance rather than whether the shot would land, and then replaced its own first
(absolute-number) calibration a second time (fix round 2, 2026-09-06, R20) once measurement showed
an absolute EV number cannot compare across chassis whose kit ceilings differ ~4x. These three values
were **measured, not guessed**: see the long comment on `BotProfile.minShotValueFraction` in
`bot-profiles.ts` for the closed-loop sweep (now run across all three chassis, not just Bullseye)
that picked them and the cliff-edge behaviour that makes a naive percentile read misleading.

The overlay's `ev best/threshold` prints exactly this comparison, resolved: `best` is the best EV/s
any ready slot's `solve()` finds from the current pose, `threshold` is
`minShotValueFraction × bestAchievableValueOf(...)`. A ratio below 1 with `slot -` is the gate
working.

### Target politics

| Field | easy | medium | hard |
|---|---|---|---|
| `targetCommitTicks` | 150 | 60 | 25 |
| `woundedBias` | 0.1 | 0.5 | 0.9 |
| `vengefulness` | 0.8 | 0.5 | 0.25 |

`vengefulness` runs backwards on purpose — a casual chases whoever hurt them.

### Positioning

| Field | easy | medium | hard |
|---|---|---|---|
| `wallLookaheadUnits` | 40 | 90 | 150 |
| `retreatHpFraction` | 0 | 0.3 | 0.35 |
| `ramIntentChance` | 0.15 | 0.3 | 0.5 |

There is no per-tier range knob in this table any more. `standoffFraction` and `deadbandFraction`
were deleted in 4.3.0: the standoff is derived (`preferredRangeOf`, above), and the coast band
`deadbandFraction` thresholded belongs to a bang-bang steer law the planner replaced — it scores a
continuous `rangeError` instead.

### Judgment (same factors, different use)

| Field | easy | medium | hard |
|---|---|---|---|
| `deadRespect` | 0.25 | 0.75 | 1 |
| `opponentRangeRespect` | 0 | 0.45 | 0.9 |
| `cornerRespect` | 0.35 | 0.75 | 1 |
| `incomingCarChance` | 0.1 | 0.55 | 0.95 |
| `situationCommitTicks` | 20 | 12 | 6 |
| `slotStickTicks` | 4 | 8 | 12 |

`opponentRangeRespect` does double duty (P38): it is the keep-out-of-their-gun weight (S11) read by
`fightRange`, and it is **the only profile field that scales a planner weight** — `theirEv`, the
continuous danger term on every candidate. At easy's 0 both are inert, which is why an easy bot
neither keeps out of your range nor leans off your line. That also makes it the one dial behind two
different complaints ("runs away from nothing" and "walks into obvious fire"), and behind two
archetypes' entire range flavour — see [Known limitations](#known-limitations).

### Threat reaction and consistency

| Field | easy | medium | hard |
|---|---|---|---|
| `dodgeChance` | 0.05 | 0.55 | 0.95 |
| `dodgeReactionTicks` | 12 | 8 | 4 |
| `dodgeHorizonTicks` | 12 | 18 | 24 |
| `blunderChance` | 0.12 | 0.05 | 0.015 |
| `blunderTicks` | 10 | 10 | 10 |
| `idleFidgetChance` | 0.1 | 0.05 | 0.02 |
| `scoreNoiseSigma` | 0.3 | 0.15 | 0.05 |
| `hearChance` | 0.15 | 0.55 | 1 |

`dodgeChance` and `dodgeReactionTicks` decide WHETHER a shot in flight is reacted to at all; the
list of reacted-to threats then reaches the planner as `threatAvoid`, which decides how hard. The
`second-best` blunder is now the planner's own runner-up — the best candidate whose first action
differs from the winner's — so a mistake is a plausible alternative rather than an inverted control.
What is committed for the blunder window is the **kind**, not the line: the runner-up is re-read
every tick, so a bot inside a `second-best` blunder follows whichever candidate the planner currently
rates second. It never reverts to the winning line mid-window, and every line it can land on is a
nearly-good one.

## Overlay

The playground prints **two lines** (P45, P46):

```
personality | situation | range N | slot K | danger N | plan(+1,+1) SCORE | ev BEST/THRESHOLD
terms  myEv N  theirEv N  rangeError N  wallPenalty N  lockKeep N  threatAvoid N
```

- `range` is `preferredRangeFor(situation)` — the range this play is holding, which is 0 in
  `recover` and in `waitOut` (arrive at the waypoint).
- `slot -` means it held fire.
- `danger` is the damage per second the bot believes it is standing in — the firing solver run
  against the opponent's own kit (`dangerEvAgainst`), weighted by believed readiness.
- `plan(steer,throttle)` is the winning candidate's FIRST input, signed so a held wheel reads at a
  glance, and `SCORE` is what that candidate scored, `commitPenalty`'s bonus included.
- `ev BEST/THRESHOLD` is the fire gate, resolved: best available shot value against
  `minShotValueFraction × bestAchievableValueOf(carId, aimErrorSigmaRad)`. **This is the primary
  tuning diagnostic** — "am I winning this exchange from here" is `ev` against `danger`, and either
  number alone answers nothing.
- The `terms` line is the winning candidate's per-term contributions, in whatever order the planner
  emitted them: the wire field is an open map, so a seventh term added to `PlanWeights` appears
  here without a client edit. It reads `terms  -` until the bot's first recompute window — the same
  "nothing to report" sentinel `slot -` uses on the line above, rather than an empty line that would
  read as a broken renderer.

**The `terms` line prints RAW term values, not points.** `myEv` and `theirEv` are EV/s, `rangeError`
is units, `wallPenalty` is that squared overlap, `threatAvoid` is a displacement. To read which term
actually won the decision, multiply each by that situation's weight from `objectives.ts` — a
`wallPenalty` of 0.017 is 5 points against `fight`'s 300 and 40 against `unpin`'s 2400, while a
`rangeError` of 50 units is 15 points in `fight`. There is no scoreboard.

## Personality

Five archetypes still jitter hands and favorite guns inside the tier band (H47). They cannot skip
`waitOut` / `unpin` / `punish`. Their **range** flavour is now much narrower than it reads — see
[Known limitations](#known-limitations).

> **At easy there are three archetypes, not five.** `brawler` and `kiter` shift
> `opponentRangeRespect`, `retreatHpFraction` and `ramIntentChance`. Easy pins the first two at 0,
> so both shifts multiply zero; `ramIntentChance` does move (0.15 → 0.1875 for brawler, → 0.12 for
> kiter) but **reaches no behaviour at all** — see below. `rollPersonality` also draws
> `slotWeights` from the same stream positions whatever the archetype, so from one seed the two roll
> identical weights. **An easy `brawler` and an easy `kiter` are behaviourally indistinguishable.**
> Do not reach for `ramIntentChance` to separate them.

> **`ramIntentChance` has no consumer — pre-existing, flagged, not repaired.**
> `controller.ts` draws it into `this.wantsRam` (~line 247); the only other reference is
> `void this.wantsRam;` (~line 559). That `void` landed on `development/main` with the
> situation-play brain, before the 4.3.0 planner work, so it is not a 4.3.0 regression. **The field
> tunes nothing at any tier.** The `rng()` draw behind it is real and must stay — H21 fixes the draw
> count and order — so this is not dead code to delete; reconnecting a ram intent is a behaviour
> change for a future pass, not a doc fix. If a "the bot never rams me" complaint arrives, this is
> why, and no value of this knob will answer it.

## One press per tick

`chooseSlot` returns one slot index. `beginFire` takes the lowest set bit of the mask, so ORing
every in-range slot would only ever fire slot 0.

## Known limitations

Recorded rather than buried. None of these is a bug report; each is a thing a reader would
otherwise discover by being surprised.

**1. Archetype range flavour is materially weakened.** `brawler` and `kiter` are archetypes *about*
range, and `standoffFraction` was their lever. It is gone, and `opponentRangeRespect` — the nearest
surviving danger-distance axis — does not carry it. Three consequences, all real and all measured
off the shipped table: it is a **no-op at easy**, where `opponentRangeRespect` is 0 and both shifts
multiply zero — and so is every other field the two shift, so **an easy `brawler` and an easy
`kiter` are indistinguishable**, not merely close (see the callout below); at hard,
`kiter`'s 0.9 × 1.15 = 1.035 saturates at 1.0, an ~11% shift rather than the 15% it reads as; and
`fightRange = max(ownComfort, theirKeepOut)` FLOORS the result at the bot's own derived comfort, so
`brawler` can never stand *closer* than a neutral bot — the shift only moves the other operand.
Restoring the closing half needs a profile field that scales `ownComfort`, which P35/P36 do not
list. It is a candidate for the next tuning pass, deliberately not added on the way past.

**2. The perf budget is missed by 13–78%, and was not throttled away.** Hard's plan measures
**0.375–0.593 ms** per plan against P33's stated 0.33 ms (six bots replanning at 15 Hz inside ~30 ms
of CPU per simulated second) — the range `planner.bench.test.ts` states, spanning isolated through
full-suite load, and the one to quote. Quoting the isolated end alone (0.385–0.422 ms, "17–27%
over") reports the flattering half of the same data. The overrun is reported rather
than tuned away because there is no dial left that does not cost more than it buys: `planDepth` is
already 1, and `planHorizonTicks` is where hard's K=22 sits on a two-tick-wide plateau found by a
seven-seed sweep, so lowering K invalidates that sweep and the five-round convergence built on it.
P33's own headline is met anyway — 90 plans/s at 0.4 ms is 36 ms of CPU per simulated second — and
the two rooms that run bots for players run one bot each. `planner.bench.test.ts` gates a RATIO
against a same-process reference workload rather than a stopwatch reading, because the absolute
number varies 1.6x with what else the machine is doing.

**3. `planDepth: 2` ships on no tier.** Re-measured at the shipped configuration it costs 3.03 ms
per plan against depth 1's 0.385 — 7.95x, and 9x the budget, not the 3x an older comment claimed.
The machinery, its `1 | 2` type and its tests are all kept live and covered: it is the exact dial
P33 names for whoever earns the budget back (a faster machine, a lower K, fewer simultaneous bots,
or a cheaper scoring pass).

**4. Easy's `planHorizonTicks: 0` is a one-tick rollout**, so no candidate on its menu expresses a
manoeuvre: an easy bot navigates on one-tick score margins and cannot plan an arc, turn around, or
drive to a hunt waypoint deliberately — it drifts. That is P29 and P34's amateur tier working as
designed, at the edge of its competence, and it is why easy's `awarenessRadiusUnits` had to be
raised to 600 (a blind easy bot at K=0 never recovers). Worth knowing before filing "easy does not
chase".

**5. Spec P34's easy portrait says "does not lead", and that stopped being true** when `leadFactor`
was removed in 4.2.0. Every tier now gets the same physics solve, and the tiers separate on how
badly they read its inputs (`stateEstimationSigma` 0.25 against hard's 0.03) and on the hands that
execute it (`aimErrorSigmaRad` 0.18 against 0.035). An easy bot visibly trying — and failing — to
lead you is the intended shape. P35/P36's field tables are normative and were followed; the prose
portrait was not edited, and rewriting the spec is the user's call.
