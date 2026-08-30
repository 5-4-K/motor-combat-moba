# Online Netcode & Client Architecture — Consolidated Design

**Date:** 2026-08-30
**Status:** design settled by debate; constants provisional; nothing implemented
**Target:** competitive fairness at **80 ms RTT**, honest degradation to 130 ms, functional to 250 ms
**Supersedes:** `docs/ideas/cursor-architecture-proposal.md` and
`docs/ideas/online-netcode-and-client-architecture-spec.md` — both are inputs to this document, not
authorities. Where they disagreed, §2 records which won and why.

---

## 0. How this document was produced, and what that is worth

Two agents each took one proposal and argued it against the other, with a rule that every claim name
a file, a constant, a measured number, or a citable source. Twelve points of disagreement were
identified (C1–C12). Nine resolved on evidence, two are split with a stated condition that selects
the branch, one is a balance decision reserved for the user.

**Both source documents were written against a game that does not exist.** Establishing that was the
single most productive hour of the exercise, and it is why neither doc could simply be adopted:

| Assumed by both docs | Shipped reality | Consequence |
|---|---|---|
| 3v3 with respawn, spawn immunity, score | Last-player/team-standing elimination | A death is permanent for the round, so latency errors are punished harder, not softer |
| 60 Hz sim | `TICK_RATE_HZ = 30`, `DEFAULT_PATCH_RATE_HZ = 20` | Every tick-denominated figure in both docs was wrong |
| Arena ≈ 3190 × 1794, 5.5 s to cross | **1280 × 720, `obstacles: []`**, 2.2 s to cross | Every "world units" error figure understated its impact by ~2.5× |
| TTK 4+ seconds | **Fastest kill 0.7 s** (`npm run ttk`) | The Cursor doc's central premise inverts — see §1.1 |
| Greenfield ("this repo is empty") | v1 shipped: prediction, reconciliation, interpolation, aim assist with LOS all live | Several "proposals" are refactors of working code and must be priced as such |

Every number below is measured from the repo or cited to a source. Claims that are **not** yet
verified are collected in §8 and are marked as work items, not conclusions.

**The document's confidence is uneven, and it is worth knowing which parts earned it.** C1, C2 and
C4 were each attacked hard from both sides and survived with their numbers corrected. C12 was
**revised three times** — graded FAIL, then softened by a `startUpMs` field neither session had read,
then inverted entirely when hit tolerance turned out to be a second and opposite exposure metric — and
every one of those moves was triggered by the reader pushing on something both sessions had already
signed off. Sections that were never challenged (§3.2's protocol layout, §3.4's server loop, §6.3's
hosting case) are *not* thereby more reliable; they are simply untested. Treat agreement between two
analysts as weaker evidence than a claim that survived an attack.

### 0.1 What the user decided

Asked directly, and load-bearing for what follows:

- **Match shape:** both modes eventually — elimination first, a respawn brawl later. Netcode is
  therefore designed against the stricter case (elimination), and the respawn mode inherits it free.
- **Tick rate:** open to 60 Hz.
- **Physics:** the velocity-vector drive and sequential-impulse solver are **authorized** (this opens
  the `CLAUDE.md` "stop and ask" fence on the drive model, hitbox model, and collision-damage rules).
- **Effort:** no calendar constraint — "produce the right architecture and its build order."
- **Transport:** no constraint on replacing Colyseus; pick what is correct.
- **Geography:** one region, same country.
- **Hosting topology:** undecided, recommendation requested (§6.3).
- **Cheat model:** unsure, build so it can grow. Read as a **structural constraint**: any client-side
  authority granted must be revocable without a rewrite. This shapes §4.3 and §4.4.

---

## 1. The measurements the design rests on

### 1.1 The roster is faster and deadlier than either doc assumed

Resolved from `CAR_TABLE` × `DRIVE_CONFIG`:

| Chassis | Max speed | Accel | Turn rate | Lateral accel `v·ω` |
|---|---|---|---|---|
| Mirage | 576 u/s | 1032 u/s² | 4.20 rad/s | **2419 u/s²** |
| Bullseye | 414 u/s | 744 u/s² | 3.41 rad/s | 1411 u/s² |
| Bastion | 315 u/s | 564 u/s² | 5.35 rad/s | 1686 u/s² |

Hull is 48 × 32. Arena is 1280 × 720.

**The dominant acceleration term is steering, not throttle.** At speed, `v·ω` for Mirage is 2419 u/s²
against a throttle authority of 1032. Both source documents reasoned about prediction error using
throttle figures (~800 u/s²) and consequently understated worst-case error by roughly 6×. Every error
figure in this document uses the steering term.

Time-to-kill, measured (`npm run ttk`, damage ceilings assuming perfect contact):

```
attacker \ defender    Mirage(480hp)  Bullseye(300hp)  Bastion(820hp)
Mirage                     1.0 s          0.7 s           5.8 s
Bullseye                   3.5 s          1.7 s           7.1 s
Bastion                    3.2 s          1.2 s          13.0 s
```

The Cursor doc argued 80 ms is acceptable because "80 ms is about 2% of a 4 s life," explicitly
contrasting with "~10% of a 0.8 s twitch TTK" as the disqualifying case. At a 0.7 s fastest kill,
**80 ms is 11% — the game is in the category its own proposal said it was not in.** That argues for
more aggressive netcode, not less, and it is why this design predicts remote cars rather than
displaying them late.

### 1.2 There is a live bug in the shipped interpolation buffer

`NET_CONFIG.interpolationDelayMs: 50` against a 20 Hz patch rate — a 50 ms patch interval. The buffer
holds **exactly one patch of slack**, and `InterpolationBuffer.sample()` freezes rather than
extrapolating past the newest snapshot by documented design. Steady-state render time therefore sits
exactly on the newest snapshot's timestamp, and **jitter tolerance is zero by construction.**

Simulated against the real `sample()`/`prune()` logic, 60 fps over 30 s, percentage of frames showing
a frozen remote car:

```
buffer      jit 5  jit 10  jit 15  jit 25  jit 40
--- 20 Hz patch (SHIPPED) ---
 50 ms *      0.2     0.2     7.9     8.3    14.4
 67 ms        0.2     0.2     0.2     0.2     3.2
100 ms        0.3     0.3     0.3     0.3     0.3
--- 30 Hz patch ---
 50 ms        0.2     0.2     0.2     0.2     4.5
--- 60 Hz patch ---
 50 ms        0.2     0.2     0.2     0.2     0.2
* = shipped configuration
```

The shipped cell is the only failing cell. At 15 ms jitter every remote car freezes on ~8% of frames.
**This is not a latency problem — it reproduces identically at 20 ms ping with the same jitter.** The
standard rule it violates is the one Source encodes in its `cl_interp` default: buffer ≥ 2 × patch
interval, plus a jitter margin.

This is **P0 and independent of every architectural decision below.** The fix is one constant —
`interpolationDelayMs: 50 → 67`, not the textbook 100 — for the reason set out in §5.1.

### 1.3 Metric one — flight time, which clears the floor everywhere except one row

There are **two** independent exposure metrics and each ranks the roster differently. This is the
first; §1.3.1 is the second, and using this one alone was the longest-standing error in this analysis.

A projectile whose flight time is shorter than RTT cannot be made fair by any netcode, because the
disagreement window is the entire engagement. Measured against `AIM_CONFIG.lockRange` (400 u), the
honest mid-range engagement in a 1280-wide arena:

| Weapon | Speed | Time to 400 u | vs 80 ms RTT | Lead needed vs full-speed crosser |
|---|---|---|---|---|
| thumper | 450 | 889 ms | 11.1× | 512 u (10.7 hulls) |
| bulwark | 492 | 813 ms | 10.2× | 468 u |
| pepperbox | 800 | 500 ms | 6.3× | 288 u |
| fireball | 900 | 444 ms | 5.6× | 256 u |
| skewer | 1000 | 400 ms | 5.0× | 230 u |
| needler | 1300 | 308 ms | 3.8× | 177 u |
| afterburner | 1100 | 200 ms at its 220 range | contact weapon | — |
| shockwave | 1500 | 100 ms at 150 radius | aura; 3 waves 250 ms apart telegraph it | — |
| **lance** | **6000** | **67 ms** | **0.8×** | 38 u |

The distribution is **bimodal, not marginal**: eight weapons clear the floor by 3.8–11.1×, and
`lance` sits alone below one RTT. There is no cluster near the threshold to argue about, so **no
general balance action is needed on this metric** — the roster already honours a constraint nobody
wrote down, and that should be stated plainly so it is not "fixed" later. `lance`'s exception is also
mitigated in its own row: `startUpMs: 700` is a real sim-side wind-up, **8.75× the RTT bar**, so the
victim's decision window is enormous and only the final commitment is instant.

The "lead needed" column is the reassuring one: a fireball needs 5.3 hulls of lead against a
full-speed crosser. **For eight of nine weapons, aim error dominates netcode error by an order of
magnitude.**

### 1.3.1 The second metric: hit tolerance, which ranks the roster the opposite way

**Flight time is the wrong metric for the shooter's problem, and using it alone was this analysis's
longest-standing error.** The two metrics measure different people:

- **Flight time** measures *the victim's ability to react* — how long they have to leave the shot's
  path once it exists.
- **Hit tolerance** measures *the shooter's exposure to prediction error* — how far the target can be
  from where the shooter saw it before a hit becomes a miss.

Tolerance is the perpendicular half-width of the projectile plus the perpendicular half-extent of the
car (16 u nose-on, 24 u broadside):

| Weapon | Half cross-section | **Tolerance** | Manual zone (beyond `lockRange`) | Per shot |
|---|---|---|---|---|
| needler | 3 (`radiusAcross`) | **19–27 u** | 400–850 u (53% of reach) | 22 dmg / 0.6 s |
| **skewer** | **5** | **21–29 u** | 400–650 u (38%) | **110 dmg / 6 s** |
| pepperbox | 6 | 22–30 u | 400–600 u (33%) | 45 × 3 / 1.8 s |
| fireball | 12 | 28–36 u | 400–900 u (56%) | 50 / 2 s |
| thumper | 15 | 31–39 u | 400–550 u (27%) | 60 / 3 s |
| **lance** | **28.75** | **45–53 u** | 400–1200 u (67%) | 170 / 16 s |

Against a worst-case prediction error of 40.9 u (§4.1), **`lance` has the largest hit tolerance in the
game.** The weapon flagged by the flight-time metric is the one best protected on this one — its 2.5×
rect already put it there. The two metrics rank the roster in opposite orders and both are real.

**Why a locked shot is not exposed to position error.** Inside `AIM_CONFIG.lockRange` the client
extrapolates, runs the shared aim-assist on its predicted positions, picks a target and presses fire;
the input lands for `T_gen`; the server runs *the same* aim-assist on its true positions and **spawns
the shot at its own angle.** The shot therefore points at wherever the target actually is. Client
prediction error changes what the client *drew*, not where the shot *went*, and C11's blend absorbs
the visual difference. **The lock is self-correcting under server authority** — which is the mechanism
by which shipped games put auto-aim on fast projectiles.

**But this relocates the failure rather than removing it, and the replacement is categorical.** The
angle self-corrects; **target choice does not.** A 40 u prediction error can flip which candidate wins
the lock score when two are close, and the server then fires at *a different car entirely* — not a
slightly-off shot, a completely different shot. It is rare and C4 bounds it to one tick, but it is
highly visible ("I was aiming at that guy"), and it is a different failure class rather than an
absence of one. See the steal-margin constraint in C4.

Position exposure is therefore confined to the **manual zone** — reach beyond 400 u, plus the three
weapons with `usesAimAssist: false`. There the exit angle comes from the shooter's own car, the
best-predicted object in the game, so the disagreement is purely the target's position.

**That zone is not an edge case.** Measured against each weapon's own reach:

```
weapon      assist  range   band beyond lockRange
lance        true    1200   800 u  = 67% of its reach unassisted
fireball     true     900   500 u  = 56%
needler      true     850   450 u  = 53%
skewer       true     650   250 u  = 38%
pepperbox    true     600   200 u  = 33%
thumper      true     550   150 u  = 27%
afterburner  false     220   n/a — contact weapon
shockwave    false     150   n/a — aura
bulwark      false     492   no assist at all, but a 60° cone is its own tolerance
```

**27–67% of every assisted weapon's reach is unprotected**, and the band is largest on `lance` — two
thirds of its range has no lock and therefore no self-correction. In a 1280 × 720 arena, `lockRange`
is only 31% of the width, which makes long-range poking plausible rather than exotic. This is why
§8's "what fraction of shots are fired beyond `lockRange`" is **the single load-bearing unknown in all
of C12**: if most shots land inside 400 u, exposure is near zero and "change nothing" is clearly
right; if players routinely poke from 600 u, a third to two thirds of shots are unprotected and the
conclusion changes.

**The exposed weapon is `skewer`, not `needler` and not `lance`.** Needler's tolerance is thinner but
it fires every 600 ms for 22 damage, so error averages out across many shots. Skewer is thin *and*
single-shot *and* 110 damage *and* on a 6 s cooldown — the one combination where a single mispredicted
41 u puts a high-stakes shot into empty space with no second attempt. Pepperbox is quietly protected
by its own geometry: a 12° spread across 3 pellets is ~84 u wide at 400 u, so **the spread is
tolerance**.

### 1.3.2 The ping band where this actually bites

The error is **exactly zero unless the target changes input inside the window**, so this is a joint
condition on latency and behaviour rather than a latency threshold. Solving
`2419·((RTT + 50)/1000)² = tolerance` for `skewer`, the thinnest high-stakes row:

| What the target does in the window | RTT at which worst-case error exceeds tolerance |
|---|---|
| Holds input (most ticks) | **Never** — error is 0 at any ping |
| Throttle change | ~97 ms (nose-on) → ~123 ms (broadside) |
| Starts a turn | ~82 ms → ~105 ms |
| Full steering reversal at top speed | ~43 ms → ~60 ms |

Those are Mirage at top speed. The term is `v·ω`, so Bullseye's reversal crosses at ~72–93 ms,
Bastion's at ~62–81 ms, and **any car at half speed pushes every threshold up by ~1.4×**. For
contrast, `lance` does not cross until ~86–98 ms *even on a full reversal at top speed*.

Reading the band:

- **Below ~43 ms nothing crosses in any combination.** LAN play is unaffected entirely.
- **43–80 ms:** only a full steering reversal by a fast car crosses, and only on the thinnest weapons.
  That is someone actively juking — the game working, not the netcode failing.
- **~80–120 ms is the band that matters**, where an *ordinary* manoeuvre becomes enough. The 80 ms
  target sits at its front edge.
- **Above ~120 ms** routine driving crosses tolerance on thin weapons, consistent with §4.1's 126 ms
  crossover and supporting the same degrade-and-warn threshold.

Two reasons real exposure is narrower than the table:

1. **Only the perpendicular component can cause a miss.** The table assumes all 40.9 u is
   perpendicular. Longitudinal error is nearly free — skewer's `radiusAlong: 22` means an error along
   the flight path just makes the hit early or late.
2. **C8 reduces this error as a side effect — by roughly a quarter, not by an order of magnitude.**
   The shipped model applies steering instantaneously
   (`angle += (steer · turnRate · authority + angVel) · dt`), so a reversal is an instant Δω of
   `2·turnRate` — exactly where the 4838 u/s² worst case comes from. C8's converge-angular-velocity
   model ramps ω over `ANG_ACCEL`. At 60 Hz with ~2-tick convergence (τ ≈ 33 ms) inside a 130 ms
   window, displacement scales by roughly `((W − τ/2)/W)²` ≈ **0.76, about a 24% reduction.** Real,
   worth having, and a second argument for C8 that neither source doc made — but **not a solution to
   the error budget**, and it must not be counted on as one.

### 1.4 How much jitter margin the input buffer actually needs

This is the measurement that sizes `T_gen`, and therefore sizes C1's error. Model: the client targets
a server-side buffer occupancy of `M` ticks; each input packet carries redundant copies of the
previous 8 inputs (§3.2); input for tick `T` survives if any packet carrying it arrives un-lost with
excess delay ≤ `(M − k)` ticks, against a heavy-tailed delay distribution. 200k ticks per cell.

```
% of ticks with NO fresh input (server falls back to repeat-last)
                    jit10/0%  jit25/0%  jit25/1%  jit25/3%  jit50/3%
--- 30 Hz sim ---
M=1  ( 33 ms)          0.00      4.87      5.53      7.69     11.04
M=2  ( 67 ms)          0.00      0.02      0.02      0.26      0.89
M=3  (100 ms)          0.00      0.00      0.00      0.00      0.04
--- 60 Hz sim ---
M=1  ( 17 ms)          3.23      8.48      9.34     11.05     49.52
M=2  ( 33 ms)          0.00      0.46      0.42      0.89      5.31
M=3  ( 50 ms)          0.00      0.02      0.02      0.04      0.52
M=4  ( 67 ms)          0.00      0.00      0.00      0.00      0.04
```

Three things follow, and all three are load-bearing:

1. **`M = 1` is not viable at either rate.** The Spec doc's "target input-buffer occupancy: 1–2 ticks"
   is too optimistic at the low end — it starves 5–11% of ticks at realistic jitter. **The floor is
   `M = 2` at 30 Hz and `M = 3` at 60 Hz.** Note that 60 Hz `M = 1` reaches 49.5% starvation at
   jit50/loss3: a finer tick is *more* fragile at low margin, because the margin is quantised in
   ticks.
2. **This is the strongest argument for 60 Hz, and neither source doc made it.** At 30 Hz the minimum
   viable margin is 67 ms; at 60 Hz you can buy 50 ms and get *better* starvation numbers. Finer ticks
   let you purchase precisely the slack required instead of overshooting to the next tick boundary —
   **17 ms less extrapolation window at lower starvation, worth ~11 u of C1 error.**
3. **Input redundancy is what makes any of these numbers survivable.** Compare the `jit25/0%` and
   `jit25/3%` columns: 3% packet loss barely moves them, because the next packet carries the lost
   input. It is the cheapest reliability win in the protocol.

---

## 2. The twelve decisions

### C1 — Remote cars: predict all six through the shared step ✅ *(Spec doc)*

**Decision.** Every car, local and remote, is advanced through the shared `stepSim` with
repeat-last-input for unacknowledged remote ticks. Not per-entity dead reckoning — the full step, so
contacts inside the unknown window are predicted too. Interpolation of remotes is deleted.

**Why.** Both models displace a remote from truth. The comparison must be made honestly, and an
earlier draft of this analysis got it wrong in prediction's favour by omitting a term.

**The extrapolation window is `RTT + jitterMargin`, not RTT.** Under C5 the client generates input for
`T_gen`, which sits ahead of the server by the margin, so the unknown-input window includes it. And
the margin cannot be set to taste — §1.4 measures the floor. At the recommended 60 Hz sim with a
3-tick margin the window is **130 ms**, not 80 ms:

```
INTERPOLATION (staleness = one-way latency + buffer), at 80 ms RTT
  sim 30 / patch 20  ->  buffer 100 ms  ->  stale 140 ms  ->  81 u = 1.68 hulls behind
  sim 60 / patch 30  ->  buffer  67 ms  ->  stale 107 ms  ->  62 u = 1.28 hulls
  sim 60 / patch 60  ->  buffer  33 ms  ->  stale  73 ms  ->  42 u = 0.88 hulls

PREDICTION (error = ½ · Δa · t²), window 130 ms at 80 ms RTT + 50 ms margin
  no input change in the window ................  0 u
  throttle change ............................ 16.3 u  (0.34 hulls)
  straight -> full steer ..................... 20.4 u  (0.43 hulls)
  full steer reversal (worst) ................ 40.9 u  (0.85 hulls)
```

**So the honest claim is not "prediction is 5× better."** At matched configuration (60/30) prediction's
*worst* case is 0.85 hulls against interpolation's *unconditional* 1.28, and against interpolation's
best achievable 0.88 it is a wash. C1 is won on the **distribution**, not the worst case:

> Prediction's error is **conditional and zero-centred** — exactly zero when the opponent holds input,
> rising to ~0.85 hulls only on a full steering reversal inside the window. Interpolation's error is
> **unconditional and systematic** — always present, always directly behind the target's velocity
> vector, and largest exactly when the target is fastest, which is when you are trying to ram them.

Most ticks contain no input transition, so the *typical* case is 0 against a permanent 62 u. That is
the win, and it is a large one — but it is a distributional win and overselling it as a worst-case win
would be dishonest.

**Why this works here and not in an FPS.** Extrapolation requires bounded angular acceleration. A
mouse can flick 180° between ticks; a car is rate-limited to 3.4–5.4 rad/s by `turnRateOf`. This is a
structural property of the game, not a tuning choice.

**The CPU objection does not exist at this entity count.** Measured against the real `stepSim` from
built `dist` — 6 cars in arena-01 at contact-adjacent placement, 200k iterations after 20k warm-up —
one full world tick costs **0.0163 ms**, 0.0027 ms per car. Predicting all six every tick at 60 Hz
*with* an 8-tick rollback replay per patch is **0.88% of one core**; at 30 Hz/20 Hz patch it is 0.31%.
A low-end machine at 5–10× slower is still under 10% of budget. Rocket League needed a 120 Hz Bullet
scene to do this; this game needs six OBBs and a sequential solver. *(Caveat: measured on Node/V8 on a
desktop, and it excludes C8's impulse solver, which will cost more than the current `resolveWorld` —
expected same order, unmeasured.)*

**Precedent.** Rocket League predicts all cars and replays the whole physics scene. More pointedly:
Psyonix *shipped* snapshot interpolation in the predecessor game, hit the predicted-car-vs-
interpolated-object wall, and rewrote to rollback for Rocket League. The Cursor doc cited Rocket
League as its closest physics analogue and then recommended the architecture that analogue abandoned.

**Stated residual (not solved, mitigated).** CrystalOrb's caveat on predict-everything is that it
holds "provided no player input significantly changes the course of the simulation" — and input
changes cluster *precisely at contact*, when players brake and counter-steer. The unknown window is
80 ms, in which a Mirage covers 46 u, about one full hull. The mitigation is C8: graded-impulse ram
degrades a wrong contact into *slightly less spin* rather than a categorically different outcome.
This is a mitigation of a known residual and must not be written up as a solved problem.

### C2 — No lag compensation, no rewind ✅ *(Spec doc; split, see §6.2)*

**Decision.** No server-side rewind. No `clientRenderTick` on the fire packet. Hits resolve against
present-tick state. A ~32-tick pose history ring is kept server-side (≈3 KB) for the determinism
differ and bug repro, and is authoritative for nothing.

**Why — the structural argument.** Valve's own Source networking documentation states that entity
interpolation causes a constant 100 ms view lag, "*however, the server-side lag compensation knows
about client entity interpolation and corrects this error.*" Read as a dependency, because it is one:
**lag compensation is the cure for interpolation.** C1 deletes the interpolation. Keeping the cure for
a disease you no longer have is not caution.

**Why — the mechanism argument.** Rewind and extrapolation double-count the same latency in opposite
directions. Under interpolation the client sees the remote at `T_now − (latency + buffer)`, so
rewinding by that amount lands on what the shooter actually saw. Under C1 the client has already
extrapolated the remote **forward** to its predicted present; rewinding the server backward from
there moves the target to a position **the shooter never saw at any point in time**. The two coherent
packages are {interpolate + rewind} and {extrapolate + no rewind}. The cross terms are strictly worse
than either.

**Why — the fairness argument, which is the user's stated goal.** The literature on favour-the-shooter
is unambiguous that it does not remove unfairness, it relocates it: "shot behind cover" is the
canonical artifact, and the consensus is that it "can't be eliminated, only transferred between one
player and another." The brief was *avoid mismatch/desync/glitch caused by ping, maximum competitive
fairness*. Adopting rewind would **introduce a glitch class this game does not currently have**, to
fix an error C1 already makes ~5× smaller at the source.

**Also relevant:** §1.3 shows required aim lead is 3–11 hulls for eight of nine weapons. Netcode error
of 0.3 hulls is not what makes those shots miss.

### C3 — Ram: predict the continuous half, defer the discrete half ⚖️ *(synthesis)*

**Decision.**

| Predicted client-side, in the shared sim | Server-only, applied on snapshot |
|---|---|
| Contact impulse `j`, velocity change, angular velocity change | Damage and HP |
| Positional correction, friction | `stunned` and every other status application |
| Camera shake, sparks, contact VFX | Control-authority reduction |
| — | Elimination |

**Why.** The user's cheat answer is a structural requirement — *client authority must be revocable
without a rewrite* — and it bites on a distinction neither source doc drew: **continuous versus
discrete state.** The physics of a ram is continuous, self-correcting, and already reconciled every
tick by the same machinery that reconciles driving; a mispredicted bump is eased away by the
reconciler. That is inherently revocable. The discrete consequences are not: un-stunning a car or
resurrecting one is exactly the "no honest way to reconcile 'you were dead for 80 ms'" problem
`docs/networking.md` already refuses to have.

This is strictly better than the Cursor doc's "cosmetic bump VFX only," which leaves the attacker's
*car* unmoved by a collision they can plainly see happening — and it satisfies the same constraint
that position was reaching for.

**Precedent and its cost.** Rocket League predicts contact and accepts phantom bumps as permanent;
Psyonix's public position is that bumps and demos "will never be perfect in online play." They accept
it because predicting contact is worth it. Graded impulse (C8) makes the trade better for us than for
them.

### C4 — Aim assist: shared code both sides, collapse the state ⚖️ *(synthesis)*

**Decision.** The identical `sim/weapons/lock.ts` runs on both sides. `lockTargetId` and the commit
timer are replicated every tick, so a divergence lasts one tick instead of persisting. The received
lock ID is authoritative for *remote* cars' brackets and is **reconciliation only** for your own —
your predicted shots must use the lock at `T_gen`, not one that is RTT old. No lead. LOS retained.

**Collapse the stateful knobs.** `AIM_CONFIG` currently carries `retentionConeDeg`,
`retentionLateralUnits`, `retentionRangeUnits`, `stealMarginFraction`, `commitMs`, `lockTimeoutMs`,
`losGraceMs`, plus per-car `losLostSinceTick` in `lock.ts` — **seven interacting stateful rules and a
timer, solving one problem (bracket strobing)**. Under C1 that is seven divergence sources per car
across six cars, and path-dependent state turns a *transient* divergence into a *persistent* one: if
the two sides pick different targets on one tick, the timers are now defending different targets and
the divergence heals slowly or never.

Replace with **one commit timer**: once picked, hold for `LOCK_COMMIT_TICKS` unless the target leaves
the acquisition region entirely. Residual visual flicker is a *renderer* problem — the bracket may
debounce a frame or two without the sim knowing. Presentation smoothing belongs in presentation.

**⚠️ Constraint on the collapse: keep an explicit steal margin.** This is a coupling between C4 and C1
that was decided in separate rounds and needs stating. `stealMarginFraction: 0.25` exists to make a
lock **sticky** — a marginally better candidate cannot take it, and it takes a 25% score margin to
flip a committed lock rather than a hair. **That stickiness is precisely what defends against
target-choice divergence**, which §1.3.1 identifies as the one categorical failure a locked shot can
still produce: a 40 u prediction error flipping which candidate wins the score, so the server fires at
a different car entirely.

C1 makes prediction error larger at exactly the moment C4 would remove the thing damping its effect.
So the collapsed design must **retain an explicit steal margin, or state why it does not need one.**
Collapsing seven rules to one commit timer is right for the path-dependence reason above; collapsing
to one commit timer *and no margin* trades a transient divergence problem for a categorical one.

Shipped `commitMs` is 400; the Spec recommends ~150. Treat as a tuning delta, not a bug.

**LOS is downgraded, not dropped.** `arena-01` has `obstacles: []`, so LOS is inert in the shipped
arena; `arena-02` (2000 × 2000) has obstacles and `hasLineOfSight` is already implemented. Keep it —
it is a pure function of positions, therefore deterministic, therefore fine in shared code running on
both sides. **LOS is not an argument for server authority over the lock**, which is what the Cursor
doc used it for.

**A warning that already came true.** The Spec doc's §8.7 says 400 u against a 3200-wide arena "reads
as a close-quarters aid," and warns that shrinking the arena would quietly stop ramming mattering
"and the cause won't be obvious." At 1280 wide, 400 u is **31% of the arena width and 56% of its
height**. The condition the doc warns about is the shipped condition. Aim assist range versus arena
size needs a deliberate re-look during tuning (§9).

### C5 — Run-ahead with time dilation ✅ *(Spec doc)*

**Decision.** Three client timelines:

```
T_snap = newest authoritative tick received     ≈ S_now − downLatency
T_gen  = tick the client generates input for    = S_now + upLatency + jitterMargin
T_r    = tick the client renders                = T_gen − D,  with D = 0 shipped
```

The server measures per-player input-buffer occupancy, returns a signed correction (6 bits) in every
snapshot, and the client applies **time dilation** — nudging tick duration by up to ~5%, never
skipping or duplicating ticks. Target buffer occupancy 1–2 ticks, sized adaptively from observed
jitter — **target occupancy `M = 3` ticks at 60 Hz (50 ms), `M = 2` at 30 Hz (67 ms), per §1.4.** This
corrects the Spec doc's "1–2 ticks", which starves 5–11% of ticks at realistic jitter. Missing input:
repeat previous, decay toward neutral after 5, mark `STALLED` after 1 s. Late inputs are discarded,
never retroactively applied.

**Why.** This is Overwatch's shipped design, not a theory: the server detects input starvation, tells
the client, the client simulates slightly faster (16 ms → ~15.2 ms) to build a server-side buffer,
then dilates back to drain it. On starvation the server duplicates the last known input.

**Why it matters beyond feel.** Run-ahead is *what makes C2 true.* Because the client generates input
for `T_gen` and the server simulates `T_gen` with that input, the client is firing at the tick the
server will simulate — it is not firing into the past, so there is nothing to rewind. The Cursor
doc's model (client simulates "now", server simulates "now + up-latency") is what forces a rewind to
exist. Buffer occupancy is also the best available jitter signal — better than RTT variance — and is
what should drive any future adaptive `D`.

`D` stays a dev-only knob. Its primary value is debugging: `D = RTT` renders raw server state with
prediction fully bypassed, so a bug that survives is in the sim and a bug that vanishes is in
prediction. Put it on a hotkey. If ever exposed, cap at 2 ticks and apply it **uniformly to all cars**
— your car at `T_gen` and remotes at `T_r` draws contacts wrong, which is worse than the error `D`
was introduced to reduce.

### C6 — Determinism: differ first, LUT on evidence ⚖️ *(split with condition — see §6.2)*

**Decision.** Build the determinism differ in phase 1. Defer the trig LUT until measured. Adopt the
cheap rules immediately: no `Math.random` in the sim (already true), all durations in ticks (already
true via `msToTicks`), fixed iteration order, deterministic tiebreaks on strict `<` in ID order.

**Why deferred rather than mandated.** Cross-engine `Math.cos` divergence is ~1 ULP (~1e-16). Against
a position quantization step of 1/16 u that is fourteen orders of magnitude below the floor, and full
snapshots correct any residual every tick. The Spec doc's own §4 opens by saying bit-exact determinism
is not strictly required and then mandates a 4096-entry LUT anyway; those do not sit together.
Rewriting all **48 non-test transcendental call sites in `packages/shared/src/sim/`** (`sin` 20,
`cos` 16, `hypot` 7, `atan2` 3, `tan` 1) before knowing whether it matters is a sim-wide change on a
hunch. Note also that **`Math.random` appears nowhere in `packages/shared/src` outside tests** — the
sim is already PRNG-clean, so that half of the determinism work is done and only needs a lint rule to
*stay* done.

**Three conditions, so the deferral does not become a silent never:**

1. **The differ must run cross-engine.** Node and Chrome are both V8, and V8 and SpiderMonkey both use
   fdlibm ports — that pairing will look clean and prove nothing. The real risk is Safari /
   JavaScriptCore, which the game must run in. *A clean Node-vs-Chrome differ is not evidence.*
2. **The differ must hash contact sets and collision booleans, not just poses.** The failure mode is
   not slow drift, it is a **discrete branch flip**: 1 ULP in `cos` flips a SAT separating-axis test
   at the exact boundary and one side has a collision the other does not. That is categorical, and a
   pose-only hash can miss it.
3. **The trigger is pre-committed, now, before either answer is known:** *if any cross-engine run
   shows a contact-set divergence within a 10-tick replay — in either direction, **including one that
   heals on its own** — the LUT ships.* Pose drift below the quantization floor is acceptable; a
   flipped collision is not, because a flip that self-corrects still produced a frame in which two
   players disagreed about whether they touched, and under a graded-impulse ram that is a difference
   in outcome rather than a cosmetic one.

Note the LUT's 0.088° angle granularity is **not error** — computed identically on both sides it is a
different sim, not a divergent one, and costs 1.3 u of lateral aim at 850 u range. It is not a reason
against the LUT; it is simply not a reason for it either.

**This project already ruled on the smooth case, and the ruling agrees.** From `sim/drive.ts`,
immediately above the position integration:

> `cos/sin are not guaranteed bit-identical across JS engines (server V8 vs. client browser engine),
> so replayed positions can drift by an ULP or two. That's fine here: Task 4 reconciles client
> prediction against authoritative server state rather than trusting bit-exact replay, so this is not
> a desync-checksum-safe function.`

That is the C6 question asked and answered in the shipped source by whoever wrote the prediction
layer, and it is a stronger citation than anything either source document brought, because it is a
prior decision *by this project* rather than an argument from another one.

**It does not dissolve the split, and the reason is the whole point.** The comment reasons about
**position drift**, which reconciliation genuinely does absorb. The remaining objection is about a
**discrete SAT boundary flip**, which reconciliation absorbs far less gracefully once a graded-impulse
ram makes contact outcomes continuous. So the in-repo ruling covers the smooth case and is *silent on
the categorical one* — which is exactly the gap the cross-engine differ is built to measure, and
exactly why the trigger is a **contact-set** divergence rather than a pose divergence.

**Feasibility is settled.** `+ − × ÷ sqrt` on doubles are IEEE-754 exact and portable. Rapier's
JS/WASM build is fully cross-platform deterministic across browsers, OSes and CPUs, and Rune ships a
production approach of patching `Math` to a common precision. JS determinism is an engineering cost,
not a nightmare — which means C6 **cannot be used as an argument against shared-sim prediction**,
which is the use the Cursor doc put it to.

### C7 — Transport: Colyseus 0.18, two first-class transports 🔄 *(third answer; neither doc)*

**Decision.**

- **Upgrade Colyseus `0.15 → 0.18`.** 0.18 ships built-in client prediction, server reconciliation,
  lag-compensated rewind, fixed-delay interpolation, and **WebTransport as a first-class transport**.
- **Keep Colyseus for what it is good at**: room lifecycle, lobby, matchmaking, reliable match events,
  reconnect handshake. All latency-insensitive.
- **Move the state channel to raw quantised binary** via `sendBytes()`, behind a `send(bytes)` /
  `onDatagram(cb)` seam so the transport underneath can change without touching the protocol.
- **WebTransport and WebSocket are both first-class and both tested.** Not primary-and-fallback.
- **WebRTC DataChannel deferred**, behind a measurement (§8).

**Why this and not either doc's answer.** Both docs framed the choice as hand-rolled WebTransport
versus TCP, and both were written without knowing 0.18 exists. A hand-rolled protocol now has to beat
a supported one. Simultaneously, WebTransport sits at ~75% browser support with W3C Candidate
Recommendation expected *during* 2026 and broad implementation in 2027, against WebSocket's 99%+. **A
path a quarter of players live on permanently is not a fallback**, and shipping WebTransport-primary
now is writing a 2027 answer in 2026. Because the transport is a Colyseus configuration choice rather
than a bespoke build, running both is cheap — which is exactly what makes the "keep the WebSocket path
tested, not a prototyping crutch" position affordable.

**⚠️ The caveat that limits this, and it is the plan's top risk.** A secondary source describing the
Colyseus WebTransport rollout states: *"In the initial iteration, unreliable delivery is only supported
when using WebTransport via the `client.sendUnreliable()` method from the client-side"* — i.e.
unreliable is **client → server only**. If true, the downstream snapshot path — the direction carrying
six cars at 30–60 Hz, and the only direction where head-of-line blocking costs a frozen car — is still
reliable and ordered even on WebTransport, and **the C7 answer may not deliver the thing it was
adopted for.**

**This is explicitly unverified.** A second attempt to confirm it against the Colyseus netcode and
transport documentation pages found *neither confirmation nor refutation*: the transport page lists
WebSocket / uWebSockets.js / WebTransport / Bun with no delivery guarantees stated in either
direction. Do not treat it as settled in either direction — it is verification item §8.1, it gates
C9's second phase, and it is the single thing most worth checking before committing to the transport
story. **If it resolves badly, the fallback is the raw-`sendBytes()`-behind-a-`send(bytes)`-seam
position, which survives independently of the transport underneath.** That is precisely why the seam
is specified before the transport is chosen.

**A possible upside in the same release, also unverified.** 0.18's documented netcode surface includes
`predict.reconciler`, a `Predict` helper for remote entities offering **both `lerp` and a
dead-reckoning "reckon" mode**, `predict.spawns` for predicted projectiles, `predict.defineEvent()`,
`setFixedTimestep()`, `allowRewindState()` and `rewind.lastSeenBy()`. If the reckon mode and
`predict.spawns` work as documented, **C1 and C11 move closer to configuration than to construction**
and phases P5–P6 shrink materially. Verify first; assume nothing.

### C8 — Physics: authorized, and it is part of the netcode ✅ *(Spec doc, user-authorized)*

**Decision.** Unify the drive state into a full velocity vector; replace velocity reflection with a
sequential-impulse solve.

**This is a smaller step than either source document implies, and the difference matters for
sequencing.** The shipped model is not scalar-speed-along-heading — it is already a hybrid.
`stepDrive` integrates `pos += (cos·speed + shoveX, sin·speed + shoveY)·dt` and carries `angVel`
alongside, with `nextAngVel` already implementing countersteer (`steer · angVel < 0` selects a faster
decay) and `decayShove` bleeding off lateral knock. **Lateral velocity and angular velocity already
exist**; what does not exist is a solver that produces them from geometry rather than from a ram
special case. C8 is therefore: promote `speed + shove` into one `vel` vector, replace decay-based
knock recovery with a real impulse exchange, and let `j` fall out of the solve instead of being
computed by `RAM_CONFIG`.

**Do not over-correct on that re-pricing, though.** The shipped model is not a velocity vector wearing
a disguise: `speed` is scalar-along-heading governed by throttle and drag, while `shove` is a
*separate additive term on an exponential decay curve* that knows nothing about mass or friction.
Merging them changes semantics, not just representation — after the merge, lateral motion is governed
by the solver and Coulomb friction rather than by `RAM_DECAY.shove`. **`RAM_CONFIG`'s four half-lives
(`spin`, `shove`, `authority`, `counterSteer`) and its three epsilons all become dead or must be
re-derived, and that is a balance surface rather than a refactor.** `golden.test.ts` exists precisely
so this cannot happen silently.

The accurate summary: **the state model is already there; the force model is not, and replacing
decay-driven recovery with solver-driven recovery is where the tuning cost actually lives.** Cheaper
than both source docs priced it, materially more than "promote two fields."

- **State:** `pos: vec2`, `vel: vec2` (including lateral), `angle`, `angVel`.
- **Drive:** project `vel` onto forward/right, run the existing four-rate throttle logic on `v_f`
  unchanged, scrub `v_l` by `LATERAL_KEEP`. **`LATERAL_KEEP = 0` must reproduce the current model
  exactly** — verify that as a regression test before layering collisions on top.
- **Steering:** converge `angVel` toward `steer × turnRate × speedFactor(v_f)`, clamped by
  `ANG_ACCEL × controlAuthority`. Countersteering then costs nothing to implement — the integrator
  does not know why `angVel` is high.
- **Contact:** 2-point manifold via reference/incident face clipping; impulse exchange with
  restitution and Coulomb friction; mass-weighted positional correction with slop.
- **Mass appears only in the impulse solve**, never in drive acceleration — a force-based drive
  (`a = F/m`) forces heavy ⇒ sluggish and collapses the chassis triangle to one axis.

**Why this belongs in a netcode document at all.** This is the sharpest thing the debate produced: a
graded-impulse ram is a **different netcode problem** than a binary CC ram. Under C1 there is a
residual disagreement window at contact (F2, §C1). With binary CC an 80 ms disagreement is *stunned
versus not stunned* — categorical, and the loudest possible complaint. With graded impulse it is
*slightly less spin* — continuous, and self-correcting through the same reconciler that handles
driving. **C8 is not a physics luxury; it is C1's error-tolerance strategy.** The two decisions are
coupled, and taking C1 without C8 is the worst available combination.

Free consequence: `j`, the impulse magnitude, is the number the CC severity formula needs. It falls
out of the solve rather than being computed separately.

### C9 — Snapshot rate: 30 Hz now, 60 Hz gated ✅ *(Cursor doc's phasing)*

**Decision.** Patch rate 20 → **30 Hz** in phase 2. 60 Hz snapshots are a later step, gated on the
§8.1 transport measurement.

**Why 30 first.** It fixes the §1.2 measured defect at the *same* 50 ms buffer, and it does so by
*reducing* staleness rather than trading more of it — the alternative fix (raise the buffer to 100 ms)
costs 50 ms of extra remote lag and makes C1 worse. A 60 Hz sim with a 30 Hz patch also satisfies
hard invariant #5 on either reading of it, without needing anyone to reinterpret an invariant.

**Why not 60 immediately.** Bandwidth is not the constraint — a full six-car snapshot is ~110 B, so
60 Hz is ~9.6 KB/s down per client and ~58 KB/s up for a whole match. The constraint is that over the
WebSocket path (a permanent quarter of players, per C7), doubling packet *rate* doubles the
opportunities for a head-of-line stall, and each stall costs a full RTT. Given §8.1 leaves downstream
unreliable delivery unproven, this argument now applies to the WebTransport path too. Measure, then
raise.

### C10 — Matchmaking: mostly collapses ✅ *(both, converged)*

One region in one country makes the Spec's ping-*spread* gate and the Cursor doc's absolute-ping gate
nearly the same rule. Both are cheap; ship spread as the harder constraint when ranked exists, because
extrapolation error scales with `t²` and a match where everyone sits at 90 ms is *fairer* than one
mixing 20 ms and 120 ms even though the average is worse.

**The surviving content here is a negative, and it is firm: no match-wide equalized delay.** Not in
V1, not in ranked. It taxes a 20 ms player to 120 ms for someone else's benefit — a certain,
continuous, highly perceptible cost imposed to remove an intermittent, marginal one. Rocket League,
Overwatch and Valorant all reject it; the games that use it are lockstep RTS (architecturally forced)
and FIFA (persistently complained about).

### C11 — Combat prediction: predict the flash, never the damage ✅ *(Spec doc §7.6)*

**Decision.**

| Predict immediately | Wait for the server |
|---|---|
| Muzzle flash | Damage numbers |
| Fire sound | HP change |
| Projectile / beam spawn, tagged `(ownerId, slot, fireSeq)` | Hit confirmation |
| Impact spark | Kill feed |
| — | Status / CC application |

When the authoritative volley arrives with a matching tag, blend the predicted transform toward it
over ~100 ms, then let the server version drive. `fireSeq` is per slot so two slots firing on the same
tick are unambiguous.

**Why this is the biggest felt win available.** Combat is currently predicted at **zero** — `fireSlots`
is raw key state and the server even derives press edges from its own `prevFireMasks`. At 80 ms RTT
plus up to 50 ms of patch quantisation plus 50 ms of interpolation, **nothing at all happens on screen
for ~90–130 ms after the player presses fire.** That is well past the threshold at which a game reads
as unresponsive rather than merely laggy.

**Why it is safe here specifically.** It directly answers the objection `docs/networking.md` raises
("no honest way to reconcile 'you were dead for 80 ms'") because *none of the predicted things are the
thing that cannot be reconciled*. A ghost shot that produces a spark and no damage number reads as "I
grazed them," not "the game ate my shot."

**Two properties make it cheap.** Pellet fans are already deterministic — pellet `i` of `n` takes
`exitAngle + spreadHalf · (2i/(n−1) − 1)`, no PRNG anywhere in the weapon system. And the server's
press-edge derivation is a deterministic function of the mask stream the client already sent, so the
client can derive identical edges locally **with no protocol change**. Stock is replicated, so a
mispredicted fire self-corrects within one tick.

### C12 — Weapon exposure: two metrics, and the roster passes both ✅ *(Cursor doc, extended)*

Resolved at §1.3, §1.3.1 and §1.3.2. The Cursor doc's constraint — a projectile whose flight time is
below RTT cannot be made fair by any netcode — is real, original to it, and **the shipped roster
honours it with 3.8–11.1× margin.** No general balance action on that metric; say so in writing so
nobody "fixes" it later.

**The debate then got this crux wrong twice, in opposite directions, and the second correction is the
useful one.** First it graded `lance` a FAIL, which `startUpMs: 700` refuted. Then it treated flight
time as *the* exposure metric, which §1.3.1 refutes: **hit tolerance is a second, independent metric
measuring the shooter rather than the victim, and it ranks the roster in the opposite order.** By
tolerance, `lance` is the *best*-protected weapon in the game (45–53 u against a 40.9 u worst case)
and `skewer` is the exposed one (21–29 u, single-shot, 110 damage, 6 s cooldown).

Two structural findings fall out and both belong in the plan rather than in a balance ticket:

1. **An aim-locked shot is immune to position error.** The server re-derives the exit angle from its
   own view of the target, so its shot points where the target actually is; a disagreement yields a
   different angle that still connects. Only a *different target choice* flips it, which C4 bounds to
   one tick. This is why shipped games put auto-aim on fast projectiles, and it means exposure exists
   only in the manual zone beyond `lockRange`.
2. **The band is 80–120 ms and behaviour-gated, not latency-gated** (§1.3.2). Below ~43 ms nothing
   crosses; between 43 and 80 ms only an active juke does; past ~120 ms ordinary driving does.

Recommendation: **no balance change now.** `skewer`'s `radiusAcross: 5 → 8` is the lever if measurement
says it is needed, and the plan's own error-reduction work — 60 Hz, margin sizing, 30 Hz patch, and
C8's ω convergence — all shrink the 40.9 u directly. Measure first. See §6.1.

---

## 3. The architecture, assembled

### 3.1 Time and rates

| | |
|---|---|
| Simulation | **60 Hz** fixed, `DT = 1/60` |
| Snapshot send | **30 Hz** phase 2, 60 Hz gated on §8.1 |
| Input send | 60 Hz with 8-input redundancy |
| Render | `requestAnimationFrame`, decoupled, interpolating between sim states |

**Why 60 Hz sim, stated as a cost/benefit rather than a preference.** Two independent reasons, and
the first is the one that decides it:

1. **The authorized physics rewrite needs it.** At 30 Hz, per-tick displacement at Mirage's top speed
   is 19.2 u, and two Mirages closing head-on cover **38.4 u in a single tick — more than the car's
   32 u width.** Feeding that into a sequential-impulse solver with positional correction produces
   exactly the "cars launch on deep hits" failure mode. At 60 Hz those figures halve to 9.6 and 19.2,
   which is what makes the Spec's "cars don't need CCD" analysis true. That analysis is a 60 Hz
   argument; at 30 Hz it does not hold.
2. **It buys a smaller jitter margin, which directly shrinks C1's error.** Per §1.4, the minimum
   viable margin is 67 ms at 30 Hz but 50 ms at 60 Hz, *with better starvation numbers*. Margin is
   quantised in ticks, so a finer tick lets you purchase precisely the slack you need instead of
   overshooting to the next boundary. That is 17 ms off the extrapolation window — about 11 u of
   worst-case prediction error — bought with no responsiveness cost anywhere.
3. **It is what makes a 30 Hz patch rate meaningful** — there has to be something new to send.

Costs, honestly: ~2× server CPU (measured at 0.10% of one core per world tick — trivial), 2× input
bandwidth (~720 B/s up — nothing), and re-pinning `golden.test.ts`. Most tick-denominated constants
migrate themselves because durations are authored in milliseconds and converted by `msToTicks`.

The considered alternative — keep the sim at 30 Hz and sub-step collision 2× — works, but means a
tick no longer equals a physics step, which complicates rollback indexing and the golden fixture for
no saving.

### 3.2 Protocol

**Full snapshots, no delta compression.** Six entities makes it affordable and it buys three things:
a lost packet costs exactly nothing, there is no baseline state to desync, and reconnect is free.

**Quantize on send, and have the server adopt its own quantized state as authoritative.** If the
server keeps full-precision state while clients receive rounded state, every client sits permanently
off-true and reconciliation fires constantly on noise.

**Position precision: 1/16 u, not 1/4 u.** This corrects the Spec doc. Gaffer's networked-physics
series establishes that state synchronization needs substantially more precision than snapshot
interpolation — he needed 4096 position values per metre for state sync versus 512 for snapshot
interpolation, an 8× increase — *because quantized values are fed back into the simulation instead of
merely being drawn*. Under C1 they are fed into an impulse solver, where small position error is
amplified by contact normals into visibly different spin. Against a 1280 × 720 arena, 1/16 u costs 15
bits of x and 14 of y: four extra bits per car, ~3 bytes per snapshot. Buy it.

Per-car payload also carries `angle`, `vel`, `angVel`, health, `controlAuthority`, CC ticks remaining,
`lockTargetId` + commit timer, per-slot stock, state flags, and **`lastInputEcho` — required, because
it is what drives remote extrapolation.**

**Volley compression.** Because pellet fans are deterministic, the wire carries the volley, not the
pellets: `(volleyId, ownerId, weaponId, spawnTick, spawnPos, exitAngle, pelletCount)` ≈ 10 B replaces
~96 B for a 12-pellet blast. Clients derive each pellet and integrate forward. Deaths arrive as
events. The growing-beam formulation is the same trick: reach is a pure function of
`(spawnTick, now, speed, maxRange)`, so it carries no per-tick state and cannot desync.

**Input redundancy.** Each input packet carries the previous 8 inputs (64 bits). A single lost input
packet becomes invisible — the next one carries it. Cheapest reliability win in the protocol.

### 3.3 Client

- **Prediction.** All six cars through the shared step. Local car keeps the existing input history and
  replay reconciliation, which is already correct — including the `seq <= lastProcessedSeq` predicate
  and the snap-not-ease treatment of derived fields.
- **Error smoothing.** Never snap visually. Maintain a render-time visual offset (position vector plus
  shortest-arc angle delta), decayed exponentially: 150–200 ms for errors under 0.2 hulls (invisible),
  40–60 ms for errors over one hull (a hard correction beats lying about a collision that clearly
  happened).
- **Rendering.** Fixed 60 Hz accumulator, clamped to ~5 steps per frame so a hitch does not spiral.
  Camera and HUD read the render timeline. Local VFX fire on the render timeline, not the sim timeline.
- **Input sampling — change from what ships.** Do not sample keyboard state once per rendered frame:
  at 30 fps that quantizes input into 33 ms buckets while a 240 fps player gets 4 ms buckets, which is
  a real competitive difference. Listen to `keydown`/`keyup`, record `event.timeStamp`, bucket each
  transition into the correct tick, use `KeyboardEvent.code`, ignore `event.repeat`.
- **Camera fairness.** Fixed aspect, fit-and-letterbox, in world units. The shipped arena is already
  sized to the client's logical canvas so this holds today; keep it holding. No gameplay code reads
  viewport dimensions. Cap DPR at 2 and re-fit on `matchMedia` resolution change.
- **Background tabs.** `rAF` stops when hidden. On regaining focus, discard the accumulator and
  request a full resync rather than catching up.
- **No allocation in the sim hot path — and this is a netcode invariant, not a style preference.**
  Under run-ahead, a GC pause on the client does not merely drop a frame, it drops an **input tick**,
  and a dropped input tick is a starved server tick from the §1.4 table. Predict-all at 60 Hz with
  replay allocates roughly 2k short-lived objects/sec today (`stepSim` returns a fresh body,
  `otherCarHulls` allocates per car per tick) — trivial for a modern GC, with no pathology observed
  across 1.2M benchmarked steps, but the headroom exists to be kept rather than spent. The
  `CHASSIS_DRIVE` comment in `car-config.ts` ("`stepSim` runs this lookup for every player every tick
  on both halves of the lockstep, so it must not allocate") already has the right instinct; generalise
  it to a rule covering the whole step, and pool the per-tick hull and manifold objects introduced by
  C8.

### 3.4 Server

```
tick++
inputs = collect(tick)              // pop buffer; repeat-with-decay on miss
world  = step(world, inputs, tick)  // the shared pure function
quantize(world)                     // server state == transmitted state
push(history, world)                // ~32 ticks, diagnostics only
for p in players: send(snapshot, inputAck[p], timing[p])
```

One process per match, no shared state, no database in the tick loop. The lobby/session service stays
separate and latency-insensitive. **Log the per-tick input stream** (~1.2 KB/s, under 1 MB for a
10-minute match): deterministic bug reproduction now, and replays or spectating later come free.

**Reconnect is nearly free under full snapshots** — a reconnecting client needs exactly what a
connecting client needs, one snapshot. Abandoned car coasts to a stop and despawns after ~5 s; grace
window 60–90 s. Freezing the car in place creates a free invulnerable obstacle that could be exploited
deliberately.

---

## 4. Fairness ledger

### 4.1 What error remains, by latency

Window is `RTT + jitterMargin`, with the margin at the §1.4 floor of 50 ms (60 Hz, `M = 3`). Worst
case is a full steering reversal (`Δa = 2 · v · ω` = 4838 u/s² for Mirage); common case is a
straight-to-turn transition; **most ticks contain no input transition at all and therefore have zero
error.** Interpolation column is the matched 60 Hz sim / 30 Hz patch configuration.

| RTT | Window | No input change | Throttle change | Straight → turn | Steer reversal (worst) | Interpolation, unconditional |
|---|---|---|---|---|---|---|
| 80 ms | 130 ms | **0 u** | 16.3 u | 20.4 u | 40.9 u (0.85 hulls) | 62 u (1.28 hulls) |
| 130 ms | 180 ms | **0 u** | 31.3 u | 39.2 u | 78.4 u (1.63 hulls) | 76 u (1.58 hulls) |
| 250 ms | 300 ms | **0 u** | 86.9 u | 108.9 u | 217.7 u (4.5 hulls) | 111 u (2.3 hulls) |

Reading it honestly:

- **At the 80 ms target the design wins on every measure** — worst case 0.85 hulls against an
  unconditional 1.28, typical case zero.
- **The worst cases cross over at ≈126 ms RTT** (solving `2419·(R+50)² = 288000·R + 38592000`).
  Beyond that, a player who reverses steering inside the window is displaced further than
  interpolation would have displaced them — while the player who holds input is still displaced by
  nothing at all. Prediction remains better *on average* well past the crossover; it stops being
  better in the tail.
- **Treat 126 ms as an upper bound, not a point estimate.** The table holds the margin at 50 ms and
  the buffer at 67 ms across all three rows, but **jitter correlates with RTT** — a 250 ms path is not
  a 130 ms path with more delay, it is a worse path with a fatter tail, and both columns would need
  more slack than the table grants them. Both tails are therefore optimistic, and prediction's is more
  optimistic because its error grows as `t²` while interpolation's grows as `t`. The true crossover
  sits somewhat *below* 126 ms. This does not touch the 80 ms conclusion at all. The agreed 130 ms
  fairness bar should be adopted **because it is conservative**, not because the arithmetic happened
  to land on it.
- **The distribution, not the tail, is the argument.** How often input actually transitions inside the
  window is unmeasured and is verification item §8.5. At an assumed 2–5 transitions per second in
  active driving, a 130 ms window contains one roughly 26–65% of the time and mean error lands around
  10–25 u — a 3–6× win over interpolation, not the 20× a worst-case-free reading would suggest.
- **The clustering objection is real and is not closed.** Input transitions are not uniformly
  distributed; they cluster at contact, because contact is when players brake and counter-steer. If
  they cluster hard enough, the distribution collapses toward the worst case exactly where it matters
  most. C8's graded impulse is the mitigation (§C3); §10.4's input logging is how it gets measured.

### 4.2 What this design deliberately refuses

- **No lag compensation** (C2) — refuses to create the "shot behind cover" glitch class.
- **No equalized delay** (C10) — refuses to tax low-ping players.
- **No client-authoritative hits, ever** — the client never reports a hit, never chooses a lock as
  truth, never spends stock the server did not.
- **No interest management** — the whole arena is always visible; there is nothing to cull.

### 4.3 Revocability, per the user's cheat answer

Every piece of client-side authority in this design is *predictive*, never *decisive*, and each can be
switched off with a config flag rather than a rewrite:

| Client predicts | Server decides | Cost of revoking |
|---|---|---|
| Own car pose | Own car pose | Already reconciled every tick — set `D = RTT` and prediction is bypassed entirely |
| Remote car poses | Remote car poses | Fall back to interpolation; the buffer code path is the one being deleted, keep it behind a flag for one release |
| Contact impulse | Contact impulse, damage, CC, elimination | Predicted impulse is eased away by the reconciler; nothing to unwind |
| Muzzle flash, shot spawn | Shot existence, trajectory, every hit | Predicted shot is untagged and dropped |
| Lock target (for its own shots) | Lock target (for brackets and for the record) | Replicated every tick; a divergence lasts one tick |

**Nothing the client computes is ever the last word on an outcome.** That is the property the user's
"build so it can grow" answer requires, and it is why the debate resolved C3 on the
continuous/discrete line rather than on trust.

### 4.4 Anti-cheat posture

Server-authoritative for every outcome, so the honest-client fast path costs nothing and validation
tightens later without restructuring. The three inputs worth validating when that day comes are input
timestamps (already bounded by `maxInputsPerTick`), input rate, and `seq` monotonicity (already
required). Note that run-ahead is *self-policing* on one axis: inflating your latency makes your own
inputs arrive late and get dropped, so there is no lag-switch advantage to buy.

---

## 5. Build order

Sequenced so each phase is verifiable before the next depends on it. No calendar attached, per the
user's answer; estimates are relative effort only.

| # | Phase | Contents | Why here |
|---|---|---|---|
| **P0** | **Interpolation buffer fix** | **`interpolationDelayMs: 50 → 67`.** One constant | **Live bug at any ping** (§1.2). Independent of every decision below. Ship it now; it gets deleted in P6 and that is fine |
| P1 | Tooling | Determinism differ (cross-engine, hashing contact sets), visual debug overlay, headless scenario harness, netgraph | Every later phase is debugged with these. The differ also decides C6 |
| P2 | Rates | 30 → 60 Hz sim, 20 → 30 Hz patch, re-pin `golden.test.ts` | Prerequisite for P3's solver and P6's error budget |
| P3 | Physics | Velocity vector + `angVel`; verify `LATERAL_KEEP = 0` reproduces current feel; car-vs-static with real contact point; 2-point manifold; impulse + friction; positional correction | Authorized (C8), and it is C1's error-tolerance strategy. Must precede remote prediction — predicting a sim you are about to replace is wasted work |
| P4 | Graded ram | Severity from impulse `j`, control authority, front/flank/rear bonus. Continuous predicted, discrete server-only (C3) | First point where the core mechanic is testable. **Playtest gate** |
| P5 | Transport | Colyseus 0.15 → 0.18; `send(bytes)` seam; binary snapshot + quantization at 1/16 u; WebTransport and WebSocket both live and tested; resolve §8.1 | Protocol must be settled before prediction is tuned against it |
| P6 | Prediction | Clock sync, run-ahead, time dilation; predict all six through shared step; delete interpolation; error smoothing; event-timestamped input sampling | The core of the design. Everything above exists to make this correct |
| P7 | Combat & aim | Predicted muzzle/spawn with `fireSeq` blending; collapse `AIM_CONFIG`'s seven stateful rules to one commit timer | Depends on P6's timeline being real |
| P8 | Session | Reconnect handshake, abandoned-car policy, region config, input logging | Cheap now, 4–6× the cost retrofitted |
| P9 | Tuning | All `[T]` constants, aim-assist-vs-arena ratio (§C4), `lance` ruling | Needs a playable build, not more discussion |

**On expectations for the physics phases.** Writing the code — SAT, impulse resolution, integrators,
swept tests — compresses well; these are textbook algorithms with known-correct forms. *Making it
behave* does not. "Cars jitter when three touch a wall" is usually not a bug in any line: the code
does exactly what was written, and the misbehaviour emerges from the interaction of restitution,
penetration correction, tick rate and mass ratios. Plan for working code fast, then real tuning.

### 5.1 Why P0 is 67 ms and not the textbook 100 ms

The two obvious P0 fixes are not equivalent and must not be presented as interchangeable. Raising the
buffer to 100 ms fixes the freeze **and makes staleness worse** — 140 ms total, 81 u, the worst cell in
the whole fairness ledger. Raising the patch rate fixes the freeze **and reduces** staleness. They
point in opposite directions on the metric the rest of this document optimises.

**67 ms is the better value and it is not a compromise.** The §1.2 sweep shows that at the shipped
20 Hz patch rate, a 67 ms buffer already gives 0.2% frozen frames out to 25 ms jitter, failing only at
40 ms jitter and then only at 3.2%. It fixes the measured failure at a third of the staleness cost of
the textbook value — and when P2 raises the patch rate to 30 Hz, **67 ms becomes exactly the 2× patch
interval the rule wants**, so the P0 value is already correct and needs no second edit. P0 and P2
compose instead of colliding.

### 5.2 The order above is one of two defensible orders. This is a risk-appetite decision.

The table sequences physics (P3–P4) before prediction (P5–P6). The alternative reverses them:

> **`P0 → P1 → P2 → P5 → P6 → P3 → P4 → P7 → P8 → P9`** — same content, same hard dependencies
> (tooling first, transport still before prediction), but the online experience lands at step five
> instead of step seven.

**The case for physics-first (the table's order):** graded impulse is C1's error-tolerance strategy
(§C8). Shipping prediction over today's binary CC means the residual disagreement surfaces as
categorical stunned/not-stunned — the exact glitch class the brief asks to avoid.

**The case for netcode-first (and it is the stronger one):**

1. **The coupling is small and was checked, not assumed.** `PredictionBuffer` is structurally
   independent of the drive model: it holds pending inputs, replays them through `stepSim`, eases
   `x`/`y`/`angle`, and snaps derived fields. `stepSim`'s signature is unchanged by C8. The only place
   the drive model appears is the **snap list** (`speed`, `reverseHold`, `angVel`, `shoveX/Y`,
   `authority`), which C8 edits. Add re-tuning `reconcileSnapPos`/`reconcileSnapAngle` and re-pinning
   `golden.test.ts` — work required after *any* physics change — and the waste is ~10–20% of P6.
2. **The order decides what the user gets if they stop early**, and they explicitly reserved that
   right ("I'll decide how far down it to go"). Under the table's order, stopping anywhere before P6
   delivers a physics rewrite and *no online improvement at all*.
3. **P3–P4 is the highest-risk, longest-tuning, least-reversible chunk in the plan.** Putting the
   highest risk in front of the highest value is the wrong bet when stopping early is on the table.
4. **Prediction over today's ram is still strictly better than today** — interpolation's unconditional
   62 u against prediction's 41 u worst case. The categorical-CC concern is an argument about what to
   expose to players, not about what to build first, and C3 defers the discrete half to the server in
   either order, so no new categorical disagreement is *introduced*.

**Recommendation: take the netcode-first order.** The physics-first justification ("don't predict a
sim you're about to replace") sounded stronger than it measured, and C8 turns out to be a smaller step
than billed because `angVel` and `shoveX/Y` already exist (§C8). Print both, take the second, and
accept the two stated costs: a ~10–20% P6 re-tune after P3, and ram disagreements staying categorical
until P4.

---

## 6. Reserved for the user

### 6.1 Weapon exposure — the recommendation is to change nothing yet

**Recommendation: no balance change now. Measure, then decide.** The reasoning is §1.3.1 and §1.3.2;
this section records the options and the history so the call can be revisited without re-deriving it.

**The candidate is `skewer`, not `lance`.** By hit tolerance — the metric that measures the shooter's
exposure to prediction error — `skewer` sits at 21–29 u against a 40.9 u worst case, while carrying
110 damage on a 6 s cooldown with no second attempt. Its lever is `hitbox.radiusAcross: 5 → 8`, which
would put tolerance at 24–32 u and clear the entire 80–120 ms band for ordinary manoeuvres. Hold it
until measured: the error is zero unless the target changes input, only its perpendicular component
counts, and four separate pieces of the plan (60 Hz, margin sizing, 30 Hz patch, C8's ω convergence)
shrink the 40.9 u directly.

**`lance` needs nothing.** It has the *largest* hit tolerance in the roster (45–53 u), a 700 ms
sim-side wind-up, and a 16 s cooldown. Its flight time is genuinely below one RTT, but flight time
governs the victim's reaction window, which `startUpMs` already covers nine times over.

**Two options from the earlier analysis are withdrawn, for different reasons.** Option
(D) — `usesAimAssist: false` on `lance`, or resolving it by entity lock rather than beam trace — was
proposed to make the shot immune to position disagreement. Since the server already re-derives the
exit angle from its own true view, the trace **already** lands on the true target: (D) solves a
problem server-side angle derivation had solved before it was raised. It was the right answer to a
wrong model of how the lock resolves.

The options below were written when `lance` was believed to be the exposed weapon. **The framing is
superseded by §1.3.1 — option (C) is now the recommendation on much stronger grounds than the wind-up
alone, and option (B) is withdrawn entirely** (widening `hitbox.width` raises tolerance globally,
including against cars never locked, to fix an error the existing 57.5 u rect already exceeds; and it
cannot touch the residual that survives, which is angular rather than positional). They are kept
verbatim as the record of a real analysis, and the per-target-tolerance mechanism they gesture at —
Destiny-style bullet magnetism, where the widened test applies *only* to the locked target — remains
the correct form of (B) if one is ever needed.

*Verbatim from the session that found the constraint, and that also found the `startUpMs` field which
softened its own verdict.*

> `lance` is the only weapon in the roster whose flight time (67 ms to the 400 u lock range) is shorter
> than the RTT bar — every other weapon sits at 3.8x–11.1x. It is therefore the one weapon where
> client/server disagreement about a car's position translates directly into a hit/miss flip, because
> the beam resolves before reality catches up. **It is not, however, the fairness failure I first
> reported: `startUpMs: 700` is a real sim-side wind-up, so the victim gets 700 ms — nearly nine times
> the RTT bar — to leave the line of fire, and the 57.5 u hitbox (2.5x normal width) already absorbs
> part of the residual error.** The options, in the order I'd recommend them:
>
> - **(C) Accept it, and watch it.** The 700 ms telegraph is the fairness mechanism and it is
>   generous; the 16 s cooldown means the residual flip is rare. Cost: nothing. Risk: this is the
>   single weapon most likely to generate "I dodged that" reports at 80 ms, and you should expect
>   them. **This is my recommendation** — the wind-up genuinely does the work, and the other two
>   options change a weapon that isn't broken.
> - **(A) Slow the beam: `speed` 6000 → ~1600.** Flight to 400 u becomes 250 ms (3.1x RTT), bringing
>   it in line with the rest of the roster; full 1200 range in 750 ms. Cost: the row's own comment —
>   "crosses its full 1200 range in 200 ms — a flash, not a sweep" — stops being true. It becomes a
>   visible sweep you can react to *after* commitment, which is a different weapon with a different
>   feel, arguably a better one, but not the one that was designed.
> - **(B) Widen the hitbox further** (57.5 → ~90) so position error can't flip the result. Cost: a
>   170-damage weapon on a 16 s cooldown becomes hard to miss. That's a significant power increase
>   bought to solve a netcode problem, which is the wrong currency.
>
> **Cutting `range` alone does not work** and shouldn't be offered: range doesn't change beam speed,
> so a 500 u lance still crosses a mid-range engagement in 83 ms — still about one RTT. Only speed or
> hitbox size moves the netcode number.

### 6.2 Residual disagreements, argued by the dissenting side in its own words

**C2 — the rewind dissent was withdrawn. The ruling is unanimous.** Verbatim:

> **Your mechanism argument is correct and I'm not going to have you print a case I no longer
> believe.** Rewind and extrapolation double-count the same latency in opposite directions: under C1
> the client has already moved the remote *forward* to its predicted present, so rewinding the server
> *backward* resolves the shot against a position the shooter never saw at any point in time — the
> error is the full RTT plus the extrapolation, worse than either model alone. That is a sign error,
> not a safety net, and "the framework gives it free" is not a reason to apply a term with the wrong
> sign. The two coherent packages are {interpolate + rewind} and {extrapolate + no rewind}; the cross
> terms are strictly worse than either. **Print the ruling as unanimous.** What I want on the record
> is only your own concession: keep ~30 ticks of pose history server-side (~3 KB) for the determinism
> differ, bug repro, and the dev overlay — authoritative for nothing. If a later measurement shows the
> C1 residual is worse than predicted, the data is there and turning rewind on becomes a decision with
> evidence behind it rather than a hedge taken blind today.

**C6 — the determinism deferral. Conditions accepted, one added.** Verbatim:

> I accept the LUT deferral exactly as you've conditioned it, including the pre-committed trigger, and
> your two corrections improve my argument rather than weaken it — you're right that identical
> quantisation on both sides is a different sim rather than a divergent one, and right that the failure
> mode is a **discrete branch flip** (a SAT separating-axis test flipping at the boundary, giving one
> side a collision the other doesn't have) rather than smooth drift. That is precisely why my "14
> orders of magnitude" framing was insufficient, and it's why the differ must hash **contact sets and
> collision booleans, not just poses**. Your cross-engine condition is the important one and I'd state
> it harder than you did: **a Node-vs-Chrome differ is not evidence of anything** — both are V8, and
> V8 and SpiderMonkey both ship fdlibm-derived implementations, so that pair is engineered to agree.
> The test that matters is **JavaScriptCore**, because Safari is a browser this game must run in and it
> is the one engine likely to disagree. One condition I'll add: the trigger should fire on a
> contact-set divergence **in either direction** within a 10-tick replay — including a divergence that
> heals on its own — because a flip that self-corrects still produced one frame where two players
> disagreed about whether they touched, and under a graded-impulse ram that is a real difference in
> outcome, not a cosmetic one.

**That added condition is accepted and is now part of C6's trigger**: a self-healing contact-set
divergence still fires the LUT.

### 6.3 Hosting

Recommendation requested and given: **host in-country, single region.** Local hosting wins twice — a
few milliseconds of raw latency, and, more importantly, it avoids the international gateway entirely.
Bangladeshi international traffic transits IIG operators and submarine cable capacity where evening
peak congestion is well documented; hosting in Mumbai or Singapore puts *every packet* across that
boundary. If the game feels fine in the afternoon and bad at 9pm, that is the cause.

Build region-readiness now even at one region (~1–2 days; adding region #2 later ≈ half a day): game
server is one stateless process per match, lobby service separate, region is a config row and never a
constant, and the client pings candidate regions on load and reports RTT with its join. That last one
gives a free latency map of the actual player base.

**Measure before committing**: in-country versus Mumbai versus Singapore, at evening peak, not at
midday.

---

## 7. What changes under the probes

Per `CLAUDE.md`'s playtest rule, stated loudly rather than discovered later:

**Essentially every probe in `packages/server/playtest/` measures something this plan moves.** Named
explicitly: the tick order in `ArenaRoom.tick`, `TICK_RATE_HZ` (30 → 60), `DEFAULT_PATCH_RATE_HZ`
(20 → 30), all of `NET_CONFIG`, `DRIVE_CONFIG` (the drive model itself), `RAM_CONFIG` (severity now
derives from impulse magnitude), the client's prediction and step-context assembly, and — if the
`lance` ruling goes that way — `WEAPON_TABLE`.

Consequences to expect: ram trigger rates change because contact resolution changes; collision depth
changes because per-tick displacement halves; prediction-error probes measure a different quantity
entirely once remotes are predicted rather than interpolated; and any report string quoting 30 Hz,
20 Hz, a tick count, or a hull dimension goes stale.

**`npm run playtest` is strongly recommended before P3 (to capture a baseline) and after P4, P6 and
P7.** The probes are not being updated as part of this plan, and should not be — keeping them honest
is maintenance the user asks for explicitly. The one exception is a probe that stops compiling, which
gets fixed on the spot because a probe that does not build measures nothing.

---

## 8. Unverified — work items, not conclusions

1. **Colyseus 0.18 downstream unreliable delivery — the top risk.** A secondary source says unreliable
   is client → server only "in the initial iteration"; the official transport and netcode pages state
   no delivery guarantee in either direction, so this is **neither confirmed nor refuted**. If server
   → client remains ordered, head-of-line blocking persists on *both* transports and C9's second phase
   stays gated. **Check this before committing to the transport story.**
2. **Whether 0.18's `Predict` (`reckon` mode), `predict.spawns`, `setFixedTimestep` and
   `predict.reconciler` fit this design** or must be bypassed. The design is deliberately independent
   of them; if they fit, P5–P6 shrink materially.
3. **Colyseus 0.15 → 0.18 migration cost.** Three minor versions including a schema-encoder change.
   Unmeasured.
4. **Cross-engine determinism** (C6's trigger measurement). Must include Safari/JavaScriptCore — a
   Node-vs-Chrome run is not evidence.
5. **How often input transitions fall inside the extrapolation window, and whether they cluster at
   contact.** This is the single measurement that decides how good C1 actually is — §4.1's mean-error
   figures assume 2–5 transitions/second and that assumption is unmeasured. §3.4's input logging gives
   it directly. **The same measurement decides `skewer`** (§6.1): its exposure is entirely a function
   of how often a target manoeuvres inside the window at 80–120 ms.
6. **What fraction of shots are actually fired in the manual zone** (beyond `AIM_CONFIG.lockRange`) —
   **the single load-bearing unknown in all of C12, and second in priority only to item 1.** §1.3.1's
   position-exposure analysis applies only there, because a locked shot is self-correcting. The
   unprotected band is 27–67% of each assisted weapon's reach, and `lockRange` is only 31% of the
   arena width, so this is not a safely-small number by inspection. If most shots land inside 400 u,
   exposure is near zero and "change nothing" is clearly right; if players routinely poke from 600 u,
   the conclusion changes. The per-weapon hit-rate readout in the debug overlay gives it for free.
7. **The impulse solver's CPU cost.** The 0.88%-of-a-core benchmark used the current `resolveWorld`,
   not C8's solver. Expected same order, unverified.
8. **Evening-peak latency**, in-country versus Mumbai versus Singapore (§6.3).
9. **The TTK matrix is a damage ceiling**, not a prediction of real time-to-kill — `scripts/ttk.mjs`
   says so in its own header. §1.1's conclusion relies only on the ceiling being reachable, which for
   `afterburner` means 0.7 s of sustained contact.
10. **Nothing in this plan has been playtested.** Every figure is derived from tables, benchmarked in
   isolation, or simulated. See §7.

---

## 9. Sources

Netcode models — [Gaffer On Games: State Synchronization](https://gafferongames.com/post/state_synchronization/) ·
[Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/) ·
[Gabriel Gambetta: Lag Compensation](https://www.gabrielgambetta.com/lag-compensation.html) ·
[CrystalOrb (predict-everything analysis)](https://github.com/ErnWong/crystalorb) ·
[Client-side prediction](https://en.wikipedia.org/wiki/Client-side_prediction)

Shipped titles — ['Overwatch' Gameplay Architecture and Netcode, Tim Ford, GDC 2017](https://www.gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and) ·
[Overwatch netcode deep dive (input buffer, time dilation)](https://edgegap.com/blog/game-backend-deep-dive-overwatch-2016-netcode-architecture-rollback) ·
[Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking) ·
[Valve: Lag Compensation](https://developer.valvesoftware.com/wiki/Lag_Compensation) ·
[Valve: Interpolation](https://developer.valvesoftware.com/wiki/Interpolation) ·
[Enhancing multiplayer shooter experience via advanced lag compensation (ACM MMSys'18)](https://dl.acm.org/doi/10.1145/3204949.3204971)

Transport — [WebSocket vs WebTransport (support status, 2026)](https://websocket.org/comparisons/webtransport/) ·
[Colyseus WebTransport](https://docs.colyseus.io/server/transport/webtransport) ·
[Colyseus Transport](https://docs.colyseus.io/server/transport) ·
[Colyseus docs](https://docs.colyseus.io/)

Determinism — [Rapier: Determinism](https://rapier.rs/docs/user_guides/javascript/determinism/) ·
[Rune: Making JS deterministic](https://developers.rune.ai/blog/making-js-deterministic-for-fun-and-glory)

Aim assist and projectile exposure (§1.3.1) — [Halopedia: Auto-aim](https://www.halopedia.org/Auto-aim) ·
[Halopedia: Magnetism](https://www.halopedia.org/Magnetism) ·
[Bungie forums: bullet magnetism as effective hitbox enlargement](https://www.bungie.net/en/Forums/Post/208469742) ·
[Blizzard forums: Overwatch has no homing projectiles; auto-lock weapons are hitscan](https://us.forums.blizzard.com/en/overwatch/t/what-is-blizzards-stance-on-homing-projectile-weapons/551702) ·
[Netcode Series Part 4: Projectiles (lag compensation and prediction)](https://medium.com/@geretti/netcode-series-part-4-projectiles-96427ac53633) ·
[Hitscan](https://en.wikipedia.org/wiki/Hitscan)
