# Bot behaviour

Which knob to reach for when a bot feels wrong. Modelled on
[`docs/turn-tuning.md`](turn-tuning.md)'s job: the page you open when something feels bad, not a
second copy of the design's reasoning.

**Unlike `docs/turn-tuning.md`, nothing tests this page.** No script parses the table below and
recomputes it from `bot-profiles.ts`, so it can drift the moment a tier value moves and nothing will
fail `npm test` to say so. **Re-check the parameter table against
[`packages/server/src/config/bot-profiles.ts`](../packages/server/src/config/bot-profiles.ts)
yourself whenever a tier value changes**, and treat any number here with suspicion if the two ever
look like they disagree — the config file is the source of truth, this page is a transcription of it.

See [`docs/superpowers/specs/2026-09-04-human-like-bot-behavior-design.md`](superpowers/specs/2026-09-04-human-like-bot-behavior-design.md)
(decisions H1-H48) for why the brain is built the way it is, and
[`packages/server/balance/README.md`](../packages/server/balance/README.md) for measuring whether a
change actually moved anything.

## Reading a complaint

| Symptom | Knob(s) |
|---|---|
| "The bot never dodges" | `dodgeChance`, `dodgeReactionTicks`, `dodgeHorizonTicks` |
| "It fights at the wrong distance" | `standoffFraction`, `awarenessRadiusUnits`, and the `effectiveRangeOf` formula (below) |
| "It wastes its ult" | `ultDisciplineChance`, `ultWindowHpFraction` |
| "It feels robotic" | `aimErrorDriftTicks`, `scoreNoiseSigma`, `idleFidgetChance`, `blunderChance` |
| "It never uses its second weapon" | `slotWeights` (personality, see below), and H27's one-press-per-tick rule (below) |
| "All three tiers feel the same" | Not a knob — read
[`packages/server/src/bot/brain/tiers.test.ts`](../packages/server/src/bot/brain/tiers.test.ts) first. Those characterisation tests are the guard that the tiers still differ; if they pass and the tiers still feel the same, the complaint is about a parameter's *value*, not the mechanism. |

## The full parameter table

Copied by hand from `bot-profiles.ts` on 2026-09-04. Grouped the way the config file groups them —
perception, aim, fire economy, target politics, positioning/survival, threat reaction and
consistency — 34 fields per tier.

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

### Aim

| Field | easy | medium | hard |
|---|---|---|---|
| `aimErrorSigmaRad` | 0.18 | 0.09 | 0.035 |
| `aimErrorDriftTicks` | 20 | 14 | 9 |
| `aimToleranceRad` | 0.3 | 0.16 | 0.07 |
| `fireConeRad` | 0.55 | 0.35 | 0.2 |
| `leadFactor` | 0 | 0.55 | 0.95 |

### Fire economy

| Field | easy | medium | hard |
|---|---|---|---|
| `burstGapTicks` | 14 | 7 | 3 |
| `fireDisciplineChance` | 0.05 | 0.45 | 0.85 |
| `ultDisciplineChance` | 0 | 0.5 | 0.9 |
| `ultWindowHpFraction` | 0.4 | 0.4 | 0.4 |

### Target politics

| Field | easy | medium | hard |
|---|---|---|---|
| `targetCommitTicks` | 150 | 60 | 25 |
| `woundedBias` | 0.1 | 0.5 | 0.9 |
| `vengefulness` | 0.8 | 0.5 | 0.25 |

`vengefulness` is the one field that runs backwards up the ladder — a casual chases whoever hurt
them, a pro is not distracted. That is deliberate, not a typo.

### Positioning and survival

| Field | easy | medium | hard |
|---|---|---|---|
| `standoffFraction` | 0.45 | 0.7 | 0.85 |
| `deadbandFraction` | 0.25 | 0.15 | 0.08 |
| `orbitBias` | 0 | 0.35 | 0.75 |
| `wallLookaheadUnits` | 40 | 90 | 150 |
| `retreatHpFraction` | 0 | 0.3 | 0.45 |
| `ramIntentChance` | 0.15 | 0.3 | 0.5 |

`retreatHpFraction` 0 on easy means exactly what it looks like: an easy bot fights to zero hp. There
is no floor under that number to raise if a designer wants easy to flee sooner — 0 is a deliberate
tell, not a placeholder.

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
| `stanceCommitTicks` | 45 | 30 | 18 |

### Constants shared by every tier

Not per-tier, so not in `BotProfile` at all — deliberately, per `bot-profiles.ts`'s own comment. Live
in `BRAIN_CONSTANTS`:

| Field | Value | Meaning |
|---|---|---|
| `minEngageUnits` | 70 | Closest range the bot will ever choose to hold |
| `contactTriggerUnits` | 150 | Range at which a `range: 0` weapon (`wildcharge`) is worth pressing |
| `ultCooldownMs` | 5000 | `cooldownMs` at or above which a weapon counts as an ult for discipline purposes |
| `personalityJitter` | 0.25 | How far a personality may move a parameter from its tier value, as a fraction |

## The five layers

One `decide()` call, five layers, in order (`HumanController` in
[`brain/controller.ts`](../packages/server/src/bot/brain/controller.ts)):

1. **Perceive** (`perception.ts`) — turns a fair view into a human one: acquisition delay, an
   awareness radius, a rear blind arc, a cap on tracked threats, memory decay. Runs every tick.
2. **Assess** (`stance.ts`) — picks a target by weighted score, then scores and holds a stance.
   Runs on `recomputeTicks`.
3. **Move** (`movement.ts`) — blends steering desires (hold range, orbit, dodge, avoid a wall) into
   one heading, then reduces it to `steer`/`throttle`. Runs on `recomputeTicks`.
4. **Shoot** (`firing.ts`) — ranks the ready slots and presses the single best one. Runs on
   `recomputeTicks`.
5. **Humanize** (`humanize.ts`) — reaction delay line, blunders, idle fidget. Runs every tick.

Perception and humanization run every tick on purpose: a memory that only updates on the recompute
cadence is not a memory, and a delay line that only shifts on that cadence delays by a multiple of
the cadence instead of by its own value.

## The seven stances

Named, scored, held for `stanceCommitTicks` unless a pre-emption fires (hp crossing
`retreatHpFraction`, the target dying/leaving, or the bot losing control). Live in
[`brain/stance.ts`](../packages/server/src/bot/brain/stance.ts).

| Stance | Chosen when | Publishes |
|---|---|---|
| `engage` | a target is known and the bot is healthy | hold `preferredRange`, orbit by `orbitBias` |
| `brawl` | a range-0 weapon is ready, or the bot intends a ram | close to `contactTriggerUnits` |
| `kite` | target is closer than 60% of preferred range | hold range, back off, keep facing |
| `disengage` | hp below `retreatHpFraction` | break contact, keep the target in arc where possible |
| `reposition` | pinned against a wall or corner | move to open floor, hold fire |
| `hunt` | no target is currently known | sweep toward last-known or arena centre |
| `recover` | dead or phased — no control worth spending | coast |

**Three of those cells differ from an earlier draft of the design spec, which this page originally
copied verbatim — verify against `stance.ts`/`controller.ts` directly if you ever doubt this table
again, not the spec.** `recover`'s gate (`controlLost`, defined identically in both `scoreStances`
and the pre-emption check) is `!self.alive || hasStatus(self.statuses, "phased", tick)` — the bot's
own `stunned` status is never read anywhere in `bot/brain/`; `stunned` is checked only against the
*target*, in `firing.ts`, for ult discipline. `reposition`'s score is driven solely by
`pinnedOnWall`; there is no line-of-sight check anywhere in the stance layer. `kite`'s score is a
pure distance threshold (`distance < preferredRange * 0.6`); there is no HP or trade comparison in
it anywhere. None of the three is a defect to fix here — if a bot should someday recover from being
stunned, back off from a shot with no line, or kite a losing trade rather than a close one, that is a
design decision for a later pass, not something this table gets to assert into existence.

**Dodging is not one of the seven, and never will be.** It is a steering *desire* in the movement
layer, blended alongside holding range and orbiting — never a stance that replaces `engage`. That is
what lets a bot dodge without stopping fighting; a design where dodging is a state that pre-empts
`engage` produces a bot that stops fighting to dodge and stops dodging to fight, and both read as
robotic on screen.

## Two mechanisms worth knowing before you touch anything

**The bot presses exactly one slot per tick.** `beginFire` (the sim's own fire-resolution code)
takes at most one press per tick and resolves it to the *lowest set bit* the car can use. The bot
that shipped before this brain ORed every in-range slot into one mask — which meant it fired slot 0
almost exclusively and only ever reached slots 1/2 in the gaps where slot 0 was out of stock or
locked. That was a real, shipped defect, not a design choice worth reproducing: it made every
chassis one-note and skewed every balance report's per-weapon columns toward slot 0. `firing.ts`'s
`chooseSlot` instead *ranks* the ready slots — by weapon value, personality preference weight, and
fit to the current distance — and returns the single best one. If a future change ever goes back to
OR-ing a mask together instead of returning one slot, this defect is exactly what comes back.

**A probability roll that gates a repeated opportunity is rolled ONCE per opportunity, not once per
tick.** Three examples, all in `controller.ts`/`firing.ts`:

- The **dodge roll** — `dodgeChance` — is rolled once per newly-noticed threat, in `perception.ts`.
- The **ram roll** — `ramIntentChance` — is rolled once per target, in `controller.ts`'s `plan()`.
- The **ult-discipline roll** — `ultDisciplineChance` — is rolled once per (target, ready) episode
  in `firing.ts`'s `chooseSlot`, and the held decision is memoized until the episode ends (the slot
  fires, goes not-ready, or the target changes).

A per-tick re-roll of any of these decays geometrically: at `recomputeTicks` 2 and a 90% discipline
chance, "hold this ult" surviving 140 independent evaluations across a 30-second fight is
0.9^140 ≈ 0 — which turns "saves its ult for a good moment" into "delays its ult by a few ticks and
fires anyway." This was found and fixed once already during implementation (Task 9's ult-discipline
bug), and it is the single easiest mistake to reintroduce if a future change touches any of these
three rolls.

## A tier is data; a behaviour is code

No module under `bot/` branches on `profileId` or the difficulty name — `grep -rn "profileId ==="
packages/server/src/bot/brain/` should return nothing, always. Only the parameter table
(`BOT_PROFILES`) and the humanize layer's *use* of those parameters know which tier is running; every
other layer reads numbers out of whichever `BotProfile` it was handed and has no idea whether that
profile is `easy`, `medium`, or `hard`. That is the whole mechanism that stops the three tiers
collapsing back into "the same bot at different speeds" as the brain grows — a rule worth preserving
in any future edit here, not just observing.

`BOT_BRAIN_VERSION` (currently `"1.0.0"`, in `bot-profiles.ts`) exists for the case a hash of
`BOT_PROFILES` cannot see: a behaviour change made entirely in code, with every tier's numbers left
untouched. It rides inside `botFingerprint` (`packages/server/balance/fingerprint.ts`) precisely so
that case still invalidates an old balance report instead of silently comparing two different pilots.
Bump it whenever the brain's behaviour changes without a number in the table moving.

## Personality: five archetypes, rolled within a tier's band

A tier sets the competence band; personality (`personality.ts`) shifts a handful of parameters
*within* that band, rolled once per bot on its first `decide()` call. Every shift is clamped so it
can never leave the tier's `± personalityJitter` (0.25) window, and never pass the value the next
*easier* tier holds for that same field — a hard `sprayer` is still recognisably a good player.

| Archetype | Shifts |
|---|---|
| `brawler` | standoff down, ram up, retreat down, orbit down |
| `kiter` | standoff up, orbit up, retreat up, ram down |
| `sprayer` | discipline down, burst gap down, ult discipline down |
| `grudge` | vengefulness up, target commit up, wounded bias down |
| `opportunist` | wounded bias up, ult discipline up, standoff unchanged |

Per-slot preference weights (`slotWeights`) are rolled the same pass, are not clamped, and feed both
`chooseSlot`'s ranking and `preferredRangeOf`'s range model — a bot that prefers its shotgun also
wants to fight closer.

## `effectiveRangeOf` / `preferredRangeOf`: how a preferred distance is derived

Nobody authors a standoff distance in units. It comes out of the bot's own kit
(`firing.ts`):

```
effectiveRange   = Σ(range_i × value_i) / Σ(value_i)     over ready slots with range > 0
value_i          = (damage_i / cooldownSeconds_i) × slotWeight_i
preferredRange   = clamp(standoffFraction × effectiveRange, minEngageUnits, awarenessRadiusUnits)
```

`value_i` is a shaping heuristic for standoff and slot ranking only — it reads the raw `damage`
field, so a beam's per-pulse number and a shotgun's per-pellet number both under-rate what the
weapon actually deals per press. That is accepted; `sim/damage.ts` remains the only authority on
real damage, and nothing in the bot brain may be mistaken for it. Range-0 rows (`wildcharge`) are
excluded from this average — they would drag it to zero — but a ready one still pulls the bot toward
contact through the `brawl` stance (H36).

## How to read the playground overlay

Open `http://localhost:5173/?dev=playground`, switch the opponent to **Bot**, and pick a tier from
the difficulty select beside it — the swap takes effect live, mid-match.

The playground now shows a live "what is it thinking" read-out in the corner of the screen —
`HumanController.debug()` (`BotDebug`: current stance, every stance's score, the chosen target,
`preferredRange`, the rolled personality, and the last-pressed slot — see
`packages/server/src/bot/types.ts`), broadcast from `PlaygroundRoom` to the client overlay at 5 Hz
(every 6 ticks — fast enough to feel live, slow enough to actually read) as
`MSG_PLAYGROUND_BOT_DEBUG`, and rendered by `mountPlaygroundOverlay` in
`packages/client/src/dev/playground/overlay.ts`. It is deliberately **not** part of the pause menu:
the pause menu only shows while the sim is paused, and pausing is exactly what stops the bot
deciding and the room broadcasting, so a "live" read-out gated behind pause would never update. It
sits in a small fixed box, always on screen, independent of the pause overlay.

The line reads `<personality> | <stance> | range <preferredRange> | slot <n>` — for example
`kiter | kite | range 312 | slot 2`. What each field tells you:

- **personality** — one of `brawler`, `kiter`, `sprayer`, `grudge`, `opportunist`, rolled once per
  bot instance (a fresh roll happens whenever the bot is reconstructed — a difficulty change, a
  setup change, or `Switch car`). If it stays fixed across a whole session where you expected
  variety, you are probably re-reading the same `HumanController` instance rather than a new one.
- **stance** — one of `engage`, `brawl`, `kite`, `disengage`, `reposition`, `hunt`, `recover`. This
  is the field to watch first when a bot "does something odd" — the label alone usually tells you
  whether the brain thinks it is fighting (`engage`/`brawl`/`kite`), regrouping
  (`disengage`/`reposition`), searching (`hunt`), or stripped of control (`recover`, e.g. mid-respawn
  phase). A stance stuck on one value for far longer than `stanceCommitTicks` while the fight clearly
  changed shape is a sign to go look at `scoreStances` rather than at movement code.
- **range** — `preferredRange`, in world units, rounded. It should settle near the kit's own
  effective-range band (see the formula above) once a target is acquired, and reads **0** whenever
  there is no target — that is the intentional reset in `controller.ts`'s `plan()`, not a bug. A
  range wildly outside the kit's band with a live target is the field to check against
  `preferredRangeOf` and the personality's range bias.
- **slot** — the weapon slot the bot pressed on the tick this read-out was generated, 1-indexed to
  match the HUD's own slot numbering, or `-` when it held fire that tick. A slot that never varies
  while multiple weapons are ready points at `chooseSlot`'s weighting or `ultHold` discipline rather
  than at a wiring bug; a slot that fires every single recompute even at long range on a short-range
  kit points the other way.

Since the read-out only updates while the sim is actually running, remember to **resume** (P) after
opening it from the pause menu — otherwise the numbers are frozen at whatever the bot was doing when
you paused.

Beyond eyeballing the corner of the screen:

- Run `packages/server/src/bot/brain/tiers.test.ts` — the characterisation suite that pins the
  behavioural differences between tiers directly (dodges vs. doesn't, fires the ult vs. doesn't,
  disengages vs. doesn't, and so on). This is the fastest way to confirm a mechanism still works at
  all.
- Run `npm run balance` for aggregate behaviour across many matches — win rates, weapon usage,
  hit rates — see [`packages/server/balance/README.md`](../packages/server/balance/README.md).
- Play a tier in practice mode and watch it. This is still the acceptance test the design spec
  names: every number in the parameter table above is a first pass, and the only way to know if a
  tier reads as *a kind of player* rather than *a difficulty slider* is to fight it. Practice mode
  itself carries no debug read-out — `PracticeRoom` ships to players, and the overlay above is
  strictly a `PlaygroundRoom`/dev-tools thing.
