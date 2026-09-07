# Planner facing term — design

**Date:** 2026-09-07
**Status:** design approved (implementation follows this document)
**Extends:** [`2026-09-05-bot-situation-play-design.md`](2026-09-05-bot-situation-play-design.md)
and the planner phase that followed it. Nothing there is superseded: S1–S28 stand, `PlanWeights`
gains a seventh term and `objectives.ts`'s `BASE` gains a column.

Decisions here are numbered **F1–F14**.

---

## 1. The problem

The 2026-09-06 car-physics rework's heavy-car pass cut `baseAccel`/`accelPerRating` 420/7.2 ->
60/1.4, stretching time-to-forward-cap from 0.44-0.57 s to 1.49-2.16 s. Hard's plan horizon is 22
ticks — 0.73 s. **The horizon crossed a regime boundary**: it used to sit past both speed caps, and
now sits short of them, so the drive model's acceleration constants govern the rollout where its
speed constants used to.

Under the old numbers, forward's cap (1.54x the reverse cap, via `reverseSpeedRatio` 0.65) made
forward travel further over any horizon anyone planned across. Under the new ones,
`reverseAccelFactor` governs — and it was 1.41, so every chassis covered 1.29x more ground
*reversing* than driving forward. `throttle: -1` beat `throttle: 1` on `rangeError` unconditionally,
on every chassis, and the bot moonwalked.

`reverseAccelFactor` 1.41 -> 0.6 (2026-09-07, commit `40191c6`) fixed the immediate inversion and
three of the five failing bot tests. **It did not fix the fragility**, which is the subject of this
document.

**F1. The planner scores position and expected value. It never scores orientation.** `rawScore`
(`planner.ts:869`) combines six terms — `myEv`, `theirEv`, `rangeError`, `wallPenalty`, `lockKeep`,
`threatAvoid`. Every one is about where the car IS or what it can SHOOT. None is about where it
POINTS, independent of what it can shoot from there.

**F2. Turning is therefore pure cost.** A turning candidate covers less ground than a straight one
(Bullseye over 22 ticks: 34.6 u straight, 15.0 u turning), so it loses on `rangeError` — the
largest-magnitude term in the score — and gains nothing anywhere. The bot collapses to straight-line
inputs whenever a straight line scores at all.

**F3. That the bot turned at all before was an accident of the drive numbers, not a property of the
score.** This is the finding that motivates the work. The planner was resting on a coincidence: that
forward happened to be the fastest way to cover ground. A drive retune flipped it once and can flip
it again, silently, because nothing in the score asserts the preference the old numbers supplied.

---

## 2. What the term is

**F4. The missing quantity is nose-versus-travel alignment, not nose-versus-objective.** Both
readings are natural in English and they behave OPPOSITELY in the scenes that fail. Nose-versus-
objective is:

- **Redundant.** Pointing at the target is already paid for by `myEv` (per-slot firing solutions are
  built from the car's real pose) and by `lockKeep`.
- **Wrong for the failing case.** In `controller.test.ts`'s dodge scene the bot sits at (100, 100)
  angle 0 with its target at (400, 100). Its nose already points dead at the target, so a
  nose-versus-objective error is **zero at `steer: 0`** — the term would reinforce the input the
  test is failing on rather than move it.

Nose-versus-travel says the thing nothing else says: **orientation is future options.** A car
pointing where it is going can keep going. A car pointing backwards relative to its travel is
committed to a slow reversal, and a receding-horizon planner that only scores the terminal POSITION
cannot see that cost. That is precisely the quantity a short horizon loses.

**F5. `facingError` is the misalignment between the terminal velocity and the terminal heading**,
stated as one formula so there is nothing left to interpret:

```
speed = speedOf(vx, vy)
facingError = speed <= DRIVE_CONFIG.stopEpsilon
  ? 0
  : (1 - forwardOf(vx, vy, angle) / speed) / 2
```

`forwardOf / speed` is the cosine of the angle between velocity and nose, so the term is **bounded
in [0, 1]**: `0` driving straight ahead, `0.5` sliding exactly sideways, `1` reversing. The rest
band is `DRIVE_CONFIG.stopEpsilon`, the same constant the sim already uses to decide a car counts as
stopped — not a second threshold invented here (hard invariant 2: no magic numbers in logic).

**F6. It is computed through `sim/velocity.ts` and nowhere else.** `forwardOf(vx, vy, angle)` and
`lateralOf(vx, vy, angle)` already give the decomposition. That module is the sanctioned home of the
world-frame/car-frame conversion — five open-coded copies of it existed before the vector-drive
rework and one was silently wrong for sideways motion — so this term must not re-derive the
projection inline.

**F7. It is an angle-like quantity, normalised by speed — never a distance.** The existing terms
already span three magnitude regimes (`rangeError` ~302, `threatAvoid` ~20, `wallPenalty` ~0.004),
each with a hand-tuned weight compensating. A seventh term measured in world units would add a
fourth regime and make the weight table harder to reason about, not easier. Normalising by speed
keeps the term bounded and scale-free.

**F8. At rest the term is 0, not undefined.** This is the whole answer to the reference-direction
problem. A nose-versus-objective term needs a defined objective, and `recover` and `evade` may have
none — `targetAt` falls back to the car's own pose, leaving the direction undefined and the term
injecting noise. Velocity is always defined; a car at rest is trivially not mis-aligned. **No
situation needs a special case**, and that is a positive reason to prefer this formulation, not
merely a convenience.

---

## 3. Where it is measured

**F9. At the terminus, with `rangeError` and `threatAvoid`.** The planner already distinguishes
terms that ask about a MOMENT (taken as a best or worst anywhere along the arc) from terms that ask
where the arc LEAVES the car. Facing is the second kind: it describes the pose the plan hands to the
next plan. A maximum or mean over the arc would punish the transient mid-turn misalignment that
every good turn necessarily passes through — which would penalise turning, the exact behaviour this
term exists to make affordable.

**F10. It reads the same terminal `SimBody` the other two terminal terms read.** No new rollout, no
new sample, no extra candidate. The rollout already carries `vx`/`vy`/`angle` at every path index.
The planner's per-plan cost is unchanged in shape, which keeps `planner.bench.test.ts`'s budget
intact — a horizon change was ruled out for exactly that reason.

---

## 4. The weights

**F11. Eight new numbers in `objectives.ts`'s `BASE`, one per situation.** The seventh column. The
term is subtracted, like `rangeError` and `wallPenalty`.

**F12. Kiting situations get a deliberately low weight.** `fight` and `reset` are where a ranged
chassis correctly backs off toward its preferred range with its guns on the target — observed in
H39's open-floor run, where the enemy sits 200 units away against a preferred 470. **This term must
not forbid that.** A high weight there would trade one wrong behaviour for another, and a global
constant (the rejected "penalise reverse" approach) could not express the difference at all. That is
the reason this is a per-situation weight and not a `BRAIN_CONSTANTS` scalar.

**F13. `waitOut` gets the highest weight.** Hunting is where facing your travel IS the play: a bot
crossing the arena toward a heading it has committed to should arrive pointing where it is going,
because what it does on arrival is fight. This is the situation whose two G12 tests named the
defect.

**F14. The existing 48 weights are perturbed and must be re-measured, not assumed.** They were swept
against each other with six terms. Adding a seventh changes every situation's balance. The
implementation re-runs the suites and the duel fixtures, and reports what moved; it does not assume
the old numbers still sit at their optima.

---

## 5. Verification, and what is deliberately left open

**The two remaining failures are not both promised.**

- **H39** (`tiers.test.ts`) is expected to pass. Near the wall a forward escape is blocked by
  `wallPenalty` at weight 2400 while on open floor it is free, so once reversing carries a cost the
  two runs should choose differently and the streams diverge. The test's `tailGoal` assertions
  already pass — `unpin` fires — so only the input comparison is at stake.
- **The dodge test** (`controller.test.ts`) is genuinely open. Reversing IS the correct perpendicular
  escape in that scene: the shot falls down the line x=110, the car sits at x=100, and the escape
  axis is ±x, which is the car's own nose axis. Penalising reverse may simply produce a worse dodge.

**If the bot plays well and an assertion still fails, the assertion is what changes.** The bot is not
to be bent to satisfy a test whose discriminator the physics rework invalidated. Any such rewrite is
brought back for approval rather than made silently — this is the (a)/(b) fork that motivated the
work, and it does not fully disappear just because (b) was chosen.

**`BOT_BRAIN_VERSION` 4.4.0 -> 4.5.0.** Behaviour changes without `BOT_PROFILES` moving, which is
exactly the case the version exists for. Balance reports across the bump are not comparable and the
harness's `--baseline` flag will refuse the comparison.

**Recommend a `npm run balance` run and a `npm run playtest` run after landing.** Neither is part of
the suite; both are the user's call, not a step taken on their behalf.
