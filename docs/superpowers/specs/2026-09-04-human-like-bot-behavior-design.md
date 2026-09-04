# Human-like bot behaviour — design

**Date:** 2026-09-04
**Status:** design approved, implementation pending
**Supersedes:** the bot half of
[`2026-09-03-game-balance-harness-design.md`](2026-09-03-game-balance-harness-design.md) — B2 and B22
named this work explicitly ("bot intelligence is a separate session's work; replacing `decide` is the
whole of it") and B19/B23 deferred the tier values to it. Every other B decision stands, and this
spec is written to live inside them.

Decisions here are numbered **H1–H48**, plus **H27a**.

---

## 1. The problem

The shipped bot chases and fires. `LegacyController.decide` picks the nearest enemy, steers at it,
drives toward a fixed standoff distance, and sets the fire bit of every slot whose range covers the
target. `easy`, `medium` and `hard` run that identical behaviour with six numbers scaled: standoff,
deadband, recompute cadence, aim tolerance, fire cone, fire period.

That is why the tiers feel the same. Nothing a hard bot does is absent from an easy bot; it merely
does the same thing tighter and more often. Players do not read "the same plan executed at 4 Hz
instead of 30 Hz" as a weaker opponent — they read it as the same opponent, lagging.

Three facts about the current code frame the work:

- **The bot ignores most of what it is already allowed to see.** `BotView` carries enemy hp,
  statuses, `phased`, every weapon instance in flight, obstacles, arena bounds, the bot's own hp and
  slot recharge state, and `observedFires`. `botInput` reads two positions, two angles and a list of
  slot ranges.
- **The human-latency machinery exists and is switched off.** `viewStalenessTicks` and
  `reactionDelayTicks` are plumbed end to end (a `ViewRing` snapshot ring in the host, an intent
  delay line in the controller) and set to `0` on every tier. B19 built them and left the values to
  this session.
- **The seeded RNG is injected and never drawn from.** B20 put `rng` on the view specifically so a
  bot could be *inconsistent*, on the grounds that inconsistency is most of what makes a casual a
  casual. Nothing reads it.

## 2. What the goal is, stated so it can be checked

Simulate a **casual**, an **amateur** and a **pro** human — not three settings of one machine. The
test a change has to pass is behavioural, not numeric: watching a match, a player should be able to
say *what kind of player* that bot is, not just how fast it reacts.

**H1. Weakness is modelled as worse decisions, never as a handicap.** No damage scaling, no speed
penalty, no artificial miss injected after a correct aim. The moment a tier gets a multiplier on its
output, the balance harness stops measuring the game and starts measuring the handicap.

**H2. No tier may exceed human capability.** `hard` is a strong human — good reactions, good habits,
real mistakes — not the best a program could play. The ladder stays at three rungs; a superhuman
`expert` rung was considered and rejected as out of scope for practice mode's audience.

**H3. Practice-mode feel wins over harness fidelity when they conflict** — inherited from B23,
unchanged. The harness documents the compromise; it does not get to overrule it.

## 3. What other games do, and what is taken from each

Researched 2026-09-04. Values are reproduced here because the tier numbers in section 7 are derived
from them.

**Counter-Strike (`BotProfile.db`)** — four scalars, difficulty as a tag on a profile rather than a
separate system:

| Template | Skill | Aggression | ReactionTime |
|---|---|---|---|
| Easy | 0 | 20 | 0.50 s |
| Fair | 25 | 30 | 0.40 s |
| Normal | 50 | 50 | 0.40 s |
| Hard | 75 | 75 | 0.25 s |
| Expert | 90 | 90 | 0.25 s |
| Elite | 100 | 100 | 0.20 s |

**TF2 (`TFBot`)** — the closest model to what is built here: numeric knobs *plus* probabilistically
gated abilities.

| | Easy | Normal | Hard | Expert |
|---|---|---|---|---|
| Recognition time | 1.00 s | 0.50 s | 0.30 s | 0.20 s |
| Aim tracking interval | 1.00 s | 0.25 s | 0.10 s | 0.05 s |
| Hears quiet gunfire | 10% | 30% | 60% | 90% |
| Airblast usage | 0% | 50% | 90% | 100% |
| Dodging | off | on | on | on |
| Reload in cover, threat prioritisation | off | off | on | on |

**Unreal Tournament** — repertoire gating up the ladder. Novice will not move during combat, has a
30° field of view and aims up to 30° off; Experienced strafes; **Adept dodges incoming fire and leads
non-hitscan shots**; Masterful switches targets mid-fight; Godlike aims within 1° with 360°
awareness. FOV climbs 30 / 40 / 60 / 80 / 100 / 120 / 360 and turn rate 180 / 225 / 270 / 315 °/s.

**Quake III** — 40+ per-bot floats. Taken from it: `AIM_ACCURACY` (with a per-weapon variant),
`AIM_SKILL` (leading and prediction), `REACTIONTIME`, `AGGRESSION`, `SELFPRESERVATION`,
`VENGEFULNESS`, `EASY_FRAGGER`, `ALERTNESS`, `FIRETHROTTLE`, `WEAPONWEIGHTS`.

**Measured human reaction time**: ~250 ms average visual, ~215 ms strong amateur, 150–165 ms
professional, ~100 ms physiological floor.

**H4. Reaction time alone cannot carry three tiers.** The pro-to-casual gap is roughly 3 ticks at
30 Hz. Every game above reaches for repertoire and decision quality for exactly this reason, and so
does this design.

Sources: [CS BotProfile.db](https://github.com/badw000lf/Counter-Strike-Source-BotProfile.db/blob/main/BotProfile.db),
[TFBot skill levels](https://steamcommunity.com/sharedfiles/filedetails/?id=572409016),
[UT bot difficulty](https://steamcommunity.com/sharedfiles/filedetails/?id=1510057213),
[Quake III `chars.h`](https://github.com/ioquake/ioq3/blob/main/code/game/chars.h),
[Game AI Pro: behaviour selection algorithms](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter04_Behavior_Selection_Algorithms.pdf).

## 4. Architecture

### 4.1 The pipeline

**H5. Five layers, one `decide` call.**

```
BotView ─▶ ① perceive ─▶ ② assess ─▶ ③ move ─┐
             every tick     cadence          ├─▶ ⑤ humanize ─▶ BotIntent
                            ④ shoot ─────────┘      every tick
```

**H6. Perception and humanization run every tick; assess/move/shoot run on the recompute cadence.**
The shipped controller gates everything on the cadence. A memory that only updates every 12th tick is
not a memory, and a delay line that only shifts every 12th tick delays by a multiple of the cadence
rather than by its own value. Cadence is *how often the bot re-decides*, and it applies only to
deciding.

**H7. Layer responsibilities are strict.**

1. **Perceive** — turns a *fair* view into a *human* view: acquisition delay on new threats, an
   awareness radius, a rear blind arc, a cap on simultaneously tracked threats, decay of what is no
   longer visible, and the enemy-ult memory (**built but not yet consumed** — see H22).
2. **Assess** — chooses a target, then scores a stance and holds it for a commitment window.
3. **Move** — a context-steering blend of desires, collapsed to `steer`/`throttle`.
4. **Shoot** — a per-slot decision, with aim error and shot leading applied.
5. **Humanize** — reaction delay line, blunders, idle fidget.

**H8. Only the parameter table and the humanize layer know what tier the bot is.** No layer branches
on `profileId`. A tier is data; a behaviour is code. This is what stops the tiers drifting back
together as the brain grows.

### 4.2 Decision layer: scored stances, not a state machine and not free-form utility

**H9. The decision layer picks one of a small, closed set of named stances by weighted score.**

| stance | chosen when | publishes |
|---|---|---|
| `Engage` | a target is known and the bot is healthy | hold `preferredRange`, orbit by `orbitBias` |
| `Brawl` | a range-0 weapon is ready, or the bot intends a ram | close to `contactTriggerUnits` |
| `Kite` | target is closer than 60% of preferred range | hold range, back off, keep facing |
| `Disengage` | hp below `retreatHpFraction` | break contact, keep the target in arc where possible |
| `Reposition` | pinned against a wall or corner | move to open floor, hold fire |
| `Hunt` | no target is currently known | sweep toward last-known or arena centre |
| `Recover` | dead or phased — no control worth spending | coast |

**Correction (2026-09-04, post-implementation, Task 10/12 review):** this table originally claimed
`Recover` also fires on "fully stunned," `Reposition` also fires when "the shot has no line," and
`Kite` also fires when "the bot is losing the trade." None of those three exist in the shipped
`stance.ts`/`controller.ts` — `Recover`'s `controlLost` gate never reads the bot's own `stunned`
status (only `firing.ts` reads `stunned`, and only on the *target*, for ult discipline);
`Reposition`'s score is driven solely by `pinnedOnWall`, with no line-of-sight check anywhere in the
stance layer; `Kite`'s score is a pure distance threshold, with no HP or trade comparison anywhere
in it. The table above is corrected to what the code actually does. Whether the bot *should* someday
do any of the three original claims is an open design question for a later pass, not something this
spec gets to retroactively claim was built.

Named stances give the legibility of a state machine (you can print one over the bot); scoring gives
the wide parameter surface asked for, since every parameter becomes a weight rather than a threshold
on a hand-authored branch.

**H10. A stance is held for `stanceCommitTicks` unless a *pre-emption* fires.** Without commitment a
scored selector dithers on the tick a score crosses. There are exactly three pre-emptions, and they
are the cases a human also interrupts themselves for: hp crossing below `retreatHpFraction`, the
current target dying or leaving the field, and the bot losing control (`Recover`). **Dodging is not a
pre-emption** — it is a steering desire (H26) and never interrupts a stance, which is the whole
reason a bot here can dodge without stopping fighting.

**H11. Movement is a separate layer from the stance, and stances do not own steering.** A stance
publishes *desires* (a preferred range, a bias to orbit, a willingness to ram); the movement layer
blends them with the reactive ones (dodge, wall). This is the load-bearing choice of the whole
design: dodging must compose with fighting. Any design where `Dodge` is a state that replaces
`Engage` produces a bot that stops fighting to dodge and stops dodging to fight, and both read as
robotic.

**H12. The score breakdown is exposed for debugging.** `BotController` gains an optional
`debug(): BotDebug` returning the current stance, every stance's score, the chosen target, the active
desires and the rolled personality. The playground overlay prints it. This is the deliberate answer
to the known weakness of a scored decision layer — that "why did it do that?" is answered by reading
a scoreboard — and the playground is the tool that makes it cheap.

### 4.3 Movement layer: context steering

**H13. Each concern contributes a desired heading and a weight; the blend picks the resulting
heading; a single reducer converts heading error and range error into `steer`/`throttle`.**

Concerns: hold preferred range to the target; orbit rather than close head-on; lean off the line of
an incoming instance; keep clear of a wall or obstacle within the look-ahead; close to contact when a
range-0 weapon is ready; break away when disengaging.

**H14. The blend must have a defined fallback when every weight is zero or the desires cancel.**
Continue the previous heading and coast. A context-steering blend with no fallback dithers on the
tick everything cancels, which is the failure mode this style is known for.

**H15. `steer` and `throttle` stay ternary and the reducer is the only place that converts to them.**
The wire format does not change; nothing else in the brain emits an input value.

### 4.4 Modules

**H16.** New code lives in `packages/server/src/bot/brain/`:

```
packages/server/src/bot/
  brain/
    controller.ts    HumanController — the pipeline; implements BotController
    perception.ts    attention, threat list, memory decay, enemy-ult memory
    stance.ts        stance scoring, commitment, pre-emption
    movement.ts      context-steering blend -> steer/throttle
    firing.ts        per-slot fire decision, discipline, ult windows, range model
    aim.ts           drifting aim error, shot leading
    humanize.ts      reaction delay line, blunders, idle fidget
    personality.ts   seeded personality roll within a tier band
  types.ts           extended: BotDebug, BotPersonality
  view.ts            unchanged — hosts change, the projection does not
  rng.ts             unchanged
  view-ring.ts       unchanged
config/bot-profiles.ts  rewritten: the table in section 7
```

**H17. `controller.ts` (`LegacyController`) and `input.ts` (`botInput`, `triggerRangeOf`,
`shouldRecomputeIntent`, `pulsedFireSlots`) are deleted, with their tests.** The user chose outright
replacement over keeping a legacy pilot. `shouldRecomputeIntent` and `pulsedFireSlots` are re-created
inside the new modules where their semantics now differ (H6 changes what the cadence gates; H27
changes what the pulse means).

**H18. Every module is a pure function of its inputs plus an explicit state object.** The controller
owns state; the modules receive it. This is what makes each layer unit-testable without constructing
a room.

## 5. Fairness and determinism

**H19. Every random draw comes from `view.rng`.** `Math.random()` stays banned on the bot path
(B20). This includes the personality roll, aim error, blunders, fidget, score noise, and every
probability gate in the table.

**H20. The personality is rolled lazily on the first `decide` call**, from `view.rng`, so no
constructor signature changes and every host gets a personality without knowing personalities exist.

**H21. Draw order is part of the contract.** Every draw happens in a fixed order per tick regardless
of branch outcome, or two runs of the same seed diverge the first time a branch is skipped. Where a
draw is only *sometimes* needed, it is drawn unconditionally and discarded. A test asserts an
identical intent stream for an identical seed.

**H22. The bot never reads an enemy's `WeaponSlotState`** (B18, unchanged). Ult tracking is built
from `observedFires` and the drawn `maneuver` field, both visible to a player.

**H22 as shipped: the memory is BUILT, and nothing reads it yet.** `perceive` records every observed
press into `ultSeenTick`, and `ultIsSpent` answers "was this car seen spending this weapon recently"
— but no module under `brain/` calls it, and `BotCarView.maneuver` is carried on the view and never
read either. Nothing in the shipped bot presses more boldly because it watched an enemy burn an
ultimate. The plumbing is kept deliberately rather than deleted: it is a correct, cheap seam (one
map, three zero-length loops per tick) and rebuilding it next pass would be pure waste — but this
spec must not be read as describing behaviour a player could observe. Consuming it is future work.

**H23. Vengefulness is driven by observed incoming fire, not by damage attribution.** The bot blames
whoever owns the instances it saw coming at it — `BotInstanceView.ownerSessionId`, which a player can
see. It can therefore blame the wrong car, which is not a defect: mis-attributing a hit is exactly
what a human does, and `lastDamagerSessionId` is deliberately absent from `BotCarView`.

**H24. `pressId` stays out of the view.** Linking a watched press to the instance flying toward you
by string equality is a cross-reference no player has. Ult memory matches on `(ownerSessionId,
weaponId)` and time, the way a person does.

## 6. The behaviours

### 6.1 Threat reaction

**H25. The bot reads `view.instances` and reacts to shots aimed near it.** A shot is *threatening*
when its heading passes within a lateral threshold of the bot's projected position within the next
`dodgeHorizonTicks`. Reaction is gated on `dodgeChance` (rolled once per newly-noticed threat, not
per tick — a bot that re-rolls every tick dodges everything eventually) and delayed by
`dodgeReactionTicks` on top of the tier's normal latency.

**H26. Dodging is a steering desire, never a stance.** Per H11.

### 6.2 Fight economy

**H27. The bot chooses exactly one slot per press and never sets more than one bit.**

`beginFire` resolves at most one press per tick and takes **the lowest set bit the car can actually
use**. The shipped bot ORs every in-range slot into one mask, which means it fires slot 0 essentially
forever and only ever reaches slots 1 and 2 in the gaps where slot 0 is out of stock or locked. That
is a defect, not a behaviour to reproduce: it makes every chassis one-note, and it skews the per-
weapon usage columns of every balance report ever produced.

The firing layer therefore *ranks* the slots it would like to press — by weapon value, personality
preference weight, and how well the current geometry fits that weapon's window — and emits the single
best one. `burstGapTicks` paces presses overall rather than per slot, since the sim will not accept
two presses on one tick anyway.

**H27a. Switch-lock awareness is a skill.** Pressing a different slot than last time is refused while
`switchLockUntilTick` has not expired, and every press sets that lock afresh. A disciplined bot
checks its own `switchLockUntilTick` (it is on its own HUD, so reading it is fair) and does not throw
away a press it cannot make.

**AMENDED after implementation: the check is uniform across tiers, not a skill.** The original text
said "a casual mashes and eats the refusal", which was never implemented and is not worth
implementing: `beginFire` simply ignores a press it refuses, so eating a refusal has no observable
effect in the sim at all — no wasted cooldown, no animation, nothing a player could see. A tier
difference that produces no difference is not a tier difference. `chooseSlot` therefore holds fire
under its own switch lock on every tier, and this decision earns no knob of its own.

**H28. A slot fires only inside the window that weapon wants.** Range is compared against the
weapon's own `range`; a `range: 0` row (`wildcharge`) uses `contactTriggerUnits` instead, since a
charge damages through driven hull contact and gating it on its own range is what kept Bastion from
ever pressing it before 2026-09-04.

**H29. `fireDisciplineChance` is the probability of *holding* a shot that is outside the good
window** — the target is beyond the effective band, the aim is marginal, or the slot is down to its
last stock. An easy bot sprays; a hard bot mostly waits.

**H30. `ultDisciplineChance` gates long-cooldown weapons on a good moment**, TF2's airblast pattern.
A weapon counts as an ult when its `cooldownMs` is at or above `ultCooldownMs` (5000, which selects
`thunderclap`, `afterburner`, `lance`, `roadblock`, `wildcharge`). A good moment is: target below
`ultWindowHpFraction`, or stunned, or inside half the weapon's range. On a failed discipline roll the
bot fires it as soon as it is in range, which is what a casual does.

**H31. Personality supplies per-slot preference weights**, Quake's `WEAPONWEIGHTS`. Weights bias both
the fire decision and the range model in 6.4, so a bot that loves its shotgun fights closer.

### 6.3 Target politics

**H32. Target choice is a weighted score, not nearest-first.** Terms: proximity, `woundedBias` on
(1 − hp fraction), `vengefulness` on recently-observed incoming fire, and a bonus for the currently
held target that decays over `targetCommitTicks`. Phased and dead cars score negative infinity.

**H33. `vengefulness` decreases with skill** — 0.80 / 0.50 / 0.25. A casual chases whoever hurt them;
a pro is not distracted. This is the one parameter that deliberately runs backwards up the ladder,
and it is a large part of why easy will read as a *person* rather than as a slow machine.

**H34. Target politics only bite in FFA.** 1v1 practice has exactly one target; the scoring collapses
to it and nothing is wasted.

### 6.4 Positioning and survival

**H35. Preferred range is derived from the bot's own kit, not authored as a unit count.**

```
effectiveRange = Σ(range_i × value_i) / Σ(value_i)      over ready slots with range > 0
value_i        = (damage_i / cooldownSeconds_i) × slotWeight_i
preferredRange = clamp(standoffFraction × effectiveRange, minEngageUnits, awarenessRadiusUnits)
```

Range-0 rows are excluded from the average (they would drag it to zero) but still drive H36. The
awareness radius doubles as the maximum engagement range, which is self-consistent: a bot does not
hold a range further than it can perceive. With today's table this puts Bullseye furthest out,
Bastion in the middle and Mirage closest — which is the roster's intent, and is not a result the
shipped fixed-standoff bot could produce for any value of `standoffUnits`.

`damage_i` and `cooldownSeconds_i` are the raw `WEAPON_TABLE` fields, not `weaponDamageOf` and not
per-press totals: a beam's `damage` is one pulse and `pepperbox`'s is one pellet, so `value_i`
under-rates both. That is acceptable and deliberate — `value_i` is a shaping heuristic for standoff
only. It is not a damage model and must never be mistaken for one; `sim/damage.ts` is the only
authority on damage.

**H36. A ready range-0 weapon adds a `Brawl` desire that pulls preferred range to contact.** This is
what makes "Bastion is going for the charge" legible on screen.

**H37. `retreatHpFraction` triggers `Disengage`, and easy's value is 0.** An easy bot fights to zero
hp. Self-preservation is a learned habit, and its absence is one of the clearest casual tells there
is.

**H38. Disengaging kites rather than flees** — the bot backs off while keeping the target in its
firing arc where the drive model allows. Turning tail is a blunder outcome, not a plan.

**H39. Wall and obstacle avoidance is a steering desire with a tier-scaled look-ahead.** `arena-01`
has no obstacles, so on the shipped arena this is entirely about arena bounds and corners. An easy
bot with a 40-unit look-ahead at 320–450 u/s will pin itself on walls, which is free human-likeness
and costs no extra code.

**H40. `ramIntentChance` gates deliberate ramming.** Ram knockback and the hard-slam stun are real
mechanics no bot has ever used on purpose.

**AMENDED after implementation: the roll is FLAT.** The original text added "deliberate ramming
favours a heavier chassis and a target that is stunned or cornered", which did not ship and the spec
was never corrected for it. What shipped is a single unweighted `rng() < ramIntentChance` draw, made
once per engagement with a target (and re-armed when the target is lost, so a death or a `phased`
respawn does not switch ramming off for the rest of the match) and read only as `wantsRam` by
`scoreStances`'s `brawl` row. `carId` is never read anywhere under `brain/`, and neither is the
target's stun state at this seam. Weighting the roll by chassis mass or target state is a design
question for a future pass, not a defect in this one.

### 6.5 Consistency and mistakes

**H41. `blunderChance` is rolled once per decision window and commits the bot to a wrong action for
`blunderTicks`.** A blunder is one of: steer the wrong way past the target, fire into nothing,
reverse into a threatening shot, or hold fire when the shot was good. Committing for a window is what
separates a mistake from noise; a per-tick coin flip reads as a stutter.

**H42. `scoreNoiseSigma` perturbs stance and target scores** so a marginal call goes the wrong way
sometimes. This is the difference between "the bot always makes the same choice in the same spot" and
a player.

**H43. `idleFidgetChance` produces small steering inputs when there is nothing to do.** Humans are
never perfectly still. Cheap, and it removes the strongest tell in a lull.

## 7. The parameter table

**H44. `BotProfile` is rewritten to the following.** Values marked (r) are derived from the research
in section 3; the rest are first-pass and expected to move under playtesting.

Of the shipped eight fields: `viewStalenessTicks` and `reactionDelayTicks` survive unchanged in
meaning and gain non-zero values for the first time; `reactionTicks` is **renamed `recomputeTicks`**
(B19's own table already called it "recompute cadence", and the old name reads as a reaction time it
never was); `aimToleranceRad` and `fireConeRad` survive with new values; and `standoffUnits`,
`deadbandUnits` and `firePeriodTicks` are **removed** — replaced by `standoffFraction`,
`deadbandFraction` and `burstGapTicks`, which are fractions of the bot's own kit rather than absolute
unit counts (H35).

**Perception** — total perceived latency is `viewStalenessTicks + reactionDelayTicks`: 433 ms /
300 ms / 200 ms, against measured human values of ~250 ms casual, ~215 ms amateur, 150–165 ms pro (r).
The bot's numbers sit slightly above the raw measurements because a car game's decision is a
navigation decision, not a click.

| | easy | medium | hard |
|---|---|---|---|
| `viewStalenessTicks` | 4 | 3 | 2 |
| `reactionDelayTicks` | 9 | 6 | 4 |
| `recomputeTicks` | 12 | 6 | 2 |
| `acquireTicks` | 15 | 9 | 5 |
| `awarenessRadiusUnits` | 520 | 700 | 900 |
| `rearBlindHalfAngleRad` | 1.05 | 0.60 | 0 |
| `trackedThreatLimit` | 1 | 2 | 4 |
| `memoryTicks` | 15 | 45 | 90 |

**Aim** — the steering deadzone shrinks sharply from today's values because inaccuracy now comes from
a drifting error term rather than from a fat dead angle. Drift is the point: error resampled every
tick reads as jitter; error that wanders over roughly half a second reads as a hand.

| | easy | medium | hard |
|---|---|---|---|
| `aimErrorSigmaRad` | 0.18 | 0.09 | 0.035 |
| `aimErrorDriftTicks` | 20 | 14 | 9 |
| `aimToleranceRad` | 0.30 | 0.16 | 0.07 |
| `fireConeRad` | 0.55 | 0.35 | 0.20 |
| `leadFactor` | 0.00 | 0.55 | 0.95 |

`aimToleranceRad < fireConeRad` on every row is retained from the shipped table and still asserted:
tolerance is the deadzone steering settles inside, the cone is the gate firing needs, and a row with
the inequality backwards settles at a heading it can never shoot from.

`leadFactor` is the largest single skill gap available. Cars top out at 320–450 u/s while
`magmablast` flies at 600 and `thumper` at 450; a bot that does not lead cannot hit a moving Mirage
with either. This is UT's Adept gate, and it is why easy will read as *bad at the game* rather than
merely slow.

**Fire economy**

| | easy | medium | hard |
|---|---|---|---|
| `burstGapTicks` | 14 | 7 | 3 |
| `fireDisciplineChance` | 0.05 | 0.45 | 0.85 |
| `ultDisciplineChance` | 0.00 | 0.50 | 0.90 |
| `ultWindowHpFraction` | 0.40 | 0.40 | 0.40 |

`ultWindowHpFraction` is inert at `easy`, whose `ultDisciplineChance` of 0 means the window is never
consulted. It carries a real value anyway rather than a sentinel, so a personality roll or a retune
that lifts easy's discipline off zero finds a sane number rather than a hole.

`ultDisciplineChance` reproduces TF2's airblast gating (0% / 50% / 90%) (r). It bites hard on this
roster: `lance` is 16 s for 170 damage, `wildcharge` 20 s for 250. An easy bot burning `lance` into a
full-hp car at maximum range, and a hard bot holding it for a stunned target, is a difference a
player sees without being told to look.

**Target politics**

| | easy | medium | hard |
|---|---|---|---|
| `targetCommitTicks` | 150 | 60 | 25 |
| `woundedBias` | 0.10 | 0.50 | 0.90 |
| `vengefulness` | 0.80 | 0.50 | 0.25 |

**Positioning and survival**

| | easy | medium | hard |
|---|---|---|---|
| `standoffFraction` | 0.45 | 0.70 | 0.85 |
| `deadbandFraction` | 0.25 | 0.15 | 0.08 |
| `orbitBias` | 0.00 | 0.35 | 0.75 |
| `wallLookaheadUnits` | 40 | 90 | 150 |
| `retreatHpFraction` | 0.00 | 0.30 | 0.45 |
| `ramIntentChance` | 0.15 | 0.30 | 0.50 |

**Threat reaction and consistency**

| | easy | medium | hard |
|---|---|---|---|
| `dodgeChance` | 0.05 | 0.55 | 0.95 |
| `dodgeReactionTicks` | 12 | 8 | 4 |
| `dodgeHorizonTicks` | 12 | 18 | 24 |
| `blunderChance` | 0.120 | 0.050 | 0.015 |
| `blunderTicks` | 10 | 10 | 10 |
| `idleFidgetChance` | 0.10 | 0.05 | 0.02 |
| `scoreNoiseSigma` | 0.30 | 0.15 | 0.05 |
| `stanceCommitTicks` | 45 | 30 | 18 |

**Shared constants** — not per tier, and therefore not in the profile: `minEngageUnits` 70,
`contactTriggerUnits` 150, `ultCooldownMs` 5000, `personalityJitter` 0.25.

**H45. Every knob is a named field with a doc comment, and `botFingerprint` already hashes the whole
table** — so any retune invalidates balance baselines automatically, as designed.

**H46. The controller carries a `BOT_BRAIN_VERSION` constant, included in `botFingerprint`.** The
table hash cannot see a behaviour change made in code with the numbers untouched. Without this, a
brain edit that leaves the table alone would let the harness compare two incomparable pilots.

## 8. Personalities

**H47. A tier sets the band; a personality shifts parameters within it.** Five archetypes, rolled
uniformly from the bot's own stream:

| archetype | shifts |
|---|---|
| `brawler` | standoff down, ram up, retreat down, orbit down |
| `kiter` | standoff up, orbit up, retreat up, ram down |
| `sprayer` | discipline down, burst gap down, ult discipline down |
| `grudge` | vengefulness up, target commit up, wounded bias down |
| `opportunist` | wounded bias up, ult discipline up, standoff mid |

Each archetype is a table of multipliers applied to the tier's values and then **clamped so a
personality can never leave its tier's band**. The band is `± personalityJitter` (0.25) of the tier
value, further clamped so the result never passes the value the *easier* neighbouring tier holds for
that parameter, where one exists — so a hard bot can never be as undisciplined as a medium bot, and
`easy` (no easier neighbour) is bounded by the jitter alone. A hard `sprayer` is still recognisably a
good player. Slot preference weights are rolled per bot in the same pass and are not clamped, since
preferring a different weapon is not a skill difference.

## 9. Host changes

**H48. Every host must now feed three things it does not feed today.**

1. **A `ViewRing`.** All three tiers run `viewStalenessTicks > 0`, so `snapshotWorld(state, combat)`
   must be pushed once per tick — once per room, not once per bot — and the ring passed to
   `buildBotView`. Capacity is `max(viewStalenessTicks) + 1`. The machinery exists and has never run
   in production.
2. **The `fired` sink — rooms only.** `PipelineCtx.events` is optional and neither room passes it, so
   `observedFires` is empty in both. Rooms allocate one `CombatEvents` bag, pass it through the
   pipeline, feed the previous tick's `fired` slice into the view, and **drain the bag as they go** —
   a long deathmatch would otherwise accumulate every event of the match in a bag nothing reads.
   `balance/match.ts` already does all of this (it keeps a `firedCursor` and passes
   `previousTickFires`) and needs no change here.
3. **Per-bot RNG streams — already done where it matters.** `balance/match.ts` already derives
   `makeRng(deriveSeed(seed, "seat", slot))` per seat. Both rooms hold a single `botRng`, which is
   correct while a room has exactly one bot, and both do. No change; recorded so the next person to
   add a second bot to a room knows the rule.

Call sites to migrate: `PracticeRoom.enqueueBotInput`, `PlaygroundRoom`'s equivalent, and
`balance/match.ts`. All three construct `LegacyController` today; beyond swapping the class, the
rooms take items 1 and 2 and the harness takes item 1 alone.

## 10. Testing

**Unit, per module.** Aim error is deterministic for a seed and its spread matches the sigma; lead
solves the right intercept for a known geometry and degrades correctly at `leadFactor` 0 and 1; the
stance selector honours its commitment window and its pre-emptions; the steering blend has a defined
output when every weight is zero (H14); the delay line reproduces B19's behaviour; the personality
roll never leaves the tier band.

**Determinism.** Same seed, identical intent stream over a fixed number of ticks — extending the
existing balance determinism digest, which already asserts a full stats/outcome digest.

**Characterisation — the tests that keep the tiers apart.** These assert *behavioural* differences
directly, because that is the thing this work exists to produce and the thing a future tuning pass
will silently erode:

- hard breaks off the line of an incoming `predator` within its reaction budget; easy does not react
  at all.
- easy fires `lance` at a full-hp target at maximum range; hard does not.
- easy never disengages above 0 hp; hard disengages below its threshold.
- driven at a corner from a fixed pose and seed, easy reaches wall contact and hard turns out before
  it — asserted as "easy's minimum distance to the wall is smaller than hard's" over the same scripted
  approach, not as "easy crashes", which would be a flaky thing to demand.
- given two targets, hard picks the wounded one; easy picks the one that last shot at it.
- a chassis with three ready slots does not press the same slot every time (the H27 defect, asserted
  directly so it cannot come back).

**Ladder monotonicity.** Over a fixed set of seeds, hard out-damages medium out-damages easy. Proxy
metrics (damage dealt, hit rate, time alive) rather than win rate, so the suite stays fast; the real
answer is `npm run balance`. If a duel-based test cannot run in a few seconds it moves out of the
suite and into the harness, and this spec's claim moves with it.

## 11. What this disturbs

- **Every existing balance report becomes non-comparable.** The bot fingerprint refuses that
  comparison already (`--baseline` will reject it), so nothing lies silently — but the README's
  "the current pilot is a fixed-standoff 1v1 chaser" caveat (B2, B40) is now wrong and must be
  rewritten, along with the note that the bot cannot press `wildcharge` (already fixed in 550f5ab).
- **Every past report's per-weapon columns were measuring a slot-0 bias, not a preference.** H27's
  finding means the old pilot pressed slot 0 almost exclusively; any historical conclusion about a
  slot-1 or slot-2 weapon being weak is suspect for that reason alone, independently of the pilot
  rewrite. Worth stating in the harness README rather than left for someone to rediscover.
- **Practice mode's difficulty feel changes for players.** That is the point, and it means the three
  tiers are not done until the user has played them.
- **`packages/shared/dist` in this worktree is stale** — it reports `predator` at a 300 ms cooldown
  against a source reading 1000 ms, and `magmablast` at 1000 against 1600. Rebuilding shared is step
  zero; the range model in H35 reads `cooldownMs` and would otherwise be tuned against fiction.
- **Playtest probes are unaffected.** `playtest/lan.ts` carries its own inline chaser and does not
  import the bot API; no probe imports `botInput`, `BOT_PROFILES` or `LegacyController`. Nothing in
  `packages/server/playtest/` needs updating for this work, and nothing there should be touched.
- **`docs/turn-tuning.md` is unaffected** — no `CAR_TABLE` or `DRIVE_CONFIG` value moves.
- **The cars & weapons guide is unaffected** — `balanceStamp` does not hash `BOT_PROFILES`.

## 12. Documentation

- New `docs/bot-behavior.md`: which knob to reach for when a bot feels wrong, the full parameter
  table, the stance list, and how to read the playground's debug overlay. Modelled on
  `docs/turn-tuning.md`'s job of being the page you open when something feels bad.
- `CLAUDE.md`: a bot section, and a row in the "Read the right doc" table.
- `packages/server/balance/README.md`: rewrite the pilot caveat.
- `packages/server/CLAUDE.md`: note the new module layout if it lists one.

## 13. Out of scope

Recorded so a future session does not have to re-derive that these were considered and dropped:

- A fourth difficulty rung, above or below the current three (H2).
- Learning or adaptation of any kind — no difficulty that tracks the player's performance.
- Bot chat, taunts, or names.
- Team coordination between bots. FFA only; nothing here reasons about an ally.
- Pathfinding. `arena-01` has no obstacles and `arena-02` is not in the practice or balance rotation;
  steering-level avoidance is enough until an arena needs more.
- Bots in `ArenaRoom` (real multiplayer). Practice, playground and harness only, as today.
