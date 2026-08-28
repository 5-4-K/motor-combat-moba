# Invariant Reconciliation — Decisions

**Date:** 2026-08-28
**Status:** In progress — 1 of 8 resolved
**Companion:** the invariant audit (artifact), `NETCODE_INVARIANTS.md`, `BROWSER_CLIENT_INVARIANTS.md`

The audit found eight axiom-level conflicts between the supplied invariant documents and this
codebase. This file resolves them one at a time and records why. Decisions are numbered `R1…R8` and
are stable — never renumber, same rule as `D1–D22` and `A1–A14`.

---

## R0 — Scope and targets (governs every decision below)

**LAN is a v1 convenience, not the product.** The goal is an online multiplayer game with players on
mixed connections. Every ruling in this file is therefore made for the **online** case. A problem
that only shows up over the internet is still a problem to solve; a problem that only shows up at
extreme ping may be deferred.

This supersedes the v1 spec's framing (*"Product deploy: LAN only"*) as a **statement of intent**,
not as a change to what v1 ships. v1 still ships LAN. What changes is which decisions we are allowed
to make cheaply now and pay for later.

### Latency targets

The stated goal was "smooth feel and competitive accuracy to 70 ping." Recommend raising it, in
tiers, for one reason: **jitter, not mean ping, is what breaks feel.** A 70 ms mean with 25 ms jitter
behaves like a 95 ms link at the moments that matter, so designing to a 70 ms mean puts the P95
player outside spec on their own connection.

| Tier | RTT | Requirement |
|---|---|---|
| **Feel parity** | **≤ 80 ms** | Indistinguishable from LAN. Trigger response, car response, shot appearance. |
| **Competitive fairness** | **≤ 130 ms** | May feel slightly heavier; must not be *systematically less accurate*. Ping must not decide fights. |
| **Honest degradation** | 130–250 ms | Playable, and the player is told their connection is marginal. |
| **Refused** | > 250 ms | Rejected at connect with a clear message (matches I-N6.3's max client lead). |

**Feel and fairness are different problems with different fixes.** Feel is bought with prediction —
the client acts immediately and reconciles. Fairness is bought with lag compensation — the server
judges a shot against what the shooter could actually see. Neither substitutes for the other. Most of
the disagreement between the invariant documents and this codebase is really about the first.

### The arithmetic that drives R1

Time from key press to seeing your own shot, with today's design (server-only spawning):

| Term | LAN | 70 ms RTT |
|---|---|---|
| Input uplink (one-way) | ~1 ms | ~35 ms |
| Server tick quantisation (30 Hz) | ~17 ms avg | ~17 ms avg |
| Patch wait (20 Hz) | ~25 ms avg | ~25 ms avg |
| Patch downlink (one-way) | ~1 ms | ~35 ms |
| **Total** | **~44 ms avg, 83 ms worst** | **~112 ms avg, ~145 ms worst** |

On LAN this is borderline. At the target it is not: 112 ms is well past where players read a weapon
as mushy. **Raising the patch rate does not save it** — going 20 → 30 Hz recovers about 8 ms of a
112 ms budget. The dominant terms online are the two network hops, and the only thing that removes
them is prediction.

---

## Register

| # | Conflict | Ruling | Status |
|---|---|---|---|
| R1 | Projectile prediction (I-N4.1) | Predict both tiers; keep I-N4.1's intent, tighten its wording; blocked on R3 for lock-derived weapons | ✅ Resolved (revised) |
| R2 | Simulation tick rate (30 vs 60 Hz) | Six sub-points; **R2.1 resolved** — see below | 🟡 In progress |
| R3 | Remote car handling (interpolation vs input replication) | Predict remotes through the shared roster step; replicate *current* input as state, not input *history* as a stream | ✅ Resolved — **unblocks R1 tier 2** |
| R4 | Transport (WebSocket vs WebRTC DataChannel) | Seven sub-points; R4.3/R4.6 conditional on a measurement not yet taken | ✅ Resolved on paper |
| R5 | Input redundancy (I-N5.3) | — | ⬜ Open |
| R6 | Tick sync / client lead (§6) | — | ⬜ Open |
| R7 | Design resolution (1280 vs 1424) | — | ⬜ Open |
| R8 | HTTPS / secure context (I-C10.7) | — | ⬜ Open |

---

## R1 — Projectile prediction

> **Revised 2026-08-28** after R0 established online play as the target. The first ruling
> ("keep server-only spawning, predict only the fire event") was correct for a LAN game and is
> wrong for this one. The analysis below is unchanged; the conclusion is not.

**Conflict.** I-N4.1 requires projectiles to be *"fully predicted on the client."* This project spawns
them server-only and draws `state.weapons`.

**Ruling: predict projectiles, in two tiers, and keep I-N4.1's intent while fixing its wording.**

### What survives from the first ruling

Two findings still stand and are not affected by the scope change.

**1. The audit's "responsiveness vs. correctness" framing was wrong.** I-N4.2 already keeps damage
server-authoritative, so a predicted projectile is a *drawing* and cannot change who dies. The
project's written objection — *"a mispredicted bullet is a phantom kill, and there is no honest way
to reconcile 'you were dead for 80 ms'"* — argues against a design nobody proposed. The real axis is
responsiveness vs. presentational fidelity.

**2. I-N4.1's premise, as written, is false.** It claims the trajectory is a pure function of *"the
firing car's facing at that tick."* For any weapon with `usesAimAssist`, the angle is
`atan2(lockTarget − muzzle)` — a function of a *remote car's* position. That wording has to change
regardless of the ruling.

### What changed: the fire-event-only fix does not survive online

The previous ruling was "predict the muzzle flash, sound and HUD cooldown; let the bullet come from
the server." On LAN, flash at 0 ms and bullet at ~44 ms reads as one event.

At 70 ms RTT the bullet arrives ~112 ms after the flash. **That is worse than no flash at all** — a
muzzle flash followed by a bullet an eighth of a second later does not read as a weapon firing, it
reads as two unrelated events. The half-measure is LAN-shaped, and R0 says we are not building a LAN
game.

So the projectile itself has to be predicted. Which means the aim-assist problem must be **solved**
rather than avoided.

### It is solvable, and cheaper than expected

The blocker was: the client cannot know the lock angle, because `updateLock` runs server-side and
A14 puts none of its internals on the wire.

Checking that assumption against the code: **`updateLock` is already a pure function exported from
`@motor-combat-moba/shared`**, taking an explicit `UpdateLockContext`. `AIM_CONFIG` and `AIM_TICKS`
are exported alongside it. `signedAngleDegTo`, `lockScore`, `inAcquireRegion`, `inRetainRegion`,
`hasLineOfSight` — all shared, all pure. Nothing needs to be built or moved for a client to run the
identical lock.

The only missing ingredient is **a good estimate of remote car poses at the spawn tick.** That is
not an aim-assist problem. It is R3.

**A14 does not block this, and relaxing it costs nothing.** A14 keeps the lock's internals off the
wire for wire economy, not anti-cheat. A client that runs its own lock and picks a *better* target
gains nothing: the server still computes its own lock authoritatively and fires along that angle. A
hacked client would simply mispredict and watch its own tracer get corrected. A14 becomes
*"server-authoritative; the client may predict it"* — the same relationship `stepSim` already has.

### The two tiers

Predictability is already a property of the weapon definition. Make it explicit.

**Tier 1 — self-derived (`usesAimAssist: false`).** Trajectory is a pure function of the client's own
predicted pose plus the weapon def. `muzzleOf(localPose)`, angle = `localPose.angle`, speed and range
from `WEAPON_TABLE`, and spread from `fanOffset` — which is deterministic, evenly sampled, with no
RNG anywhere in it. **Fully predictable today, with no dependency on anything.** I-N4.1 as written is
correct for this tier. `repeater` is the shipped example.

**Tier 2 — lock-derived (`usesAimAssist: true`).** Additionally requires the client to run
`updateLock` on its own estimate of remote poses. Prediction quality is exactly the quality of that
estimate, which is R3's subject:

- **Under today's interpolation** (remotes rendered 50 ms in the past, patches 20 Hz): the target's
  pose is 50–100 ms stale, a 540 u/s car has moved 27–54 units, and at `lockRange` 400 the shot
  lands 27–54 units off — at or beyond the ~28-unit tolerance `AIM_CONFIG` computes for itself
  (half a 32-unit car plus the 12-unit hitbox). **About one car width. Too much.**
- **Under input replication** (I-N0.1/I-N3.2, R3's subject): the client predicts remotes forward from
  their inputs, so its estimate at the spawn tick is close to exact and the residual error is a
  fraction of a car width. **Good enough.**

So **R1 Tier 2 is blocked on R3.** If R3 keeps interpolation, Tier 2 weapons stay server-spawned and
we accept a mushier trigger on them. If R3 adopts input replication, Tier 2 predicts as well as
Tier 1. That coupling should be decided in R3 with R1's cost on the table — not rediscovered later.

### Divergence handling

A predicted shot is **provisional** and cosmetic. It never applies damage (I-N4.2 unchanged). When
the server's authoritative instance arrives:

- **Adopt it.** Blend the provisional onto the authoritative pose over a few frames rather than
  snapping — the same easing rule `reconcile` already uses for the car, and for the same reason.
  Nobody tracks a bullet's exact path, so a tracer that curves slightly for two frames is nearly
  invisible where a car snapping is not.
- **Snap past a threshold**, exactly as `reconcileSnapPos` does. A large divergence means the
  prediction was wrong about something structural; easing it is a slow slide to the same place.
- **Retire silently** if no matching instance arrives within the window — the server refused the
  shot. The player saw a tracer and no impact, which reads as a misfire.

**Precondition, and the one real cost:** `WeaponInstanceState` carries `id`, `ownerSessionId`,
`weaponId`, `kind`, pose and `spawnTick` — but **no input `seq`**. There is no key to match a
provisional client shot against a server instance. Adoption needs that field. It is one `uint32`,
and it is unavoidable.

### Predict the fire event too — this part was right, and is now a floor

Independent of tier, and worth doing first because it is cheap and helps every weapon:

- Muzzle flash at `muzzleOf(localPredictedPose)` on the fire tick.
- Weapon sound on the same tick, once an audio system exists.
- **HUD cooldown starts locally** — needs no new wire field, since `cooldownMs` and `msToTicks` are
  already shared. The client computes a provisional `rechargeEndsTick`; the server's value overwrites
  it on the next patch.
- All of it behind a **fresh-tick guard** (I-N3.8). The project has no such guard today because it
  has nothing to guard — this is the change that creates the need, and it must land with it.

### The amendment

Replace I-N4.1 with:

> **I-N4.1** A projectile is predicted on the client when its trajectory is derivable from state the
> client holds. Two tiers, and a weapon definition states which it is:
>
> - **Self-derived** — trajectory is a pure function of the firing client's own input and own
>   predicted pose. Always predicted. Spread must be deterministic or seeded from replicated state;
>   never `Math.random()`.
> - **Lock-derived** — trajectory additionally depends on another entity's pose. Predicted only where
>   the client's estimate of that pose is accurate to within the weapon's own hit tolerance.
>   Otherwise drawn from server state.
>
> **I-N4.1a** Predictability is a property of the weapon definition, not a per-call-site judgement.
> Targeting logic used for prediction is the *same shared function* the server runs — never a second
> implementation (§2.2). The server's result remains authoritative; the client's is a prediction of
> it, exactly as with `stepSim`.
>
> **I-N4.1b** Where a projectile is not predicted, **the fire event still is.** Muzzle flash, weapon
> sound, recoil and the HUD cooldown fire on the input tick, from local state, behind a fresh-tick
> guard (§3.8). *"The shot is server-spawned"* is never a reason for the trigger to feel dead.
>
> **I-N4.1c** A predicted projectile is **provisional**: it carries the input `seq` that spawned it,
> is adopted by the matching server instance on arrival — blended, not snapped, below a configured
> divergence threshold — and is retired silently if no match arrives within the reconciliation
> window. It never applies damage (§4.2 unchanged).

I-N4.2, I-N4.3, I-N4.5, I-N4.11 and I-N4.12 are untouched and already held.

---

## R2 — Simulation tick rate

**Conflict.** The rules fix simulation at **60 Hz**, input send at 60 Hz and snapshots at 30 Hz.
This project runs `TICK_RATE_HZ = 30`, input at 30, `DEFAULT_PATCH_RATE_HZ = 20`.

Being resolved point by point. Only R2.4 is genuinely a product judgement; the rest follow from
evidence.

| # | Sub-decision | Status |
|---|---|---|
| R2.1 | Author durations in ms, not ticks | ✅ Do it first, unconditionally |
| R2.2 | One rate, or split by subsystem | ✅ One rate |
| R2.3 | The `TICK_RATE_HZ` env override | ✅ Remove it |
| R2.4 | **The sim rate itself** | ✅ Hold at 30 Hz, revisit after R3b |
| R2.5 | The patch rate | ✅ Hold at 20 Hz; decision moves to R4 |
| R2.6 | CPU budget, both ends | ✅ Numbers set, measurement mandated |

### R2.1 — Author durations in ms, derive ticks once. Do it *before* deciding the rate.

**Resolved: convert now, as its own change, ahead of any rate decision.**

Four constants are written as tick counts, so their real duration is a function of `TICK_RATE_HZ`:

| Today | at 30 Hz | at 60 Hz, untouched | Becomes |
|---|---|---|---|
| `collisionDamageCooldownTicks: 15` | 500 ms | 250 ms | `collisionDamageCooldownMs: 500` |
| `reverseHoldTicks: 2` | 66 ms | 33 ms | `reverseHoldMs: 66` |
| `NET_CONFIG.pendingInputCap: 24` | 800 ms stall tolerance | 400 ms | `pendingInputMs: 800` |
| `NET_CONFIG.maxInputsPerTick: 5` | 166 ms catch-up | 83 ms | `maxCatchUpMs: 166` |

Everything else already derives correctly — the whole weapon table and `AIM_TICKS` through
`msToTicks`, `FLOW_CONFIG` in seconds. **This is not a new pattern; it is finishing D6's.**

The last two look like ratios rather than durations. They are not. `maxInputsPerTick` exists to
absorb *"a hitch and the catch-up burst that follows"*, and a hitch is a real-world duration: a
100 ms stall is 3 ticks of backlog at 30 Hz and 6 at 60 Hz, so holding the tick count fixed would
halve the tolerance for the same real stall. Same for `pendingInputCap`.

**Why unconditionally, and why first.**

- **It is correct at 30 Hz too.** Today anyone who touches `TICK_RATE_HZ` — including the env
  override in finding N-3, which is how you would tune it for testing — silently re-balances ram
  cooldown, reverse debounce, stall tolerance and catch-up window. Same class as the N-3 desync, but
  quieter: nothing breaks visibly, the game just plays differently with no signal.
- **It defuses R2.4.** Most of what makes 30-vs-60 feel expensive is *"everything re-derives, what
  breaks?"* After R2.1 the answer is *nothing does* — the rate becomes one constant plus a CPU
  measurement, with no balance movement.
- **It buys the option to defer.** The strongest argument for 60 Hz is R3b's spin, and that mechanic
  does not exist yet — its ω range is unknown until the impulse model is tuned. With the rate cheap
  to change, we need not bet on it now.

**Cost:** small and mechanical. `msToTicks` rounds up (`Math.ceil`) so a derived duration is never
shorter than authored, which is already the weapon table's documented trade. `reverseHoldMs: 66`
lands exactly on 2 ticks at 30 Hz; the others round by under a tick.

**Amendment:**

> **I-N10.7** *(new)* Every gameplay duration is **authored in milliseconds** and converted to ticks
> through one shared derivation. A duration written directly as a tick count is a defect: it makes
> the tick rate a balance change rather than a knob, and it changes behaviour silently when the rate
> moves. Tick counts appear only as the *derived* form.

This strengthens I-N10.2 rather than replacing it: tuning data stays part of the protocol version,
but the rate itself stops being a hidden tuning change.

### R2.2 — One rate. No per-subsystem split.

The tempting split is drive and collision at the high rate, combat at the low one: cooldowns, lock
timers and hit tests are perceptual rather than physical, and `AIM_TICKS` would not notice.

**Rejected.** I-N2.1 mandates a single fixed timestep, and the saving is small at six players while
the cost is a second determinism surface — two tick counters that can drift apart, two replay orders
to reproduce, and R3's `stepRoster` needing to know which rate it is being called at. Decisively:
`runCombat` runs *after* driving each tick and reads the poses driving just produced, which
`combat-model.md` calls *"the rule, not an implementation detail."* A split breaks that ordering
guarantee for every tick where only one of the two ran.

### R2.3 — Remove the `TICK_RATE_HZ` env override.

`getTickRateHz` overrides the **server only**, while the client and `msToTicks` stay on the
compiled-in constant. Setting it desyncs every connected client with no error anywhere — finding
N-3. It is not a tuning knob; it is a footgun wearing one's clothes.

R2.1 makes it *more* dangerous, not less: with durations authored in ms, changing the rate is safe
**only if both ends change together**, and this override guarantees they do not. If runtime rate
tuning is ever wanted, it belongs in the version handshake (I-N10.1), where a mismatched client is
rejected rather than silently diverging.

### R2.4 — Hold at 30 Hz. Revisit after R3b's impulse model exists.

**The rules' 60 Hz is not adopted now.** The reasoning is sequencing, not disagreement.

The strongest argument for 60 Hz is R3b: at `turnRate` 4.2 rad/s a 30 Hz tick is 8° of rotation, and
an impulse-driven spin will exceed that. But **that mechanic does not exist yet**, and its actual ω
range is unknown until the impulse model is built and tuned. Moving now pays real cost — the server's
per-tick budget halves, the client's roster work doubles on top of R3's 6×, and the input send rate
doubles, which R5 would then have to absorb — for a benefit that cannot yet be measured.

R2.1 is what makes deferring safe. The flip is one constant plus a CPU measurement, with **no balance
movement at all**. The cost of being wrong is re-measuring once; the cost of guessing right now is
paid whether or not it was needed.

**Reopen R2.4 when:** the impulse resolver lands and produces a measured angular velocity range. If
peak ω exceeds roughly half a tick's worth of rotation — aliasing territory — move to 60. Record the
measurement either way, because it is the number Gate G7 never produced in the predecessor.

### R2.5 — Hold the patch rate at 20 Hz. The decision properly belongs to R4.

**R3 changed what this number means.** It was "how fresh remote cars look." It is now **how often
every car's prediction is corrected** — remotes are predicted, so the patch rate no longer sets
visual lag.

That reframing matters for why remote prediction is a win at all: interpolation is a *constant*
76–110 ms lag on every frame, while prediction is **exact while a remote holds steady input** — which
in a driving game is most of the time — and wrong only in the ~112 ms window after an input edge,
with the error growing from zero. The patch rate is one term in that window, and the smallest: going
20 → 30 Hz recovers about 8 ms of ~112 ms.

**Not changed now, because bandwidth headroom is what actually gates it, and the wire format is
broken.** Poses ship as raw float64 (finding N-4, I-N5.7): ~4.8 KB/s at 20 Hz, ~7.2 KB/s at 30 Hz
against a 12 KB/s budget. Fix the quantisation first and the headroom question answers itself.

**Moved to R4**, because transport decides what a snapshot costs and whether delta-against-acked-
baseline (I-N5.6) survives on an unreliable channel. Deciding patch rate before transport would be
deciding it twice.

### R2.6 — Budgets, and the measurement that has never been taken.

At 30 Hz the server has **33.3 ms** per tick. The rules' figure is ≤ 4 ms of 16.6 ms at 60 Hz — 24 %
utilisation — so the equivalent here is:

| | Budget | Notes |
|---|---|---|
| Server tick, 6 players worst case | **≤ 8 ms** of 33.3 ms | I-N8.1's "worst case" means max projectiles and beams live, not an average moment |
| Client roster step + replay | **≤ 4 ms** of 33.3 ms | New cost, created by R3: six `stepSim` calls per tick plus reconciliation replay |

**Neither has ever been measured, in this project or the predecessor** — Gate G7 was opened for
exactly this and left OPEN. R3 is what makes the client figure non-trivial, so the measurement lands
with R3's implementation rather than as separate work. I-N8.1 stays GUARDED until both numbers exist.

Note the interaction with R2.4: these budgets are the evidence that decides whether 60 Hz is
affordable. Measuring them at 30 Hz is what makes the later flip a calculation instead of a gamble.

---

## R3 — Remote car handling

**Conflict.** I-N0.1 forbids interpolation-in-the-past for cars and I-N3.2 requires remotes to be
predicted forward from replicated inputs. This project interpolates remotes at
`now − interpolationDelayMs`.

**Ruling: adopt remote prediction. Take the cheap path — replicate each car's *current* input as
schema state, not its input *history* as a stream, and predict the whole roster through one shared
function.**

### This is not only an online problem. It ships today.

How far behind the server a remote car is drawn, end to end:

| Term | LAN | 70 ms RTT |
|---|---|---|
| Patch wait (20 Hz, average) | ~25 ms | ~25 ms |
| Downlink (one-way) | ~1 ms | ~35 ms |
| `interpolationDelayMs` | 50 ms | 50 ms |
| **Total behind server truth** | **~76 ms** | **~110 ms** |
| At 540 u/s, that is | **41 units** | **59 units** |

A car is 48 × 32. **Even on LAN, a rectangle at top speed is drawn roughly a full car length behind
where the server has it.** Online it is a car length and a quarter.

For a game whose core damage mechanic is *ramming*, that is the wrong number to be wrong by. Two cars
closing head-on at 540 each carry 1080 u/s of relative motion: 82 units of closing-distance error on
LAN, 119 online. The server decides the ram correctly — but from poses that never matched what either
player saw.

### The bug underneath it: a car has three different positions right now

There are three answers in the codebase to "where is that remote car," and they disagree:

| Used for | Source | Age vs. server truth |
|---|---|---|
| **Drawing it** | `InterpolationBuffer.sample(now − 50 ms)` — `ArenaScene.ts:793` | ~76 ms (LAN) |
| **Colliding against it** | raw `state.players` pose — `step-context.ts`, `otherCarHulls` | ~26 ms (LAN) |
| **Server's own contact resolution** | current tick | 0 |

The first two differ by the whole interpolation delay — **27 units at 540 u/s, more than half a car
width.** The local player's prediction bounces off a hull that sits half a car ahead of the sprite
that car is drawn as. You bounce before you visibly touch.

`step-context.ts` documents the choice and its reasoning:

> Remotes enter at their last-known *server* pose. The client predicts only itself, and that is also
> what the server saw when it built its own `others`.

That is true of the tick the patch *describes*, and false of the tick the client is *predicting* —
which is several ticks later. The reasoning holds only if the client never predicts forward, and the
client always predicts forward.

**Prediction fixes this by construction**, because there is then one predicted pose per car per tick
and all three consumers read it.

### The cheap path — and why the expensive one buys nothing

I-N3.4 as written wants full input replication with per-remote input buffers and rollback-replay of
all six cars. That is not necessary here, for one reason that is easy to miss:

**Under *either* design the client does not have remote inputs for the ticks it is extrapolating.** A
remote's input for tick T reaches you at T + their uplink + your downlink. Both designs therefore
extrapolate over the same window, with the same rule — repeat the last known input.

What the full input stream adds is *resolution on already-past ticks*: an input history records edges
at the send rate (30 Hz) rather than at the patch rate (20 Hz). But those ticks are exactly the ones
the corrective snapshot is about to overwrite, and I-N0.2 already says we keep that snapshot rather
than pursuing exactness. The expensive machinery buys accuracy the architecture discards.

**So replicate the input as state.** `PlayerState` already carries `speed` and `reverseHold` — the
derived fields `stepSim` needs. Add the two it lacks:

- `steer` and `throttle` are each `-1 | 0 | 1` — nine combinations, four bits. Packed with `fireSlots`
  they fit in **one `uint8`**: `@type("uint8") inputBits`.
- Cost: 1 byte per player per patch — about **120 B/s** at six players and 20 Hz. Against the
  ~4.8 KB/s the float64 poses already cost, this is nothing.

With that, the client holds everything `stepSim` needs to advance any car, and I-N3.3 ("repeat their
last known input") is satisfied *structurally* — the last patched value **is** the last known input.

### The real work: lift the roster loop into shared

This is the substantial piece and the honest price of R3.

Today `serverTick` (`packages/server/src/sim/tick.ts`) owns the whole-roster loop — sorted
`sessionId` iteration, per-player context assembly, sequential contact resolution — and the client's
`buildStepContext` builds a context for **one** player. The two sides share the single-body `stepSim`
but each orchestrates the roster its own way, and *the orchestration is where the order-dependence
lives*. Both files say so, at length:

> `resolveWorld` applies contacts sequentially over `others`, and the last contact resolved is the
> one guaranteed to end separated. Two hulls swapped here can settle a squeezed car on a different
> pose.

To predict every car, the client must reproduce that ordering exactly. So:

1. **Add `stepRoster(entries, inputs, world, dt)` to shared** — sorted iteration, sequential context
   assembly, per-player `stepSim`, returning the whole roster's next poses.
2. `serverTick` becomes a thin adapter: drain queues → `stepRoster` → write back to schema.
3. The client calls the *same* function each predicted tick, with its own input from its buffer and
   each remote's input from that remote's last-patched `inputBits`.
4. `buildStepContext` folds into it; the client no longer needs a one-player context.

**This completes hard invariant #4 rather than complicating it.** "`stepSim` is the lockstep; server
and client import the same function" is currently true of the body step and false of everything
around it. After this it is true of the tick.

### Reconciliation becomes uniform

Every car — local and remote — is predicted and then reconciled against each authoritative snapshot
by the same snap/ease rule the local car already uses (`reconcileSnapPos`, `reconcileSnapAngle`,
`reconcileEaseRate`). One code path; the only difference between cars is where the input comes from.

`InterpolationBuffer` retires. `blendPose` stays — the sub-tick render blend is a different mechanism
solving a different problem (sim rate below frame rate) and is still needed.

**Remote thresholds need their own tuning.** A remote's error profile is not the local car's: local
error is latency-driven and roughly continuous, remote error is *input-edge* driven and arrives in
steps when a car starts or stops turning. Expect different numbers, and measure them rather than
inheriting the local ones.

### The project's stated objection to extrapolation does not apply

`interpolation.ts` explains why it holds rather than extrapolates past the newest snapshot:

> Extrapolation would guess a pose the server never authorised — sliding a coasting car through a
> wall it actually bounced off.

**That is correct for *linear* extrapolation and void for *simulated* extrapolation.** Advancing a
remote through `stepSim` runs `resolveWorld`, so the car bounces off the wall exactly as the server's
did. The project rejected the right thing for the right reason and then generalised it one step too
far.

### What this does and does not buy — stated honestly

It does **not** put remotes at their true present pose. It replaces *"interpolate between two stale
poses and land 76–110 ms behind"* with *"integrate forward through the real physics and land
approximately at the present, wrong only where the remote changed input inside the window."*

For this drive model that is a very good trade. `stepDrive` is constant turn rate plus constant
acceleration — no chaos, high inertia, continuous input. A remote that was turning keeps turning,
which is right most of the time. The residual error appears only at input *edges* and is a small
angular divergence, not a teleport. I-N0.1's own rationale says exactly this, and it is correct here:

> Arcade tank-like handling has low chaotic divergence, so input-based prediction of remote cars
> stays accurate over the prediction window.

Had this been a twitch shooter with instant direction changes and small hitboxes, the answer would be
the opposite and interpolation would win.

### Costs and consequences

- **Remotes gain visible corrections** where today they are smooth-but-late. That is the trade being
  made deliberately: a small correction at an input edge, against a systematic full-car-length lag on
  every frame.
- **CPU:** six `stepSim` calls per predicted tick instead of one, plus replay. Trivial at six players;
  `stepSim` is a handful of trig operations and a SAT pass.
- **I-N7.4 becomes live.** Predicting a car requires replicating its input, so a future
  limited-visibility mode cannot predict cars it does not replicate. Checked
  `docs/ideas/brawl-mode-design.md` — no fog-of-war or follow-camera mode is planned, so this is a
  noted consequence, not a blocker. It is also exactly why I-N7.2's outbound filter seam matters.
- **Interacts with R2.** At 60 Hz the prediction window is twice as many ticks but each tick is a
  smaller error. Decide R2 knowing this loop now runs six times per tick on the client.

### What it unblocks

**R1 tier 2.** With remotes predicted, the client's estimate of a lock target's pose at the spawn
tick is close to exact, so it can run the shared `updateLock` and predict aim-assisted shots to
within the ~28-unit hit tolerance. R1's blocker is removed by this ruling.

### The amendment

> **I-N3.2** Remote cars are **predicted forward through the same shared roster step the server
> runs**, never interpolated in the past. A remote's input is the last input replicated for it.
>
> **I-N3.3** *(unchanged)* — satisfied structurally: the last replicated input *is* the last known
> input, so a missing patch degrades into input repetition with no special case.
>
> **I-N3.4** Every input the local player sends is stamped with a tick and buffered until
> acknowledged; on an authoritative snapshot the client rewinds to it and replays its own buffered
> inputs. Remote cars are re-based on the snapshot and re-integrated forward from their replicated
> input; **they carry no input history.** Replicating full remote input history is not required,
> because the corrective snapshot (§0.2) supersedes any accuracy it would add on already-past ticks.
>
> **I-N3.9** *(new)* One car is predicted exactly as any other. Server and client advance the **whole
> roster** through a single shared function — neither side may privately own the iteration order, the
> context assembly, or the contact-resolution sequence.
>
> **I-N3.10** *(new)* A car has **one predicted pose per tick.** The pose used to draw it, the pose
> used to collide against it, and the pose reconciled against the snapshot are the same value. Where
> these are allowed to differ, players bounce off cars that are drawn somewhere else.

I-N0.1 is honoured as written. I-N0.2 is unchanged and is the reason I-N3.4 could be relaxed.

---

## R4 — Transport

**Conflict.** I-N5.1 mandates WebRTC DataChannel `{ordered: false, maxRetransmits: 0}`, with
reliable-ordered reserved for join/leave, round transitions, chat and results (I-N5.4). This project
runs Colyseus over WebSocket for everything. R2.5 also handed R4 the patch rate.

| # | Sub-decision | Status |
|---|---|---|
| R4.1 | The measurement rig — R4 cannot be decided without it | ✅ Resolved |
| R4.2 | What must actually be replaced | ✅ Boundary named |
| R4.3 | WebRTC vs WebTransport vs stay | ✅ Conditional on R4.1's result |
| R4.4 | Replace Colyseus, or hybrid | ✅ Hybrid, if it comes to it |
| R4.5 | Degraded-mode signalling | ✅ Resolved |
| R4.6 | The patch rate (from R2.5) | ✅ Hold 20 Hz; reframed and gated on N-4 |
| R4.7 | Sequencing relative to R3 | ✅ Resolved |

**R4.3 and R4.6 are deliberately conditional.** The measurement has not been taken — this session was
paper only. Conditional rulings are what stop that deferral becoming a fresh design argument later:
whoever runs the rig inherits a lookup, not a debate. The acceptance criterion in R4.1 was fixed
*before* any number exists, for the same reason.

### R4.1 — The measurement rig. R4 is not decidable on today's evidence.

**Resolved: build a deterministic harness that models both transports, before ruling on R4.**

#### The evidence we have does not cover the case in question

The predecessor's measurement is the strongest argument for staying on TCP:

> Over the real transport, reconciliation is exact at any latency. Colyseus rides WebSocket/TCP,
> which never reorders or drops … Measured peak error at 40 ms, 150 ms and 400 ms one-way: **0**.

Two caveats it needs, and they are decisive:

1. **It was measured with only the local car predicted.** After R3 every car is predicted, and the
   quantity at risk is remote prediction error, which that harness never produced.
2. **It was measured with no packet loss** — their injector had no loss knob either. *"Exact when
   nothing is lost"* is trivially true of any transport. **The measurement does not cover the case
   where TCP hurts.**

#### And this project cannot reproduce that case at all

Three limits, all already in the findings register:

- **No loss knob** (N-9) — only `SIM_LATENCY_MS` / `SIM_JITTER_MS`.
- **Inbound only.** `withSimulatedLatency` wraps the input `enqueue` in `ArenaRoom`; nothing
  intercepts outbound patches, because Colyseus broadcasts internally. **Downstream loss — the case
  that matters most — is unreproducible.**
- **It is the predecessor's pre-fix version** (N-12), reordering inputs in a way TCP never does. So
  it is simultaneously too harsh in one dimension and blind in another.

#### What the question actually turns on

> **TCP converts loss into latency spikes. Unreliable plus redundancy converts loss into nothing.**

Head-of-line blocking means one lost packet stalls everything behind it for at least one RTT. At
70 ms and 1 % loss that is roughly a 70 ms stall every 5 s; at 3 %, every 1.7 s. During each stall the
client keeps predicting all six cars from stale inputs, and error grows. Unreliable delivery skips
the lost packet: one correction is missed, nothing stalls.

**Whether that matters is an empirical question with a measurable answer.** R4 should not be decided
by argument.

#### Two rigs, not one

The predecessor arrived at this split and explained it; inherit both halves.

| | Production injector | Deterministic harness |
|---|---|---|
| Purpose | live feel-testing by a human | numbers you can assert on and cite in a ruling |
| Timing | real timers, `Math.random()` | whole-tick quantisation, seeded PRNG, no timers |
| Direction | inbound inputs | **both directions** |
| Used by | `npm run dev` with env vars | a test suite |

> The production injector is timer- and `Math.random()`-based; asserting numeric bounds against it
> would flake, so the harness models its behaviour instead.

**Fix the production injector too** — port the predecessor's per-stream `scheduleOrdered` clamp so it
stops manufacturing reorders TCP never produces, and add a loss knob. That is a contained change and
it is required by I-N10.5 however R4 lands.

#### What the harness must model

The point is **comparison**, not characterisation. It must drive the same scenario through both
transport models:

- **Reliable-ordered (TCP)** — per-stream ordering clamp, and loss becomes a **retransmit stall** of
  ≥ 1 RTT that holds up everything behind it.
- **Unreliable-unordered (UDP)** — loss simply drops the packet; reordering is permitted; input
  redundancy (I-N5.3 / R5) makes single input loss invisible.

Knobs as **separate** dimensions — latency, jitter, loss, reorder — because conflating them is what
made the predecessor's injector mislead. Both directions delayed independently. Seeded and
timer-free, so results are reproducible and assertable.

Build it **architecture-agnostic**: it models the network and drives whatever sim and prediction
exist. That way it baselines today's behaviour immediately and is ready the moment R3 lands.

#### Profiles — tied to R0's targets

| Profile | RTT | Jitter | Loss | Why |
|---|---|---|---|---|
| Control | 0 | 0 | 0 | proves the rig itself adds nothing |
| Feel parity | 80 ms | 20 ms | 0.5 % | R0's feel tier |
| Fairness | 130 ms | 30 ms | 1 % | R0's competitive tier |
| **Mandated** | 100 ms | 30 ms | **3 %** | I-N10.5's required profile |
| Ceiling | 250 ms | 50 ms | 3 % | R0's refusal boundary |

#### The acceptance criterion — agreed *before* measuring

This is the part that stops the result being argued about afterwards. Every threshold below is a
number already in the codebase, not a new invention:

- **Peak remote prediction error < 24 units.** That is `NET_CONFIG.reconcileSnapPos`, half a car's
  48-unit length, and near the ~28-unit aim tolerance `AIM_CONFIG` computes. Above it, a player
  bounces off a car that is not there and shots miss targets they visually hit.
- **Snaps are rare.** The predecessor's bar was **zero snaps in 10 640 reconciles** at tuned
  thresholds. Same bar.
- **No stall exceeds one patch interval** of usable-correction gap.

> **If TCP holds those at the mandated 100 ms / 30 ms / 3 % profile, §5 is amended and we stay on
> WebSocket. If it does not, the unreliable transport is justified on evidence and R4.2–R4.4 become
> real work.**

Either outcome is a legitimate answer. That is the point of measuring.

#### Why this is worth doing first regardless

It is cheap, contained, touches no gameplay code, and pays off no matter how R4 lands:

- It is **required by I-N10.5** in every scenario (finding N-9).
- It makes **R3 verifiable** — nothing currently verifies remote prediction under loss, and R3 is the
  larger change.
- It produces the number **Gate G7 was opened for and never produced** in the predecessor.
- It removes N-12, which currently makes every latency measurement in this project harsher and
  differently-shaped than the real link.

**Amendment:**

> **I-N10.5** *(clarified)* Netcode changes are verified under simulated latency, jitter **and loss**
> — at minimum 100 ms RTT, 30 ms jitter, 3 % loss — in **both directions**, through a deterministic,
> seeded, timer-free harness whose results are assertable. A live injector is for feel-testing and is
> never the basis of a numeric claim. Loss must be a knob independent of jitter: a rig that produces
> reordering as a side effect of jitter is modelling a transport nobody ships.

### R4.7 — Sequencing. The rig lands *with* R3, not before it, and R4 is decided after.

**Resolved.** An earlier draft of this ruling had the rig first and a pre-R3 baseline as its
justification. That was wrong twice over: the baseline is informative but **not decision-critical**
(R4 turns on how *remote prediction* behaves under loss, and remote prediction does not exist yet),
and the harness's shape depends on what it drives, so building it against today's architecture means
extending it substantially when R3 arrives.

**The order:**

| Tranche | Work | Why here |
|---|---|---|
| **0 — unconditional** | R2.1 ms-authoring · R2.3 remove the env override · **N-12 fix the injector** · cheap findings: C-1 blur key release, C-2 delete `window.game`, N-2 gate the monitor | All small, all pure risk reduction, none depend on an open ruling. N-12 matters most: until it is ported, every `SIM_LATENCY_MS` run misleads. |
| **1 — the big change** | **R3 and the R4.1 harness together.** The harness is R3's verification, not a separate project. | R3 is transport-agnostic and the larger gameplay win. Its failure mode — remote prediction drifting under loss — is invisible to unit tests *by construction*. |
| **2 — measure** | Run R4.1's profiles. Capture R2.6's CPU budgets in the same pass. | First point at which R4's question has an answer. Also closes Gate G7, open since the predecessor. |
| **3 — decide R4** | **N-4 first** (quantise the wire), then R4.3 and R4.6 by lookup against R4.1's criterion. | N-4 changes the bandwidth arithmetic both depend on. |
| **4 — physics** | R3b impulse model as its own numbered spec → produces measured peak ω → **reopens R2.4**. | Needs R3 for the car-vs-car half; static-geometry half (I-N4.13) could start earlier. |

**The one hard constraint: the rig must not land after R3.** This codebase has a documented history
of exactly the bug class it catches. P5's tracker records two bugs *"that the unit tests could not
see"* — ram detection using `obbsOverlap` when `resolveWorld` had already separated the pair to a
measured gap of 0, so ramming dealt no damage live while every hand-placed unit test passed; and the
spectate camera gating on `canDrive`. Both were found by a live protocol harness, not by the suites.
R3 is bigger than either.

### R4.2 — What must be replaced: the state encoder, not the socket.

**`@colyseus/schema`'s delta encoder assumes ordered delivery.** It encodes changes since the last
patch with no per-client baseline tracking, so it cannot ride an unreliable channel — and I-N5.6
(delta against the last *acked* snapshot) is precisely what it does not do.

So an unreliable state path needs, newly built: a **per-client baseline tracker**, **delta encoding
against that baseline**, an **ack message** from the client, **quantised field encoding** (which is
N-4 regardless), and **full state on join and after a lost baseline**.

**What does not need replacing** — and this is the boundary that makes R4.4 obvious. Everything
I-N5.4 already reserves for reliable-ordered delivery is what Colyseus is good at:

| Stays on Colyseus (reliable, ordered) | Moves to the unreliable path |
|---|---|
| join / leave, room lifecycle, matchmaking | per-tick input |
| lobby intents, team switch, car select | per-tick state snapshot |
| phase transitions, results | — |

**Honest sizing:** the socket swap is the small part. The state layer is the project.

### R4.3 — Conditional on the measurement.

> **If** R4.1's criterion passes at the mandated 100 ms / 30 ms / 3 % profile — peak remote
> prediction error under 24 units, snaps rare, no stall beyond one patch interval — **then stay on
> WebSocket and amend I-N5.1**, recording the measurement as the justification.
>
> **If it fails**, adopt **WebRTC DataChannel** `{ordered: false, maxRetransmits: 0}` as I-N5.1
> specifies.

Two things to record now, so they are not rediscovered under pressure:

- **The rules do not price NAT traversal.** I-N5.1 is right that browsers cannot open raw UDP
  sockets, but a DataChannel needs signalling plus STUN, and roughly 8–10 % of users behind symmetric
  NAT need a **TURN relay** — which costs money and adds latency, partly negating the reason for
  going unreliable. That is a real operational input to R4.3 and it belongs in the decision.
- **WebTransport:** I-N5.2 excludes it as a *sole* transport on Safari grounds. It is materially
  simpler than WebRTC — no signalling, no STUN/TURN, just a URL — so if Safari support has landed it
  is the better mechanism. **Verify support at decision time**; do not trust either document's
  snapshot of the browser matrix, including this one.

### R4.4 — Hybrid, not replacement.

**If R4.3 lands on unreliable: keep Colyseus for the reliable half.** The split in R4.2's table is
almost exactly I-N5.4's own list, which is the clue that the rules anticipated this shape. Replacing
Colyseus outright would discard working room lifecycle, lobby, matchmaking and flow to solve a
problem confined to per-tick data.

The seam is already half-built: `combat-bridge.ts` is *"the only file that knows about the Colyseus
schema"* for combat, and `serverTick` takes plain queues. Post-R3, `stepRoster` in shared has no
Colyseus dependency at all.

### R4.5 — Degraded mode, and when it does *not* apply.

I-N5.5 requires a WebSocket fallback to be **degraded mode, with the player told**. Note the scope:
this only bites in R4.3's *failure* branch. If the measurement passes and WebSocket remains the
primary transport, it is not a fallback and I-N5.5 is inapplicable — there is nothing to warn about.

> **I-N5.5** *(scoped)* Where an unreliable primary transport exists, a reliable-ordered fallback is
> degraded mode and the player is told so, in the UI, before the match starts. Where reliable-ordered
> delivery *is* the chosen primary transport under a recorded measurement, this clause does not
> apply.

### R4.6 — Hold the patch rate at 20 Hz. Its job changed; so does the reason to raise it.

R2.5 established that post-R3 the patch rate is the **correction** rate rather than a freshness knob.
One refinement worth recording, because it inverts the usual reasoning:

**Post-R3 the patch rate matters more for combat than for cars.** Car motion is predicted, so a
missed patch costs a correction the next one supplies. But **hp, weapon instances, the lock target and
phase are not predicted** — their freshness *is* the patch rate. So the case for raising it is
combat feedback, not smoothness.

> **Hold at 20 Hz. Revisit after N-4 (quantised wire) and after R4.3.** Poses ship as raw float64
> today — roughly 4.8 KB/s at 20 Hz against a 12 KB/s budget — so bandwidth headroom is consumed by a
> defect rather than by the rate. Fix that first and the question answers itself. If R4.3 lands on
> unreliable, the rate is re-decided against the new encoder anyway.

---

## R3a — Contact, and ramming as crowd control

**Context.** Ram *damage* may be removed entirely. Ramming stays a core mechanic, but as **crowd
control**: car collision physics that let a flank or rear hit make an opponent lose control.

**This does not weaken R3. It is now the strongest argument for it.** The ruling stands unchanged;
what follows is what R3 must additionally carry so the mechanic is buildable on top of it.

### First, R3 never depended on ram damage

Part of R3's case was ram-damage accuracy. Remove that and the core is untouched: the three-way pose
disagreement is a bug regardless of what contact *does*, and the shot-accuracy case (R1 tier 2) is
independent. Nothing above needs restating.

### Why directional CC is the hardest thing to build on interpolation

`DRIVE_CONFIG.turnRate` is **4.2 rad/s**. Convert each staleness window into angular error:

| Pose age | Angle error |
|---|---|
| Collision hull, LAN (~26 ms) | **6.3°** |
| Collision hull, 70 ms RTT (~60 ms) | **14.5°** |
| Rendered pose, LAN (~76 ms) | **18.3°** |
| Rendered pose, 70 ms RTT (~110 ms) | **26.5°** |

A flank-or-rear test is a **directional threshold**. Today's `ramDotThreshold: 0.5` is a 60° cone;
whatever shape the CC test takes, it will be a comparison of the same kind. **A 26.5° error against a
60° boundary flips the outcome routinely** — CC would fire when you did not hit the flank and fail
when you did.

Worse, the two numbers disagree with *each other*: the client **draws** contact from an 18–26°-stale
pose while **computing** it from a 6–15°-stale one. The player would see a clean rear-end that
registers as a glance, and a glance that spins them.

Damage tolerated this because damage is a number that arrives late. **A control loss is something
the car is visibly doing.**

### Predicting CC: the line is motion, not gameplay-vs-physics

I-N4.5 says predict the bounce, not the damage. The natural question is which side CC falls on. It
is not a new category — it is **motion**:

> You cannot predict the bounce and not the spin. They are the same impulse.

An angular impulse changes the car's trajectory this tick. A control lockout changes how this tick's
input is interpreted. Both are things the car is doing now; health is a number you can wait for. So
the line I-N4.5 draws is not *physical vs. gameplay*, it is **"does the car's own trajectory depend
on it this tick."**

### The stakes are asymmetric, and they argue for predicting

- **The rammer** predicts they landed a hit. Low stakes — a small bounce on their own car.
- **The rammed** predicts they lost control. **Highest stakes in the game**: their own inputs stop
  working.

Not predicting means the victim keeps steering normally for one one-way trip (~35 ms at 70 ms RTT)
and then snaps into a spin. That lags the player's own **agency**, which is the worst thing in a game
to lag. Predicting means occasional false positives — a spurious wobble the server then cancels.

**A false positive is far cheaper than a false negative here**, and recovery is graceful: write the
lockout as an absolute deadline tick, make the server's value authoritative on arrival, and a
mispredicted lockout is simply overwritten on the next patch. Worst case is a ~50 ms wobble.

### Prior art: the predecessor already built and measured this

`E:\Work\motor-combat` shipped exactly this mechanism for wall impacts:

- `controlLockedUntilTick` — an absolute-tick `uint32` on the car schema, *"read by the sim, so
  networked (inv. #8)."*
- *"Control lockout / wobble (`controlLockedUntilTick`; **client prediction respects it too**)."*
- **One impact system, several sources** — wall hard-hits and weapon hits route through the *same*
  seam rather than each growing their own.
- Its latency harness measured prediction *through* a control-lockout event and reported
  **zero snaps**.

**Caveat worth stating:** their lockout came from *wall* hits — one body against static geometry,
which is perfectly predictable. Car-vs-car is I-N4.4's hard case, where both entities are predicted.
So the precedent validates the *mechanism* (absolute-tick field, predicted, reconciled, one shared
seam) and not the trigger. **R3 is what makes the trigger agreeable.**

### What R3 must additionally carry

Three requirements. All three are cheap now and expensive to retrofit.

**(a) `stepRoster` emits contact events, not just poses.** Today
`resolveWorld(body, others, obstacles, bounds) → SimBody` returns a pose and nothing else — there is
no seam for *"A hit B along normal n at relative angle θ with severity s."* Design the signature with
it from day one:

```
stepRoster(entries, inputs, world, dt) → { bodies, contacts }
```

The sim consumes `contacts` to apply CC; the client's effects layer consumes the same list for
sparks and shake, behind the fresh-tick guard (§3.8). This is the same discipline D20 applied to hit
testing — build the seam before the feature needs it, or every path gets refactored under pressure.

**(b) `SimBody` needs angular velocity, and it is a schema field.** `SimBody` is
`{x, y, angle, speed, reverseHold}`. Steering is instantaneous rate application —
`angle = body.angle + steer * turnRate * dt`. **Nothing in the sim can spin.** A spin-out requires an
`angularVelocity` term, and by hard invariant #8 and I-N3.7 it must live on `PlayerState`. Same for
`controlLockedUntilTick`. Two numbers; negligible on the wire.

Note also that `restitution: 0.35` is a **scalar applied to `speed`** — there is no lateral or
angular impulse model at all. "Car collision physics" is a new model, not a tuning change.

**(c) I-N4.6 stays, and matters more.** No lag compensation on contact: rewinding one car
un-rewinds the other, so the server's present tick is the symmetric tiebreaker. With CC this is more
important, not less — lag-compensated CC would let a high-ping player retroactively spin a low-ping
one. The honest cost is that a high-ping player will sometimes be spun by a car that "was not there
yet." That is the correct trade, and it is the same trade every game with physical contact makes.

### Sequencing — this reverses the natural order

**Do R3 before designing ram-as-CC.** The CC design's central question — *when do both sides agree a
flank hit happened?* — is only answerable once both cars are predicted at the same tick. Designing CC
on top of interpolation would bake in compensations for a problem R3 removes.

**Ram-as-CC is its own design pass, and `CLAUDE.md` says so:** *"Stop and ask before changing the
drive model, hitbox model (OBB), collision-damage rules … or adding a physics engine."* This changes
the drive model **and** the collision-damage rules. It deserves a numbered register of its own, in
the shape of D1–D22 and A1–A14. R3 does not decide it. R3 makes it possible.

### The amendment

> **I-N4.5** Contact **damage** is not predicted. Contact **motion** — separation, restitution,
> angular impulse, and any control-state change that gates input processing — **is** predicted. The
> line is not *physical vs. gameplay*: it is **"does the car's own trajectory depend on it this
> tick."** A control lockout does; a health change does not. You cannot predict the bounce and not
> the spin — they are the same impulse.
>
> **I-N4.5a** *(new)* A predicted control-state change is written as an **absolute deadline tick** in
> the snapshot, and the server's value is authoritative on arrival. A mispredicted lockout is
> cancelled by the next patch, never held to expiry.
>
> **I-N4.5b** *(new)* All sources of a control-state change — contact, wall impact, weapon effect —
> write through **one shared seam**. Never a second lockout field or a second recovery path.
>
> **I-N3.11** *(new)* The roster step returns the tick's **contact set** alongside its poses.
> Anything that reacts to contact — sim effects, audio, particles, screen shake — reads that set;
> nothing re-derives contacts from poses afterwards, on either side.

I-N4.4 and I-N4.6 are unchanged and both become load-bearing for this mechanic.

---

## R3b — Collision response as impulse physics

**Context.** The collision model will simulate real-ish rigid-body response: pushback and spin scaled
by contact position and angle. Boundary walls and obstacles apply the same response at reduced
intensity.

### Good news first — this is *more* prediction-friendly, and it corrects R3a's emphasis

R3a argued from a threshold: *"a 26.5° error against a 60° cone flips the outcome."* That was the
right argument for a **discrete** control-lockout trigger, where a small input error produces an
all-or-nothing output for fifteen ticks. It is the worst possible shape for prediction.

**Continuous impulse physics has no such cliff.** A small error in contact angle produces a
proportionally small error in the resulting impulse. Mispredict slightly, spin slightly wrong,
reconciliation eases it away — the response degrades gracefully instead of flipping. Even the
contact boundary itself is continuous, because a grazing hit has near-zero closing velocity along
the normal and therefore near-zero normal impulse.

So the R3a numbers still describe the error, but the *consequence* of that error is far milder than
R3a implied. This is a better mechanic to predict than a lockout threshold, not a worse one.

Two caveats keep it honest:

- **Angular error integrates.** Angular velocity persists, so a mispredicted impulse compounds
  through ω → angle → position rather than landing once. Over one patch interval (50 ms) at a
  plausible 0.5 rad/s misprediction that is ~1.4 units of position error — negligible, and the next
  snapshot resets it. It only bites if patches stop arriving.
- **Contact *order* matters more.** `resolveWorld` resolves sequentially and `RELAXATION_PASSES` is
  **1**. Sequential impulse resolution is more order-sensitive than positional separation, so a
  three-car pileup settles differently under a different order. R3's shared, sorted `stepRoster` is
  what makes that reproducible — it is now a correctness requirement, not just tidiness.

### The one thing that would break everything: do not use a physics engine

`CLAUDE.md` already gates this (*"Stop and ask before … adding a physics engine"*). The netcode
reason is worth stating precisely, because it is not about determinism first — it is about
**rollback**.

I-N3.7 requires that a predicted mechanic's *complete state* be in the snapshot, restorable and
re-simulable. A physics engine's solver is **stateful in ways it does not expose**: contact caches,
warm-starting accumulators, sleeping flags, broadphase pair persistence. None of that is on your
wire, none of it can be restored from a snapshot, and all of it changes the next frame's result.

> You cannot roll back matter.js. That, not floating point, is why the engine is disqualified.

The same argument retires Phaser Arcade for this (I-N2.4/I-C1.2 already do) and any wasm Box2D port.

### What to build instead: a stateless impulse resolver

For 2D OBBs this is small and entirely tractable — roughly forty lines, pure, and fully described by
the body state so it rolls back for free:

```
j = -(1 + e) · (v_rel · n)
    ────────────────────────────────────────────
    1/mA + 1/mB + (rA × n)²/IA + (rB × n)²/IB

vA -= j·n / mA      ωA -= (rA × j·n) / IA
vB += j·n / mB      ωB += (rB × j·n) / IB
```

**What the codebase already has:** the SAT separation necessarily produces a minimum translation
vector — that is the contact **normal** and the **penetration depth**, which are two of the three
inputs.

**What it does not have:** a **contact point.** Torque needs `r`, the vector from each body's centre
to where the hit landed, and MTV does not give it. For OBB–OBB that means clipping a contact
manifold — real additional work, and the piece most likely to be underestimated. Budget it
explicitly.

Per-surface intensity (walls and obstacles reduced) is then just a different `e` and impulse scale
per surface kind. `COMBAT_CONFIG`/`DRIVE_CONFIG` currently hold one scalar `restitution: 0.35`; it
becomes a small table.

### The state-model consequence — this is the big one

**A car currently cannot be pushed sideways, at all.** `stepDrive` integrates
`x += cos(angle) · speed · dt`: velocity is a scalar *always along the heading*. Pushback
perpendicular to the heading is **unrepresentable in the current state**.

Two ways out, and the choice belongs to the CC spec rather than to R3:

| | Full rigid body | Arcade + impulse overlay *(recommended)* |
|---|---|---|
| State | `speed` → `{vx, vy}`, `angle` integrated from `ω` | keep `speed` along heading; add a decaying `{ix, iy}` impulse velocity and `ω` |
| Feel | drift, slide, momentum — a different game | drives exactly as today, but gets shoved |
| Tuning | every `DRIVE_CONFIG` number re-derived | existing tuning survives intact |
| Risk | rewrites the drive model the project says to stop and ask about | additive |

The overlay keeps the arcade handling the project has already tuned and validated, and confines the
new physics to a term that collisions inject and drag removes. Either way the new fields —
`ω`, and either `{vx, vy}` or `{ix, iy}` — are read by `stepSim`, so by hard invariant #8 and I-N3.7
**they are networked schema fields on `PlayerState`.**

### Fix the deep-penetration case *before* adding impulses, not after

`resolveWorld`'s own documentation records an existing weakness:

> A car crushed between another car and an obstacle, or between an obstacle and a wall, can hold an
> overlap as deep as a full car dimension — 48px measured on the flush-obstacle fixture in the tests
> — and hold it *stably* … **Nothing here bounds the depth.**

Under positional separation that is ugly. Under impulse physics it is **explosive**: corrective
impulses scale with penetration, so a 48-unit overlap discharges as a launch. This is the classic
physics-blowup, and it is already latent in the codebase.

The stateless fixes are the standard ones — a penetration **slop** threshold, a **clamped**
positional correction (Baumgarte-style, bounded per tick), and more relaxation passes. All of them
are pure and roll back. The stateful fixes — sleeping, warm-starting — are exactly what a physics
engine would offer and exactly what I-N3.7 forbids.

### Walls and obstacles are the easy half, and they unblock work now

A useful asymmetry: **arena geometry is static and identical on every client.** `getArena` is shared,
the arena id is replicated, obstacles never move. So wall and obstacle impulses involve **no remote
pose staleness whatsoever** — they are perfectly predictable today, with no dependency on R3.

That is also precisely the case the predecessor shipped and measured (its `controlLockedUntilTick`
came from wall hits, and its harness reported zero snaps through one).

**Build order falls out of this:**

1. **Impulse response against walls and obstacles.** Predictable now. Exercises the resolver, the new
   state fields, the contact-event seam and the effects path — with no R3 dependency and no
   two-body agreement problem. `arena-01` has no obstacles, so this needs `arena-02` or a fixture.
2. **Car-vs-car impulse.** Needs R3, because it needs both cars predicted at the same tick.

### A fourth R3 argument, written in the code already

`resolveWorld`'s comment explains why car-vs-car overlap stays mild:

> The car-car case is the mildest only because **the server resolves every player against the current
> state each tick**, so the *other* car is being pushed off this one at the same time and the pair
> works itself apart. That relief comes from the caller's loop, not from anything in this function:
> `resolveWorld` on its own will happily hold two cars overlapped forever.

**The client has no such loop.** It steps only the local car, against frozen remote hulls — so the
mutual push-apart never happens in prediction, only on the server. The client's separation behaviour
is therefore systematically different from the authoritative one, today, and impulses widen that gap.
R3's `stepRoster` is what gives the client the same relief the server has.

### Verification graduates from optional to required

With ω integrated into angle and angle into position, prediction error grows quadratically in the
window rather than linearly. At a 50 ms patch interval this is immaterial — but it makes I-N10.4's
cross-engine determinism check (same inputs, same start state, same end state within epsilon, Node
and browser) worth having before the impulse model lands rather than after. Contact resolution is
also exactly the kind of code where an ordering bug hides behind a passing unit test.

### The amendment

> **I-N2.8** *(new)* Collision response is implemented as a **stateless** impulse resolver whose
> complete state is the bodies' own networked fields. No physics engine, no solver-internal state —
> no contact cache, warm-start accumulator, sleeping flag or persistent broadphase pair. If it cannot
> be restored from a snapshot, it cannot be part of the sim (§3.7).
>
> **I-N2.9** *(new)* Penetration is **bounded**. Positional correction is clamped per tick and
> carries a slop threshold, so no accumulated overlap can discharge as an impulse the sim never
> intended.
>
> **I-N4.13** *(new)* Collision response against **static geometry** — arena bounds and obstacles —
> is fully predictable on every client and is predicted unconditionally. Only **car-vs-car** response
> depends on remote pose accuracy (§3.2).

I-N2.4 is unchanged and now covers a second case: Phaser Arcade was already excluded from gameplay;
so is every other engine, for the rollback reason above.

---

## Manual aim vs. aim assist — do not scrap manual aim

Asked directly: is supporting both getting too complicated, and should manual aim be dropped?

**No, and dropping it would make the netcode harder, not easier.**

**1. Manual aim is the easy case.** Its trajectory is a pure function of the client's own pose —
predictable today, with no dependency on R3, no lock to replicate, no staleness. Aim assist is the
hard case. Scrapping manual aim keeps only the hard one.

**2. It is not a subsystem.** The game is keyboard-only; there is no mouse and no cursor-to-world
mapping (I-C3.7 notes this explicitly). "Manual aim" here means one boolean:
`usesAimAssist: false`, on which `aimAngleFor` already returns `null` and the shot falls through to
the car's heading. Deleting it removes a flag, not a system.

**3. It is the skill axis.** With keyboard-only control, *facing is aiming* — positioning the car is
the aiming skill. A roster where every weapon auto-aims has no aiming skill in it at all. Aim assist
is a good answer to "steering and aiming share one control"; it is a poor answer to "what does the
player get better at."

### The real bill, and it is worth knowing before you author the weapon

**Aim assist is inherently lag-compensating. Manual aim is not.**

The server derives an aim-assisted angle from its own current-tick state, so a 130 ms player's shot
leaves at exactly the angle a 10 ms player's would. Ping does not degrade it.

A manual-aim weapon has no such property. The shooter aims by facing, based on what they can see,
and what they can see is stale by their own latency plus the patch delay. At 70 ms RTT a 540 u/s
target has moved roughly **32 units** — about one car width — beyond where the shooter saw it, against
that same ~28-unit tolerance. That error is **systematic and scales with ping**: the higher-ping
player misses shots the lower-ping player lands, on identical play.

So the honest statement is:

> **Manual aim is what forces lag compensation.** Not aim assist, and not projectile prediction.

That is squarely inside R0's fairness tier (*"must not be systematically less accurate"* to 130 ms).
Decision **D20** already built the seam for it — hit testing takes a `PoseSnapshot` rather than live
state, with a test pinning it, and the weapon spec's own words are that adding lag compensation is
then *"pass a different snapshot."*

**Scheduling:** rewind hit testing is not needed for LAN v1 and is not needed for a roster that is
entirely aim-assisted. It becomes required **before the first manual-aim weapon ships to online
play.** Note it against that milestone rather than building it now.

### Complexity verdict

Supporting both costs one flag in the sim and one dependency in the netcode. The genuine complexity
in this area is lag compensation, and it is driven by *manual aim plus online*, not by supporting two
modes. Keep both.
