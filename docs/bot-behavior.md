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

Copied from `bot-profiles.ts` on 2026-09-05. `BOT_BRAIN_VERSION` is `4.0.0`.

## Reading a complaint

| Symptom | Knob(s) |
|---|---|
| "Medium is too hard to hit" | `aimErrorSigmaRad` up. `minShotValue` is not a straightforward easier/harder dial: lowering it widens what the bot will attempt (more shots, more misses); raising it makes the bot *pickier and therefore MORE deadly per shot*, not less |
| "Hard is a laser" | Same knobs the other way on `hard` |
| "Hard isn't attacking / holds fire" | `minShotValue` down. Check the overlay first: `fight` with `slot -` (holding fire) while a gun is in range can still be the bot *correctly* declining a shot below `minShotValue` — the overlay does not print the solver's `value` yet, so confirm by reading `solve()`'s output for that slot before assuming it is a bug |
| "Shots are all over the place" | **Not a knob any more.** The solver decides hit chance and value; if it is firing shots that miss, that is a solver bug to investigate (`bot/brain/solution.ts`), not a value to tune |
| "It ults my corpse / spawn shield" | `deadRespect` up (Hard should already be 1) |
| "It sits in a corner while I approach" | `cornerRespect` up; overlay should read `unpin` |
| "It never dodges" | `dodgeChance`, `dodgeReactionTicks`, `dodgeHorizonTicks`, `incomingCarChance` |
| "It weaves instead of fighting" | Orbiting no longer exists — the orbit desire was deleted along with the angular fire gate; a later phase reintroduces circling as emergent planner behaviour. Weaving today means either the steering lag compensation is mis-tuned (`BRAIN_CONSTANTS.deadzoneFloorFraction` / `deadzoneCapMultiplier`) or it is a real bug — say so rather than reaching for a knob |
| "It fights at the wrong distance" | `standoffFraction`, `opponentRangeRespect`, `awarenessRadiusUnits` |
| "It charges in / never closes" | `standoffFraction` down, `opponentRangeRespect` down |
| "It lost me and drove around" | `memoryTicks`, `hearChance` — hunt is last-known / shots / quadrants, never the arena centre |
| "It wastes its ult" | `ultDisciplineChance` up, `ultWindowHpFraction` (the HP that counts as a dump window) |
| "It never punishes a stun" | Overlay should flip to `punish`; if it stays `fight`, `situationCommitTicks` is not the issue (punish preempts) |
| "It feels robotic" | `aimErrorDriftTicks`, `scoreNoiseSigma`, `idleFidgetChance`, `blunderChance` |
| "It never uses its second weapon" | personality `slotWeights`, `slotStickTicks` (too high = glued to one gun) |
| "All three tiers feel the same" | Read [`tiers.test.ts`](../packages/server/src/bot/brain/tiers.test.ts). If that passes, the complaint is a parameter *value*. |

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
trigger used to be an angle (`fireConeRad`); it is now expected damage per second of gun time
(`minShotValue`), so a shot that will not land is not taken at all. Fewer, deadlier shots is the
intended shape of this version, not a regression.

## Situations (highest priority wins)

| Id | When | Drive | Fire |
|---|---|---|---|
| `recover` | self dead or phased | coast | off |
| `waitOut` | nobody hittable | last-known / heard shot / quadrant | **off** |
| `evade` | incoming shot (rolled `dodgeChance`) or incoming car (`incomingCarChance`) | off the line | still fire if in cone |
| `unpin` | on a bound/corner with a target, `cornerRespect` | open floor, never map centre | fight rules |
| `punish` | stunned, low HP, or they just spent a 5s+ gun | close | dump, including ult |
| `reset` | own HP < `retreatHpFraction` (0 = Easy fights to zero) | open range, no reverse into a wall | fight rules |
| `fight` | a ready gun's **aim/player** reach covers them | that gun's band in open floor | `chooseSlot` |
| `close` | they're up but not in reach yet | intercept, throttle 1 | off |

HUD lock is never a veto. A big gun is `cooldownMs >= 5000` (not predator).

Own reach uses `aimRangeUnits` when the gun has aim assist (predator fights around 800, not 1800).
Opponent keep-out is their **shortest** gun × `opponentRangeRespect`.

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

`fireConeRad` and `leadFactor` are gone as of `BOT_BRAIN_VERSION` 4.0.0 — the angular fire gate and
its hand-authored lead were both replaced by the solver's own aim quadrature and its `value` (EV)
threshold, `minShotValue` (below).

### Steering (shared constants, not per-tier)

`BRAIN_CONSTANTS` in `bot-profiles.ts` — feeds `compensateForLag` in `bot/brain/movement.ts`.

| Field | Value | What it does |
|---|---|---|
| `deadzoneFloorFraction` | 0.5 | Floors the effective steering deadzone at half of whichever rotation the bot cannot correct within — one tick's, or one `recomputeTicks` decision window's, whichever is larger. Without it the bang-bang steer law (`steer` is only ever -1/0/1) limit-cycles around its own aim line forever, because it never anticipates its own reaction lag. |
| `deadzoneCapMultiplier` | 2.3 | Hard ceiling on that deadzone, as a multiple of `aimToleranceRad`. **A FITTED constant, not a derived one** — the doc comment on it in `bot-profiles.ts` shows nearby values (2.0, 2.3, 3.0) settling to qualitatively different, non-monotonic outcomes. Do not nudge it casually; re-measure if `turnRate`, `deadzoneFloorFraction`, or a tier's turn-rate profile changes. |

### Fire economy

| Field | easy | medium | hard |
|---|---|---|---|
| `burstGapTicks` | 14 | 7 | 3 |
| `minShotValue` | 0.5 | 7 | 25 |
| `ultDisciplineChance` | 0 | 0.5 | 0.9 |
| `ultWindowHpFraction` | 0.4 | 0.4 | 0.4 |

`minShotValue` is the expected damage per second of gun time a shot must be worth before this bot
takes it — it replaced `fireDisciplineChance`, which gated on distance rather than whether the shot
would land. These three values were **measured, not guessed**: see the long comment on
`BotProfile.minShotValue` in `bot-profiles.ts` for the closed-loop percentile sweep that picked them
and the cliff-edge behaviour that makes a naive percentile read misleading.

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

Playground prints `personality | situation | range N | slot K`. There is no scoreboard.

## Personality

Five archetypes still jitter hands and favorite guns inside the tier band (H47). They cannot skip
`waitOut` / `unpin` / `punish`. A kiter stands farther in open floor; they still leave a corner.

## One press per tick

`chooseSlot` returns one slot index. `beginFire` takes the lowest set bit of the mask, so ORing
every in-range slot would only ever fire slot 0.
