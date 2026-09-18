# Unity Physics Port — Execution State

> **Read this first in any session that executes one of these plans**, before the stage plan itself.
> It is the state file: where the work got to, what was measured, and which task is in flight.
>
> **The update rule, which is the whole point of this file:** update it **in the same commit** as the
> work it describes. A task's commit ticks that task's checkboxes in its plan *and* moves the block
> below. Nothing here is written from memory at the end of a session — a session can stop at any
> moment, and the last commit must already say where it stopped.

**Status as of 2026-09-18: stage 1 (the drive model) has landed.** The spec and all five stage plans
were written first; stage 1's eight tasks are now committed. Stages 2-5 have not started.

**Spec:** [`docs/superpowers/specs/2026-09-18-unity-driving-and-ram-physics-port-design.md`](../../specs/2026-09-18-unity-driving-and-ram-physics-port-design.md)
**Ledger:** [`interfaces.md`](interfaces.md) — outranks any one plan, is outranked by the spec.

## Starting a session

1. Read the in-flight block below. If it says *nothing in flight*, start at the first `Not started`
   row whose dependency is `Landed`.
2. **Verify it against git**, because this file is a claim and git is the fact:
   ```bash
   git log --oneline -8
   git status
   ```
3. Open that stage's plan and find the first unticked `- [ ]`. That is the resume point.
4. In a fresh worktree, `npm install` before the first build, or the build inlines the **main
   checkout's** shared `dist` and the server silently runs the wrong sim while every suite passes.

## In flight

*Nothing in flight.* Stage 1 landed (all eight tasks committed, `test(drive): pin tick-rate
independence; rebuild the guide` closing it), stage 2's first commit (restitution → 0) is in, and a
**whole-branch review of stage 1 has been swept** — see below. Next: stage 2, Task 1 onwards.

### Stage 1's whole-branch review, swept 2026-09-18

Two Critical findings and seven of lesser severity, fixed in one wave on top of `bb69f26`. The two
that change shipped behaviour:

- **`stepHold` double-counted steering yaw** (`sim/drive.ts`). Under U16 steering SETS `angVel`, and
  the branch kept the pre-port `steer * turnRate * mods.turnRate + body.angVel`, so a held car turned
  at twice its rate for the whole hold and kept turning after the key was released or while
  `steeringLocked`. Reachable via `lance`, a ~2.2 s `holdsDuringFire` beam. It also rebuilt its
  imposed slide at the NEW angle (the "on rails" behaviour this port deletes) and ignored `fullStop`.
  The coverage hole was that every HOLD case entered with `angVel: 0`, where the two yaw rules are
  the same arithmetic; six cases were added that enter one already turning.
- **The server's silent-player coast** (`server/src/sim/tick.ts`), replaced with an elapsed-silence
  gate. See the two rows under "Deferred, and who owns it" below for the detail and the consequences.

The rest were documentation and coverage: the fired `steeringGrip` trip-wires in the bot's
`planner.ts`/`objectives.ts` (re-derivation still owed, still stage 5 Task 8 Step 1 — no weight
moved); the "Rate while reeling" guard restored to `docs/turn-tuning.md` and its doc test, deleted on
a false premise; the `accel` channel's real behaviour written down (it scales the drag exponent too,
so it cancels out of top speed and stretches the time constant in BOTH directions — `reeling`'s 0.4
makes a ram's own knockback carry 2.5x further, 368 u); `channels.test.ts` proving `grip` properly and
naming `spinFree`/`ramBlocked` as declared ahead of use; and the spec's Changelog, slip formula and
`ChassisDrive` field count.

**Measured test state after the sweep** (root `npm run build`, `npm test`, `npm run test:scripts`,
all from the repo root):

- **shared green** — 54 files, 981 passed, 6 skipped (up 11 from stage 1's exit: the new HOLD-yaw
  cases and the `grip` channel proof).
- **client green** — 69 files, 1019 passed, 5 skipped. Unchanged.
- **`npm run test:scripts`: 1 red of 155** — `manual-page.test.mjs`'s stale-guide fingerprint, which
  stage 2's rebuild owns. Its computed stamp is `104b5f3c9e9fa7a6` **before and after this wave**, so
  nothing here moved `balanceStamp`; the sweep changed comments and prose only.
- **server: 16 red of 711** — the same count as stage 1's exit and the **same 16 cases as this wave's
  own starting point (`bb69f26`)**. Nothing moved: the four bot suites below (`predict.test.ts` 9,
  `controller.test.ts` 2, `planner.test.ts` 2, `tiers.test.ts` 2), plus `pipeline-order.test.ts`'s
  "charges the attacker with restitution AND its own contest impulse, not the reflection alone".
- **The composition differs from stage 1's exit by one swap, and neither half of it is this wave's.**
  `balance/match.test.ts`'s seed-1 ranking tie is **green again** at `bb69f26` and stayed green;
  `pipeline-order.test.ts`'s attacker-restitution case went **red** in that same commit (stage 2's
  restitution → 0), and stage 2 owns it. Measured red at `bb69f26` before any of this wave ran.

## Stages

| # | Plan | State | Gate |
|---|---|---|---|
| 1 | [`01-drive-model.md`](01-drive-model.md) | **Landed** | Asymptotic top speed; measurable slip angle; `stepDrive` reads no module-level rate; 30/60 Hz equivalence test green |
| 2 | [`02-walls-and-bumps.md`](02-walls-and-bumps.md) | Not started | Restitution 0; a car slides along a wall and never gains speed; the spike self-trigger re-measured |
| 3 | [`03-rams.md`](03-rams.md) | Not started | Attacker stops and locks; victim flung, spun, reeling; head-on stops both; `applyImpulse` has one production caller |
| 4 | [`04-slam-and-effects.md`](04-slam-and-effects.md) | Not started | `wildcharge` still clearly harder than the best ordinary ram; `ramLock` published to players |
| 5 | [`05-tune-and-reconcile.md`](05-tune-and-reconcile.md) | Not started | Playground pass done with the user; probes honest; fresh balance baseline; docs true |

## What is known before any of it runs

- **CORRECTED by stage 1 Task 8 (2026-09-18): the "three already-red tests" list immediately below
  was stale on arrival and is history, not a baseline to re-derive from.** A stage 1 task checked out
  the pre-work commit (`139f6a1`) directly and confirmed only ONE of the three was actually red there
  — `src/bot/brain/controller.test.ts`'s OFF-AXIS case. The other two were GREEN at `139f6a1`:
  `tiers.test.ts` P49 and `balance/match.test.ts`'s deathmatch-clock canary. The original claim (kept
  verbatim below for the record, struck through in spirit) named the wrong pair as already-red; do
  not cite it as this port's starting point. See "Stage 1 exit: measured test state" below for what
  is red now, which is a different list again — the drive model moved the bot (as expected) and, not
  originally expected, moved `balance/match.test.ts` back into a tie at its currently-pinned seed.

  ~~Three tests are already red on this branch, measured on 2026-09-18 at `139f6a1`, before any of
  this work ran:~~

  | Suite | Failing case |
  |---|---|
  | `src/bot/brain/controller.test.ts` | "keeps the body on the aim line when the target is OFF-AXIS" |
  | `src/bot/brain/tiers.test.ts` | P49, "hard fires at its preferred range rather than parking and weaving" — **was actually green at `139f6a1`** |
  | `balance/match.test.ts` | "shortening matchSeconds still lets the deathmatch clock fire, so a winner can appear" — **was actually green at `139f6a1`** |

  Everything else passes: 985 shared tests (53 files), 704 server (46 of 49 files), 69 client files.
  **Note this differs from the root `CLAUDE.md`, which names `tiers.test.ts` P50 as the third.** P50
  passes here; the deathmatch-clock canary is red instead. Trust this measurement over that prose.
  **This work does not fix any of them and must not silently re-pin them** — stage 5's `bot-tuner`
  pass is where the bot ones are addressed. Re-run and compare at the end of stage 5.
- **The worktree is wired correctly**: the server bundle inlines `// ../shared/dist/…`, not an
  escaped path, so `npm install` has already been run here.

### Stage 1 exit: measured test state (Task 8, 2026-09-18)

`npm install`, `npm run build` (root), `npm test` (root), `npm run test:scripts`, all from the repo
root, against this stage's final commit:

- **shared: green.** 54 files, 970 passed, 6 skipped (unrelated) — includes the new
  `sim/drive-rate.test.ts` (U7's 30-vs-60 Hz proof) and the six `tick.test.ts` re-pins' upstream
  fixtures.
- **client: green.** 69 files, 1019 passed, 5 skipped (unrelated).
- **`npm run test:scripts`: green.** 39 suites, 153 passed, 2 skipped (unrelated), 0 failed —
  includes `scripts/turn-tuning-doc.test.mjs` and `scripts/manual-page.test.mjs` (the rebuilt guide's
  fingerprint check).
- **server: 44 of 49 files green, 692 of 708 tests passed, 16 red — all 16 in five files:**

  | Suite | Red count | Cases |
  |---|---|---|
  | `src/bot/brain/predict.test.ts` | 9 | "carries a straight-line car forward, coasting off only slowly"; "curves a car that was observed turning, without any input"; "and the pre-rework scalar read would have been 76 units wrong — more than a car length"; "holds the observed speed, landing on the true path at every horizon and every speed"; "beats an engine-on rollout, worst of all where the target cannot move"; "holds a REVERSING car's speed, which zeroing the engine alone does not"; "beats a straight line wherever the target turns, and never loses where it does not"; "lets a sloppy read miss a curve entirely, and even read it backwards" (P20); "reads either side of the steering threshold, by how far the estimate falls short" (P20) |
  | `src/bot/brain/controller.test.ts` | 2 | "hunts a quadrant waypoint when it has never seen anyone, never the arena centre" (G12); "hunts toward a last-known pose, not the arena centre" (G12) — note the ORIGINALLY-red OFF-AXIS case is GREEN again at this stage's exit; the drive model moved which case fails, not just how many |
  | `src/bot/brain/planner.test.ts` | 2 | "finds a shot the arc SWEEPS through, not only the one it ends on" (R-P7); "does not let one out-of-arena candidate turn commitPenalty into a latch" (R-P16) |
  | `src/bot/brain/tiers.test.ts` | 2 | "hard changes course for an incoming shot and easy ignores it" (H25); "hard sidesteps an incoming shot compared to dodgeChance 0" (S13 evade) — note this is a DIFFERENT pair from the corrected pre-work baseline's P49, which is green again here |
  | `balance/match.test.ts` | 1 | "shortening matchSeconds still lets the deathmatch clock fire, so a winner can appear" |

  The first four rows are the bot-behaviour suites this stage's plan and brief both name as expected
  fallout (matches the Task 6/7 prediction of `predict.test.ts` 9, `controller.test.ts` 2,
  `planner.test.ts` 2, `tiers.test.ts` 2 exactly in count, though not case-for-case against the
  original pre-work baseline — see above). **Stage 5's `bot-tuner` pass owns all four; Task 8 did
  not re-pin any of them.**

  **`balance/match.test.ts` is a fifth, unnamed-by-the-brief red file, and worth flagging clearly:**
  its currently-pinned seed (1) comes back a legitimate 1-1 kills/deaths ranking TIE under the
  retuned drive model — `out.seats.some(s => s.kills > 0)` passes, only `out.winnerSessionId` is
  empty, exactly the failure SHAPE this exact test's own multi-paragraph reseed history has recorded
  and re-pinned around more than a dozen times before (every ram, bot and drive change that moved
  this one Mirage/Bastion matchup's dynamics has landed here). It is deterministic (re-run in
  isolation: same single case fails every time) and is not a clock defect — `hitClock` is never even
  reached because the kills line already tells the story. Re-seeding it (that file's own established
  fix) needs the same kind of seed sweep its history shows, which is balance-tuning work outside
  Task 8's file list (`tick.test.ts`, `drive-rate.test.ts`, `manual.html`, this file) and outside
  stage 1's plan. Left untouched and reported here rather than silently re-pinned or ignored — next
  to pick this up should either reseed it now (stage 1 did move its outcome) or fold it into stage
  5's tuning pass alongside the four bot suites above.
- **Every balance report from before this work is incomparable.** `configFingerprint` hashes
  `CAR_TABLE`, `DRIVE_CONFIG` and `RAM_CONFIG` whole; `BOT_BRAIN_VERSION` moves to `6.0.0` in stage 1.
- **`balanceStamp` does NOT hash `RAM_CONFIG`** but does hash `DRIVE_CONFIG`, the active `CAR_TABLE`
  rows, `STATUS_TABLE` and the guide's copy — so stages 1, 3 and 4 each owe `npm run build:manual`,
  and a ram-only retune does not.

## Measurements

Filled in as each stage lands. Each row is a number a later stage tunes against, so record the
command as well as the figure.

| What | Value | Measured in |
|---|---|---|
| Time to 90% of top speed, per chassis | Mirage 1.79 s, Bullseye 2.21 s, Bastion 2.59 s (`ln(10) / dragRate`) | stage 1 |
| Roll distance from top speed, per chassis | Mirage 147.1 u, Bullseye 152.3 u, Bastion 152.8 u (`maxSpeed / dragRate`) | stage 1 |
| Slip angle at full lock, per chassis (target ~35° at `lateralGripRate` 3.0) | Mirage 26.1°, Bullseye 23.6°, Bastion 21.2° — below the ~35° target because the formula is `atan(turnRate / (dragRate + lateralGripRate))`, not `atan(turnRate / lateralGripRate)` alone: each car's own `dragRate` adds to the sideways bleed, so a car with more `accel` corners tighter as a side effect (see `docs/turn-tuning.md#grip-and-drift`) | stage 1 |
| U7 30-vs-60 Hz equivalence, one second of full-lock turn+throttle on a synthetic `ChassisDrive` (`sim/drive-rate.test.ts`) | position delta 0.87 u (bound: `carWidth`/10 = 6 u); angle delta ~2.9e-15 rad (bit-exact — `turnRate * 1s` sums identically regardless of tick count); speed delta 0.0014 u/s. A same-length straight-line run (no steer) shows speed match to ~14 digits but a position delta of ~1.04 u — velocity is exactly rate-independent under the closed-form integrator, position is a first-order accumulation of it and is not, though it stays well inside the test's tolerance | stage 1 |
| How far a ram's shove carries a reeling victim (`grip: 0.6`, target ~2.2 car lengths) | — | stage 3 |
| Settled speed into a wall, self-driven, vs `SPIKE_CONFIG.triggerSpeed` | — | stage 2 |
| Reference flank ram: shove and spin (Bastion → parked Bullseye) | — | stage 3 |
| `wildcharge` slam against the best ordinary ram | — | stage 4 |

## Deferred, and who owns it

- **`DRIVE_CONFIG.flipSteeringInReverse` is OFF from 2026-09-18, and the predicate behind it is the
  thing to fix before it goes back on.** A playtest at `baseTurnRate` 1.0005 / `turnRatePerRating`
  0.02535 found the car juddering for about a second after releasing the throttle mid-corner — most
  of the time on Mirage, sometimes on Bullseye, never on Bastion. Cause: `steerSenseOf` asks "am I
  reversing?" by reading the car-frame FORWARD component of velocity, which was the car's speed
  before this port welded nothing to the nose, and is now `speed * cos(slip)`. A corner that swings
  the nose past sideways drives it negative at speed, it then sits on the `-reverseEpsilon`
  threshold, and the steering sense inverts and reverts several times a second. Reproduced exactly:
  **Mirage 12 sense flips, Bullseye 6, Bastion 0.** The shipped turn rates clear it by only 5 u/s, so
  this is latent rather than absent there, and any handling buff walks into it.
  **Candidates tested and REJECTED — do not re-propose these without new evidence:**
  - *Raise `lateralGripRate`* (3 → 4 clears it): a 5% turn-rate nudge brings it straight back, and
    the grip needed always lands steady-state slip at ~30°, so it silently caps the drift dial.
  - *A reverse-only drag knob*: needs ~50/s against a normal drag of 1.28, is non-monotonic (more
    drag sometimes made it worse, because it parks the value ON the threshold), and at that strength
    it destroys real reversing.
  - *An alignment test* (`|lateral| < |forward|`): still 8 flips — a spin-out sweeps the velocity all
    the way round, so it passes through aligned-backwards anyway.
  - *A speed gate*: spin-out and genuine reverse occupy the same speed range, and at higher turn
    rates the ranges cross over entirely. **No threshold on velocity MAGNITUDE can work.**
  **The fix that does work is intent:** `throttle === -1 && forward < -reverseEpsilon`. Stateless, no
  schema change, measured clean on the spin-out and correct on a genuine reverse. Its one cost is
  that releasing reverse while still rolling backwards un-flips the sense once — today that case
  chatters 7 times, so it is an improvement either way. A latched variant removes even that, but the
  latch must BE the sense: keeping `forward < -reverseEpsilon` as a live per-tick term re-inherits the
  chatter (measured worse than stateless), and the latch needs a networked schema field to satisfy
  invariant 8.
  **Also noticed while measuring, and NOT a bug:** pressing reverse while sliding backwards
  accelerates you backwards instead of stopping you. That is the intended control scheme — one pedal
  per direction, each doubling as the other's brake — confirmed by the project owner. What is worth a
  look in the tuning pass is that the two directions do not stop equally hard: forward braking uses
  the authored `CarDef.brakeDecel`, backward braking uses ordinary forward engine thrust, which is
  1.4x weaker on Mirage, 2.1x on Bullseye and 2.4x on Bastion — and that backward figure is
  `topSpeed * dragRate`, so nobody ever chose it and it moves every time top speed is tuned.
- **Ram spin is currently completely INERT — a rammed car does not tumble at all. Stage 3 owns it.**
  `packages/shared/src/sim/impulse.ts`'s `applyImpulse` still accumulates spin into `body.angVel` and
  clamps it to `RAM_CONFIG.spinMaxRate`, exactly as before; but under U16 the ordinary `stepDrive`
  branch OVERWRITES `angVel` from the steer input on the very next tick, and the only thing that
  preserves an injected spin is `mods.spinFree`, which nothing sets until stage 3 wires it through
  `reeling`. So every ram's spin lives for zero ticks of driving. `chassis.spinPerTick` is the
  matching placeholder (1, the identity) until the same stage sets
  `RAM_CONFIG.reelingSpinDecayRate`. Two tests pin the degenerate reality rather than hiding it:
  `tick.test.ts`'s "zeroes a coasting car's angVel on its first stepped tick, and never rotates it"
  (renamed from "carries every knock component, not just shove", which by the end of stage 1 asserted
  the negation of its own name) and `drive-vector.test.ts`'s "keeps its spin while spinFree and
  erases it the moment control returns".
- **A silent knocked player used to freeze holding 96% of the shove; that is FIXED, and the fix is a
  behaviour change stages 2-5 should know about.** `serverTick`'s coast gate was `hasKnock`, which
  read `lateralOf(vx, vy, angle)` against `stopEpsilon` on the premise that `steeringGrip` was 1.0 —
  a constant this port deletes — so a shove along the victim's own heading was invisible to it and a
  re-pinned `tick.test.ts` case measured the residual moving from 8.06 u/s to **287.423 u/s** across
  stage 1 (300 u/s shove, one tick of drag, then frozen). The whole-branch review replaced the
  predicate with elapsed silence (`NET_CONFIG.silentCoastGraceMs`, `hasMotionToResolve` in
  `sim/tick.ts`), because the client never steps a tick it did not send an input for and no property
  of the body can distinguish imposed motion from drift under this model. **Consequences for later
  stages:** the server now steps a genuinely-absent player's car to rest whatever pushed it, and
  `packages/server/playtest/collision.ts`'s scenarios 4 and 5 both measure that path and will report
  different numbers — their comments say so, and stage 5's probe-honesty task should re-read them.
- **`packages/server/playtest/collision.ts`'s energy-gain sweep** computes its predicted flip angle
  from `atan(sqrt(DRIVE_CONFIG.restitution))`, which is zero once stage 2 lands, so the probe sweeps
  nothing. Stage 5 owns rethinking it — not re-aiming it.
- **`DRIVE_CONFIG.dashSubstepMaxUnits` 16 → 8**, inherited from the 2026-09-06 car-physics rework's
  stage 2. Untouched by this port; stage 5 judges it with the user.
- **`wildcharge.impulse.speed` (520) and `uncontrolMs` (1400)** were provisional before this work and
  still are. Stage 4 makes their doc comments true; stage 5 pitches the numbers.
- **The netcode rewrite's phase 1 plan is stale** — its fixtures still name `speed`, `shoveX`,
  `shoveY` and `authority`, deleted by the car-physics rework's stage 1. Not this work's to fix, but
  whoever starts that rewrite must refresh it against the model this port leaves behind.

## Decisions that bind

- The spec's §2 decisions U1–U11 were put to the user and answered. **Do not re-litigate them**, in
  particular: pure Unity drag (launch and roll are one number), drift replacing the "no wash" rule,
  diminishing returns kept, the slam keeping its own rules, and 30 Hz now.
- **Grip is two knobs, not Unity's one** (U10 as revised, spec §5): `DRIVE_CONFIG.lateralGripRate`
  3.0 is the driver's drift, and `reeling`'s `grip: 0.6` multiplier is how far a shove carries a
  victim. The user chose this over a Unity-faithful single rate after seeing that one number could
  not serve both. **There is no `gripless` flag** — an earlier draft of the spec had one.
- **Turn radius is uniform across the roster on purpose, for now** (~89.9 u on all three). The user
  was shown two spreads and chose to revisit it in stage 5's tuning pass. Do not widen it silently.
- **The frozen `RAM_TICKS` table is fixed in stage 3** (U40), so stage 5's ram duration sliders are
  live. It was a real bug predating this work, not something the port introduced.
- **This work supersedes the 2026-09-06 car-physics rework's stage 5 and its parked restitution
  stage.** Stage 5 of THIS plan set records that in the rework's own `EXECUTION.md`.
- Tuning is the user's call. An agent proposes numbers and measures them; it does not decide what the
  game should feel like.
