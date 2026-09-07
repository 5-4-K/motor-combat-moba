# Bot Predictive Brain — Master Index, Execution Strategy, Tracker

> **For agentic workers:** This file is **not** executed directly. Execute one plan file at a time,
> in the numbered order. Source design:
> `docs/superpowers/specs/2026-09-05-bot-predictive-brain-design.md` — read it before the first plan
> and keep it open; every task cites its `Pnn` decisions.
>
> **REQUIRED SUB-SKILL** for each plan file: `superpowers:subagent-driven-development` (recommended)
> or `superpowers:executing-plans`.
>
> **Completion rule (do not skip):** when a plan is implemented and its Validation section has been
> run successfully, update the **Execution Tracker** below in the same change (status → Done, date,
> short note). Never mark Done without Validation evidence. Do not start executing unless the human
> explicitly asks.

**Goal:** Rework the bot brain so easy plays like an amateur, medium like an experienced casual, and
hard like a highly skilled player — replacing a reflex-with-noise agent with one that predicts,
evaluates real firing solutions, and plans.

**Architecture:** A firing-solution solver built on the sim's own projectile geometry, a threat
evaluator that is the same solver with its arguments swapped, physics-based prediction through the
real `stepDrive`, and a receding-horizon planner over the complete 9-action input space. The
situation FSM survives as the strategy layer, supplying objective weights instead of headings.

**Tech Stack:** TypeScript, npm workspaces, Vitest. Server-only (`packages/server`); this work reads
`@motor-combat-moba/shared` and never modifies it.

**Environment:** Windows 10, PowerShell. Worktree
`E:\Work\motor-combat-MOBA\.claude\worktrees\bot-intelligence-rework-c37f8f`, branch
`claude/bot-intelligence-rework-c37f8f`.

**Spec:** `docs/superpowers/specs/2026-09-05-bot-predictive-brain-design.md`

---

## Global Constraints

Copied verbatim from the spec and from `CLAUDE.md`. Every task's requirements implicitly include
this section.

- **No cheating (P1, P4).** `BotView` is the whole of what a bot may know. Never reach for
  `inputQueues`, `prevFireMasks`, or `ArenaState` from inside `decide` or anything it calls.
- **State a human infers is inferred (P5).** `angVel`, `authority`, `shoveX/Y`, `reverseHold` on
  another car come from observed motion, never from the wire.
- **A behaviour is code, a tier is data (H8).** No module may branch on `"easy" | "medium" | "hard"`.
  Tier differences are numbers in `BOT_PROFILES`.
- **Fixed random draw counts (H21).** Every layer draws the same number of `rng()` calls regardless
  of branch. **The solver and planner draw zero** (P43).
- **One press per tick (H27).** `chooseSlot` returns one slot index, never a mask.
- **No magic numbers in logic.** New constants go in `BRAIN_CONSTANTS` or `BOT_PROFILES`.
- **`npm install` before the first build in this worktree**, or the build inlines the main checkout's
  shared `dist`. Verify with: the inlined path comment in `packages/server/dist/index.js` must read
  `// ../shared/dist/…`, not `// ../../../../../packages/shared/dist/…`.
- **Verify with root `npm test`**, never a per-workspace run — a per-workspace run silently skips the
  server suite.
- **Never create a new playtest probe or scenario.** Fix a compile break in one; otherwise report and
  recommend, do not edit (`CLAUDE.md`).
- **Do not touch `docs/ideas/` or `docs/invariants/`.**

---

## Plan list

Files are numbered by **execution order**, with the spec's phase letter in parentheses. The spec's
letters (B → C → A → D) are the dependency graph's topological order and are deliberately *not*
alphabetical; the numbers exist so nobody executes them in the wrong order.

| # | Plan file | Spec phase | What you get after Validation |
|---|---|---|---|
| 1 | `2026-09-05-bot-brain-1-firing-solutions.md` | **B** | The §1.1 lockout is fixed and the bot shoots on expected value instead of an angle. Hard reliably kills a stationary target. The bot presses `wildcharge` for the first time. |
| 2 | `2026-09-05-bot-brain-2-threat-and-cooldowns.md` | **C** | The bot knows when it is standing in someone's firing solution, and estimates enemy weapon readiness from what it has seen fire. |
| 3 | `2026-09-05-bot-brain-3-physics-prediction.md` | **A** | Lead comes from rolling the real drive model forward instead of a constant-velocity solve. Prediction quality becomes a tier knob. |
| 4 | `2026-09-05-bot-brain-4-planner.md` | **D** | Vector-averaging is gone. The bot plans an arc, hedges against the target's possible inputs, and the overlay shows why. The tier ladder becomes reflex → shallow → planning. |

---

## Execution strategy

### Required sequence

```
1 (B)  →  2 (C)  →  3 (A)  →  4 (D)
```

Strictly sequential. Nothing here may run in parallel, and the reasons are structural rather than
conventional:

1. **1 (B) first.** Plans 2 and 4 both consume the solver's geometry. Plan 2 is literally the same
   function with its arguments swapped; writing it first would mean writing that geometry twice.
2. **2 (C) after 1.** `dangerEV` is `solve()` inverted.
3. **3 (A) after 1.** A better predictor is wasted while shots are still released through a bad
   gate — the whole reason the spec orders A third rather than first.
4. **4 (D) last.** The planner scores on plan 1's `myEV` and plan 2's `theirEV`, and reuses plan 3's
   rollout code. It also performs the `movement.ts` deletion, which the earlier plans still depend on.

### Per-plan obligations that are easy to forget

Each plan carries a **Docs and skill** task. Per **P58b** these are *correctness* obligations, not
tidiness: `bot-tuner` is a skill and fires automatically on any "the bot feels wrong" phrasing, so a
stale copy would confidently propose edits to fields that no longer exist for the whole duration of
the following plans. **Do not defer these to the end.**

Each plan also bumps `BOT_BRAIN_VERSION` (P47): `4.0.0`, `4.1.0`, `4.2.0`, `4.3.0`. Every bump
invalidates prior balance baselines, which is expected and accepted (P55).

### Session / machine handoff

Each plan file is self-contained: files, interfaces, tasks, commands, Validation. An agent picking
this up fresh should:

1. Read this index (tracker + strategy).
2. Read the spec.
3. Read **only** the next Allowed plan.
4. Implement it, run its Validation, update the tracker.

---

## Execution Tracker

| # | Plan | Status | Date | Notes |
|---|---|---|---|---|
| 1 | `bot-brain-1-firing-solutions` (B) | **Done** | 2026-09-06 | Validation run; whole-branch review clean after one fix wave. `BOT_BRAIN_VERSION` 4.0.0. See below. |
| 2 | `bot-brain-2-threat-and-cooldowns` (C) | **Done** | 2026-09-06 | Validation 1-2 run (root `npm test` green; build inlines `// ../shared/dist/`); 3-5 are hands-on playground checks left to the user. Whole-branch review clean after one fix wave. `BOT_BRAIN_VERSION` 4.1.0. See below. |
| 3 | `bot-brain-3-physics-prediction` (A) | **Done** | 2026-09-06 | Validation 1-2 run (root `npm test` green, 44 server test files; build inlines `// ../shared/dist/`); 3-4 are hands-on playground feel checks left to the user. Whole-branch review APPROVE after one fix wave plus two residuals. `BOT_BRAIN_VERSION` 4.2.0. See below. |
| 4 | `bot-brain-4-planner` (D) | **Done** | 2026-09-07 | Validation 1-3 run (root `npm test` green; build inlines `// ../shared/dist/`; the only tier-name hits in `src/bot` are a type declaration and H47's pre-existing `EASIER` adjacency table, so nothing branches on a tier); 4-5 are the hands-on playground pass and the balance/playtest recommendation, left to the user. Ten tasks, resequenced because the plan's own order did not compile; task 3 alone took five fix rounds, and four further fix waves closed every review finding. `BOT_BRAIN_VERSION` 4.3.0. See below. |

### What plan 1 changed, and what later plans inherit

- The fire gate is `solution.ts`'s expected value, not an angle. `fireConeRad`,
  `fireDisciplineChance` and `orbitBias` are gone from `BotProfile`.
- **`minShotValueFraction` is RELATIVE to the shooter's own kit ceiling**, not an absolute EV. An
  absolute threshold made a hard Bastion mute — its best possible shot (18.3) sat below the
  threshold (25) while Bullseye's ceiling is 78.3. Values easy 0.01 / medium 0.05 / hard 0.3.
- **`leadFactor` was NOT removed** — it belongs to plan 3, which actually replaces it. Removing it
  in plan 1 silently gave easy and medium a lead upgrade.
- A steering limit cycle was found and fixed mid-plan: `compensateForLag` in `movement.ts`, with
  `BRAIN_CONSTANTS.deadzoneFloorFraction` and `deadzoneCapMultiplier`. **Plan 4 deletes all of it**
  when the planner replaces bang-bang steering.
- Spec corrections made during execution: §1.1's severity, P35's phase column, P36's threshold
  semantics, P50's fire-volume claim. Read the spec, not this summary, before starting plan 2.

### What plan 2 changed, and what later plans inherit

- `readinessOf(state, sessionId, weaponId, tick, profile)` in `perception.ts` estimates how loaded a
  bot BELIEVES an enemy weapon is, 0..1. Its backing map was renamed `ultSeenTick` → `firedSeenTick`:
  the old name lied about its contents, which always held every weapon seen fired, not only ults.
- **`readinessOf` reaches back only `memoryTicks`** (15/45/90), while the roster's four big guns
  recharge over 390–600 ticks. A hard bot therefore discounts a watched `lance` for 3 s of its 16 s
  downtime and then believes it is loaded again. P16's *"break his lance line"* is **not delivered by
  this phase.** The direction is conservative (danger is over-read, never under-read); giving
  press-memory its own horizon is the fix if a later phase wants that behaviour.
- `dangerEvAgainst` in `solution.ts` is `solve()` with its arguments swapped, summed over the
  opponent's chassis kit and weighted by believed readiness. Two unknowables are ASSUMED, both in the
  conservative direction: their lock is assumed absent (which lowers danger, so the bot never
  flinches from a lock the opponent does not hold), and their aim error is
  `BRAIN_CONSTANTS.assumedOpponentAimSigmaRad`, 0.06. Note 0.06 sits *above* hard's own 0.035, so a
  hard bot under-reads danger from another hard bot.
- **The anticipatory evade is four gates, and phase D deletes all of it.** It fires only when the bot
  is not pinned, is alive and not phased, has `opponentRangeRespect > 0`, has `danger > 0`, clears a
  120-tick refractory, and `danger * opponentRangeRespect >= bestValue * dangerEvadeFraction` — where
  `bestValue` is the best `value` among its OWN ready solutions at its CURRENT pose. Read that as
  *"am I losing this exchange from here"*, not *"could anyone shoot me"*. Phase C adds **no**
  `BotProfile` field: `opponentRangeRespect` was repurposed as the danger weight (P38), and the other
  two knobs are shared `BRAIN_CONSTANTS`.
- **Why four gates, and why it is temporary.** `evade` is priority index 2 in `ALL_SITUATIONS` and
  cuts in with no commit delay — an immediacy calibrated for the EVENT *"a shot is in the air"*.
  Danger is a STANDING condition, true through most of a duel, so every simpler binding starved the
  lower situations. Measured on `balance/match.test.ts`'s hard deathmatch fixture across seeds 1–150:
  an absolute threshold gave 1–2 decisive kills, the refractory recovers 17, and disabling the term
  entirely gives 20 — at n=150 the last two are one noise band. **The spec always put this quantity
  in the phase-D PLANNER as a continuously-weighted score term (P16, P26, P27, P38), and P27 deletes
  every gate, constant and controller field listed above.** Treat it as an interim binding, not a
  design to build on.
- One trap worth carrying forward: the gate's comparison is **vacuously true when both sides read
  zero**, and separately when only `bestValue` is zero. Those are what the `danger > 0` and
  `opponentRangeRespect > 0` clauses close. The second was a shipped bug caught by the final review —
  easy's `opponentRangeRespect` of 0 made `0 >= bestValue` true whenever no slot was ready, so easy
  evaded *more* than hard (16.7% of a fight against 5%), inverting the ladder while five documents
  claimed easy was structurally immune.
- `BotDebug.dangerEv` reaches the playground overlay for real — `BotDebugPayload`, its guard,
  `PlaygroundRoom`'s broadcast and `overlay.ts`, which now prints
  `personality | situation | range N | slot K | danger N`. That reading is the phase's durable
  deliverable and survives P27.
- Known gaps left standing, all pre-existing or deliberately deferred: `BRAIN_CONSTANTS` is **not**
  hashed by `botFingerprint` (`balance/fingerprint.ts` covers only `BOT_PROFILES` and
  `BOT_BRAIN_VERSION`), so a `BRAIN_CONSTANTS`-only retune leaves two balance reports comparable when
  they are not; `observedFires` is not viewport-filtered, so on `arena-02` a bot records presses it
  could not see; and `balance/match.test.ts`'s first deathmatch test still pins ONE seed, reseeded
  five times across five brain changes, where its sibling long ago moved to a spread.
- `docs/superpowers/plans/2026-09-05-bot-brain-4-planner.md` still names
  `this.effectiveProfile.minShotValue`, a field renamed in plan 1. Fix it before executing plan 4.

---

### What plan 3 changed, and what later plans inherit

- **`leadFactor` is gone**, and P35's five-site warning was accurate: beyond the `BotProfile` field and its three
  tier values, it was read at TWO `controller.ts` call sites (the `aimPoint` and `bodyIntercept` `interceptPoint`
  calls, easy to mistake for one) and named as a plain STRING in `personality.ts`'s `UNIT_INTERVAL_FIELDS` and in
  that list's hand-maintained MIRROR, `bot-profiles.test.ts`'s `PROBABILITY_FIELDS`. The compiler catches the
  field, the values and the call sites; it catches neither string list. Both lists are 16 entries and
  byte-identical to each other today — check that pair by reading whenever a `BotProfile` field is added or
  removed.
- **`interceptPoint` survives in `aim.ts` with no production caller**, deliberately, as spec section 4's "Kept"
  zero-horizon path. `aim.test.ts` is its only reference. Plan 4's `K = 0` tier is what is meant to use it; if
  plan 4 does not, it becomes dead and should be deleted then rather than left to rot.
- **`stateEstimationSigma` (0.25 / 0.10 / 0.03) is NOT in the unit-interval lists**, and must not be added: it is
  a standard deviation, not a probability, and `aimErrorSigmaRad` set that precedent. It IS in `LADDER`, as
  `"falls"`.
- **The plan's `{ steer: 0, throttle: 0 }` target rollout was wrong and was replaced.** `DRIVE_CONFIG.drag` is
  900 u/s^2 — 0.32 s to rest — so "coasting" in this sim means braking hard, and the plan's own model
  rolled a 400 u/s Mirage to a dead stop within 20 ticks having covered 82 units, against ~400 for the straight
  line it was replacing. `throttle: 1` fixed that and introduced the mirror-image bug: it accelerates EVERY target
  toward its chassis maximum, worst against a `stunned` one (speed 0, and `punish`'s exact trigger), where the aim
  point lands hundreds of units past a car that cannot move and `minShotValueFraction` then declines the free
  shot. **What shipped is `OBSERVATION_MODIFIERS`** — the sim's own `Modifiers` channels with `accel: 0`,
  `brakeDecel: 0` and a raised `topSpeed`, so a rollout holds exactly the speed that was OBSERVED while rotation
  and position still integrate through the real `stepDrive`. Error against an independent ground truth is 0.00 at
  every speed, both steers, out to 90 ticks. **A predictor that models a throttle is the trap here; plan 4's
  planner rolls the bot's OWN car with genuine throttle and must keep using `rollForward` with real modifiers,
  which is why that parameter is required rather than defaulted.**
- **The turn is reconstructed as a STEER, not carried as spin.** The sim's steer is `-1 | 0 | 1`, so a car
  genuinely turning is at full lock and `observedAngVelOf` on one reads exactly `turnRateOf(carId)` (measured:
  8.19 vs 8.19 for Mirage). `steerFromObservedTurn` returns the sign above
  `BRAIN_CONSTANTS.fullLockAngVelFraction` of the chassis rate and 0 below, and an observed turn is attributed to
  exactly ONE cause: steering above the threshold, a decaying ram spin below it. **A car spinning from a ram
  therefore reads as one that meant to turn, and is mispredicted — that is P19's sanctioned human error, kept
  on purpose.**
- **The steer reconstruction lives INSIDE `physicsPredictor`, after the noise draws, and that placement is
  load-bearing.** It was originally in `controller.ts`, reading the RAW observed turn — which made
  `stateEstimationSigma`'s turn half completely inert (the noise multiplied a spin value that is zero whenever the
  car is judged to be steering, i.e. in the only case a physics rollout beats a straight line) while four
  documents claimed otherwise. The final whole-branch review caught it. Do not move it back out.
- **The turn half is a step function, not a gradient, and effectively easy-only.** Against a full-lock target,
  misjudging *whether* a car is steering needs a draw beyond about `-0.5 / stateEstimationSigma` sigma: ~2.3% of
  constructions at easy's 0.25, ~5 sigma at medium's 0.10, ~16.7 sigma (never) at hard's 0.03. On medium and hard
  the knob moves the MAGNITUDE of an already-correctly-classified curve. `docs/bot-behavior.md` and `bot-tuner`
  both say so; a continuous per-tier lead error, if plan 4 wants one, is still unbuilt.
- **`physicsPredictor` draws FOUR `rng()` calls, not two** — two gaussians, and `gaussian` is Box-Muller, a
  pair each. That number was written as "two" in three separate comments across this phase and corrected three
  times. The draws are taken UNCONDITIONALLY, before any rollout, and `controller.ts` builds the predictor against
  `ABSENT_TARGET` (with horizon 0) when there is no target rather than skipping it, because H21 is what lets one
  seed replay. `selfPredictor`, `rollForward`, `interceptTicks` and `steerFromObservedTurn` draw zero.
- **`dangerEvAgainst`'s `meAt` is now `selfPredictor`, not `constantVelocityPredictor`**, so phase C's
  anticipatory evade reads a physics rollout of the bot's own car. P27 still deletes that whole gate; this only
  changes what it reads until then.
- **P34's easy portrait ("does not lead") is now out of date.** With `leadFactor` gone, easy leads — badly,
  via `stateEstimationSigma` 0.25 and `aimErrorSigmaRad` 0.18. P35/P36's field tables are normative and were
  followed; the prose portrait was not edited. `docs/bot-behavior.md` records the contradiction so it is not filed
  as a regression. Rewriting the spec's portrait is the user's call.
- **`BRAIN_CONSTANTS` gained several behaviour-moving knobs this phase** — `predictionHorizonTicks` (90),
  `fullLockAngVelFraction`, `closeLeadHorizonFraction`, `observationTopSpeedHeadroom` and
  `interceptFixedPointRounds`. `botFingerprint` (`balance/fingerprint.ts`) still hashes only `BOT_PROFILES` and
  `BOT_BRAIN_VERSION`, so an edit to any of them moves the bot invisibly to the balance harness. That gap was
  already recorded after plan 2 and is now materially wider.
- **`predictionHorizonTicks` is a TICK count and does not survive netcode phase 1's `TICK_RATE_HZ` 60.** It is
  documented in the constant and guarded by nothing.
- The deathmatch clock fixture in `balance/match.test.ts` was reseeded four times on this branch as behaviour
  changed (96 -> 34 -> 5 -> 4 -> 3), assertions untouched each time and the top paragraph rewritten rather than
  stacked. Decisive-kill sweep over seeds 1-150: 17 before this phase, then 12, 18, 21, **22** — the
  23 -> 17 -> 12 drift recorded after plan 2 reverses, which is the direction expected of a bot that stops aiming
  past slow and stunned targets.
- Known gaps left standing, all pre-existing or deliberately deferred: `readinessOf` still reaches back only
  `memoryTicks`; `observedFires` is still not viewport-filtered; `BRAIN_CONSTANTS` is still outside
  `botFingerprint`; `docs/bot-behavior.md` has no test holding it to the config the way
  `scripts/turn-tuning-doc.test.mjs` holds `turn-tuning.md`; and `npm run typecheck` fails on
  `perception.ts:205` (`TS1354`), which was verified present at this branch's merge base and is not this phase's.
- **`docs/superpowers/plans/2026-09-05-bot-brain-4-planner.md` still names `this.effectiveProfile.minShotValue`, a
  field renamed in plan 1. Fix it before executing plan 4.** That was recorded after plan 2 and is still true.

---

### What plan 4 changed, and what later plans inherit

- **THE CANDIDATE SET WAS THE HARD PART, NOT THE SCORE.** Read this before touching the planner.
  Task 3 shipped, went red on ten tests, and took five fix rounds; four of those rounds each moved
  `rangeError`'s aggregation (terminus, min-along-path, mean, first-sample) and each fixed one
  closed-loop duel by breaking the other — seven-seed pass rates on-axis / off-axis were terminus
  4/7 and 6/7, min-along-path 6/7 and **0/7**, mean 4/7 and 1/7, first-sample 4/7 and 1/7 plus eight
  suite failures. All three implementers who touched it independently named the same cause: the
  missing quantity was never in the score. Under spec **P24's literal "held for K ticks"** a
  candidate is one input held for the whole horizon, so at hard's `planHorizonTicks: 22` the menu is
  0 / +150 / -150 degrees of rotation and "floor it for 0.73 s" / "stop" / "reverse" — a 0.234 rad
  (13 degree) aim correction and a 56-unit range close **are not on it**, and no aggregation can
  select an action that does not exist. What worked (R-P10, R-P12) was changing what a candidate IS:
  the action held for a **commitment window**, `ceil(K * BRAIN_CONSTANTS.commitWindowFraction)` at
  **0.52**, then a full-neutral `{steer: 0, throttle: 0}` continuation for the rest of the horizon.
  Still exactly nine candidates, so the cost is unchanged. That is the standard MPC terminal-policy
  shape and a strictly better model of a bot that re-plans every `recomputeTicks` anyway. Hard's
  on-axis duel went 24 -> 138 fires per 300 ticks at 0.000 rad and 3/7 -> 7/7 seeds.
  **The window's plateau is only TWO TICKS WIDE** — 0.13 collapses the on-axis duel to 0/7, and
  steer-only continuation never clears it at any window — so **any future `planHorizonTicks` change
  must re-run that seven-seed sweep**, and `rangeError` must be re-derived per cell or an otherwise
  correct middle reads as a regression.
- **Every score term aggregates over the rolled arc, and each term's aggregation matches its own
  kind** (R-P7, revised twice, plus R-P11). `myEv` and `lockKeep` take the **best** anywhere along
  the path — that is the instant the nose sweeps across, which is what spec section 2 says the game
  IS, and a terminus-only read can only ask where the nose ENDS. `theirEv` and `wallPenalty` take
  the **worst** — you are killed once and you clip a wall once. `rangeError` and `threatAvoid` are
  read **at the terminus**: they are destinations, not moments. Sampled at
  `BRAIN_CONSTANTS.trajectorySampleCount` = **4** points, **GEOMETRICALLY spaced** (ticks 2/5/10/22
  at K=22). Even spacing (6/11/17/22) misses the sweep entirely and reads **0/300 fires at every
  sample count**. The count was re-swept at the shipped configuration in fix wave 1 rather than left
  historical: 3 -> 6/7 and 1/7; 4 -> 7/7 and 6/7 at 0.432 ms; 5 -> 6/7 and 7/7 at 0.545; 6 -> 7/7
  and 5/7 at 0.654. 4/5/6 are a plateau at 13-of-14 seeds and 4 is the cheapest cell on it.
- **`planDepth: 2` ships on NO tier and is deliberately dormant machinery**, kept because it is the
  dial spec P33 itself names. Measured **3.03 ms per plan against the 0.33 ms budget, roughly 8x**
  (the earlier in-phase reading was 0.995 ms; depth 1 at the same K and branches is 0.166 ms).
  Lowering K cannot rescue it — at 81 sequences the SCORING alone costs ~0.475 ms before a single
  `stepDrive` runs. `planDepth` is `1 | 2` in the type, the depth-2 tests stay, and R-P17 fixed a
  latent bug in it: `commitWindowOf` now divides the window by `depth`, because `ceil(K * 0.52)`
  applied twice exceeds K for every K, which silently turned depth 2 back into the whole-horizon
  hold R-P10 exists to replace.
- **Profile fields out**: `aimToleranceRad`, `standoffFraction`, `deadbandFraction` (P35).
  **Profile fields in**: `planHorizonTicks` (0 / 8 / 22), `planDepth` (1 / 1 / 1), `targetBranches`
  (1 / 1 / 3), `commitPenalty` (0.072 / 0.126 / 0.18). One existing field moved:
  **`awarenessRadiusUnits` easy 520 -> 600** (R-P14), and the reason matters more than the number —
  the closed-loop duel opens at **553 units**, so easy started **BLIND**, `target === undefined` on
  49 of 50 recompute ticks, and at `planHorizonTicks: 0` it could never navigate back into contact.
  The symptom was **11 of 21 easy duels firing zero shots**; the one test that caught it saw a
  fraction of that. The cliff is 540 -> 560, so 600 sits mid-plateau, and the LADDER's `"rises"`
  holds against medium's 700.
- **`LADDER` gained a fourth direction, `"rises-or-equal"`**, for fields that hold flat on one rung.
  It is now earned by **`targetBranches` (1, 1, 3) alone**: `planDepth` was `1, 1, 2` when the
  direction was added and became `"equal"` when R-PF1 shipped hard at depth 1.
- **`commitPenalty` normalises against `max - median`, not `max - min`** (R-P16, a defect in this
  phase's own earlier R-P4). Measured: one out-of-arena candidate set `min` and made the commit
  bonus **2382 points against a sane-candidate range of 16** — hysteresis had become a latch pinning
  last tick's action. **The knob travels with its normaliser.** Because `median >= min`,
  `max - median` is smaller in EVERY scene, not only outlier ones, so the first step alone dropped
  the off-axis duel 94 -> 90 against a >90 bar; the values were re-scaled a uniform **1.8x**, from
  0.04/0.07/0.1 to **0.072/0.126/0.18**. The measured ratio was 2.2-2.5x, but the duel outcome is a
  step function with a narrow bad pocket at 0.204-0.215 (on-axis collapses 138 -> 24), and 0.18 sits
  mid-plateau clear of it.
- **`preferredRangeOf` (firing.ts) is solver-derived and breaks ties OUTWARD** — it takes the
  **farthest** range whose weighted total still clears
  `BRAIN_CONSTANTS.preferredRangePlateauFraction` (**0.95**) of the maximum. A strict tie-break
  returned `minEngageUnits` (70) for **every chassis at every tier**: `proxyValue` is monotonically
  **non-increasing** in distance across all ten `WEAPON_TABLE` rows and all 27 (row x tier sigma)
  sweeps — zero rises anywhere — so the maximum is a **PLATEAU** whose near edge is always the floor.
  **And the slot weights are only live because the bar is fractional**: under an exact tie the
  weights cancel out of the condition entirely (`total(r) == total(70)` iff every ready slot's own
  contribution ties), and the function degenerates to `min over ready slots of min(reach, cliff)` —
  a **veto by the shortest-reaching slot**, at full strength however small the personality's weight
  on it. Swept: weights are provably inert at >= 0.975, come alive at 0.970, and 0.95 carries 0.02
  margin while holding liveness down to 0.88. Resolved ranges, easy / medium / hard: **bullseye
  70 / 170 / 470, mirage 86.7 / 186.7 / 220, bastion 90.8 / 132.5 / 132.5**. R-D4 restored an
  explicit not-ready fallback (evaluate the plateau over ALL slots when no slot is ready), because
  with nothing ready every sample ties at 0 and the outward tie-break sent a reloading Bullseye to
  900 units. Bastion's medium/hard tie is a property of its kit, **not** of the sampling grid — a
  claim in task 4's own report that `step` explains it is FALSE and was measured false at every
  sample count from 12 to 96.
- **Spec P27's anticipatory evade is deleted in full** — the four gates, the refractory,
  `dangerEvadeFraction`, the controller field — exactly as plan 2's section promised. **What
  survives is the reading**: `dangerEvAgainst` still runs once per decision and `BotDebug.dangerEv`
  still reaches the playground overlay. Separately, **spec P40's reactive dodge had silently died**:
  deleting the eight-case situation switch deleted the only consumer of
  `shotThreats[0].awayHeadingRad`, so dodging a shot ALREADY IN FLIGHT stopped existing while three
  profile knobs and two `tiers.test.ts` tests still described it. R-P8 restored it as a **sixth
  scored term, `threatAvoid`**, weighted heavily in `evade` and at or near zero elsewhere.
- **The lag band-aid is gone and was replaced by something principled.** `compensateForLag`,
  `deadzoneFloorFraction` and `deadzoneCapMultiplier` were deleted with the desire model (R-D1), and
  the planner now plans **from the pose the input LANDS in** (dead time over
  `reactionDelayTicks + recomputeTicks`, capped by the horizon; R-P7c, accepted as an addition the
  measurements forced). That roll reads humanize's **real pending queue** — an earlier version
  doubled the committed correction and sustained a period-4 limit cycle.
- **The perf gate normalises against a reference workload measured in the same process** (R-PF2),
  not against an absolute millisecond figure. Evidence, 26 runs across three load conditions:
  absolute best-CPU spans **0.375-0.593 ms, a 1.58x spread with three NON-overlapping ranges**,
  while the median-of-five normalised ratio spans **692-790, a 1.14x spread with three OVERLAPPING
  ranges**; the reference workload itself varies 1.59x, so it is the machine that moves and the
  ratio cancels it. The gate asserts median plan-CPU / reference-CPU-per-`stepDrive` <
  790 * 1.3 = **1027 drive ticks per plan**, with the old absolute assertion demoted to a backstop
  (normalising alone is blind to `stepDrive` itself regressing). **The stated budget stays 0.33 ms**
  (`30 / 90`) and hard **misses it by 17-27%** — 0.385-0.422 ms isolated, 0.671-0.703 ms under full
  suite load — and it printed, not hidden.
- **Hard was NOT throttled to meet that budget** (R-PF3), and the reasoning is worth restating
  because the plan's own instruction was to throttle. `planDepth` is already 1, so the only dial
  left is K, and **K=22 is load-bearing**: round 5's commitment-window plateau is two ticks wide *at
  K=22*, so lowering K invalidates that sweep and the whole five-round convergence with it, and spec
  P34 states hard's K as ~22. Against that, P33's own arithmetic was mis-derived: it implies 0.2 us
  per `stepDrive` where the measured cost is 0.45 us, so **P33's stated worst case could never have
  fitted P33's own budget on this hardware**. Ninety plans a second at 0.4 ms is 36 ms, inside
  P33's headline "order 30 ms per simulated second"; in Practice and the playground, one bot each,
  it is 0.6% of a core. The cost of keeping the gate honest is real: it is ~5 s of every `npm test`
  and now the most expensive file in the server suite.
- **The headline behavioural measurement: the seeds 1-150 decisive-kill sweep reads 102/150**,
  against a recorded band of 23 / 17 / 12 / 18 / 21 / 22 — roughly **five times ABOVE it, not
  below**. The brief warned that a count materially below the band would be a behavioural signal;
  this is the same signal with the opposite sign, and it is what the phase set out to produce.
  **`balance/match.test.ts` was never reseeded on this branch** (116/116 green throughout, through
  every fix round). The flip side: at 68% decisive that fixture is now near-vacuous as a
  discriminator — it still pins what it was written to pin and no longer distinguishes much.
- **Quality bars, and one that was arithmetically impossible.** Hard's hit-rate ladder is strictly
  monotonic on all five sampled seeds — easy 0.273, medium 0.632, hard 1.000. TTK: hard Bullseye
  kills a stationary Mirage in 471 ticks (15.70 s) against a theoretical floor of 8.94 s and P49's
  2x cap of 17.87 s — 1.76x, inside the bar but with only 12% headroom on seed 17 and 5% on the
  worst of seven. R-T1 dropped the plan's `easy.fires > hard.fires` assertion per spec P50's own
  2026-09-05 correction. R-T1b re-derived P49's fire bar as `min(cadence, kit cooldowns)`: the
  plan's `300 / burstGapTicks / 4` = 25 ignores that Bullseye's three slots can physically produce
  only ~16 presses in 300 ticks, so the bar exceeded the kit's entire ceiling by 55%. Bar 4.05,
  measured 13.
- **Blunders are THREE kinds, not four** — `second-best`, `late-brake`, `hold-fire` (R-B1). The
  brief's fourth, `marginal-shot`, and P41's "misjudge range by ~15%" are **not expressible at the
  humanize seam**, which receives a finished `BotIntent`: an unconditionally-invisible kind would
  have silently weakened `blunderChance` by a quarter with no test able to see it. The comment names
  where each would actually live — `marginal-shot` at `chooseSlot`'s `minShotValueFraction`
  comparison, "misjudge range" on `preferredRangeOf`, both in `firing.ts`. `BLUNDERS` is now derived
  by `Object.keys` from a `Record<BlunderKind, true>` menu, so adding a union member and forgetting
  the list **fails to compile** rather than shipping dead code.
- **Housekeeping that closes earlier phases' loose ends.** `interceptPoint` was DELETED (R-K1) —
  plan 3's section said it becomes dead if plan 4 does not use it, and plan 4 does not, because
  `predictionHorizonTicks` (how far a shot flies) and `planHorizonTicks` (how far a bot thinks) are
  separate knobs, so even a K=0 bot aims through `physicsPredictor`. Six other newly-callerless
  helpers went with it. `duel.ts`, the extracted closed-loop duel harness, was renamed
  `duel.fixture.ts` (R-K3) to make its non-shipped status legible at the import site.
- **`movement.ts` survives as a SINGLE predicate, `wallAhead`, and its name has stopped describing
  it.** It was kept rather than deleted (`wallAhead` is an exact negation of `wallDesire`'s
  condition, so `pinned` -> `unpin` fires on bit-identical ticks; three provenance comments name the
  file; the netcode phases are expected to add movement helpers back on that seam). **The reviewer's
  standing note: a one-predicate file called `movement.ts`, under a header that has stopped being
  true, should not still be called that at the end of the phase.** Renaming it is unfinished work,
  deliberately left.

**Known gaps left standing.** The biggest is a real loss of flavour, not a deferral: **`brawler` and
`kiter` are archetypes ABOUT range, `standoffFraction` was their only lever, and
`opponentRangeRespect` does not carry it.** R-M1 claimed it did and was wrong in three measurable
ways — `opponentRangeRespect` is 0 / 0.45 / 0.9, so at **easy both brawler's x0.8 and kiter's x1.15
are exact no-ops** (easy's brawler and kiter now differ on `ramIntentChance` alone, and easy pins
`retreatHpFraction` at 0 too); at hard kiter's 0.9 x 1.15 = 1.035 **clamps to 1.0**, an ~11% shift
rather than 15%; and `fightRange = max(ownComfort, theirKeepOut)` **floors** the result at the bot's
own comfort range, so a lowered respect can never make brawler stand closer than a neutral bot,
whereas `standoffFraction` scaled that comfort itself. The doc comment now states exactly that; no
field was invented to fix it, because P35/P36 enumerate which fields arrive and an archetype range
knob is not among them. **After this phase there is no per-archetype range lever at all** — a
candidate for the user's next tuning pass. Also left standing: **easy's `planHorizonTicks: 0` is a
one-tick rollout in which no candidate expresses a manoeuvre**, so easy navigates only through
one-tick score margins (P29 and P34 both describe easy as exactly that, so this is the tier at the
edge of its competence rather than a break, but it is why the awareness radius had to move);
**near a wall, steering away is never selected** — wall avoidance is expressed only through the
throttle, because every braking candidate scores `wallPenalty` exactly 0, which is also why H39's
fixture had to compare the whole emitted input rather than the steer stream alone (commit `5e1eba4`,
flagged as outside sanction and accepted); **the runner-up snapshot is deferred, not forgotten** —
it was implemented, MEASURED to turn P50 red (medium's hit rate 0.632 -> 1.000 at seed 17, tying
hard), reverted, and documented in two places plus a test, with the doc comment softened to match
the code rather than the code strengthened to match the comment; **the P50 medium-to-hard rung now
sits at a 1.000 ceiling** and will be the first assertion to move on any humanize or planner change;
`this.lastPreferredRange` is now unconditional, so `recover` reads 0 where it used to hold the last
fight range (overlay-visible); and the overlay's `terms` line prints **raw** term values, not
weighted points, so a tuner reading them as points would misidentify the winning term. Finally, the
gaps the earlier sections already list are all still true, one of them materially worse:
**`BRAIN_CONSTANTS` is still outside `botFingerprint`** (`balance/fingerprint.ts` hashes only
`BOT_PROFILES` and `BOT_BRAIN_VERSION`) and this phase added `commitWindowFraction`,
`trajectorySampleCount`, `preferredRangePlateauFraction`, `preferredRangeSampleCount` and
`preferredRangeMinStepUnits` — every one of them behaviour-moving, on top of plan 3's five, so a
`BRAIN_CONSTANTS`-only retune still leaves two balance reports looking comparable when they are not;
`readinessOf` still reaches back only `memoryTicks` against 390-600-tick recharges; `observedFires`
is still not viewport-filtered; nothing holds `docs/bot-behavior.md` to the config the way
`scripts/turn-tuning-doc.test.mjs` holds `turn-tuning.md`; and `npm run typecheck` still fails on
`perception.ts:205` (`TS1354`), verified present at this branch's merge base and not this phase's.

**Playtest and balance, for the user to decide:** the nine resolved preferred ranges all moved, and
engagement distance and closing behaviour are what the **engagement-range and ram-trigger probes**
measure, so `npm run playtest` is worth a run. `npm run balance` is worth a fresh baseline across
all three tiers — `botFingerprint` has moved with `BOT_BRAIN_VERSION` 4.3.0 and correctly refuses a
4.2.0 comparison. Neither was run on the user's behalf.

---

## Things discovered while planning that the spec now records

Two spec corrections were made during plan-writing. They are noted here so a reader of an older
copy is not misled:

1. **P21 was wrong.** The first draft claimed the `fired` sink was disabled in every room and had to
   be enabled. All three bot hosts already wire it (`PlaygroundRoom.ts:424`, `PracticeRoom.ts:409`,
   `balance/match.ts:271`), and `perception.ts` already records every weapon fired, not only ults.
   Plan 2 is correspondingly smaller. Two stale comments in the codebase assert the opposite and are
   fixed in plan 2.
2. **P36's phase column and P58a/P58b were added** after the first commit, pinning which profile
   fields land in which phase and what `bot-tuner` owes beyond a find-and-replace.

One constraint discovered that the plans handle rather than the spec:

3. **`bot-profiles.test.ts`'s `LADDER` is `Record<keyof BotProfile, Direction>`** — exhaustive, so
   the compiler forces it updated whenever a field is added or removed. Its three directions are
   `"rises"` (strict), `"falls"` (strict) and `"equal"`. Two new fields are neither: `planDepth` is
   `1, 1, 2` and `targetBranches` is `1, 1, 3`. Plan 4 adds a `"rises-or-equal"` direction rather
   than distorting the values to fit the test.
