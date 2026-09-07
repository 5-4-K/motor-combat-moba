---
name: bot-tuner
description: >-
  Use when someone says a bot feels wrong, too easy, too hard, too accurate, not
  attacking, wasting ults, sitting in a corner, reversing into a wall, moonwalking,
  not reversing to dodge, not dodging, not setting up its shots, or fighting at
  the wrong range — including phrases like "medium bot is too hard to hit" or
  "hard bot is not attacking me even when I don't have ult". Tune BOT_PROFILES
  knobs for easy/medium/hard. Do not rewrite the brain unless they explicitly
  ask for a situation-play change.
---

# Bot tuner

The game has **one brain**. Easy / medium / hard are rows of numbers in
[`packages/server/src/config/bot-profiles.ts`](../../../packages/server/src/config/bot-profiles.ts).
The human cheat-sheet is [`docs/bot-behavior.md`](../../../docs/bot-behavior.md). The design is
[`docs/superpowers/specs/2026-09-05-bot-situation-play-design.md`](../../../docs/superpowers/specs/2026-09-05-bot-situation-play-design.md),
and the solver / prediction / planner rulings are P1–P58 of
[`docs/superpowers/specs/2026-09-05-bot-predictive-brain-design.md`](../../../docs/superpowers/specs/2026-09-05-bot-predictive-brain-design.md).

**You do not invent a Hard-only `if`.** **You do not nerf damage, speed, or HP.** **You do not
edit `DRIVE_CONFIG`.** **You do not tune around a solver bug.** **You do not tune the planner's
base weights** — those live in `bot/brain/objectives.ts`'s `BASE`, they are per-SITUATION and not
per-tier, and changing one changes what a situation *means* for every tier at once. That includes
the seventh planner term, **`facingError`**: it has no `BOT_PROFILES` field. Weakness is worse use
of the same facts, and worse hands.

## Path

1. Read the live `BOT_PROFILES` object (not this skill's memory of the numbers).
2. **Read the overlay before naming anything.** This is the method now, not a preliminary. In
   `?dev=playground` the bot prints two lines:

   ```
   personality | situation | range N | slot K | danger N | plan(+1,+1) SCORE | ev BEST/THRESHOLD
   terms  myEv N  theirEv N  rangeError N  wallPenalty N  lockKeep N  threatAvoid N  facingError N
   ```

   - **`ev BEST/THRESHOLD` answers every holds-fire complaint outright.** `BEST` is the best EV/s
     any ready slot's `solve()` finds from the current pose; `THRESHOLD` is
     `minShotValueFraction × bestAchievableValueOf(carId, aimErrorSigmaRad)` — the shooter's own kit
     ceiling, not a shared absolute number. A ratio **below 1 with `slot -` is the gate working**,
     and `minShotValueFraction` is the tune. A ratio **at or above 1 with `slot -` is a bug** in
     `chooseSlot` / `solve()` — stop and say so.
   - **The `terms` line says what the bot thought it was doing instead.** The overlay prints
     whatever keys `PlanWeights` currently has (`PlaygroundRoom` copies the map wholesale) — **seven
     as of 4.5.0**, `facingError` the seventh. Do not treat an extra name as noise, and do not
     hard-code six. These are RAW term values, not points: multiply each by that situation's weight
     in `objectives.ts` to see which term actually won. `wallPenalty` runs about 0.017 in a TRUE
     corner (pose inside the margin) against weights in the hundreds, and **0 merely near a wall**;
     `rangeError` is units; `myEv` / `theirEv` are EV per second; `facingError` is bounded [0, 1]
     and in the planner's rollout it is effectively **0 or 1** (`DRIVE_CONFIG.steeringGrip` is 1.0,
     so no slide) — 0 driving ahead, 1 reversing. A bare `terms  -` means the bot has not reached
     its first recompute window yet — not a broken overlay, and not a tuning signal.
   - **`danger`** is the damage per second the bot believes it is standing in. If it reads 0 while
     you are pointed straight at it from inside your weapon's reach, stop: solver bug
     (`dangerEvAgainst`, `bot/brain/solution.ts`), not a tuning problem.
3. Name the **factor**. There are now five, and only four of them have knobs:
   - **judgment** — dead, ranges, corner, ult save, dodge notice.
   - **hands** — aim, blunder, fidget.
   - **prediction** — how well it reads your speed and turn rate (`stateEstimationSigma`,
     `bot/brain/predict.ts`). A bot that leads a TURNING car wrongly is reading the curve wrong; a
     bot that sprays at one driving STRAIGHT has bad hands. `aimErrorSigmaRad` will not fix the
     first.
   - **planning** — `planHorizonTicks`, `planDepth`, `targetBranches`, `commitPenalty`. This is the
     factor "it doesn't set up its shots", "it drives past me", and "it stutters instead of
     turning" belong to; none of them is judgment or hands.
   - **the solver** — hit chance and value. Not a knob at all.
4. Name the **tier** they complained about. Do not "fix Hard" by changing Easy unless they asked.
5. Propose **one knob, one direction, the current value → the new value**, with a one-line why.
   Wait for them to confirm before editing — same as weapon-forger.
6. After a confirmed edit: update the matching cells in `docs/bot-behavior.md` in the same change.
   `bot-profiles.test.ts` `LADDER` must still rise/fall as declared. A table-only `BOT_PROFILES`
   retune is enough for the fingerprint hash. Bump `BOT_BRAIN_VERSION` if you also changed brain
   *code*, `BRAIN_CONSTANTS`, or `objectives.ts` BASE.

**Stop tuning and say so** when the overlay shows any of these — all three are brain bugs:

- the wrong **situation** for the moment (Hard in `waitOut` while you are alive in front of it, or
  `fight` while you are phased);
- a `plan` score whose winning term is obviously the wrong one for that situation — `wallPenalty`
  dominating in open floor, `rangeError` dominating a `punish` that is already at its range.
  **`facingError` dominating `fight` while the bot backs off to range is often correct** (guns stay
  on you; that is why `fight` is 30 and `reset` is 10). `facingError` dominating a reverse dodge
  in `evade` (the reverse toll beating what `threatAvoid` can earn, 0–24 points) is a BASE bug,
  not a profile tune — stop and say so. 4.5.1 already dropped `evade`'s weight 40 → 10 for that;
- the bot holding fire while `ev` **clears** its threshold, or `solve()` reporting a value for a
  weapon that plainly cannot make that shot. The bot holding fire while `ev` is **below** threshold
  is the opposite: that is a tuning answer (`minShotValueFraction`), not a bug. The two look
  identical from outside the car and the overlay is what separates them.

## Complaint → knobs

| They say | Factor | First knobs (direction relative to "too much of this feel") |
|---|---|---|
| "medium is too hard to hit" | hands | Raise `aimErrorSigmaRad` on **medium**. `minShotValueFraction` is not a straightforward easier/harder dial: lowering it widens what the bot will attempt (more, worse shots); raising it makes the bot *pickier and therefore MORE deadly per shot* — it is not the knob to reach for "easier to hit" |
| "hard tracks me perfectly" | hands | Same on **hard** |
| "it misses me when I turn" | prediction | `stateEstimationSigma` down on that tier. Not `aimErrorSigmaRad` — that is steady-state hands, this is reading a curve. Lead is solved from the real drive model now (`bot/brain/predict.ts`), so the only tier dial on it is how wrong the bot's read of your speed and turn rate is (easy 0.25, medium 0.1, hard 0.03) — down to lead a turn better, up to lead it worse. `leadFactor` no longer exists; do not propose it |
| "hard isn't attacking / holds fire" | fire threshold | Read `ev best/threshold` FIRST (Path step 2). Below 1: lower `minShotValueFraction` on **hard**. At or above 1: bug, stop |
| "isn't attacking even when I don't have ult" | their ult is irrelevant | They mean the bot's own guns. Same as holds-fire. Do **not** drop `ultDisciplineChance` unless they also waste / never use the 5s gun |
| "it doesn't set up its shots" / "it drives past me" | planning | `planHorizonTicks` up on that tier — it is how long an arc the bot can express at all, and easy's 0 is a one-tick rollout by design. **Hard's 22 is load-bearing**: the commitment-window plateau it was measured on is two ticks wide, so moving it obliges re-running that seven-seed sweep, not eyeballing a match. `targetBranches` (1 or 3) is the hedge against what you do next, and only hard pays for it |
| "it weaves / circles me" | planning | Often correct now — circling is emergent, because the arc that sweeps its nose across you scores better than the one that does not. If it looks like a **stutter** rather than an arc, that is planner chatter: raise `commitPenalty` on that tier. `orbitBias` no longer exists |
| "it drives in a straight line into a wall" | planning, then judgment | Check the `terms` line: if `wallPenalty` is nonzero and still losing, the horizon is too short to see the wall (`planHorizonTicks`); if it reads 0 while the pose is INSIDE the margin, that is a `boundsPenalty` bug. **0 merely near a wall is expected** — see the corner row. `wallLookaheadUnits` only decides when `unpin` is CLASSIFIED, not how the car steers |
| "wastes ult" / "ults my corpse" | judgment | Raise `deadRespect` (corpse); raise `ultDisciplineChance` (live full-HP dump) |
| "sits in a corner" | judgment | Raise `cornerRespect`; overlay should read `unpin`. **`wallPenalty` dominating is only a true-corner signal** (pose inside the margin, ~0.017). Merely NEAR a wall it reads 0, same as open floor — `tiers.test.ts` H39 reads 0 in both. Since 4.5.0 the discriminator is `facingError` (`unpin` 60 vs `fight` 30 in `objectives.ts` BASE), which is why the near-wall car turns off the wall instead of reversing into it. Do not cite `wallPenalty` as the explanation on its own. Do not send them to the map centre |
| "never dodges" | judgment | Raise `dodgeChance` / `incomingCarChance`; lower `dodgeReactionTicks`. Those decide WHETHER it reacts; how hard it leans is `threatAvoid`'s weight in `objectives.ts`, which is not per-tier and not yours to move. How it dodges — reverse vs a forward arc — is `evade`'s `facingError` (10 as of 4.5.1), also BASE. See the reverse row |
| "it reverse-dodges" / "it moonwalks" / "it won't reverse to dodge" | **not a knob** | `facingError` in `objectives.ts` BASE, per-situation, no `BOT_PROFILES` field. `fight` 30 is why a ranged car backs off with guns on you (correct). `evade` 10 is the dodge reverse-toll; 40 used to cost more than `threatAvoid` could earn. Do not invent a profile field. If they asked for a situation-play change, that is BASE **and** a `BOT_BRAIN_VERSION` bump (fingerprint does not hash `objectives.ts`) |
| "shots are all over the place" | **not a knob** | The solver (`bot/brain/solution.ts`) decides hit chance and value. If it is firing shots that miss, that is a solver bug to investigate, not a value to tune — say so rather than reaching for `aimErrorSigmaRad` |
| "too close / too far" | range | `opponentRangeRespect` — how much of THEIR shortest gun it insists on clearing. The bot's own comfortable range is derived from its kit by `preferredRangeOf` (`bot/brain/firing.ts`) and has no per-tier knob: `standoffFraction` no longer exists. Predator uses aim reach (~800), not 1800 |
| "it charges in / never closes" | range | `opponentRangeRespect` down to close, up to stand off — but know the ceiling: `fightRange = max(ownComfort, theirKeepOut)`, so **nothing in the profile can make a bot stand closer than its own derived comfort**. If they want a genuinely brawling bot, that is a new profile field, not a tune — say so |
| "it runs away from nothing" | judgment | `opponentRangeRespect` down on that tier: it scales the planner's `theirEv` term, so a high value makes every candidate walking into a firing solution score worse. Read `danger` and the `theirEv` term first (Path step 2). The old anticipatory-`evade` apparatus — `dangerEvadeFraction`, `dangerEvadeCooldownTicks` — is deleted; do not propose either |
| "it walks into obvious fire" | judgment | `opponentRangeRespect` up. If the overlay's `danger` reads 0 while you are aimed at it from inside your weapon's reach, that is a solver bug in `dangerEvAgainst` (`bot/brain/solution.ts`) — stop tuning and say so |
| "easy and hard feel the same" | not a single knob | Read `packages/server/src/bot/brain/tiers.test.ts`. If green, the values are too close — move several judgment+hands knobs apart, still no `if (hard)`. `planHorizonTicks` is the field that makes the tiers differ in KIND (0 / 8 / 22), so check it first |

`stateEstimationSigma` is a FRACTION, not a probability — a value above 1 is a wild misread, not an
invalid one. It is deliberately outside `personality.ts`'s `UNIT_INTERVAL_FIELDS` and
`bot-profiles.test.ts`'s `PROBABILITY_FIELDS`, exactly as `aimErrorSigmaRad` is. Do not add it to
either list to "fix" a value you pushed past 1.

Against a target holding full lock, the turn half's misjudge-whether-it-is-steering failure is
effectively easy-only: it needs a noise draw beyond roughly `-0.5 / stateEstimationSigma` standard
deviations, which is about 2.3% of constructions at easy's 0.25 but roughly 5 sigma at medium's 0.1
and roughly 16.7 sigma (never) at hard's 0.03. On hard, "lower `stateEstimationSigma` so it leads a
turn better" moves the *magnitude* of an already-correctly-read curve, not the *decision* that the
car is curving at all — do not promise that fix against a full-lock target on hard.

`opponentRangeRespect` is one dial behind three different complaints — keep-out range, the
planner's danger weight, and two archetypes' whole range flavour — so say which one you are aiming
at when you propose a move. At easy it is 0, and therefore inert in all three.

## After they confirm

Edit only `bot-profiles.ts` (and the `docs/bot-behavior.md` cells). Run:

```
npx vitest run src/config/bot-profiles.test.ts src/bot/brain/tiers.test.ts
```

from `packages/server`. If you touched a planning knob, add
`src/bot/brain/planner.test.ts src/bot/brain/controller.test.ts` — the closed-loop duels are what
catch a bot that has stopped being able to aim. Recommend they try it in Practice or
`?dev=playground`. Recommend `npm run balance` only if they want a new win-rate baseline — the
table hash will have moved.

**Exception, and it bites every shared constant.** `botFingerprintInput()` in
`packages/server/balance/fingerprint.ts` hashes only `BOT_PROFILES` and `BOT_BRAIN_VERSION` —
`BRAIN_CONSTANTS` has never been part of it, and neither has `objectives.ts`'s `BASE`. So an edit
to `commitWindowFraction`, `trajectorySampleCount`, `preferredRangePlateauFraction`, or any
`facingError` / `threatAvoid` / other BASE weight does **not** move `botFingerprint`, and two
balance reports taken either side of it will compare as if the same pilot played both. 4.5.1
existed for exactly that: `evade`'s `facingError` 40 → 10 with `BOT_PROFILES` unmoved. If you
touch `BRAIN_CONSTANTS` or `BASE`, bump `BOT_BRAIN_VERSION` in the same edit — that is what makes
the harness refuse the stale comparison. It also retunes all three tiers at once, which is almost
never what a single-tier complaint asked for.

**The invariants a retune must not break.** `bot-profiles.test.ts` holds the first two and
`firing.test.ts` the third; check them before you propose, not after the suite goes red.

- Every `LADDER` field stays strictly ordered across the tiers — `minShotValueFraction`
  (0.01 / 0.05 / 0.3) and `commitPenalty` (0.072 / 0.126 / 0.18) included.
- Every `PROBABILITY_FIELDS` entry stays inside [0, 1] **on a ROLLED personality**, not just in the
  table: an archetype shift of ±25% can push a tier value past 1 on its own.
- `BRAIN_CONSTANTS.minEngageUnits` (70) stays below every tier's `awarenessRadiusUnits`.
  `preferredRangeOf` caps its answer at the awareness radius with a `Math.min`, so an awareness
  radius under the floor would silently push a bot's chosen range BELOW the floor that constant
  exists to enforce.

And one that no test can hold: `commitPenalty` is a fraction of `maxScore - medianScore`, measured
against that spread and no other. If anyone changes the planner's normaliser, this knob is
re-measured, never carried across.
