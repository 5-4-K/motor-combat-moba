# Bot behaviour

One brain, three rows of numbers: easy, medium and hard are rows of `BOT_PROFILES` in
[`packages/server/src/config/bot-profiles.ts`](../packages/server/src/config/bot-profiles.ts); no
module branches on the tier name, and the practice bot and the balance pilot are the same bot.
Design: [`2026-10-09-bot-brain-v7-design.md`](superpowers/specs/2026-10-09-bot-brain-v7-design.md)
(BB1–BB70). **`BOT_BRAIN_VERSION` is `7.0.0`.** Feel complaints go through
[`bot-tuner`](../.claude/skills/bot-tuner/SKILL.md). **Unlike `docs/turn-tuning.md`, nothing tests
this page:** its tables copy `BOT_PROFILES` and `BRAIN_CONSTANTS`; re-copy a cell when code moves.

## Pipeline

`bot/brain/controller.ts` runs perceive → predict → solve → assess → navigate → shoot → humanize.

- **Every tick:** `perceive` (what the bot has noticed: cars past `acquireMs`, tracked threats,
  observed fires, memory), `stepAimError` (the hand wobble, resampled every `aimErrorDriftMs`), and the
  `humanize` delay line, which emits the intent decided `reactionDelayMs` ago.
- **Every recompute** (`recomputeMs`: 400 / 200 / 67 ms): target choice (`target.ts`), the target
  predictor (`predict.ts`), one exact `solve()` per ready slot, the situation (`situation.ts`), the
  goal and the steering law (`navigate.ts`), the press (`shooter.ts`).

The only random draws are the aim error (two per tick) and the predictor (four per recompute), in
fixed order, so a seed replays exactly. No coin flips, blunders or personalities.

## Situations

Lowest number wins. A higher row cuts in at once; the same or a lower one waits out `situationCommitMs`;
`recover` and `waitOut` end the moment their facts stop holding. `evade` and `unpin` outrank
`waitOut`, so a hunting bot still dodges and un-pins.

| # | Situation | When | Fires? |
|---|---|---|---|
| 0 | `recover` | self dead, or carrying `phased`, `stunned`, `reeling` or `ramLock` | no (coasts) |
| 1 | `evade` | a reacted-to shot in flight, or the target bearing down inside `dodgeHorizonMs` | yes |
| 2 | `unpin` | `wallPush` reports a wall, spike or corner within `wallLookaheadUnits` | yes |
| 3 | `waitOut` | no hittable target noticed (hittable: alive, not phased, on the other team) | no |
| 4 | `punish` | target `stunned` or `reeling`, or target HP ≤ `punishHpFraction` | yes |
| 5 | `reset` | own HP < `retreatHpFraction` (0 at easy: never) | yes |
| 6 | `ram` | target within `ramRangeUnits` and the kit is dry (no slot ready within `ramDryWindowMs`) | yes |
| 7 | `fight` | a slot that is ready now reaches the target | yes |
| 8 | `close` | target hittable but out of reach | no |

## Goals

Each situation hands the navigator one `Goal`: a point, a range to hold from it (0 = arrive), a
facing, and whether it may reverse. `believed(t)` is the raw target prediction `t` ticks ahead;
`lag` is `reactionDelayMs` in ticks.

| Situation | Point | Range | Facing | Reverse |
|---|---|---|---|---|
| `recover` | none: coast | | | |
| `waitOut` | self + hunt heading × `awarenessRadiusUnits` | 0 | nose | no |
| `evade` | self + dodge direction × `dodgeDistanceUnits` | 0 | free | yes |
| `unpin` | self + last wall push × `unpinDistanceUnits` | 0 | free | yes |
| `punish` | `believed(lag)` | `max(minEngageUnits, ownComfort × punishRangeFraction)` | nose | yes |
| `reset` | `believed(lag)` | `max(fightRange × resetRangeMultiplier, minEngageUnits)` | nose | yes |
| `ram` | target predicted at `min(distance / own top speed, horizon)` | 0 | nose | no, forward only |
| `fight` | `believed(lag)` | `fightRange` | nose if the shooter wants it, else orbit | yes |
| `close` | `believed(lag)` | 0.9 × longest raw reach among slots ready within `soonReadyMs` (else the kit's) | nose | no |

Hunt heading: last-known pose, nearest heard shot, then four quadrant waypoints. Dodge direction:
the summed away headings of reacted-to threats and an incoming car; a held `evade` keeps its last.

## How it drives

A closed-form steering law turns the goal into `steer` and `throttle`, each `-1`, `0` or `+1`.
Nothing rolls the drive model forward; there is no planner.

- **Nose.** Point at the goal, with the aim error added to the bearing so shaky hands wander the
  nose. Drive in when more than `rangeBandUnits` too far, reverse nose-on when more than a band too
  close, lift off inside the band. Too close with reverse not allowed: hold.
- **Orbit** (`fight`, unless the shooter wants the nose) is a **weave**, not a circle. Too far:
  drive straight in. Inside the band: drive forward with the target held `orbitOffsetRad` (0.45) off
  the nose, inside the turret's ±30° half-arc. A band too close: back out nose-on until a band too
  far, then drive in again. A true circle would put the target 90° off the nose, out of every arc.
- **Free** (`evade`, `unpin`). Arrive at the point by whichever of forward or reverse is quicker;
  reversing steers from the tail so the car backs along the line.
- **The latch.** The wheel turns on past `steerDeadbandRad` (0.06), lets go under half of it, and in
  between holds only while the error keeps its sign. It stops wheel chatter.
- **The reactive wall layer.** Outside `recover` and `unpin`, a forward-driving car facing a wall
  push steers toward the push's side, reversing if the wall is nearly dead ahead. `wallPush` sums
  unit vectors away from walls and obstacles at the look-ahead point, damaging spike faces at 1×
  and 2× it, and a corner (two planes within `minEngageUnits`); any hit counts as pinned.

## How it shoots

A slot is **pressable** when it is ready (a stock in hand, past its refire lock), not the disabled
basic attack, its solved `hitChance ≥ hitChanceBar`, and its `expectedDamage > 0`. At most one
press per decision, never inside `burstGapMs` of the last press or the bot's own switch lock:

1. target `stunned` → the pressable slot with the highest expected damage;
2. else the kit's setup slot (the one that applies `stunned` to opponents) if it is pressable;
3. else the pressable slot with the highest expected damage.

Cooldown never enters the ranking and there is no ult holding: a 16 s weapon that will land fires
like any other. A turret press aims at the solution's `turretBearingRad` plus the realised aim
offset. A ready fixed-muzzle slot in reach but not pressable makes `fight` face `nose`, not orbit.

## Ranges

- **Effective reach** (`effectiveReachOf`): the farthest of 13 evenly spaced distances from
  `minEngageUnits` to the weapon's reach at which `solve()` against a stationary target dead ahead
  clears the tier's bar at its aim sigma; memoised on the active bundle. Hard: `predator` 646.67,
  `lance` 1200, `magmablast` 900, `thumper` 893.33.
- **Comfort** = `comfortFraction` (0.85) × the smallest effective reach among slots ready within
  `soonReadyMs`, else × the kit's largest (stand off while reloading); floored at `minEngageUnits`.
- **Keep-out** = the opponent's shortest known gun (chassis kit plus weapons seen fired) ×
  `opponentRangeRespect`. `fightRange = max(comfort, keep-out)`.

## Profile table

Authored in ms, resolved to ticks at 60 Hz. `hitChanceBar` is quantised by the solver's quadrature
nodes (0.457 centre, 0.240 at ±1.15σ, 0.031 at ±2.37σ): easy's 0.3 fires when its exact aim lands,
medium's 0.5 also needs one 1.15σ error to land, hard's 0.7 needs both.

| Field | easy | medium | hard |
|---|---|---|---|
| `viewStalenessMs` | 133 | 100 | 67 |
| `reactionDelayMs` | 300 | 200 | 133 |
| `recomputeMs` | 400 | 200 | 67 |
| `acquireMs` | 500 | 300 | 167 |
| `awarenessRadiusUnits` | 600 | 700 | 900 |
| `rearBlindHalfAngleRad` | 1.05 | 0.6 | 0 |
| `trackedThreatLimit` | 1 | 2 | 4 |
| `memoryMs` | 500 | 1500 | 3000 |
| `stateEstimationSigma` | 0.25 | 0.1 | 0.03 |
| `aimErrorSigmaRad` | 0.18 | 0.09 | 0.035 |
| `aimErrorDriftMs` | 667 | 467 | 300 |
| `burstGapMs` | 467 | 233 | 100 |
| `hitChanceBar` | 0.3 | 0.5 | 0.7 |
| `targetCommitMs` | 5000 | 2000 | 833 |
| `woundedBias` | 0.1 | 0.5 | 0.9 |
| `vengefulness` | 0.8 | 0.5 | 0.25 |
| `wallLookaheadUnits` | 40 | 90 | 150 |
| `retreatHpFraction` | 0 | 0.3 | 0.35 |
| `punishHpFraction` | 0.4 | 0.4 | 0.4 |
| `opponentRangeRespect` | 0 | 0.45 | 0.9 |
| `dodgeReactionMs` | 400 | 267 | 67 |
| `dodgeHorizonMs` | 400 | 600 | 800 |
| `situationCommitMs` | 667 | 400 | 200 |

## Constants (`BRAIN_CONSTANTS`, shared by every tier)

| Constant | Value | Reader |
|---|---|---|
| `minEngageUnits` | 70 | range floors, corner margin, hunt waypoint arrival |
| `contactTriggerUnits` | 150 | reach of a `range: 0` weapon, `isIncomingCar` |
| `predictionHorizonMs` | 3000 | solver and ram predictor |
| `fullLockAngVelFraction` | 0.5 | `predict.ts` |
| `interceptFixedPointRounds` | 3 | `predict.ts` |
| `spikeLookaheadFactor` | 2 | `wallPush` |
| `comfortFraction` | 0.85 | comfort range |
| `punishRangeFraction` | 0.5 | `punish` goal |
| `resetRangeMultiplier` | 1.15 | `reset` goal |
| `rangeBandUnits` | 40 | the band either side of a goal range |
| `steerDeadbandRad` | 0.06 | the latch |
| `orbitOffsetRad` | 0.45 | orbit weave |
| `dodgeDistanceUnits` | 120 | `evade` goal |
| `unpinDistanceUnits` | 180 | `unpin` goal |
| `soonReadyMs` | 1000 | comfort and `close` ranges |
| `ramDryWindowMs` | 1500 | the dry-kit test |
| `ramRangeUnits` | 400 | `ram` entry |
| `effectiveReachSamples` | 12 | effective-reach sweep |

## Overlay

`?dev=playground` prints one line for the debugged bot, sampled at 5 Hz:

```
situation | range N facing | slot K | hit BEST/BAR | drive(+1,0)
```

The committed situation; the goal's range and facing (`none` in `recover`); the pressed fire slot's
index + 1 (`slot -` = held fire); the best solved hit chance among ready slots against the tier's
`hitChanceBar`; the signed `steer` and `throttle`. **`hit` is the holds-fire diagnostic:** under
the bar with `slot -` is the bar working; at or over it, the burst gap, the switch lock, a
non-firing situation, or a bug. Read the line before naming a knob.

## Reading a complaint

| Complaint | Look at | Knob |
|---|---|---|
| "holds fire" | `hit BEST/BAR` on the overlay | `hitChanceBar` down on that tier |
| "misses a turning car" | it leads a straight driver fine | `stateEstimationSigma` |
| "sprays" | misses a straight driver too | `aimErrorSigmaRad` |
| "never dodges" | `evade` never appears | `dodgeReactionMs` down (or `dodgeHorizonMs` up) |
| "walks into fire" | `range N` sits inside your gun | `opponentRangeRespect` up |
| "sits in a corner" | `unpin` never appears | `wallLookaheadUnits` up |
| "never rams" | by design: `ram` only when the kit is dry | not a knob |
| "feels robotic" | instant, steady reactions | `reactionDelayMs` up; `aimErrorDriftMs` (how fast the wobble wanders) |

## Known limitations

1. **Orbit needs open floor.** Near a wall the reactive layer turns the weave and flips its side.
2. **A beam is never dodged.** No travel speed means an ETA of 0; attached beams are tracked (they
   take a threat slot) but never reacted to.
3. **ETA is measured at notice**, once. A shot is dodged when it lies in `(dodgeReactionTicks,
   dodgeHorizonTicks + ~3.5]` ticks: easy (24, 27.5], medium (16, 39.5], hard (4, 51.5]. Easy
   practically never dodges (accepted; 6.x's 0.05 `dodgeChance` was the same in effect).
