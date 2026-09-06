# Bot behaviour

Which knob to reach for when a bot feels wrong. The config file is the source of truth:
[`packages/server/src/config/bot-profiles.ts`](../packages/server/src/config/bot-profiles.ts).
This page is a transcription — re-check it whenever a tier value changes.

**Unlike `docs/turn-tuning.md`, nothing tests this page.**

One brain, three rows of numbers. Feel complaints belong in the
[`bot-tuner`](../.claude/skills/bot-tuner/SKILL.md) skill, which reads the live table and proposes
knob moves — not a Hard-only branch.

Design: [`docs/superpowers/specs/2026-09-05-bot-situation-play-design.md`](superpowers/specs/2026-09-05-bot-situation-play-design.md)
(S1–S28). Fairness / hands / personalities: H1–H8 and H16–H48 of
[`docs/superpowers/specs/2026-09-04-human-like-bot-behavior-design.md`](superpowers/specs/2026-09-04-human-like-bot-behavior-design.md).

Copied from `bot-profiles.ts` on 2026-09-06. `BOT_BRAIN_VERSION` is `4.2.0`.

## Reading a complaint

| Symptom | Knob(s) |
|---|---|
| "Medium is too hard to hit" | `aimErrorSigmaRad` up. `minShotValueFraction` is not a straightforward easier/harder dial: lowering it widens what the bot will attempt (more shots, more misses); raising it makes the bot *pickier and therefore MORE deadly per shot*, not less |
| "Hard is a laser" | Same knobs the other way on `hard` |
| "Hard isn't attacking / holds fire" | `minShotValueFraction` down. Check the overlay first: `fight` with `slot -` (holding fire) while a gun is in range can still be the bot *correctly* declining a shot below `minShotValueFraction * bestAchievableValueOf(carId, sigma)` — the overlay does not print the solver's `value` yet, so confirm by reading `solve()`'s output for that slot before assuming it is a bug |
| "Shots are all over the place" | **Not a knob any more.** The solver decides hit chance and value; if it is firing shots that miss, that is a solver bug to investigate (`bot/brain/solution.ts`), not a value to tune |
| "It misses me when I turn" / "it shoots where I was" | `stateEstimationSigma` down on that tier — **not** `aimErrorSigmaRad`. Leading a car through a curve is PREDICTION (how well it reads your speed and turn rate, `bot/brain/predict.ts`); `aimErrorSigmaRad` is steady-state hands and will not fix a lead that is aimed at the wrong place to begin with. If it misses you equally badly while you drive STRAIGHT, that is the hands after all |
| "It ults my corpse / spawn shield" | `deadRespect` up (Hard should already be 1) |
| "It sits in a corner while I approach" | `cornerRespect` up; overlay should read `unpin` |
| "It never dodges" | `dodgeChance`, `dodgeReactionTicks`, `dodgeHorizonTicks`, `incomingCarChance` |
| "It weaves instead of fighting" | Orbiting no longer exists — the orbit desire was deleted along with the angular fire gate; a later phase reintroduces circling as emergent planner behaviour. Weaving today means either the steering lag compensation is mis-tuned (`BRAIN_CONSTANTS.deadzoneFloorFraction` / `deadzoneCapMultiplier`) or it is a real bug — say so rather than reaching for a knob |
| "It fights at the wrong distance" | `standoffFraction`, `opponentRangeRespect`, `awarenessRadiusUnits` |
| "It charges in / never closes" | `standoffFraction` down, `opponentRangeRespect` down |
| "It runs away from nothing" | anticipatory `evade` (below) overreacting: `opponentRangeRespect` down is the tier dial; `BRAIN_CONSTANTS.dangerEvadeFraction` up or `dangerEvadeCooldownTicks` up narrow it further. Read the overlay's `danger` reading first — if it is genuinely nonzero this is a threshold/frequency tune, not a bug |
| "It walks into obvious fire" | `opponentRangeRespect` up. If the overlay's `danger` reads 0 while you are aimed at it from inside your weapon's reach, that is a solver bug (`dangerEvAgainst` in `bot/brain/solution.ts`), not a knob to tune |
| "It lost me and drove around" | `memoryTicks`, `hearChance` — hunt is last-known / shots / quadrants, never the arena centre |
| "It wastes its ult" | `ultDisciplineChance` up, `ultWindowHpFraction` (the HP that counts as a dump window) |
| "It never punishes a stun" | Overlay should flip to `punish`; if it stays `fight`, `situationCommitTicks` is not the issue (punish preempts) |
| "It feels robotic" | `aimErrorDriftTicks`, `scoreNoiseSigma`, `idleFidgetChance`, `blunderChance` |
| "It never uses its second weapon" | personality `slotWeights`, `slotStickTicks` (too high = glued to one gun) |
| "All three tiers feel the same" | Read [`tiers.test.ts`](../packages/server/src/bot/brain/tiers.test.ts). If that passes, the complaint is a parameter *value*. |

The "runs away from nothing" / "walks into obvious fire" rows above mix a per-tier dial
(`opponentRangeRespect`) with two knobs that are **not** per-tier: `BRAIN_CONSTANTS.dangerEvadeFraction`
and `dangerEvadeCooldownTicks` are shared, so retuning either moves medium and hard together, not just
the complained-about tier. Easy is structurally immune regardless: the anticipatory term is gated on
`opponentRangeRespect > 0` in `controller.ts`, and easy's is 0, so it stays permanently false there no
matter what the shared constants say. (That gate is explicit for a reason — the scaling by
`opponentRangeRespect` alone did not deliver the immunity, because `0 >= bestValue * fraction` is
true whenever the bot has no shot of its own.)

## Pipeline

```
perceive (every tick)
  → assess: facts → one situation → one play
  → move: that play's heading / range / throttle (never reverse into a bound)
  → shoot: one slot, only if the play allows fire and they are hittable
  → humanize (every tick)
```

Practice, playground, and the balance harness all call `HumanController.decide(BotView)`.

**Expect a skilled bot to fire noticeably LESS often than before 4.0.0, and hit far more.** The
trigger used to be an angle (`fireConeRad`); it is now a FRACTION of the shooter's own kit's
best-achievable expected damage per second (`minShotValueFraction`, gated against
`bestAchievableValueOf(carId, aimErrorSigmaRad)`), so a shot that will not land — or is not worth the
gun time relative to what this car could do at its best — is not taken at all. Fewer, deadlier shots
is the intended shape of this version, not a regression.

**The threshold is RELATIVE to the shooter's own chassis, not an absolute number** (fix round 2,
2026-09-06, R20). A kit's best-achievable `value` varies roughly 4x across the roster (Bullseye's
pepperbox ~78, Bastion's thumper ~18), so comparing every chassis's shot quality against one shared
absolute number made a hard Bastion — whose best possible shot anywhere sat below the old absolute
threshold — never fire at all. `minShotValueFraction` divides by each shooter's OWN ceiling instead.

## Situations (highest priority wins)

| Id | When | Drive | Fire |
|---|---|---|---|
| `recover` | self dead or phased | coast | off |
| `waitOut` | nobody hittable | last-known / heard shot / quadrant | **off** |
| `evade` | incoming shot (rolled `dodgeChance`), incoming car (`incomingCarChance`), or — anticipatory, before any shot exists and **only while not wall-pinned**, alive and not phased — standing in a loaded gun's firing solution (see below) | off the line | still fire if in cone |
| `unpin` | on a bound/corner with a target, `cornerRespect` | open floor, never map centre | fight rules |
| `punish` | stunned, low HP, or they just spent a 5s+ gun | close | dump, including ult |
| `reset` | own HP < `retreatHpFraction` (0 = Easy fights to zero) | open range, no reverse into a wall | fight rules |
| `fight` | a ready gun's **aim/player** reach covers them | that gun's band in open floor | `chooseSlot` |
| `close` | they're up but not in reach yet | intercept, throttle 1 | off |

HUD lock is never a veto. A big gun is `cooldownMs >= 5000` (not predator).

Own reach uses `aimRangeUnits` when the gun has aim assist (predator fights around 800, not 1800).
Opponent keep-out is their **shortest** gun × `opponentRangeRespect`.

### `evade`'s anticipatory half — and why it has a refractory period

Beside the reactive dodge, `evade` also fires when the danger the bot is standing in
(`dangerEvAgainst`, scaled by `opponentRangeRespect`) meets or beats the best shot the bot could
itself take from its current pose — "am I losing this exchange from here", asked before any shot
exists. Easy's `opponentRangeRespect` of 0 makes it impossible to trip, which is the intent — the
gate tests `opponentRangeRespect > 0` explicitly rather than relying on the scaling to deliver that.

**It is also gated on the bot NOT being wall-pinned, and on it being alive and not spawn-protected.**
So "it will not break the line when backed against a wall" is by design, not a tuning failure: a
pinned bot yields this term to `unpin`, which gets first crack at getting off the wall and usually
breaks the line on its way to open floor. The reactive dodge and the incoming-car trigger are *not*
gated that way — they still fire while pinned. The alive/not-phased gate is there so a dead or
spawn-protected bot cannot silently consume the refractory below at a moment when `recover` outranks
`evade` anyway — which in `FFA_DEATHMATCH`, and therefore in Practice, is every respawn.

**Reach for `BRAIN_CONSTANTS.dangerEvadeCooldownTicks` (120) before `dangerEvadeFraction` (1) if this
behaviour feels wrong.** A shot in flight is a rare, brief EVENT, which is what `evade`'s
no-commit-delay priority slot is calibrated for; "I am in someone's firing solution" is a STANDING
condition, true for much of an ordinary duel. Without a refractory period the bot disengages for most
of the fight no matter what arithmetic decides the condition — three differently-shaped triggers were
measured collapsing the same duel fixture before the cooldown was added. The cooldown says how often
an excursion may START and `situationCommitTicks` says how long one LASTS, so between them evade's
share of a fight is about `situationCommitTicks / dangerEvadeCooldownTicks` — 5% on hard, 10% on
medium. Retuning `situationCommitTicks` moves that share without touching the cooldown.

## Parameter table

### Perception

| Field | easy | medium | hard |
|---|---|---|---|
| `viewStalenessTicks` | 4 | 3 | 2 |
| `reactionDelayTicks` | 9 | 6 | 4 |
| `recomputeTicks` | 12 | 6 | 2 |
| `acquireTicks` | 15 | 9 | 5 |
| `awarenessRadiusUnits` | 520 | 700 | 900 |
| `rearBlindHalfAngleRad` | 1.05 | 0.6 | 0 |
| `trackedThreatLimit` | 1 | 2 | 4 |
| `memoryTicks` | 15 | 45 | 90 |

### Aim (hands)

| Field | easy | medium | hard |
|---|---|---|---|
| `aimErrorSigmaRad` | 0.18 | 0.09 | 0.035 |
| `aimErrorDriftTicks` | 20 | 14 | 9 |
| `aimToleranceRad` | 0.3 | 0.16 | 0.07 |
| `stateEstimationSigma` | 0.25 | 0.1 | 0.03 |

`stateEstimationSigma` is filed under **Perception** in `bot-profiles.ts`, not Aim — it is a
reading-the-world knob whose effect lands on the gun. It sits here because the knob it is constantly
confused with, `aimErrorSigmaRad`, is one row up, and telling them apart is the whole diagnostic
(see the complaint table above).

`fireConeRad` is gone as of `BOT_BRAIN_VERSION` 4.0.0 — the angular fire gate was replaced by the
solver's own aim quadrature and its `value` (EV) threshold, `minShotValueFraction` (below).

**`leadFactor` is gone as of 4.2.0.** It was first removed alongside `fireConeRad` in 4.0.0, which
was premature (R21) — the replacement was a phase that had not landed, so it was restored and the
tiers kept a lead knob in the meantime. That phase is this one: the fraction-of-the-correct-lead dial
is replaced by rolling the target through the **real drive model** (`bot/brain/predict.ts` —
`physicsPredictor`, `interceptTicks`, `rollForward` over `stepDrive` + `driveOf`), so lead is now
solved rather than dialled, and there is no "how much of the correct answer does this tier apply"
number left to turn. The `interceptPoint` FUNCTION survives in `aim.ts` with its `leadFactor`
parameter and has **no production caller today** — kept deliberately as the cheap zero-horizon
straight-line path for a later phase, not as a live knob.

`stateEstimationSigma` is how wrong a bot's read of an opponent is, **as a fraction** — two gaussian
draws per predictor construction (four `rng()` calls: Box-Muller draws a pair each) scale the observed
`speed` and the observed turn rate before the rollout runs. Reading exact `speed` off another car
every tick is the one place a bot sees more precisely than a person, and this is the answer to that.

The turn half is the one that reads a **corner**, and it works by moving the observation across
`BRAIN_CONSTANTS.fullLockAngVelFraction`: the noised rate — not the raw one — is what
`steerFromObservedTurn` reconstructs a held wheel from, so a bad enough read misjudges *whether* the
car is steering at all, and near the threshold *which way*. Above the threshold the read is quantised
to a -1/0/1 steer, so a small error there changes nothing; below it the residual is a ram's spin and
the error scales it continuously. That reconstruction lives inside `physicsPredictor`, after the
draws, precisely so the noise reaches it.

It is **not confined to [0, 1]** (a fraction
above 1 is a wild misread, not an invalid value), so it is deliberately absent from
`personality.ts`'s `UNIT_INTERVAL_FIELDS` and from `bot-profiles.test.ts`'s `PROBABILITY_FIELDS` —
exactly as `aimErrorSigmaRad` is, and for the same reason.

**Easy now leads, badly — and the easy portrait in
[`2026-09-05-bot-predictive-brain-design.md`](superpowers/specs/2026-09-05-bot-predictive-brain-design.md)
("Does not lead", P34) is out of date.**
With `leadFactor` 0 gone, no tier aims at where you are standing any more: every tier gets the same
physics solve, and the tiers separate on how badly they read the inputs to it (`stateEstimationSigma`
0.25 on easy against hard's 0.03) and on the hands that then execute it (`aimErrorSigmaRad` 0.18
against 0.035). The spec's normative field tables are what this phase followed; its prose portrait
was written when `leadFactor` still existed. An easy bot visibly trying — and failing — to lead you
is the intended shape of 4.2.0, not a regression, in the same spirit as "expect a skilled bot to fire
less and hit far more" above.

**A car spinning from a ram is read as a car that MEANT to turn, and is mispredicted.** The bot infers
turn rate from two observed poses (`observedAngVelOf`), assumes `authority` and shove neutral because
those are not numbers a person reads off a screen, and above
`BRAIN_CONSTANTS.fullLockAngVelFraction` of the chassis's own turn rate treats the result as a held
wheel. Just after a ram all of that is wrong at once, and the next shot misses. That is P19 and it is
**kept on purpose** — it is a very human error obtained for free. Do not file it as a prediction bug.

### Shared constants (`BRAIN_CONSTANTS`, not per-tier)

In `bot-profiles.ts`. Editing any of these retunes **every** tier at once — and note that
`botFingerprintInput()` (`packages/server/balance/fingerprint.ts`) hashes only `BOT_PROFILES` and
`BOT_BRAIN_VERSION`, so a `BRAIN_CONSTANTS` edit does not move `botFingerprint`: bump
`BOT_BRAIN_VERSION` yourself, or two balance reports will compare as if the same pilot played both.

Steering — feeds `compensateForLag` in `bot/brain/movement.ts`:

| Field | Value | What it does |
|---|---|---|
| `deadzoneFloorFraction` | 0.5 | Floors the effective steering deadzone at half of whichever rotation the bot cannot correct within — one tick's, or one `recomputeTicks` decision window's, whichever is larger. Without it the bang-bang steer law (`steer` is only ever -1/0/1) limit-cycles around its own aim line forever, because it never anticipates its own reaction lag. |
| `deadzoneCapMultiplier` | 2.3 | Hard ceiling on that deadzone, as a multiple of `aimToleranceRad`. **A FITTED constant, not a derived one** — the doc comment on it in `bot-profiles.ts` shows nearby values (2.0, 2.3, 3.0) settling to qualitatively different, non-monotonic outcomes. Do not nudge it casually; re-measure if `turnRate`, `deadzoneFloorFraction`, or a tier's turn-rate profile changes. |

Danger and the anticipatory `evade` — feeds `dangerEvAgainst` in `bot/brain/solution.ts` and the
gate in `bot/brain/controller.ts`:

| Field | Value | What it does |
|---|---|---|
| `assumedOpponentAimSigmaRad` | 0.06 | The aim error a bot assumes of an OPPONENT when reading danger, instead of projecting its own hands. One shared number because the bot cannot know who it is facing — so it sits between medium's `aimErrorSigmaRad` (0.09) and hard's (0.035), over-reading an easy or medium opponent's threat and under-reading a hard one's by ~1.7x. Accepted asymmetry, not "assume competence". |
| `dangerEvadeFraction` | 1 | Fraction of the bot's OWN best available shot (`bestValue`) that the scaled danger must clear before it leaves the line. Relative, not absolute: "am I losing this exchange from here". |
| `dangerEvadeCooldownTicks` | 120 | Refractory period — how often an anticipatory excursion may START. With `situationCommitTicks` saying how long one LASTS, this sets `evade`'s share of a fight (5% hard, 10% medium). Reach for this before `dangerEvadeFraction`; see the section above. |

Prediction — feeds `physicsPredictor` / `selfPredictor` / `interceptTicks` in `bot/brain/predict.ts`,
all built in `controller.ts`'s `plan()`:

| Field | Value | What it does |
|---|---|---|
| `predictionHorizonTicks` | 90 | How far ahead a firing solution rolls a target. How far a SHOT flies, not how far a bot thinks. Verified against `WEAPON_TABLE`: the longest flight on the roster is `thumper`'s 87 ticks (1305 u at 450 u/s = 2.9 s), `predator` next at 60 — 90 covers the roster with a little margin. **A tick count, so a `TICK_RATE_HZ` change does not rescale it**: thumper becomes 174 ticks at 60 Hz and this would silently truncate every long solve. Re-derive it if the netcode rewrite's phase 1 lands. |
| `closeLeadHorizonFraction` | 1 / 3 | Fraction of that horizon the `close` situation aims the BODY at — a car closes far slower than a bullet flies, so the full shot horizon would point the nose most of a lap around a turning target. A fraction rather than its own tick count so it cannot drift away from the horizon it is a fraction OF. |
| `fullLockAngVelFraction` | 0.5 | Fraction of a chassis's own turn rate an observed turn must reach before it reads as deliberate STEERING rather than a ram's residual spin. A half, because the sim has no partial steer — `stepDrive`'s steer is only ever -1/0/1, so a car genuinely turning is at FULL lock and there is nothing between the two cases to discriminate. Per-chassis by construction: Bastion's bar is lower than Mirage's. |
| `interceptFixedPointRounds` | 3 | Rounds of fixed-point iteration behind "how many ticks ahead do I aim". A curving path has no closed form, so this converges what `aim.ts`'s `interceptPoint` solves in one shot against a straight line. Fixed rather than looped to a tolerance because the solver must do bounded work every tick (H21). |

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
| `standoffFraction` | 0.45 | 0.55 | 0.7 |
| `deadbandFraction` | 0.25 | 0.15 | 0.08 |
| `wallLookaheadUnits` | 40 | 90 | 150 |
| `retreatHpFraction` | 0 | 0.3 | 0.35 |
| `ramIntentChance` | 0.15 | 0.3 | 0.5 |

`orbitBias` is gone — the orbit desire was deleted along with the angular fire gate. A later phase
reintroduces circling as emergent behaviour from a planner; there is no orbiting today.

### Judgment (same factors, different use)

| Field | easy | medium | hard |
|---|---|---|---|
| `deadRespect` | 0.25 | 0.75 | 1 |
| `opponentRangeRespect` | 0 | 0.45 | 0.9 |
| `cornerRespect` | 0.35 | 0.75 | 1 |
| `incomingCarChance` | 0.1 | 0.55 | 0.95 |
| `situationCommitTicks` | 20 | 12 | 6 |
| `slotStickTicks` | 4 | 8 | 12 |

`opponentRangeRespect` does double duty as of phase C (P38): it was already the keep-out-of-their-gun
weight (S11) read by range selection, and is now also the weight on danger in the anticipatory
`evade` term below — how hard the bot works to stay out of a loaded gun's firing solution before any
shot exists. At 0 (easy) the anticipatory evade can never fire, the same way easy already ignores
keep-out range generally. No new field was added for phase C; this one was repurposed.

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

## Overlay

Playground prints `personality | situation | range N | slot K | danger N`. `danger` is the damage
per second the bot believes it is standing in — the firing solver run against the opponent's own
kit (`dangerEvAgainst`, `bot/brain/solution.ts`), weighted by believed readiness. There is no
scoreboard.

## Personality

Five archetypes still jitter hands and favorite guns inside the tier band (H47). They cannot skip
`waitOut` / `unpin` / `punish`. A kiter stands farther in open floor; they still leave a corner.

## One press per tick

`chooseSlot` returns one slot index. `beginFire` takes the lowest set bit of the mask, so ORing
every in-range slot would only ever fire slot 0.
