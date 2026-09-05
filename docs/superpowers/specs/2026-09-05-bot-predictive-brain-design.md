# Bot predictive brain — design

**Date:** 2026-09-05
**Status:** approved, not yet implemented
**Supersedes:** the move and shoot layers of
[`2026-09-05-bot-situation-play-design.md`](2026-09-05-bot-situation-play-design.md) (S13's per-play
heading switch, S15's slot ranking). Keeps that spec's assess layer and situation catalog.
**Extends:** [`2026-09-04-human-like-bot-behavior-design.md`](2026-09-04-human-like-bot-behavior-design.md)
(H1–H48). H21's stream-alignment rule and H8's "a behaviour is code, a tier is data" are load-bearing
here and are strengthened, not relaxed.

---

## 1. The problem

The bot does not read as a player. Reported: a hard bot takes far too long to kill a **stationary**
target, does not attack most of the time, and its shots go everywhere. The purpose of the bots is to
give a human a player-like sparring partner and to give the balance harness player-like data; neither
is served today.

Reading `packages/server/src/bot/brain/` finds three separable causes.

### 1.1 A hard bot cannot fire at the range it chooses to stand at

In `fight`, once inside its deadband, `controller.ts` adds an orbit desire and `blendHeading`
averages it with the aim heading. At hard's `orbitBias: 0.35` against `GOAL_WEIGHT: 1` the blended
heading sits `atan2(0.35, 1) = 0.337 rad` (19.3°) off the target. `chooseSlot` refuses any shot with
`|aimDelta| >= fireConeRad`, and hard's cone is `0.2 rad` (11.5°).

**19.3° > 11.5°, permanently.** Throttle is 0 in the deadband, so the bot parks at its preferred
range, weaves, and holds fire — indefinitely, against a stationary target.

The bug is tier-shaped, which is why hard does not feel harder than medium: medium
(`orbitBias 0.2` → 11.3°, cone 20°) fires normally; easy (`orbitBias 0`) fires normally.

### 1.2 The same offset breaks hard's aim assist

Lock acquisition requires the target within `AIM_CONFIG.lateralMax` (120 units) of the centreline.
Hard's Bullseye stands at roughly `0.7 × 789 = 553` units; `553 × sin(19.3°) = 182 > 120`. Medium at
~434 units and 11.3° gives 85, inside. **Medium keeps its predator lock and hard drops it.**

Nothing in the brain models the lock rules at all, so nothing notices.

### 1.3 The fire gate is not a hit prediction

`fireConeRad` is an angular tolerance with no relation to whether a shot connects. At 553 units a car
subtends about `0.058 rad`; hard's `0.2 rad` cone is **3.5× wider than the target**. The bot is
authorised to fire at angles that geometrically cannot hit. "Shots all over the place" is that,
literally.

### 1.4 Nothing plans

`blendHeading` sums desire vectors — the classic averaging failure, where two good options average to
a bad third. There is no lookahead anywhere. Every layer is a one-tick reflex with noise applied on
top, which is why the result reads as random rather than calculated.

**§1.1–1.4 are derived from reading the code, not from running it.** P54 makes demonstrating §1.1
the first implementation task.

---

## 2. The insight this game turns on

Most shipped FPS bot architectures separate aiming from moving, because in an FPS those are two
actuators — mouse and keyboard.

**Here they are one actuator.** Every shot fires along `player.angle` unless aim assist holds a lock
(`aimAngleFor`). A skilled player of this game is therefore managing a tension no FPS bot faces:
*point at him to shoot, or point where I need to go*. Skilled play is finding arcs where those
coincide, and timing the trigger for the instant the nose sweeps across.

The current brain does the one thing guaranteed to fail at that — it averages the two into a single
heading and satisfies neither. §1.1 is a symptom of that architecture, not an accident of tuning.

---

## 3. Goals and non-goals

### Goals

- **G1.** Easy plays like an amateur, medium like an experienced casual, hard like a highly skilled
  player. The tiers differ in *kind* (reflex vs. planning), not only in magnitude.
- **G2.** Every bot action is explicable. "Why did it do that?" is answerable from the overlay.
- **G3.** Balance data stays honest: no cheating, and the harness can tell tiers apart on a real
  metric.
- **G4.** The bot presses every weapon in its kit, `wildcharge` included.

### Non-goals

- **N1.** Habit modelling — learning that *this player* dodges right. Explicitly excluded by the
  user. `targetBranches` (P28) hedges across what the controls permit, which is not the same thing.
- **N2.** Machine learning of any kind. No training step, no weights file.
- **N3.** Changing the drive model, hitbox model, collision-damage rules or friendly fire. This spec
  reads the sim; it does not modify it.
- **N4.** Pathfinding or navmeshes. `arena-01` has no obstacles and `wallDesire`'s successor handles
  `arena-02`'s.

### Fairness (the user's ruling, 2026-09-05)

- **P1.** Cheating is *obtaining information a human player cannot obtain*. Input reading is cheating.
- **P2.** Cooldown tracking is **not** cheating: a skilled player tracks ability availability
  approximately. The bot may remember observed fires and estimate readiness from the weapon table.
- **P3.** Running the real physics forward on an observed opponent is **not** cheating — it is a
  player's internalised model of how a chassis corners.
- **P4.** `BotView` remains the whole of what a bot may know. `inputQueues` and `prevFireMasks` stay
  structurally unreachable from `decide`, so P1 is enforced by the type system rather than by
  discipline.
- **P5.** State a human infers rather than reads (`angVel`, `authority`, `shoveX/Y`, `reverseHold`)
  must be **inferred from observed motion**, never taken from the wire. See P17–P20.

---

## 4. Architecture

```
perceive   (every tick)   — extended: cooldown tracking, angular-velocity estimation
predict    (NEW)          — roll self and target forward through the real stepDrive
assess     (unchanged)    — facts → one situation → one play
plan       (REPLACES move)— candidate steer×throttle, rolled K ticks, scored
fire       (regated)      — one slot, chosen by expected value, not by an angle
humanize   (every tick)   — reshaped blunders
```

### New modules

| Module | Job |
|---|---|
| `brain/predict.ts` | Roll a car forward N ticks via `stepDrive` + `driveOf`. Self and target. |
| `brain/solution.ts` | The solver. "Does slot *i* have a shot on car *j* from pose *p*, and what is it worth?" Runs both directions. |
| `brain/planner.ts` | Enumerate the 9 actions, roll each K ticks, score, emit `steer`/`throttle`. |

### Deleted

**P6.** The entire desire-vector model in `movement.ts` — `Desire`, `blendHeading`, `goalDesire`,
`orbitDesire`, `dodgeDesires`, `reduceToIntent`. The averaging *is* §1.1; there is no variant of it
without that failure mode. `wallDesire`, `openFloorHeading`, `nearBound` and `reverseWouldHitBound`
survive, demoted to planner score-term helpers.

### Kept

`situation.ts` (strategy), `goals.ts` (target choice), `roles.ts`, `personality.ts`,
`perception.ts` (extended), `humanize.ts` (blunders reshaped, P41). `aim.ts` keeps `signedDelta` and
`stepAimError`; `interceptPoint` is superseded by `predict.ts` but survives as the `K = 0` cheap path.

---

## 5. The solver (`brain/solution.ts`)

**P7.** One function, both directions:

```ts
solve(shooter, slot, target, tick) → FiringSolution

interface FiringSolution {
  hitChance:      number; // 0..1, integrated over the shooter's own aim error
  expectedDamage: number; // pellets/pulses that connect, including splash
  value:          number; // expectedDamage / cooldownSeconds — EV per second of gun time
  aimHeadingRad:  number; // where to point for the best chance
  readyInTicks:   number; // 0 when ready now
}
```

**P8. The exact method.** For each quadrature offset (P43): spawn the shot's shape at the muzzle
(`muzzleOf`), march it with `stepInstance` until `instanceExpired`, `smear` from the previous pose,
and test `shapeHitsObb` against `carHullOf(...)` at the target's **predicted** pose for that tick.
`hitChance` is the weighted fraction that connect. This is the real geometry, reusing the sim's own
helpers rather than approximating them.

**P9. Exact for the trigger, proxy for the planner.** P8 costs roughly 90 shape tests per slot —
affordable once per tick for the fire decision, ruinous inside a planner evaluating 9 candidates
across K ticks. The planner therefore uses a **cheap analytic proxy**: predicted angular subtense at
time-of-flight versus aim σ, plus range fit. Roughly 20 flops.

This split is deliberate and mirrors how people play: **move on intuition, shoot on confirmation.**
The planner steers toward approximately good positions; the trigger pulls only on exactly good shots.

**P10. Four solver shapes cover nine weapons.**

| Shape | Weapons | Handling |
|---|---|---|
| Projectile | `predator`, `magmablast`, `roadblock` | March and test |
| Pellet fan | `pepperbox` | Per-pellet `fanOffset`; sum connectors |
| Beam | `lance`, `afterburner`, `tremor` | Short march; count pulses via `weaponTicksOf().damageInterval` |
| Maneuver | `thunderclap`, `wildcharge` | The "shot" is the car — roll self through the dash, hull vs. hull |

**P11.** The maneuver row is what finally lets a bot press `wildcharge` (G4), closing a distortion
the balance harness currently documents.

**P12. Splash counts.** `magmablast`'s expected damage includes the detonation — the detached
centre-origin disc beam that `instanceDefOf(id, true)` synthesizes — so its EV exceeds its
direct-hit chance. A shell whose value ignored its explosion would be systematically under-ranked.

**P13. The solver models aim assist.** For `usesAimAssist` weapons, `aimAngleFor` sends the shot at
the target's position regardless of nose direction — *if the lock holds*. The solver must therefore
evaluate `inAcquireRegion` / `inRetainRegion` (20° cone, 120 lateral, per-weapon range) and report a
near-certain `hitChance` inside a live lock. Correspondingly the planner scores **"will I keep the
lock"** (P26) rather than "is my nose on him". Nothing in the brain knows these rules today, which is
the mechanism of §1.2.

**P14. Expected value, never raw probability.** `value = expectedDamage / cooldownSeconds`. A 35%
`predator` shot on a 1 s cooldown outvalues a 90% `lance` on 16 s. The tier knob is a **minimum EV
threshold** (`minShotValue`, P36), so an amateur fires at anything and a skilled bot only takes shots
that pay for the gun time.

**P15.** P14 is also what prevents phase B making the bot *passive*. A gate on raw hit probability
would mute a bot whose predictor is still crude; a gate on EV keeps cheap fast-recharging guns firing.

**P16. Direction C is the same call with the arguments swapped.** `solve(them, their slot, me, tick)`
yields `dangerEV` — damage per second the bot is currently exposed to. Two unknowns on their side:
their aim error (assume a fixed nominal — the bot assumes competence) and their readiness (P21). The
planner minimises `dangerEV`, so *"break his lance line"* emerges from arithmetic rather than from a
hand-written case.

---

## 6. Prediction (`brain/predict.ts`)

**P17.** Rolling a car forward requires a `SimBody`. Split by what is actually visible:

- **Self** — every field is on the bot's own HUD or derivable from it. Exact.
- **Target** — `x, y, angle, speed, maneuver` are drawn on screen and already in `BotCarView`.
  `angVel`, `shoveX/Y`, `authority` and `reverseHold` are **not** numbers a human reads.

**P18.** The bot infers `angVel ≈ Δangle / Δt` from recent observations and assumes the remainder
neutral. This satisfies P5 and is simultaneously the human-ness mechanism: a person sees a car
spinning, not its `angVel` field.

**P19.** A consequence worth keeping rather than fixing: the inference is **reliably wrong just after
a ram**, when `authority` is suppressed and shove is decaying while the bot assumes neutral. Bots
therefore mispredict knocked cars. That is a very human error, obtained for free.

**P20. Estimation noise is a tier knob.** `stateEstimationSigma` (P36) perturbs the inferred `speed`
and `angVel` per observed target per recompute. Reading exact `speed` off the wire each tick is the
one grey area under P1 — a human eyeballs it — and this knob is the answer.

**P21. Cooldown tracking.** `observedFires` is documented as *"Empty when the host does not collect
combat events, which is every room today"*, so the bot cannot currently track cooldowns at all
despite P2 permitting it. The `fired` sink must be enabled for bot-hosting rooms; perception records
`(sessionId, weaponId, tick)` and estimates readiness against the weapon table, decaying with
`memoryTicks`. Approximate and forgettable — the skilled player's version, not the wallhack's.

**P22.** Prediction horizon for the target is the planner's K, so a `K = 0` tier predicts nothing and
falls back to `interceptPoint`'s constant-velocity solve.

---

## 7. The planner (`brain/planner.ts`)

**P23. The action space is complete.** `InputMessage.steer` and `.throttle` are each `-1 | 0 | 1`, so
enumerating all 9 combinations is exhaustive, not a sample. There is no discretization error anywhere
in this design.

**P24. Receding horizon.** Each candidate is held for K ticks, rolled through the real `stepDrive`,
scored, and the best one's *first* action is emitted. Re-planned every `recomputeTicks` — so hard
revises at 15 Hz while planning 0.7 s ahead. Standard MPC: plan a long arc, execute its first step.

**P25. Depth is a number.** `planDepth: 1` holds one action for K ticks; `planDepth: 2` splits into
two K/2 segments (81 branches). Depth 2 is what buys *"swing wide now so the nose sweeps him as
predator comes off cooldown."* No module branches on the tier name (H8).

**P26. Score terms.**

| Term | Direction | Source |
|---|---|---|
| `myEV` | maximise | proxy solver (P9) on the best ready slot from the future pose |
| `theirEV` | minimise | proxy solver, swapped (P16) |
| `rangeError` | minimise | distance vs. solver-derived preferred range (P31) |
| `wallPenalty` | minimise | `wallDesire`/`nearBound` successors; heavily weighted |
| `lockKeep` | maximise | will an assisted slot still hold its lock (P13) |
| `commitPenalty` | minimise | hysteresis against last tick's chosen candidate |

**P27. The situation supplies the weights.** `fight` weights `myEV`; `reset` weights `theirEV` and
range; `unpin` weights `wallPenalty` enormously; `punish` weights closing; `waitOut` uses hunt terms
only. `situation.ts` stops choosing headings and starts choosing *objectives*. The eight-case
`switch` in `controller.ts` collapses into one weight table, and the planner becomes the single place
objectives become `steer`/`throttle`. **That is the structural fix for §1.1: there is no longer
anywhere for two headings to be averaged.**

**P28. Target-input hedging.** `targetBranches: 1` assumes the target holds its apparent current
input. `targetBranches: 3` rolls a fan of their possible inputs and scores the **worst case**. A
skilled bot therefore does not walk into a dodge. This is a minimax over what the controls permit,
**not** habit modelling (N1).

**P29. `K = 0` skips the rollout** and scores the 9 candidates one tick out. Still avoids a wall it is
about to hit; cannot plan an arc. This is the amateur tier, and it is also the perf escape hatch
(P33).

**P30. Hysteresis is not optional.** A planner re-picking every 2 ticks on noisy scores chatters —
the classic MPC failure, and *"it twitches"* would be the first bug report. `commitPenalty` is a
first-class knob, not a tuning afterthought. P43's smooth scoring is the other half of the answer.

**P31. Preferred range becomes solver-derived.** Today `preferredRangeOf` is
`standoffFraction × weighted reach` — a guess. It becomes **the range at which this kit's EV peaks**,
which the solver can answer directly. This alone addresses "it fights at the wrong distance", and it
makes a hard Bastion and a hard Mirage finally play differently.

**P32. Orbiting becomes emergent.** With `orbitBias` deleted (P35), the planner circles when circling
scores better than closing. The skilled bot's orbit is then *correct* rather than a bolted-on weave
that breaks its own aim.

**P33. Perf is a gate, not an assumption.** Worst case (hard, depth 2, K=22): roughly 1600 `stepDrive`
calls, ~320 proxy evaluations and ~60 target-rollout steps per plan, at 15 plans/s/bot. Six bots is
order **30 ms of CPU per simulated second**; a 20-match balance run (~2400 sim-seconds) would gain
roughly a minute. **Phase D must measure this against a stated budget.** If it misses, K and
`planDepth` come down and nothing else changes.

---

## 8. Tiers

**P34.** Three portraits, which the numbers must reproduce:

- **Easy — amateur.** `K = 0`, no lookahead. Fires whenever roughly pointed at the target (low EV
  threshold → sprays and misses, which is *correct* for this tier). Does not lead. Fights at whatever
  range it drifted into. Pins itself on walls. No cooldown awareness. Dumps the ult the moment it is
  up. Slow to notice, slow to react.
- **Medium — experienced casual.** `K ≈ 8`, one level. Takes decent shots and some bad ones. Leads
  from real physics but assumes the target holds its input. Rough cooldown awareness. Reacts to
  threats; does not pre-empt them. Rotates through its kit.
- **Hard — highly skilled.** `K ≈ 22`, depth 2, hedges across the three inputs. **Only takes shots
  that pay.** Positions for the shot it is *about to have*. Knows the lock envelope and keeps it
  deliberately. Tracks cooldowns and attacks the window. Breaks firing lines by arithmetic rather
  than by dodge roll.

**P35. Removed from `BotProfile`** — replaced by mechanism, not by another number:

| Gone | Because |
|---|---|
| `fireConeRad` | The gate is EV now, not an angle (§1.3) |
| `fireDisciplineChance` | The EV threshold *is* discipline |
| `aimToleranceRad` | The planner emits `steer` directly; no heading-error deadzone remains |
| `leadFactor` | Superseded by real forward prediction |
| `standoffFraction`, `deadbandFraction` | Preferred range is solver-derived (P31); hysteresis moves to `commitPenalty` |
| `orbitBias` | Deleted outright (P32) |

**P36. Added** — first-pass values, expected to move under playtesting. The **Phase** column is
normative: a field does not exist in `BotProfile` until its phase lands, which is what makes P56's
"two migrations" concrete.

| New field | Phase | easy | medium | hard |
|---|---|---|---|---|
| `minShotValue` — EV needed to pull the trigger | B | 2 | 12 | 26 |
| `stateEstimationSigma` | A | 0.25 | 0.10 | 0.03 |
| `planHorizonTicks` (K) | D | 0 | 8 | 22 |
| `planDepth` | D | 1 | 1 | 2 |
| `targetBranches` | D | 1 | 1 | 3 |
| `commitPenalty` | D | 0.1 | 0.4 | 0.8 |

Phase C adds no profile field: cooldown tracking reuses `memoryTicks`, and the `theirEV` weight is
`opponentRangeRespect`, which already exists (P38).

**P37. `aimErrorSigmaRad` gains a principled meaning.** It is now the σ the solver integrates over, so
**a bot with shaky hands correctly declines long shots** — it knows its own hands are shaky. Easy
does not merely miss more; it misses more *and does not realise*, because its EV threshold is low.

**P38. `opponentRangeRespect` is repurposed, not removed.** It becomes the per-tier **multiplier** on
the planner's `theirEV` term. "How much does this bot respect danger" was always what it meant.

The two sources of a score weight do not conflict, and the order is fixed: **the situation supplies
the base weight vector (P27); the profile then scales individual terms.** Only two terms are
profile-scaled — `theirEV` by `opponentRangeRespect`, and `commitPenalty` by its own field. Every
other weight in P26 comes from the situation alone and is identical across tiers. A tier must not be
able to change *what* a situation is for, only how strongly it feels one of two pressures.

**P39. Everything else stays**: all of perception, target politics, `burstGapTicks`, ult discipline,
blunders, fidget, `hearChance`, `deadRespect`, `cornerRespect`, `situationCommitTicks`,
`slotStickTicks`, `retreatHpFraction`, `ramIntentChance`.

**P40. The reactive dodge knobs stay.** Dodging a shot *already in flight* (`dodgeChance`,
`dodgeReactionTicks`, `dodgeHorizonTicks`) is a different reflex from avoiding a *potential* firing
solution (P16). The design keeps both.

**P41. Blunders are reshaped.** `applyBlunder` currently inverts `steer`, which reads as a spasm
rather than a mistake. A human error is *plausible*: commit to the planner's second-best candidate,
misjudge range by ~15%, take a shot the solver rated marginal, brake late. Same `blunderChance`
knob, believable output.

**P42. Expect hard to fire noticeably less often than today, and hit vastly more.** Fewer, deadlier
shots is what P14 buys. This must be stated in `docs/bot-behavior.md` so it is not reported as a
regression.

---

## 9. Determinism and observability

**P43. The solver and planner draw zero random numbers.** The solver integrates over aim error using
**fixed quadrature points** — 7 offsets at set quantiles of the normal with fixed weights
(Gauss–Hermite), not Monte Carlo samples. Better on three axes at once:

1. No `rng()` consumption, so no H21 stream-alignment hazard in the hottest new code.
2. Cheaper than sampling for equal accuracy.
3. **`hitChance` is a smooth function rather than a noisy estimate.** A noisy score function is
   precisely what makes a receding-horizon planner chatter, so this addresses P30 at the root instead
   of patching it downstream.

**P44.** Randomness stays where it already lives — aim-error drift, blunders, personality roll,
target score noise, dodge rolls, ult discipline — plus one new fixed draw per observed target per
recompute for `stateEstimationSigma` (P20). Fixed counts, per H21.

**P45. Observability is a phase-D deliverable, not a follow-up.** A mis-weighted score function reads
as *confidently* wrong, which is worse than random, and cannot be debugged by watching a car drive.
`BotDebug` extends to carry the chosen candidate, **its per-term score breakdown**, the runner-up,
`myEV` / `theirEV`, and the trigger's EV against its threshold.

**P46.** Playground overlay becomes roughly:

```
kiter | fight | plan(+1,+1) 8.4 | ev 24/26 | slot 0
```

Playground only, gated by `DEV_TOOLS` as today. Practice mode stays clean.

**P47. `BOT_BRAIN_VERSION` → `4.0.0`**, bumped once per phase (`4.0.0`, `4.1.0`, `4.2.0`, `4.3.0`) so
each phase's balance reports are correctly refused as baselines for the next.

---

## 10. Testing

**P48. Solver ground-truth — the strongest guarantee in this design.** When the solver claims
`P(hit) = 0.8`, the test **runs the real sim** — `spawnInstances`, `stepInstance`,
`resolveInstanceHits` — across the same quadrature offsets and confirms the shots land at that rate.
This tests that the solver is honest *about the real game*, not merely self-consistent. It is
possible only because every sim function is importable.

**P49. The reported symptoms, pinned permanently.** Three assertions, each stated as a *relation*
rather than an absolute so that later tuning cannot silently invalidate them:

- **Time to kill a sitting duck.** A hard bot facing a **stationary**, non-firing target at 400 units
  kills it in no more than **twice** the theoretical floor for its kit — where the floor is
  `hpOf(target) / bestSustainedDpsOf(kit)`, computed from the same tables `npm run ttk` reads. Stated
  as a multiple of a derived quantity, so a weapon retune moves both sides together.
- **The §1.1 lockout, nailed shut.** Over 300 ticks in `fight` at its preferred range against that
  same target, a hard bot's fire count is **greater than zero** — and, more tightly, at least
  `300 / burstGapTicks / 4`. The weak form is the regression guard; the tight form is the quality bar.
- **The ladder holds.** Hit rate `hard > medium > easy`, and shots fired `easy > medium > hard` (P50).

`P54`'s throwaway probe supplies the *before* numbers for all three, so each assertion lands with a
measured baseline beside it rather than a guessed constant.

**P50. Tier characterisation, rewritten.** `tiers.test.ts` today can only compare *within* a tier,
because a harder tier steers more in any scene. With EV there is finally a cross-tier metric:
**easy fires most and hits least; hard fires least and hits most.** That is the ladder, testable.

**P51. Determinism.** Same seed → same intent stream, all three tiers, with and without threats
present. Plus a test that stubs `rng` to throw, proving solver and planner never touch it (P43).

**P52. Perf gate.** A bench asserting plan cost stays inside the P33 budget.

**P53.** The existing brain suite (~1200 lines) is substantially rewritten:
`controller.test.ts`, `movement.test.ts`, `firing.test.ts`, `tiers.test.ts`. `perception.test.ts`,
`goals.test.ts`, `roles.test.ts`, `situation.test.ts`, `personality.test.ts` survive with additions.

**P54. First implementation task is a throwaway probe demonstrating §1.1** — a hard bot against a
stationary target, logging `aimDelta` against `fireConeRad` — so the fix lands on a measured bug
rather than a deduced one. Labelled throwaway; not committed.

---

## 11. Phasing

Approved order, which is the topological order of the dependency graph:

```
B (hit-probability gate)  ──┬──> C (shot-denial = B inverted)
   independent, biggest win │
                            └──> D (planner: scores on B and C)

A (physics prediction)    ─────> D (shares rollout code)
   independent, wasted without B
```

| Phase | Contents | Docs + skill owed in the same commit (P58b) | Notes |
|---|---|---|---|
| **B** | `solution.ts` (P7–P15), EV fire gate, `minShotValue`, **and the §1.1 orbit fix** | `bot-tuner`: drop `fireConeRad`, `fireDisciplineChance`, `aimToleranceRad`, `orbitBias`, `standoffFraction`; add `minShotValue` + the EV-ratio diagnostic (P58a.3, P58a.4); delete the dead closing invariant. `bot-behavior.md`: hands + fire-economy tables, P42 warning. `balance/README.md`: P57. | The orbit fix must ride here: B is meaningless while the body sits 19.3° off. Uses the existing `interceptPoint` predictor. |
| **C** | Direction-C threat evaluation (P16), cooldown tracking + `fired` sink (P21) | `bot-tuner`: `opponentRangeRespect` re-documented as the `theirEV` multiplier (P38). `bot-behavior.md`: judgment table. | Nearly free once B's geometry exists. Adds no profile field. |
| **A** | `predict.ts` (P17–P22), replacing `interceptPoint` behind the same interface | `bot-tuner`: drop `leadFactor`, add `stateEstimationSigma`. `bot-behavior.md`: aim table. | Clean swap; solver quality rises without the gate changing shape. |
| **D** | `planner.ts` (P23–P33), `movement.ts` deletion (P6), situation-as-weights (P27), overlay (P45), perf gate (P33) | `bot-tuner`: the third factor (P58a.1), the inverted weave row (P58a.2), planner knobs. `bot-behavior.md`: pipeline diagram, positioning table. | The largest and riskiest phase. |

**P55.** Each phase bumps `BOT_BRAIN_VERSION` and invalidates prior balance baselines. Four phases is
four invalidations; that is the accepted price of stepping.

**P56.** `BotProfile` changes shape twice — at B (`fireConeRad` → `minShotValue`) and at D (planner
knobs). Two small config migrations rather than one.

---

## 12. Downstream obligations

**P57.** `packages/server/balance/README.md` documents *"the bot cannot press `wildcharge`"* as a
known distortion. Phase B's maneuver solver (P10, P11) makes that statement **false**; the README is
corrected in the same commit.

**P58.** `docs/bot-behavior.md` is rewritten — the parameter tables, the pipeline diagram, the
"Reading a complaint" map, and P42's warning.

### P58a. `bot-tuner` needs surgery, not a find-and-replace

`.claude/skills/bot-tuner/SKILL.md` names **six fields this spec deletes** (`fireConeRad`,
`fireDisciplineChance`, `aimToleranceRad`, `leadFactor`, `standoffFraction`, `orbitBias`), which
breaks **6 of its 10 complaint rows** and its closing invariant (*"`aimToleranceRad` must stay below
`fireConeRad`"* — both fields gone). The rewrite must also make four changes that a mechanical
substitution would miss:

1. **A third factor.** The skill sorts complaints into *judgment* vs *hands*. Planning is a new axis
   — `planHorizonTicks`, `planDepth`, `targetBranches`. "It doesn't set up its shots" belongs to
   none of the existing two.
2. **"Weaves / moonwalks" inverts.** Today the answer is `orbitBias`. After P32 weaving is either
   emergent and correct (leave it alone) or planner chatter (P30 — raise `commitPenalty`). Same
   complaint, different mechanism, opposite fix.
3. **A wider escape hatch.** The skill currently says stop tuning when the overlay shows the wrong
   *situation*. The common post-rework case is the right situation with a low EV ratio — the bot
   correctly declining shots it cannot make. The skill must distinguish *"`minShotValue` is too
   high"* (tune) from *"the solver is wrong about this weapon"* (bug, stop).
4. **A new primary diagnostic.** P46's overlay carries `ev 24/26` and the per-term plan score, which
   answers most complaints directly. The skill's method changes from "name the factor from the
   symptom" to "read the EV ratio and the score breakdown first". That is an upgrade to how the
   skill works, not a patch to its table.

**P58b. The docs and the skill are updated in the phase that breaks them, never at the end.**
`bot-tuner` is a skill: it fires automatically on any "the bot feels wrong" phrasing. Left stale
after phase B, it would confidently propose edits to `fireConeRad` — a field that no longer exists —
for the entire duration of phases C and A. Each phase therefore carries its own doc-and-skill edit
in the same commit as its code, matching P36's phase column. This is a correctness obligation, not
tidiness.

**P59. Playtest probes must be flagged loudly, per `CLAUDE.md`.** This change alters driving, firing
cadence and engagement range, and makes the bot press `wildcharge` for the first time — reaching ram
trigger rates and weapon-reach measurements. The specific probes and numbers are to be named during
implementation once read, with a `npm run playtest` run **recommended, not performed**: running it is
the user's call.

**P60. Not touched.** `docs/turn-tuning.md`, `manual.html` / `npm run build:manual`, and the art
checks. No drive-config, weapon-table or car-table value moves in this spec.

---

## 13. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Planner perf blows the balance harness budget | P33 states the budget and measures it in phase D; K and `planDepth` are the dial, `K = 0` the floor |
| 2 | A mis-weighted score function reads as *confidently* wrong — worse than random | P45's per-term overlay is a phase-D deliverable, not a follow-up |
| 3 | The nine-weapon hit predicate is the fiddliest part and the main schedule risk | P10 collapses nine weapons to four shapes; P48 proves each against the real sim |
| 4 | Planner chatter | P43 (smooth scores) plus P30 (`commitPenalty`) — two independent defences |
| 5 | Phase B alone makes the bot feel passive | P14/P15: the gate is EV, not raw probability, so cheap fast guns keep firing |
| 6 | A stale `bot-tuner` proposes edits to deleted fields between phases — it fires automatically, so this misleads without being asked | P58b: docs and skill are edited in the phase that breaks them, in the same commit as the code |
