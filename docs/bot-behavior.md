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
(decisions H1–H48) for fairness, determinism, and personalities, and
[`docs/superpowers/specs/2026-09-04-bot-tactical-intelligence-design.md`](superpowers/specs/2026-09-04-bot-tactical-intelligence-design.md)
(G1–G28) for the goal layer that replaced H9–H15. See
[`packages/server/balance/README.md`](../packages/server/balance/README.md) for measuring whether a
change actually moved anything.

## Reading a complaint

| Symptom | Knob(s) |
|---|---|
| "The bot never dodges" | `dodgeChance`, `dodgeReactionTicks`, `dodgeHorizonTicks`, `dodgeWeight` |
| "It weaves instead of fighting" | `dodgeWeight` (must stay below 1), and whether the held goal is `holdRange` (the only one that orbits) |
| "It fights at the wrong distance" | `standoffFraction`, `awarenessRadiusUnits`, and the `effectiveRangeOf` formula (below) |
| "It charges in / never closes" | `rushWeight`, `dumpWeight`, `contact` readiness |
| "It lost me and drove around" | hunt cues: last-known memory (`memoryTicks`), `hearChance`, quadrant search — hunt never seeks the arena centre |
| "It wastes its ult" | `ultDisciplineChance`, `ultWindowHpFraction` |
| "It never sets up a stun" | `setupWeight`, and whether the kit actually applies `stunned` (`rolesOf`) |
| "It feels robotic" | `aimErrorDriftTicks`, `scoreNoiseSigma`, `idleFidgetChance`, `blunderChance` |
| "It never uses its second weapon" | `slotWeights` (personality, see below), and H27's one-press-per-tick rule (below) |
| "All three tiers feel the same" | Not a knob — read
[`packages/server/src/bot/brain/tiers.test.ts`](../packages/server/src/bot/brain/tiers.test.ts) first. Those characterisation tests are the guard that the tiers still differ; if they pass and the tiers still feel the same, the complaint is about a parameter's *value*, not the mechanism. |

## The full parameter table

Copied by hand from `bot-profiles.ts` on 2026-09-04. Grouped the way the config file groups them —
perception, aim, fire economy, target politics, positioning/survival, threat reaction and
consistency — 41 fields per tier.

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
| `goalCommitTicks` | 45 | 30 | 18 |
| `rushWeight` | 8 | 2 | 0.4 |
| `interceptWeight` | 0 | 2 | 5 |
| `setupWeight` | 0 | 4 | 7 |
| `dumpWeight` | 1 | 5 | 9 |
| `pinWeight` | 0 | 1 | 6 |
| `hearChance` | 0.15 | 0.55 | 1 |
| `dodgeWeight` | 0.4 | 0.6 | 0.8 |

`dodgeWeight` is always below 1, so a dodge deflects the held goal's heading instead of replacing it.
`hearChance` is a probability (Easy often ignores a shot it has not identified; Hard always uses it).
`orbitBias` only applies while the held goal is `holdRange`.

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
   awareness radius, a rear blind arc, a cap on tracked threats, memory decay. Runs every tick. It
   also records which enemy was seen spending which weapon (`ultSeenTick` / `ultIsSpent`, H22) —
   consumed by `scoreGoals` as a `dump` bonus (G22). Last-known pose, heard shots, and quadrant
   search waypoints live here too; hunt never drives to the arena centre.
2. **Assess** (`goals.ts`) — picks a target by weighted score, derives kit roles from `WeaponDef`
   (`roles.ts`), then scores and holds a goal. Runs on `recomputeTicks`.
3. **Move** (`movement.ts`) — serves the held goal's heading (weight 1), with wall and dodge
   overlays; orbit only on `holdRange`. Reduces to `steer`/`throttle`. Runs on `recomputeTicks`.
4. **Shoot** (`firing.ts`) — ranks the ready slots for the held goal and presses the single best
   one. Runs on `recomputeTicks`.
5. **Humanize** (`humanize.ts`) — reaction delay line, blunders, idle fidget (fidget only on
   `recover`). Runs every tick.

Perception and humanization run every tick on purpose: a memory that only updates on the recompute
cadence is not a memory, and a delay line that only shifts on that cadence delays by a multiple of
the cadence instead of by its own value.

## The goals

Named, scored, held for `goalCommitTicks` unless a pre-emption fires (hp crossing
`retreatHpFraction`, the target dying/leaving, or the bot losing control). Live in
[`brain/goals.ts`](../packages/server/src/bot/brain/goals.ts). This catalog superseded the seven
named stances (`engage` / `brawl` / `kite` / `disengage` / `reposition` / `hunt` / `recover`) on
2026-09-04; see
[`docs/superpowers/specs/2026-09-04-bot-tactical-intelligence-design.md`](superpowers/specs/2026-09-04-bot-tactical-intelligence-design.md)
(G1–G28).

| Goal | Chosen when | Movement | Fire |
|---|---|---|---|
| `recover` | dead or `phased` | coast | nothing |
| `huntLastKnown` | no living unphased target | last-known + velocity; else heard shot; else quadrant search. **Never the arena centre.** | hold |
| `rush` | a target exists (easy’s default) | bearing to target, close | mash `chooseSlot` |
| `holdRange` | skirmish, no better tactic | kit-derived range; orbit is a lateral offset on this goal only | `chooseSlot` |
| `intercept` | cut them off | drive to where they will be (lead for the body) | `chooseSlot` |
| `setupCc` | stun-applying slot ready, target not stunned | geometry that weapon wants | that CC slot |
| `dump` | target stunned, or low HP with an ult ready, or their ult just seen spent | close to dump range | damage / ult, skip another setup |
| `contact` | maneuver slot ready, or ram committed | close to `contactTriggerUnits` | the maneuver |
| `reset` | HP below `retreatHpFraction`, or far inside preferred range | back off, keep them in arc | still shoot |
| `pinWall` | target near a bound and we have contact/dump | put them between us and the wall | contact / dump |
| `unpin` | we are the one on the wall | heading to open floor, **still shooting** | `chooseSlot` |

Combo is emergent: `setupCc` fires → stun lands → `dump` wins the next score. There is no playbook
file and no `carId` branch under `brain/`. Kit roles are derived from live `WeaponDef` rows in
[`brain/roles.ts`](../packages/server/src/bot/brain/roles.ts).

`recover`'s gate (`controlLost`, defined identically in both `scoreGoals` and the pre-emption check)
is `!self.alive || hasStatus(self.statuses, "phased", tick)` — the bot's own `stunned` status is
never read anywhere in `bot/brain/`; `stunned` is checked only against the *target*, in `firing.ts`
and `goals.ts`. `unpin`'s score is driven solely by `pinnedOnWall`; there is no line-of-sight check
anywhere in the goal layer.

**Dodging is not a goal, and never will be.** It is a steering *desire* in the movement layer, a
deflection (`dodgeWeight` < 1) on top of the held goal — never a state that replaces fighting. That
is what lets a bot dodge without stopping fighting; a design where dodging is a state that pre-empts
the goal produces a bot that stops fighting to dodge and stops dodging to fight, and both read as
robotic on screen.

Idle fidget fires **only on `recover`**. Hunt is a job, not an idle.

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
tick.** Four examples:

- The **dodge roll** — `dodgeChance` — is rolled once per newly-noticed threat, in `perception.ts`.
- The **ram roll** — `ramIntentChance` — is rolled once per engagement with a target, in
  `controller.ts`'s `plan()`. Losing the target ENDS that engagement and re-arms the roll, so the
  same opponent reacquired after a death or a `phased` respawn earns a fresh one — without that, a
  1v1 (practice, or the harness's duel shape) keeps one session id from the first tick to the last
  and deliberate ramming switched itself off permanently at the first death.
- The **ult-discipline roll** — `ultDisciplineChance` — is rolled once per (target, ready) episode
  in `firing.ts`'s `chooseSlot`, and the held decision is memoized until the episode ends (the slot
  fires, goes not-ready, or the target changes).
- The **blunder roll** — `blunderChance` — is rolled once per decision window (the tier's
  `recomputeTicks`), in `humanize.ts`. The humanize layer itself runs every tick, and its three
  draws happen every tick regardless; only what the first draw is allowed to DO is gated. Rolled
  per tick instead, the chance compounds by the cadence: easy spent 57.9% of its ticks inside a
  blunder against the ~9% the number describes.

A per-tick re-roll of any of these decays geometrically: at `recomputeTicks` 2 and a 90% discipline
chance, "hold this ult" surviving 140 independent evaluations across a 30-second fight is
0.9^140 ≈ 0 — which turns "saves its ult for a good moment" into "delays its ult by a few ticks and
fires anyway." This was found and fixed once already during implementation (Task 9's ult-discipline
bug), and it is the single easiest mistake to reintroduce if a future change touches any of these
four rolls.

## A tier is data; a behaviour is code

No module under `bot/` branches on `profileId` or the difficulty name — `grep -rn "profileId ==="
packages/server/src/bot/brain/` should return nothing, always. Only the parameter table
(`BOT_PROFILES`) and `personality.ts` — which reads `BOT_PROFILES[tier]` to work out the band a
personality may shift a parameter inside, and the easier neighbour it may never reach past — know
which tier is running. Every layer downstream of that, `humanize.ts` included, reads numbers out of
whichever `BotProfile` it was handed and has no idea whether that profile is `easy`, `medium`, or
`hard`. That is the whole mechanism that stops the three tiers
collapsing back into "the same bot at different speeds" as the brain grows — a rule worth preserving
in any future edit here, not just observing.

`BOT_BRAIN_VERSION` (currently `"2.0.0"`, in `bot-profiles.ts`) exists for the case a hash of
`BOT_PROFILES` cannot see: a behaviour change made entirely in code, with every tier's numbers left
untouched. It rides inside `botFingerprint` (`packages/server/balance/fingerprint.ts`) precisely so
that case still invalidates an old balance report instead of silently comparing two different pilots.
Bump it whenever the brain's behaviour changes without a number in the table moving. The 1.1.0 →
2.0.0 bump is the goal rewrite: stances became tasks, hunt is last-known rather than arena centre,
dodge is a deflection, and `ultIsSpent` is consumed. A balance report printed before it is not
comparable to one printed after.

## Personality: five archetypes, rolled within a tier's band

A tier sets the competence band; personality (`personality.ts`) shifts a handful of parameters
*within* that band, rolled once per bot on its first `decide()` call. Every shift is clamped so it
can never leave the tier's `± personalityJitter` (0.25) window, and never pass the value the next
*easier* tier holds for that same field — a hard `sprayer` is still recognisably a good player.

| Archetype | Shifts |
|---|---|
| `brawler` | standoff down, ram up, retreat down, orbit down, rush up, setup down |
| `kiter` | standoff up, orbit up, retreat up, ram down, rush down, intercept up |
| `sprayer` | discipline down, burst gap down, ult discipline down |
| `grudge` | vengefulness up, target commit up, wounded bias down |
| `opportunist` | wounded bias up, ult discipline up, standoff unchanged, dump up |

Per-slot preference weights (`slotWeights`) are rolled the same pass, are not clamped, and feed both
`chooseSlot`'s ranking and `preferredRangeOf`'s range model — a bot that prefers its shotgun also
wants to fight closer.

## `effectiveRangeOf` / `preferredRangeOf`: how a preferred distance is derived

Nobody authors a standoff distance in units. It comes out of the bot's own kit
(`firing.ts`):

```
effectiveRange   = Σ(range_i × value_i) / Σ(value_i)     over ready slots with range > 0
value_i          = (damage_i × pulses_i / cooldownSeconds_i) × slotWeight_i
pulses_i         = damage ticks one press of a ticking beam lands on one car; 1 for everything else
preferredRange   = clamp(standoffFraction × effectiveRange, minEngageUnits, awarenessRadiusUnits)
```

`value_i` is a shaping heuristic for standoff and slot ranking only, but it stopped reading `damage`
completely raw on 2026-09-04 (`BOT_BRAIN_VERSION` 1.1.0). A ticking beam authors `damage` **per
pulse**, so the raw field under-rated `afterburner` by 5x and `lance` — which became a ticking beam
that day — by 4x, which was enough that a Bullseye bot holding its ult for a wounded target could
never actually win the ranking and press it. `pulses_i` counts the damage ticks the way
`resolveInstanceHits` does. A shotgun's per-pellet number is still read raw and still under-rates
`pepperbox`: that stays accepted, because three pellets on one car is a ceiling a press rarely
reaches, while a held beam's pulses are the ordinary case. `sim/damage.ts` remains the only authority
on real damage, and nothing in the bot brain may be mistaken for it. Range-0 rows (`wildcharge`) are
excluded from this average — they would drag it to zero — but a ready one still pulls the bot toward
contact through the `contact` goal (H36).

## How to read the playground overlay

Open `http://localhost:5173/?dev=playground`, switch the opponent to **Bot**, and pick a tier from
the difficulty select beside it — the swap takes effect live, mid-match.

The playground now shows a live "what is it thinking" read-out in the corner of the screen —
`HumanController.debug()` (`BotDebug`: current goal, every goal's score, the chosen target,
`preferredRange`, the rolled personality, and the last-pressed slot — see
`packages/server/src/bot/types.ts`), broadcast from `PlaygroundRoom` to the client overlay at 5 Hz
(every 6 ticks — fast enough to feel live, slow enough to actually read) as
`MSG_PLAYGROUND_BOT_DEBUG`, and rendered by `mountPlaygroundOverlay` in
`packages/client/src/dev/playground/overlay.ts`. It is deliberately **not** part of the pause menu:
the pause menu only shows while the sim is paused, and pausing is exactly what stops the bot
deciding and the room broadcasting, so a "live" read-out gated behind pause would never update. It
sits in a small fixed box, always on screen, independent of the pause overlay.

The read-out is two lines. The first reads
`<personality> | <goal> | range <preferredRange> | slot <n>` — for example
`kiter | holdRange | range 312 | slot 2`. The second is the **goal scoreboard**: every goal the
scorer put on the table this tick with its score, sorted best first, with the chosen one marked by a
leading `*` — for example `*holdRange 5.2  intercept 5.0  rush 0.4`. What each field tells you:

- **personality** — one of `brawler`, `kiter`, `sprayer`, `grudge`, `opportunist`, rolled once per
  bot instance (a fresh roll happens whenever the bot is reconstructed — a difficulty change, a
  setup change, or `Switch car`). If it stays fixed across a whole session where you expected
  variety, you are probably re-reading the same `HumanController` instance rather than a new one.
- **goal** — one of `recover`, `huntLastKnown`, `rush`, `holdRange`, `intercept`, `setupCc`, `dump`,
  `contact`, `reset`, `pinWall`, `unpin`. This is the field to watch first when a bot "does something
  odd" — the label alone usually tells you whether the brain thinks it is rushing, holding range,
  setting up a stun, dumping, hunting a last-known pose, or stripped of control (`recover`, e.g.
  mid-respawn phase). A goal stuck on one value for far longer than `goalCommitTicks` while the fight
  clearly changed shape is a sign to go look at `scoreGoals` rather than at movement code.
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
- **the scoreboard** — the case for and against the goal that won, which is the whole reason
  goals are scored rather than picked by an if-ladder (H12). `*dump 12.1  setupCc 9.0` says the
  stun landed and dump took over; `*recover 100` says the bot was stripped of control and nothing
  else was considered. A goal that is **absent** from the line was taken off the table entirely by
  `scoreGoals` (scored `-Infinity`) rather than merely losing — `contact` with no ready maneuver and
  no ram intent, or `reset` on a tier whose `retreatHpFraction` is 0. When the goal label looks
  wrong, read this line before reading any code: it usually says which input was wrong rather than
  which branch was.

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
