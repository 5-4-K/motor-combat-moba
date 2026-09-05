# Motor Combat MOBA — Online Netcode and Client Architecture Design

**Status: reviewed and approved by the user on 2026-09-04; every open question in §10 is resolved
in place.** Written from a brainstorming session that asked for an analysis of everything the
gameplay has, then a netcode and client architecture designed from that analysis — with no bias
toward the current architecture — and then reconciled against the user's own consolidated note
(§13). Nothing here is implemented. The decisions are numbered N1–N31 (with N1a, N10a, N23a) and
are the input to the implementation plans.

**Implementation plans:**
[`../plans/2026-09-04-netcode-and-rendering/`](../plans/2026-09-04-netcode-and-rendering/) holds the
fourteen phase plans that land this design, plus the shared interface ledger
([`interfaces.md`](../plans/2026-09-04-netcode-and-rendering/interfaces.md)) and the guide for
executing them ([`00-execution-guide.md`](../plans/2026-09-04-netcode-and-rendering/00-execution-guide.md)).
**Plan-writing is complete** — all fourteen are written, as of 2026-09-05; execution has not started.
Start at [`PROGRESS.md`](../plans/2026-09-04-netcode-and-rendering/PROGRESS.md), which records the
assignment each plan was written against, every ledger defect found and how it was resolved, and the
one open question this design left for the user; then
[`00-execution-guide.md`](../plans/2026-09-04-netcode-and-rendering/00-execution-guide.md) for the
order and the per-phase gates. **Phase 6 is not scheduled**: its five tasks each wait on a measured
gate, and four of the five are expected to read "not needed" on a healthy link.

The user keeps a note at `docs/ideas/online-netcode-and-client-architecture-spec.md` (it is cited by
the 2026-08-29 ram spec). Per root `CLAUDE.md` it was **not** read for this design. If it should
inform or constrain this one, name it and this document will be reconciled against it.

## 1. Goal and target envelope

The brief: a smooth, lag-free feel, comfortably playable on common personal computers, with no
desync, glitch or lag in online play up to 80–90 ms ping. This design reads that as:

| Parameter | Target | Why this number |
|---|---|---|
| Round-trip time (RTT) | design point **90 ms**, must stay playable to **150 ms** | the brief, plus headroom for a bad evening |
| Jitter | ±20 ms typical, 60 ms spikes absorbed | home Wi-Fi to a home-hosted server |
| Packet loss | 1 % (as TCP stalls of one RTT) | the transport is TCP; loss is a delay, not a gap |
| Players | 6, one server process, one arena room | invariant 10 |
| Client machine | integrated-graphics laptop, 60 Hz display | "common personal computers" |
| Sim rate | **60 Hz** (`TICK_RATE_HZ` 30 → 60, decided 2026-09-04, N1a) | halves the lead granularity and the per-tick displacement; every ms-authored timer migrates through `msToTicks` |
| Snapshot rate | 60 Hz by default, 30 Hz fallback knob (N9) | the snapshot's age is the one slice of the window a rate can shrink |

"No desync" is taken to mean: the client never shows a state the server will contradict by more than
a fraction of a car length, and every contradiction is absorbed without a visible snap. It does
**not** mean bit-exact simulation on two machines — §5 explains why that is the wrong goal for this
game.

Out of scope: cloud hosting (an env branch only, per root `CLAUDE.md`), anti-cheat beyond what
server authority already gives, voice, spectator streaming, and any change to the drive model,
hitbox model, collision-damage rules or friendly fire. Two places where this design touches a
stop-and-ask item are flagged in §11.

## 2. What the gameplay demands of the netcode

This is the inventory the design was derived from. File references are current as of this document.

### 2.1 Cars

Thirteen numbers integrate a car: `x, y, angle, speed, reverseHold, angVel, shoveX, shoveY,
authority, maneuver, maneuverTicksLeft, maneuverAngle, maneuverSpeed` (`sim/step.ts` `SimBody`). A
tick reads the car's chassis, the other solid cars' hulls at start of tick, the arena, and its status
`Modifiers`. Ordinary driving is one Euler step of at most 15 units per tick; a `thunderclap` dash
is 53 units per tick sub-stepped in four.

What 80–90 ms (2.4–2.7 ticks) is worth on the roster:

| Chassis | Top speed | Per tick | In 3 ticks | Turn per tick |
|---|---|---|---|---|
| Mirage | 449.5 u/s | 15.0 u | 45 u | 15.6° |
| Bullseye | 375.5 u/s | 12.5 u | 37.5 u | 13.6° |
| Bastion | 320.0 u/s | 10.7 u | 32 u | 12.0° |

A car is 48 × 32. Three ticks of mispredicted steering on a Mirage re-points its velocity by 47°;
three ticks of mispredicted position is a car length. **Heading, not position, is the error that
matters**, because everything downstream (collision normal, ram severity, aim) reads the heading.

### 2.2 Contact

Car-on-car resolution is sequential, order-dependent and a **hard positional constraint**
(`sim/collide.ts` `resolveWorld`): a car resolved against a hull that is a few ticks stale is not
nudged, it is pushed out of the wrong box. Ramming is edge-triggered on the tick a pair first
overlaps, reads the pre-step approach speed of both cars, and writes absolute knock values (shove up
to 260 u/s, spin up to 6 rad/s, authority down to 0.35) onto the victim (`sim/ram.ts`,
`server/sim/ram-bridge.ts`). Wall slams write a 520 u/s knock and a 500 ms stun. The edge-trigger
set and slam clocks live in server-only `ContactMemory`.

Contact is the mechanic the netcode has to get right first. It is the core of Bastion's identity, it
is what `thunderclap` and `wildcharge` are, and it is the one place where two players' predictions
meet in the same tick.

### 2.3 Weapons

Nine carried weapons plus `tremor`; every one of them is a hitbox with travel time or persistence —
**nothing is hitscan** (`docs/combat-model.md`). Classified by what latency does to them:

| Class | Rows | Latency-relevant numbers |
|---|---|---|
| Travel projectiles | `predator` 30 u/tick, `pepperbox` 26.7, `magmablast` 20, `roadblock` 20, `thumper` 15 | at a typical 400 u engagement every one flies 13–27 ticks; travel time dominates ping by 5–10× |
| Persistent / attached beams | `afterburner` (66 ticks, re-anchored to the owner every tick), `lance` (21-tick wind-up then 51 ticks, pins the shooter), `tremor` (117 ticks, detached), `magmablast` burst (6 ticks, born at full extent) | area effects forgive lead; an attached beam must follow the owner's *rendered* pose or it visibly detaches |
| Self-movement maneuvers | `thunderclap` DASH (8 ticks at 1600 u/s, damage on contact), `wildcharge` CHARGE (300-tick window), `lance` HOLD | these move the **shooter's own car**, so the shooter feels the round trip on their own hands unless the trigger is predicted |

Every fire timing is an integer tick count baked once at module load. Presses are committed at
press time; the server derives the press edge from its own history of the player's inputs. The fire
state machine's `pending` struct, each instance's `damageClock` and `pierceLeft`, the lock's commit
timers and `prevFireMasks` are all server-only today (`server/sim/combat-bridge.ts` `CombatMemory`).

Aim assist is ambient, server-only, and aims at where the target **is** — no lead
(`sim/weapons/lock.ts`, `combat.ts` `aimAngleFor`). Only `lockTargetSessionId` reaches the wire.

### 2.4 Statuses

Eight rows; three change how a car drives and so must be known to whoever predicts it: `stunned`
(full stop, no steering), `spiked` (top speed × 0.6), `phased` (removed from everyone's hull list in
both directions). Statuses are already fully networked and derived on both sides through the same
`modifiersFromRows`, filtered by `tick < endsTick` independently of the patch. This is the one
combat subsystem with no server-only half, and it is the model the rest of this design follows.

### 2.5 Modes and flow

Last-standing and Deathmatch (5 s respawn, 1.5–3 s `phased`), plus 3v3 team mode. Respawn resets
every car field. Nothing about the world is dynamic except cars and weapon instances; arena-01 has
no obstacles and fits the viewport exactly, so the camera is parked.

### 2.6 Determinism, as it stands

- No `Math.random`, no wall clock, and no unsorted iteration on any sim path. Every order-sensitive
  loop sorts by `sessionId`.
- `Math.cos`/`sin` are **not** promised bit-identical across engines, and the code says so
  (`drive.ts`, `collide.ts`): "this is not a desync-checksum-safe function."
- `stepSim` is pure over its arguments but closes over module-level tables that the playground's
  `setTuning` mutates process-wide, with no version or hash to detect a mismatch.
- Instance ids are `${ownerSessionId}-${roomWideCounter}`, and live-instance order is `Map`
  insertion order — reconstructible from history, not from state.
- `angle` is never normalised; after minutes it is thousands of radians.

## 3. What the current architecture does at 90 ms

Measured and structural findings, numbered so §6 can point at what each decision fixes.

**F1 — Contact rubber-bands by more than a car length.** `packages/server/playtest/prediction.ts`,
run for this document (report `2026-09-04-01`):

| One-way latency | Free driving, peak correction | Head-on collision, peak correction |
|---|---|---|
| 0 ms | 0.00 u | 4.9 u |
| 30 ms | 0.00 u | 50.1 u |
| 60 ms (≈120 ms RTT) | 0.00 u | 65.3 u |
| 120 ms | 0.00 u | 117.2 u |

Free driving reconciles perfectly at every latency: the drive model and replay are sound. The
problem is entirely that the local car is resolved against remote hulls that are RTT/2 plus one patch
interval old — 4 ticks, 60 u of Mirage travel, at the design point — and `resolveWorld` turns that
staleness into a push-out in the wrong place. The probe's own verdict text says so.

**F2 — Input starvation freezes a car.** `server/sim/tick.ts`: a tick with no input in the queue does
not step the car at all — no drag, no decay, no `maneuverTicksLeft` countdown — unless it is
carrying a knock. The client sends on a 33.33 ms accumulator and the server ticks on a free-running
`setInterval` of 33.33 ms with `deltaTime` discarded and no catch-up, so the two clocks beat against
each other and a starved tick is routine, not rare. Every starved tick is a one-tick hole that the
next patch corrects, and a stationary hull in everyone else's `resolveWorld` for that tick.

**F3 — Inputs are not tick-stamped, so bursts distort timing.** An input carries only `seq`. Under
jitter the server applies 0, 1 or up to 5 inputs in one tick. Replay makes the *final* position right
(F1's free-driving zero), but every intermediate tick is wrong: the car was somewhere else when
collisions, hits and locks were evaluated. The 5-per-tick cap is also a documented 5× speed
advantage for a flooder, and intake in `ArenaRoom` is unbounded.

**F4 — No clock sync, no RTT estimate, no jitter buffer.** Remotes are interpolated exactly one patch
interval (50 ms) behind arrival — zero jitter headroom. One late patch drops the sample into
hold-last. The client has no idea what tick the server is on beyond the last patch's `tick` field.

**F5 — Patches are on a second free-running timer.** 20 Hz patches against a 30 Hz sim with no phase
relationship: a patch carries a tick's worth of state at a sliding fraction through the tick. Shot
extrapolation is anchored to "ms since last patch" and saws back to zero at each one.

**F6 — Combat feedback waits a full round trip.** A press shows nothing until the patch that carries
the instance: at 90 ms RTT plus a patch interval, 100–140 ms between key and muzzle flash. A dash
(`thunderclap`) moves the shooter's *own* car a round trip late. The HUD ring, `pendingUntilTick`,
hp bars, kill counts and the lock bracket all step at 20 Hz from the raw schema.

**F7 — The impact spark compares two timebases.** `scenes/impact-feedback.ts` documents that the
local predicted pose and a remote's interpolated pose disagree by 50–100+ ms — 50–100 u at closing
speed — and that it can spark on a miss or miss a graze. It names "the netcode rework" as the fix.

**F8 — Correction is applied by easing sim state.** `PredictionBuffer.reconcile` eases `x, y, angle`
toward the target by 25 % per patch and snaps the rest. An eased pose is a number no tick produced,
and it is what the next `stepSim` integrates; the code already has to special-case eight fields to
keep them out of the ease. A snap threshold of 24 u is 1.6 ticks of Mirage travel.

**F9 — Bandwidth is unmeasured and float-heavy.** Every `number` on the schema is a 9-byte float64.
A steady-state patch is ~730 bytes; a pepperbox press adds ~1 KB of instance ADDs; `refId`s grow
monotonically for the life of the room. Nothing counts bytes. Inputs are ~42 bytes of msgpack with
string keys for four small integers.

**F10 — Nothing detects a mismatched build or tuning.** `TICK_RATE_HZ` is env-overridable on the
server while the client bakes 30; the playground mutates tables process-wide; the only guard is the
arena-id check.

**F11 — The client cannot be tested headlessly.** `ArenaScene.ts` (2788 lines) owns prediction,
interpolation, input pacing, reconcile triggering, camera, spectate, every renderer and every
teardown. The pure modules beside it are well tested; the wiring between them is not tested at all,
and the net layer has no life outside a Phaser scene.

**F12 — No reconnect.** A dropped socket ends the session.

What is **right** and is kept: one shared `stepSim` as the lockstep (invariant 4); a required
`StepContext` built by a shared function on both sides; sorted iteration everywhere; the
lag-compensation seam in `hits.ts` (D20); a pure `runCombat` over plain objects behind thin
bridges; the headless `PlaytestWorld` that runs the real pipeline; a bot that speaks the same input
message as a client. This design changes the *transport of time*, not the simulation.

## 4. Approaches considered

### A. Deterministic lockstep with rollback (GGPO-style), server as relay or host

Every machine runs the full sim from everyone's inputs; a late input rolls back and re-simulates.
Perfect consistency, zero server authority cost, and this sim is small enough that a 4-tick rollback
of six cars costs nothing.

Rejected. It requires **bit-exact** simulation across Node and every browser engine a player might
use, and the drive and collision code call `Math.cos`/`sin`/`atan2`/`hypot`, which V8, SpiderMonkey
and JavaScriptCore do not promise to agree on. The fix — fixed-point or a software math library
through `drive.ts`, `collide.ts`, `contact.ts`, `shapes.ts`, `lock.ts` and `instances.ts` — is a
drive-model and hitbox-model rewrite by another name, the two things root `CLAUDE.md` forbids
without asking. It also gives up server authority over combat and stocks, which the weapon spec
made a design constraint ("nothing may make competitive integrity structurally impossible"), and it
makes a 6-player match wait on the slowest link. A desync in this model is a *divergent world*, the
exact failure the brief names; in the authoritative models below a desync is a correction.

### B. Authoritative server, remotes interpolated in the past, rewind hit testing

The Overwatch / Source model. The local car predicts; remotes are drawn a jitter buffer behind the
newest snapshot, exactly where they were; the server keeps a pose history and rewinds each hit test
to the shooter's view. "What you see is what you hit" is exact.

Rejected as the primary model, for one reason: **contact**. The local car lives at server-time plus
lead; remotes are drawn at server-time minus RTT/2 minus the buffer. At the design point that is
5–6 ticks apart — the gap F1 measures at 65 u. Games on this model avoid player-player physics for
exactly this reason; this game is built on it. Rewind also has to decide what a lingering beam or a
ram rewinds to, and the weapon spec already lists those as unresolved.

### C. Authoritative server, every client predicts the **present** world (recommended)

The Rocket League model. The server is authoritative for everything. Inputs are stamped with the tick
they are for and arrive before that tick runs. Every client runs the shared world step for **all**
cars — its own with its real inputs, the remotes with their last known inputs — from the newest
snapshot up to its own present tick, so the local car and every remote it can touch exist at the
same tick on the same screen. Corrections re-simulate from the snapshot and are hidden by a render
offset that decays, never by editing sim state.

Chosen because it puts the one interaction this game cannot approximate — two cars touching — in a
single timebase on every screen, and because it turns the remaining error into the *benign* kind:
a remote that changes its input is wrong by at most the few ticks until the next snapshot, and
smoothly corrected, rather than wrong by a fixed RTT forever. Its cost is that a shooter aims at an
extrapolation of the target; §6.7 quantifies that and explains why, for a roster with 13-tick
projectile flights and no hitscan, that is the smaller error. It needs no bit-exactness: an
ULP of drift is a sub-quantum correction.

## 5. Principles

1. **The server is the only author of state.** Clients send inputs and nothing else (invariant 3).
2. **Time is ticks, and ticks are on the wire.** Every input names its tick; every snapshot names
   its tick; every timer is a tick. Wall clocks exist only to estimate the server's tick.
3. **One input per tick, exactly.** Never zero (the server repeats), never five (the server ignores
   extras). F2 and F3 disappear by construction.
4. **Predict what the player feels on their own hands; confirm what happens to other people.** The
   local car's motion, its maneuvers, its fire state and its own shots are predicted. Damage, death,
   statuses landing on others and kills are never predicted.
5. **Correct state exactly, hide the correction in the renderer.** Sim state is never eased. F8.
6. **One timebase per screen.** Everything the client draws is at its present tick, or is an
   explicitly labelled render offset decaying to zero. F7.
7. **The world step is shared.** Server and client call the same `stepWorld`; the client never has a
   private copy of a rule.
8. **Measure or it is not smooth.** The harness in §9 has numbers, and the netgraph shows them in
   the client.

## 6. The design

### 6.1 Time: tick scheduling, clock sync, and the input lead

**N1 — Drift-free server tick.** The room stops using `setSimulationInterval`. A `TickScheduler`
anchors tick `k` to `epoch + k × MS_PER_TICK` on `performance.now()` and arms a `setTimeout` to the
next boundary; when it wakes late it runs every tick that is due, up to `maxCatchUpTicks` (3), then
re-anchors and logs. Sim time and wall time no longer drift apart; a 3-minute Deathmatch is 180 s.
The snapshot for tick `k` is broadcast **inside** the same wake, immediately after tick `k` — N9.
Fixes F2 (server half), F5.

**N1a — The sim runs at 60 Hz.** `TICK_RATE_HZ` becomes 60 (`MS_PER_TICK` 16.67). Decided
2026-09-04 in discussion, on three grounds: the input lead is whole ticks, so a finer tick buys
exactly the slack the link needs instead of overshooting to the next 33 ms boundary (the user's
note measured the safe input-buffer floor at 67 ms for 30 Hz against 50 ms for 60 Hz, with fewer
starved ticks); per-tick displacement halves (15 u → 7.5 u for a Mirage), so contact timing and
the ram approach speed are sampled twice as finely; and the wind-up a mobility power needs to be
predictable (N31) drops from about 200 ms to about 150 ms. Together with 60 Hz snapshots (N9) it
takes the design-point extrapolation window from about 178 ms to about 136 ms, a third off the
worst-case remote error (§6.6).

It is a sim behaviour change and is done as one deliberate pass in phase 1, with three hand
retunes named here because `msToTicks` cannot do them: `DRIVE_CONFIG.reverseHoldTicks` is
authored in ticks (2 → 4, or re-authored in ms); contact damping in `resolveWorld` runs once per
tick per surface, so sustained pushing damps twice as often per second and `restitution` or the
damping factor is re-tuned to the same per-second feel; and the Euler step halves, so the golden
fixture, `docs/turn-tuning.md`, the balance fingerprint, the manual and every playtest probe
re-pin against the new integration. Invariant 1 is unchanged: the number still lives once in
shared. CPU and input bandwidth double from trivially small to trivially small (about 0.03 ms of
sim per tick, 360 bytes per second of input per client).

**N2 — Tick-stamped inputs.** The input message becomes `{ tick, steer, throttle, fireSlots }`. The
client sends the input for tick `T` at its own local tick `T`, which it keeps `lead` ticks ahead of
its estimate of the server's tick (N4). `seq` is gone; the tick is the sequence, and the
"seq must be monotonic for the connection" trap goes with it. Fixes F3.

**N3 — Clock sync.** Every 500 ms the client sends `ping { clientMs }`; the server answers
`pong { clientMs, serverTick, msIntoTick }`. The client keeps the last 8 samples, takes the offset
from the **lowest-RTT** sample (the NTP rule — the fastest packet had the least queueing), and
estimates jitter as the RTT standard deviation. `serverTickNow()` is
`offset + performance.now()` in ticks. The estimate is applied by **dilating** the local tick period
by up to ±10 % until the local clock lands on the target, never by jumping, except when the target
moves by more than 4 ticks (a route change, a resumed tab), which resets. Fixes F4.

**N4 — The lead controller.** Lead is the number of ticks the client runs ahead of the server so its
input for tick `T` arrives before the server runs `T`. Initial lead is
`ceil((RTT/2 + jitter + MS_PER_TICK) / MS_PER_TICK)` — at 90 ms ± 20 ms and 60 Hz that is
**5 ticks** (45 + 20 + 17 = 82 ms → 83 ms). The
server tells the client how early each input actually arrived (`slackTicks` in every snapshot
header, N9: the number of ticks between arrival and use, negative when the input was missing and a
repeat was used). The controller targets `slack ∈ [2, 3]` — the note's measured floor of three
ticks of buffer occupancy at 60 Hz: if the 5th percentile over the last 120 ticks drops below 2,
lead increases by 1 immediately; if the median stays above 4 for 5 s, lead decreases by 1. Raise
fast, lower slowly. Lead is clamped to `[2, 16]` (33–267 ms).

**N5 — Client tick loop.** The client runs a fixed-step accumulator at the dilated period (N3),
one local tick per step: sample keys, build the input for `localTick`, send it, predict (N16). Frames
render at display rate between ticks. Catch-up after a hitch is capped at `maxCatchUpTicks` (6,
100 ms) local ticks per frame; a longer stall re-anchors and takes one correction rather than replaying 500
ms of inputs into a burst — the server would have repeated the last input through the stall anyway
(N6), so the burst would only diverge from it.

### 6.2 Input pipeline on the server

**N6 — Per-client input ring, repeat on silence.** Each client has a ring of inputs indexed by tick,
`ringSize` 128 (about two seconds). `inputFor(tick)` returns the input stamped `tick` if it arrived; otherwise the most
recent earlier input (**repeat**), and the snapshot header reports the negative slack. After
`repeatMaxTicks` (12, 200 ms) of consecutive repeats the ring falls back to the **neutral** input, so a
disconnected or alt-tabbed car brakes to a stop under drag instead of driving into a wall or sitting
as an immovable wall carrying a shove — the general form of the `hasKnock` coast in `tick.ts`,
which is deleted: **every on-field car is stepped every tick**, on a real, repeated or neutral
input, so drag, knock decay and maneuver countdowns always run. Fixes F2 (client half) and the flooder: extra inputs for a tick already held are
ignored, inputs for a tick already simulated are dropped and counted (the netgraph shows the late
rate), and nothing is ever applied twice. `NET_CONFIG.maxInputsPerTick` and `pendingInputCap` are
retired.

**N7 — Press edges from the ring.** The server derives presses from `inputFor(tick - 1)` and
`inputFor(tick)`, the same rule as `prevFireMasks` but with no separate memory, because the ring
*is* the history. A repeated input can never produce a press edge (its mask is identical by
definition), so silence never fires a weapon.

**N8 — The bot writes into the same ring.** `PracticeRoom` and `PlaygroundRoom` push the bot's
decision for tick `T + 1` at the end of tick `T`. Nothing else about the bot changes; its lagged
`view-ring` already models what a remote client sees.

### 6.3 What is on the wire

**N9 — One binary snapshot per tick, hand-packed.** Colyseus stays for connection lifecycle, rooms,
the lobby and match flow (N24), but the match hot path leaves `@colyseus/schema`. After every tick
the room broadcasts one `ArrayBuffer` via `client.sendBytes` (present in 0.15's `ws-transport`),
and the client sends inputs the same way. `setPatchRate(null)` disables schema auto-patching; the
lobby schema is patched manually on lobby changes only. Layout:

```
Header      tick u32 · flags u8 · ackTick u32 (last input tick used for this client) · slack i8
Roster      count u8 · per car: index u8 · x u16 · y u16 · angle u16 · speed i16 · reverseHold u8
            · angVel i16 · shoveX i16 · shoveY i16 · authority u8 · maneuver u8 · maneuverTicksLeft u8
            · maneuverAngle u16 · maneuverSpeed u16 · hp u16 · flags u8 (alive, phased, onField)
            · lastInput u8 (steer 2 bits, throttle 2 bits, fire 3 bits) · lockTarget u8
            · shotSeq u16 · pendingUntil i16 · switchLock i16 · lastFiredSlot i8
            · slots: count u8 · per slot: stocks u8 · rechargeEnds i16 · refireLock i16
            · statuses: count u8 · per status: id u8 · startTick i16 · endsTick i16 · source u8
Instances   count u8 · per instance: owner u8 · shotSeq u16 · weapon u8 · x u16 · y u16 · angle u16
            · extent u16 · flags u8 (alive, isExplosion, kind) · homingTarget u8
Events      count u8 · per event: kind u8 · tick-relative i8 · payload (§6.8)
```

Quantisation: positions in **1/16 unit** (15 bits of x and 14 of y for a 2000 × 2000 arena, packed
into a `u16` each with headroom for arena-02), angle in 2π/65536, speeds and knocks in 1/16 u/s,
ticks relative to the header tick as `i16` (the longest timer on the roster is `wildcharge`'s
600-tick cooldown). **The server adopts its own quantised state as authoritative**: after each tick
it rounds every transmitted field in place, so what the client receives *is* the server's state and
a resim from a snapshot reproduces the server to the ULP. Without that rule every client would sit
permanently a fraction of a quantum off true and the divergence metric (§7) would measure rounding
noise instead of bugs. 1/16 rather than 1/8 because quantised positions are fed back into a
collision solve, not merely drawn, and contact normals amplify position error into different
push-outs; the cost is a few bytes per snapshot. Session ids are replaced by a **car index** assigned at
match start and published in the reliable roster message (N24); `sourceSessionId` and
`lockTargetSessionId` become indices. A full snapshot for 6 cars and 20 instances is
**≈ 620 bytes**; at 60 Hz that is ≈ 37 KB/s, ≈ 300 kbit/s per client and ≈ 1.8 Mbit/s upstream for
a home host serving five others, which is why **delta compression is part of the first cut**: each
car and instance carries a changed-field mask against the previous snapshot, which TCP's ordering
makes safe with no acknowledgement bookkeeping, and which roughly halves the steady state. A
reconnecting or joining client is sent one full snapshot first. Fixes F9.

**The snapshot rate is the tick rate by default, 60 Hz** (decided 2026-09-04). The snapshot's age is
the one slice of the extrapolation window a rate can shrink: at 60 Hz it adds 8 ms on average and
17 ms at worst, against 17 and 33 at 30 Hz, and a late or lost snapshot is replaced 17 ms later, so
the jitter buffer (N18) can be zero. `snapshotEvery` (1) is a server knob; 2 is the fallback for a
host whose measured upload cannot carry 60 Hz, and the harness reports the error delta between
the two. Invariant 5 ("sim rate ≠ patch rate") is rewritten: *the snapshot rate is the tick rate or
an integer divisor of it, and a snapshot always describes the end of one whole tick.*

**N10 — Binary input.** `tick u32 · count u8 · inputs[count]`, each input `steer 2 bits ·
throttle 2 bits · fire 3 bits` in one byte for ticks `tick − count + 1 … tick`. The codec carries a
run so that an unreliable transport (N12's later option) can send the last 4–8 inputs redundantly
and a lost datagram costs nothing; over the reliable WebSocket path the client sends `count = 1`,
6 bytes, every local tick.

**N10a — Inputs are sampled from key events, not from key state per tick.** The client records
`keydown`/`keyup` with `event.timeStamp` (using `KeyboardEvent.code`, ignoring `event.repeat`) and
buckets each transition into the local tick it falls in. Sampling key state once per tick on a
30 fps machine quantises every press to the frame the tick loop happened to run in, which is a
real difference between a 30 fps and a 144 fps player; event timestamps make the tick a press
lands on independent of frame rate.

**N11 — Protocol hash at join.** The server's join response carries
`hash(codec version, TICK_RATE_HZ in effect, CAR_TABLE, WEAPON_TABLE, STATUS_TABLE, DRIVE_CONFIG,
RAM_CONFIG, COMBAT_CONFIG, AIM_CONFIG, SLAM_CONFIG, DEATHMATCH_CONFIG, arena registry)`. The client
computes the same from its own build and refuses a mismatch with a readable message. This replaces
the arena-mismatch check, closes the `TICK_RATE_HZ` env-override hole (the override is removed; the
knob served nothing a release needs), and makes the playground's `setTuning` honest: the playground
re-sends the hash after every tuning change and the client re-hashes after applying `tuningJson`.
Fixes F10.

**N12 — Transport stays WebSocket, behind an interface.** TCP head-of-line blocking at 1 % loss is
a one-RTT stall about once every three seconds of snapshots, which the jitter buffer (N18) and lead
(N4) absorb. A browser's only UDP paths — WebRTC data channels and WebTransport — need signalling or
HTTP/3 and are not required to hit the target. `MatchTransport { sendInput(bytes); onSnapshot(cb);
onPing(cb) }` is the seam; the Colyseus implementation is the first, a loopback implementation
serves tests and the harness, and a WebTransport one can be added without touching anything above
it.

### 6.4 The shared world step

**N13 — `stepWorld` replaces the per-car call site as the lockstep.** A new shared module
`sim/world.ts` exports

```ts
stepWorld(world: WorldState, inputs: ReadonlyMap<carIndex, Input>, arena: ArenaDef): WorldStepResult
```

where `WorldState` is `{ tick, cars: CarState[] (sorted by index), contact: ContactMemory }`,
`CarState` is `SimBody` plus `carId`, `onField`, `phased`, and the status rows, and
`WorldStepResult` is `{ world, contactEvents }`. Inside it does, in this order, exactly what
`runPipeline` does today up to combat: derive `Modifiers` per car from its rows, record each car's
approach speed, step each car through `stepSim` in index order against the start-of-tick hulls, run
`resolveContacts` and `applyRams`, and return the knocks written and the contact events (ram,
slam, dash hit) for the caller. **`stepSim` is unchanged**; `stepWorld` is the loop around it that
today lives in `server/sim/tick.ts` and `ram-bridge.ts`, moved to shared and made pure. The server
calls it once per tick; the client calls it once per predicted tick and again on every resim.
Invariant 4 becomes: *`stepWorld` is the lockstep; server and client import the same function.*

`ContactMemory` (the edge-trigger pair set and the slam clocks) moves **into** `WorldState`, so
that the client's contact prediction (N21) has the same edge semantics as the server's and a resim
from a snapshot starts from the right memory. It rides in the snapshot as a bitset of touching pairs
(15 bits for 6 cars) plus per-car slam ticks.

**N14 — Combat stays server-side, unchanged.** `runCombat` runs after `stepWorld` on the server
exactly as today, consuming `contactEvents` where it consumed `contactHits` and `statusRequests`.
Its hit tests still take a `PoseSnapshot` (D20) — the seam is kept, unused, for the reasons in §6.7.

**N15 — Invariant 8 becomes "if `stepWorld` reads it, it is a snapshot field."** The `PlayerState`
schema loses every sim field (N24); the snapshot carries all of them (N9).

### 6.5 Client prediction and reconciliation

**N16 — The client predicts the whole world.** `MatchClient` (N23) holds `baseline`: the newest
snapshot decoded into a `WorldState`, and a ring of predicted worlds for every local tick from
`baseline.tick + 1` to `localTick`. Each local tick it builds the input map — its own real input
for the local car, `lastInput` from the baseline for every remote (N17) — and calls `stepWorld`. It
also steps its own fire state (N20). At a nine-tick window that is at most nine calls of a
six-car step per tick, well under 0.2 ms.

**N17 — Reconcile by resim, never by easing.** When a snapshot for tick `S` arrives, the client
compares it with its predicted world for `S` (which it kept). If every quantised field of the
**local car** is within one quantum of the prediction — the common case in free driving — the
snapshot is accepted as the new baseline, the ring is trimmed, and nothing else happens: no resim,
no drift. Otherwise the client replaces its world at `S` with the snapshot and re-simulates
`S + 1 … localTick` from the stored inputs (its own real ones, the remotes' new `lastInput`s). The
difference between the old predicted pose at `localTick` and the new one, for every car, becomes a
**render offset** (N19). Sim state is always exact. Fixes F8. Snapshots for remotes are *always*
folded in (their inputs may have changed) — the "unchanged" shortcut applies to the local car only,
because only the local car's replay is expensive to get wrong.

**N18 — Jitter buffer on snapshots.** Snapshots are applied when they are `bufferTicks` old on the
estimated server clock, `bufferTicks = ceil(2·jitter / MS_PER_TICK) − snapshotIntervalTicks` clamped to `[0, 4]` (zero at
60 Hz snapshots on an ordinary link, because the next snapshot covers a late one), so a late
packet lands in the buffer rather than in the hold-last branch. On a burst (TCP stall) the client
keeps predicting forward from its last baseline up to `maxPredictionTicks` (30, 500 ms), then
freezes the world and shows the connection overlay; when snapshots resume it re-anchors (N3) and
takes one correction. Fixes F4.

**N19 — Render offset.** Every car has a render offset `(dx, dy, dθ)` that a correction adds to and
that decays toward zero over `correctionMs` (120 ms, about 7 frames at 60 Hz) with a critically
damped curve; angle decays along the wrapped delta. The renderer draws `sim pose + offset`. A
correction larger than `snapUnits` (a car length, 48 u) or `snapRadians` (π/2) is applied without
an offset — a slow slide over a whole car length is worse than a cut — and counted in the netgraph
as a snap, which the acceptance criteria (§9) require to be zero at the design point. The
`blendPose` between sim ticks stays, as it is now: the renderer draws
`blend(previousTick, currentTick, accumulatorFraction) + offset`.

### 6.6 Remote cars

**N20 — Remotes live in the predicted present.** A remote is stepped with its `lastInput` from the
baseline, so a car holding a steering input keeps turning on the same arc it is really on. When the
next snapshot shows the input changed, the resim (N17) re-drives the car from that tick and the
render offset absorbs the difference. Extrapolation is capped at `maxExtrapolationTicks` (8) beyond
the baseline; past it the car holds. Remotes' knocks, statuses and maneuver fields come from the
snapshot and are integrated forward exactly as the server integrates them, so a remote mid-spin
keeps spinning between snapshots.

What this costs, quantified for the design point — **corrected on 2026-09-04 after reconciling with
the user's consolidated note (§13), which showed the first draft's "about 18 u" understated this by
computing a chord instead of integrating the turn, and recomputed for the 60 Hz sim and 60 Hz
snapshots decided the same day.** The window `W` a remote is extrapolated over is one-way latency
(45 ms) plus the snapshot's age since it was produced (8 ms on average, 17 at worst, at 60 Hz) plus
the jitter buffer (0 at 60 Hz snapshots) plus the lead (83 ms): **about 136 ms on average, 145 ms at
worst, at the design point.** Error is exactly zero while the remote holds its input. When it
changes input at the start of the window, the error is set by the largest change in acceleration
the player can command that the predictor did not know about, integrated twice — and the biggest
such term is the steering term `v·ω`, which for a Mirage is 3,681 u/s², three and a half times its
throttle authority. Error grows with `W²` until it saturates at the turn diameter:

| Window `W` | Straight → full turn | Full steer reversal (worst) | Throttle change | Interpolated past at the same buffer (unconditional) |
|---|---|---|---|---|
| 120 ms (quiet link, lead 4) | 26 u | 49 u | 12 u | 31 u |
| 136 ms (design point, average) | 33 u | 61 u | 15 u | 39 u |
| 145 ms (design point, worst snapshot phase) | 37 u | 69 u | 17 u | 43 u |
| 162 ms (30 Hz snapshot fallback) | 46 u | 83 u | 21 u | 50 u |
| 178 ms (the 30 Hz sim this document first assumed) | 55 u | 97 u | 25 u | 50 u |

A car is 48 u long. So the honest statement is: at the design point approach C's **typical** error is
zero, its **expected** error at two to five input changes a second is under 10 u, and its **worst**
case — a full reversal by a top-speed Mirage inside the window — is about a car length and a half,
one and a half times what interpolation would show unconditionally. C is chosen on the distribution
and on contact consistency, not on the worst case. The 2026-08-31 and 2026-09-02 turn-rate and speed
edits made this term half again larger than the note measured (2,419 u/s² then, 3,681 now): a
fast-turning roster is a netcode cost, and it is a balance lever the user owns. The other levers,
all measured by the harness (§7):

- **Shorten the window.** The lead controller (N4) lowers lead on a quiet link; 60 Hz snapshots
  keep the buffer at zero. Every 17 ms removed takes about a fifth off.
- **Model the remote's input, not just repeat it.** `remoteSteerHoldTicks` — how long an
  extrapolated remote keeps a held steer before it is assumed released — is a client-only knob with
  no sim meaning; the harness reports which value minimises mean error against recorded matches.
- **Measure clustering.** The note's open item: input reversals cluster at contact, which is when
  the error matters most. The input log (N30) is what answers it.
- **Telegraph mobility (N31).** A dash is the one input the predictor cannot absorb at all; the
  rule that makes it predictable is a design rule, not a netcode one.

That worst case is the largest visible artefact in this design. It is corrected by a resim and a
120 ms render offset, never by a snap under 48 u. **Checkpoint (decided 2026-09-04):** if, once
phase 3 is measurable, contact corrections exceed the acceptance line (p95 over 12 u, any snap over
48 u) with the window and steer-hold levers exhausted, the fallback is approach B — remotes drawn
in the interpolated past with rewind hit testing — for which phases 0–2 are identical.

**N21 — Contact is predicted.** Because `stepWorld` includes `resolveContacts`, the client predicts
rams and slams between its local car and the extrapolated remotes: the victim's spin starts on the
victim's screen on the tick it happens rather than a round trip later, and the attacker's rebound is
on time. The knock values are derived from approach speeds the client also predicted, so they are
approximate until the snapshot confirms them; the confirmation is a resim plus render offset like
any other. Damage from a dash or slam is **not** predicted (N14); the stun from a wall slam is not
applied locally — it arrives as a status row a round trip later, which the shove has covered. Fixes
F1: the local car resolves against a hull at its own tick, and the residual is the extrapolation
error of §6.6, not four ticks of staleness.

**N31 — Mobility powers telegraph or commit.** A dash is the worst input for a predictor: an
instant, large, unknown acceleration. `thunderclap` as it ships (1,600 u/s from a standing press,
no wind-up) is about 200 u — four car lengths — off on a victim's screen if pressed at the start
of the window, and the correction is a cut, not a slide. Car stats cannot fix that and neither can
the netcode, because the information does not exist on the victim's machine yet. The rule, which is
also counterplay:

1. **Telegraph for at least the window.** Every mobility power carries a wind-up of at least the
   design-point window — about 150 ms at 60 Hz, `startUpMs ≥ 150` — during which
   `pendingUntilTick`, `lastFiredSlot` and the maneuver's locked angle and speed are already in the
   snapshot, so a remote client predicts the dash exactly from its first tick. `lance` already does
   this with 700 ms. `thunderclap` needs its `startUpMs` raised from 0; that is a weapon-row balance
   edit, recorded here as a follow-up rather than made. `wildcharge` needs nothing: it changes how a
   car drives under ordinary input.
2. **Commit once started.** No mid-dash steering, no cancel: a started maneuver is deterministic
   from its locked fields, which is how `thunderclap` is already built and must stay true for every
   future one.
3. **Budget the instant ones.** A power that cannot be telegraphed must keep `½·Δa·W²` under a car
   length at the design window, `Δa` under about 5,000 u/s² at 136 ms. In practice an instant
   mobility power always breaks this and should be telegraphed instead.
4. **Render a late reveal as the effect.** When a snapshot reveals a maneuver that began inside the
   window (a bad link, a press just inside it), the client plays the dash's own trail from its
   start point to its current point over a few frames instead of sliding the car (rendering spec
   R18a). The player sees "that car dashed" slightly late, which is what interpolation would have
   shown anyway, rather than "that car teleported".

### 6.7 Combat under latency

**N22 — Predicted fire state and ghost shots for the local car.** The client runs `tickRecharge`,
`beginFire` and `releaseShots` (`sim/weapons/fire.ts`) on a `FireState` rebuilt from its own
snapshot fields every baseline and stepped with its own inputs through the pending ticks; presses
come from its own input history, the same rule as N7. A predicted release:

- flips the HUD immediately — stocks, ring, `pendingUntilTick`, the car-wide lockout — in tick time;
- starts the **maneuver** immediately for `thunderclap`, `wildcharge` and `lance`, by writing the
  four maneuver fields into the predicted local car exactly as `startManeuver` does, which is the
  "additive upgrade" `step.ts` documents was designed for;
- spawns a **ghost instance** with the id the server will assign: `(carIndex, shotSeq + 1)`.
  `instanceSeq` becomes per-owner and rides in the snapshot as `shotSeq` (N9) precisely so the id is
  predictable. The ghost is aimed with the client's copy of the lock (the snapshot's `lockTarget`
  against the extrapolated target pose) and stepped with the shared `stepInstance`. When the snapshot
  instance with the same id arrives, the ghost hands over to it with a render offset; if none arrives
  within `lead + RTT + 2` ticks the ghost is removed and the HUD resims from the snapshot (a
  "refused" press, which the server can produce when a stun landed between the press and the tick).

Damage, hp, death, kills, statuses on others, and every other car's shots are never predicted.
Fixes F6.

**Why no rewind, and what replaces it.** Under option C the server tests hits at the current tick,
as today. The shooter's input for tick `T` is applied at tick `T`, and the ghost shot the client
spawned at its local tick `T` is born on the same tick as the server's; the shooter saw the target
at `T` as an extrapolation over the ≈ 5–6 ticks since the baseline (§6.6). So the error a shooter
carries is not their RTT — it is the target's *input change* over those ticks, zero for a target
holding course. Against that:

- every projectile on the roster flies 13–27 ticks at engagement range, so the player is already
  leading by 5–10× more than this;
- the assist aims at "where the target is", which under C means the extrapolated present, closer
  to the server's present than option B's past;
- the smear hit test already makes a fast shot generous.

Rewind would re-introduce the past-time target that option C exists to remove. The `PoseSnapshot`
seam in `hits.ts` is kept as it is, because it is free and because a bounded rewind of the
projectile's **birth tick only** (spawn-time catch-up, at most `lead` ticks) is the one refinement
this design would consider if the harness (§9) shows the ghost and the real shot separating at
spawn. It is not in the first cut.

**Attached beams and the lock bracket** are drawn on the extrapolated owner and target, in the same
timebase as everything else. Instances between snapshots are stepped through the shared
`stepInstance` from the baseline, not "constant velocity since last patch" — `predator`'s homing
needs the target index, which is why `homingTarget` is on the wire.

### 6.8 Events

**N23a — Reliable game events ride in the snapshot.** `hit { attacker, victim, weapon, x, y,
damage }`, `kill { killer, victim }`, `ram { attacker, victim, x, y, severity }`,
`slam { car, x, y }`, `respawn { car }`, `refused { car, slot }`. Events are what the client's
feedback layer consumes — impact sparks, screen shake, hit markers, kill banner, the hp bar's
damage flash — so the spark lands at the server's contact point on the server's tick, which
replaces the two-timebase local detection of F7. Events are idempotent per `(tick, kind, cars)` so
a resend after reconnect is harmless.

### 6.9 Client architecture

**N23 — `MatchClient`, a headless match state machine.** New package directory
`packages/client/src/match/`, importing nothing from Phaser, runnable under vitest's node
environment and in the harness:

| Module | Owns |
|---|---|
| `clock.ts` | ping/pong sampling, offset and jitter estimate, dilated tick period (N3) |
| `lead.ts` | the lead controller (N4) |
| `input-ring.ts` | local inputs by tick, for resim and press edges |
| `codec.ts` (shared, `net/codec.ts`) | snapshot/input/event encode and decode, protocol hash (N9–N11) |
| `prediction.ts` | baseline, predicted-world ring, `stepWorld` calls, reconcile-by-resim (N16–N18) |
| `fire-prediction.ts` | local `FireState`, ghost instances, handover (N22) |
| `render-offset.ts` | per-car and per-instance offsets and their decay (N19) |
| `frame.ts` | `frame(nowMs): RenderFrame` — every pose with offsets and tick blend applied, every instance, HUD numbers in tick time, events since last frame |
| `netgraph.ts` | counters: RTT, jitter, lead, slack histogram, late/repeated input rates, corrections per second, snaps, bytes in/out |
| `MatchClient.ts` | wires the above to a `MatchTransport`; `tick()`, `onSnapshot()`, `frame()` |

`ArenaScene` becomes a thin owner: it creates a `MatchClient` with the Colyseus transport, feeds it
key state each local tick, and each frame asks for a `RenderFrame` and hands it to renderers. The
renderers are split by concern into `packages/client/src/render/`: `cars.ts`, `shots.ts`,
`effects.ts` (events → sparks, shake, flashes), `hud/weapons.ts`, `hud/status.ts`,
`hud/roster.ts`, `hud/banners.ts`, `camera.ts`, `spectate.ts`. Each takes a `RenderFrame` and
Phaser objects it owns, and nothing else; the `combat-visual.ts` geometry stays as the pure library
it already is. The two-camera `ignore` list is centralised in one `layers.ts` so a new object is
registered in one place. Fixes F11; `resetMatchState`'s 84 lines become "new MatchClient()".

`RenderFrame` is a plain object rebuilt per frame; scenes read it, never the schema. The
`ArenaPlayer`, `ContextPlayer`, `StatusRowSource` and `DrawableInstance` duck types disappear.

How the renderers *draw* — baked atlases, retained sprites, particles, layers, quality tiers, the
HUD as its own scene — is the subject of the companion
[`2026-09-04-client-rendering-architecture-design.md`](2026-09-04-client-rendering-architecture-design.md);
this document only fixes what they are given (`RenderFrame` and events) and where the seam is.

**N24 — What stays on the Colyseus schema.** `ArenaState`: `phase`, `mode`, `arenaId`, the flow
deadlines, winner fields, and `players` with the lobby half of `PlayerState` (`sessionId`, `name`,
`colorId`, `team`, `status`, `carId`, `selectLocked`, `joinedAtTick`, `kills`, `deaths`,
`killedBySessionId`, `level`), plus a new `carIndex`. Everything `stepWorld` or `runCombat` writes
per tick leaves the schema (N15). `PracticeState`'s `paused` and `PlaygroundState`'s fields stay.
The view router keeps working off `phase` and `status`. This is a wire-format break: it ships as one
protocol version behind N11, and the "never renumber" rule is preserved for every field that stays.

**N25 — HUD and readouts are in tick time.** Every number the HUD shows — cooldown ring, wind-up,
respawn countdown, match clock, status drain bars, death fade, phased ghosting — is computed from
`localTick` (plus the frame's tick fraction), not from the last snapshot's tick. Hp bars ease
visually toward the snapshot value over 100 ms and flash on a `hit` event. Fixes the 20 Hz stepping
in F6.

### 6.10 Connection lifecycle

**N26 — Reconnect.** The room calls `allowReconnection(client, 60)` on an unexpected leave; the car
follows N6 (repeat, then neutral: it brakes to a stop and stays where it is, solid and killable — a
stopped car is a target, not an invulnerable obstacle, so it needs no despawn). The client keeps the
`reconnectionToken`, retries with backoff, and on success receives the roster message, restarts
clock sync and lead from scratch, and takes one full snapshot as a new baseline. Under full
snapshots a reconnecting client needs exactly what a joining one needs, which is why the window can
be generous. A late joiner or a spectator uses the same path. Fixes F12.

**N27 — Silence and floods.** A client whose inputs are all late for 2 s is shown a warning; the
netgraph shows the late rate. A client sending more than 3× the tick rate is throttled by ignoring
the extras (N6) and, after 10 s, disconnected with a reason.

### 6.11 Bots, practice and playground

**N29 — The `D` knob.** A dev-only render delay: the client can render every car `D` ticks behind
its present instead of at it. `D = lead + RTT` renders raw server state with prediction bypassed, so a
bug that survives is in the sim and one that vanishes is in prediction. On a hotkey in the netgraph
build; never exposed to players, and if it ever were it would apply to every car uniformly — your
car at the present and remotes in the past is the contact error this design exists to remove.

**N30 — The server logs the per-tick input stream.** About 1.2 KB/s, under 1 MB for a ten-minute
match, gitignored beside the playtest reports. It gives deterministic bug reproduction, feeds the
netcode harness with real input distributions (how often inputs change inside the extrapolation
window, and whether the changes cluster at contact — the one unknown that decides how good N20
actually is), and makes replays or spectating a later feature rather than a rewrite.

**N28 — No behaviour change in the sim or the bot.** `PracticeRoom` and `PlaygroundRoom` adopt the
`TickScheduler`, the input ring and the snapshot broadcast through the same `runPipeline`; their
extra schema fields are unaffected. `shouldRefusePlayground` and the `setTuning` rules stand; N11
makes the tuning hash part of the protocol. The bot's `view-ring` staleness parameter continues to
model "what a remote sees" and is re-expressed in snapshot ticks.

### 6.12 Failure modes

| Situation | What happens | What the player sees |
|---|---|---|
| Jitter spike inside buffer | snapshot applied on time | nothing |
| Jitter spike past buffer | client predicts on; late snapshot resims; offset decays | at most a 120 ms slide of remotes |
| TCP stall 1 RTT (loss) | as above; lead absorbs the input side | nothing on own car; a slide on remotes if the stall exceeds the buffer |
| Stall > 500 ms | world freezes at `maxPredictionTicks`; overlay | "Connection interrupted"; one correction on resume |
| Client alt-tabs | inputs stop; server repeats then neutral; car brakes | car drifts to a stop for everyone |
| Server hitch > 1 tick | catch-up ticks, snapshots for each | remotes and self both advance in one burst, blended |
| RTT changes by > 4 ticks | clock re-anchors; lead re-derived | one correction |
| Build or tuning mismatch | join refused (N11) | a message naming the mismatch |
| Snapshot decode error | connection dropped, logged with the buffer | reconnect path |
| Ghost shot never confirmed | ghost removed after `lead + RTT + 2` ticks; HUD resims | a shot that vanishes at the muzzle ("refused" event shows why) |

### 6.13 Performance budget

| Component | Budget | Basis |
|---|---|---|
| Server tick, 6 cars, 40 instances | ≤ 2 ms | today's pipeline measures ~0.1 ms interval error at 12 rooms; `stepWorld` adds no work, only moves it |
| Server upstream | ≤ 1 Mbit/s for 6 clients | N9 estimate |
| Client sim per frame (predict + resim worst case) | ≤ 0.5 ms | ≤ 6 `stepWorld` calls of 6 cars |
| Client `RenderFrame` build | ≤ 1 ms | pose math and offsets only |
| Client draw | see the rendering spec's R25 | measured for this pass: the afterburner ceiling alone costs 6.5 ms of CPU on the immediate-mode path (2.65 ms geometry + 3.88 ms earcut), which is why drawing is designed separately in [`2026-09-04-client-rendering-architecture-design.md`](2026-09-04-client-rendering-architecture-design.md) |
| Client memory growth per match | zero | rings are fixed size; instance ids are recycled per owner |

The server-side per-tick allocations found in the survey (an O(N²) hull rebuild, two `damageClock`
`Map` clones per live instance per tick) are not on the critical path at 6 players and are left
alone by this design; the harness reports tick time so they can be revisited on evidence.

## 7. Measurement, testing and acceptance

**Unit tests** (vitest, node): codec round-trip for every message including edge values and
quantisation error bounds; the lead controller against scripted slack streams; the clock filter
against a jittered link; the input ring's repeat, neutral fallback, late-drop and press-edge rules;
`stepWorld` equivalence with today's `serverTick` + `contactTick` on the existing fixtures
(including `golden.test.ts`); reconcile-by-resim on a scripted divergence; ghost handover and
expiry; render-offset decay.

**Netcode harness** — the existing `packages/server/playtest/prediction.ts` grows into
`playtest/netcode.ts`: a real room pipeline and a real `MatchClient` per simulated player, connected
by a link model with latency, jitter, loss-as-stall and bandwidth cap, driven by scripted and bot
inputs. It follows the playtest rules: it reports, it sweeps the sub-tick phase for contact, and it
does not assert. It reports, per scenario and latency: local correction magnitude p50/p95/max,
remote extrapolation error p95, snaps per minute, input slack histogram, repeated-input rate,
predicted-shot mismatch rate, bytes per tick, server tick time. The user runs it; per root
`CLAUDE.md` its expectations are updated on request.

**Acceptance at the design point** (90 ms RTT ± 20 ms, 1 % loss, 6 players, 10-minute bot match):

| Metric | Required |
|---|---|
| Local car correction, free driving | p95 < 1 u |
| Local car correction, contact scenarios | p95 < 12 u, max < 48 u (no snap) |
| Remote extrapolation error | p95 < 20 u |
| Repeated (missing) inputs | < 1 % of ticks after the first 2 s |
| Ghost shots not confirmed | < 0.5 % of presses |
| Snapshot size | ≤ 700 bytes, ≤ 1.2 KB during a pepperbox volley |
| Client frame (sim + frame build) | < 1.5 ms on a 2019 integrated-graphics laptop |
| Same run at 150 ms RTT | no metric worse than 2× |

**In-client netgraph** (`?debug=net`): the N23 counters as an overlay, so a LAN or internet
playtest can be read without a harness. **LAN playtest** (`playtest:lan`) is extended to print the
same counters from real sockets.

**Divergence metric, and the differ.** The per-field comparison N17 already performs is logged as
a histogram; a field that diverges beyond a quantum on more than 1 % of ticks in free driving is a
bug in the shared step, and the harness names the field. This is the desync detector: it needs no
checksum because the snapshot *is* the checksum. Three conditions, taken from the consolidated
note (§13), keep it honest:

1. **It hashes contact sets and collision booleans, not only poses.** The failure that matters is
   not slow drift but a discrete branch flip — one ULP of `cos` flipping a separating-axis test at
   the boundary so one side has a contact the other does not. A pose-only comparison can miss it.
2. **It runs cross-engine, on the supported browsers.** Decided 2026-09-04: the game supports
   Chrome, Edge and Firefox; Safari is not a target. Node and Chromium are both V8 and will agree;
   Firefox's SpiderMonkey ships fdlibm-derived math and is expected to agree too, so the harness's
   browser run is Chromium and Firefox, and a "no divergence" result needs both. If Safari is ever
   added, WebKit joins the run before that claim is made again.
3. **A pre-committed trigger.** If any cross-engine run shows a contact-set divergence within a
   ten-tick replay — including one that heals on its own, because it still produced a frame on
   which two players disagreed about whether they touched — the sim's transcendental calls move to
   a shared lookup table. Pose drift below the quantisation floor never triggers it.

**Weapon exposure, reported per weapon.** Two metrics from the note, recomputed by the harness
against the live tables every run: *flight time to the lock range* (the victim's reaction window;
every projectile clears the RTT bar by a wide margin today and `lance`'s 700 ms wind-up covers its
own) and *hit tolerance* (perpendicular half-width of the shot plus the car's half-extent — the
shooter's exposure to prediction error). Alongside them, the netgraph counts the fraction of shots
fired beyond `AIM_CONFIG.lockRange`, because a locked shot is re-aimed by the server and only the
manual zone is exposed. These are measurements, not balance decisions.

## 8. Migration

Each phase ships on its own, keeps every test green, and leaves the game playable.

| Phase | Ships | Fixes | Acceptance |
|---|---|---|---|
| 0. Instrument | `NET_CONFIG.interpolationDelayMs` 50 → 67 (a one-constant fix for the shipped zero-headroom buffer, deleted again by phase 3); ping/pong, RTT and jitter estimate, netgraph overlay, the input log (N30), the netcode harness with today's client, the differ (§7) | F4 (half) | baseline numbers recorded; frozen-remote frames under 1 % at 25 ms jitter |
| 1. Time | **60 Hz sim (N1a) with its three hand retunes and every fixture re-pinned**, `TickScheduler`, tick-stamped inputs, input ring with repeat/neutral, lead controller, snapshot on tick (still schema, still floats) | F2, F3, F5, F4 (half) | repeated-input rate < 1 %; free-driving correction stays 0; golden and turn-tuning suites green on the new rate; `npm run playtest` baseline captured before and after |
| 2. Wire | binary snapshot and input codec with delta compression, `snapshotEvery` knob, car indices, `lastInput`, `shotSeq`, `homingTarget`, protocol hash, schema split (N24), delete `TICK_RATE_HZ` override | F9, F10 | full snapshot ≤ 700 B, delta steady state ≤ 350 B; join refuses a mismatched build |
| 3. World | `stepWorld` in shared with `ContactMemory` in state; `MatchClient` with whole-world prediction, resim reconcile, jitter buffer, render offsets; `ArenaScene` split into renderers | F1, F7, F8, F11 | contact correction p95 < 12 u, zero snaps |
| 4. Feel | predicted fire state, maneuvers and ghost shots; events; tick-time HUD; hp easing and flashes | F6 | ghost mismatch < 0.5 %; press-to-flash one frame |
| 5. Lifecycle | reconnect, silence handling, late join | F12 | a pulled cable resumes within 15 s |
| 6. Optional | volley compression (§13), Colyseus 0.18 and a WebTransport transport behind the seam, `thunderclap` wind-up (N31) as a balance change | — | on evidence from the harness |

Phase 3 is the large one and is where the rewrite lives; phases 1 and 2 are each a week-scale
change that improves the shipped game on its own, and phase 1 alone removes the two structural
sources of jitter (F2, F3).

## 9. Decisions at a glance

| # | Decision |
|---|---|
| N1 | Drift-free `TickScheduler`; snapshot broadcast inside the tick |
| N2 | Inputs are stamped with the tick they are for; `seq` is gone |
| N3 | Ping/pong clock sync, lowest-RTT offset, dilated local clock |
| N4 | Adaptive input lead from server-reported slack, target 1–2 ticks |
| N5 | Client fixed-step accumulator, catch-up capped, re-anchor on long stalls |
| N6 | Per-client input ring; repeat on silence, neutral after 200 ms; extras ignored, late dropped |
| N7 | Press edges derived from the ring |
| N8 | Bots write into the ring |
| N1a | The sim runs at 60 Hz; three named hand retunes in phase 1 |
| N9 | One hand-packed, delta-compressed binary snapshot per tick at 60 Hz by default, `snapshotEvery` fallback, 1/16 u, server rounds its own state |
| N31 | Mobility powers telegraph for at least the window or commit once started; late reveals render as the effect |
| N10 | 5-byte binary input |
| N11 | Protocol hash of codec + every balance table at join; tick-rate override removed |
| N12 | WebSocket stays, behind `MatchTransport` |
| N13 | `stepWorld` in shared is the lockstep; `stepSim` unchanged inside it; `ContactMemory` in state |
| N14 | `runCombat` unchanged, server-only, D20 seam kept |
| N15 | Invariant 8: if `stepWorld` reads it, it is a snapshot field |
| N16 | Client predicts the whole world from the newest snapshot |
| N17 | Reconcile by resim; sim state is never eased |
| N18 | Jitter buffer on snapshots; predict-through up to 500 ms |
| N19 | Corrections are render offsets decaying over 120 ms; > 48 u is a counted snap |
| N20 | Remotes extrapolated with their last input, capped at 8 ticks |
| N21 | Contact (ram, slam, dash) predicted; damage and stun not |
| N22 | Local fire state, maneuvers and ghost shots predicted; per-owner `shotSeq` makes ids predictable |
| N23 | Headless `MatchClient` + `RenderFrame`; `ArenaScene` split into renderers |
| N23a | Reliable events in the snapshot drive all feedback |
| N24 | Colyseus schema keeps lobby and flow only |
| N25 | HUD in tick time; hp eased visually |
| N26 | Reconnect with a 60 s window; a disconnected car brakes to a stop and stays killable |
| N27 | Silence warning; flood throttle |
| N28 | Bots, practice, playground unchanged in behaviour |
| N29 | Dev-only `D` render-delay knob |
| N30 | Server logs the per-tick input stream |
| N10a | Inputs sampled from key events with timestamps, bucketed into ticks |

## 10. Open questions for the reviewer

1. **Remote timebase (N20) — resolved 2026-09-04: approach C.** The user chose the predicted
   present: contact (ramming, `thunderclap`, `wildcharge`) reads as precise on every screen, and
   shooting carries the target's input-change error over the extrapolation window instead of a
   rewind. Approach B (interpolated past with rewind hit testing) is recorded in §4 as the road
   not taken; the snapshot and time work (phases 1–2) would have been the same under either.
2. **Snapshot rate (N9) — resolved 2026-09-04: 60 Hz by default with delta compression,
   `snapshotEvery = 2` as the fallback for a host whose measured upload cannot carry it.**
3. **Reconnect window (N26).** 15 s is a guess; in last-standing a reconnecting player's car brakes
   to a stop and can be killed meanwhile, which seems right.
4. **The user's own note — resolved 2026-09-04: reconciled.** See §13. The file named in the ram
   spec was superseded by `docs/ideas/claude-cursor-netcode-consolidated-architecture-proposal.md`
   (2026-08-30), which is what this document was reconciled against.
5. **Hosting — resolved 2026-09-04: player-hosted now, a central server later; no decision depends
   on it.** Three choices were made so the switch is configuration: the transport seam (N12, where
   a central server's real certificate makes WebTransport worth evaluating), the `snapshotEvery`
   fallback (N9, which exists only for a home upload), and the per-room protocol hash (N11). Two
   things to carry forward: a player-hosted server gives the host zero latency and therefore a
   real advantage that this design does not equalise; and a central server hosting several
   matches needs per-room tuning and the singleton-arena rule lifted, which is server plumbing.
6. **Ping (§1) — resolved 2026-09-04: round-trip.** The design point is 90 ms RTT, as assumed.
7. **Keeping Colyseus (N24) — resolved 2026-09-04: keep.** For lifecycle, rooms, lobby and flow;
   the match hot path bypasses it. The cost accepted is the two-channel split (schema for lobby,
   binary for the match, tied together by the roster message) and a later version migration
   confined to the lobby half; the cost avoided is rebuilding rooms, sessions, reconnect tokens and
   matchmaking, which a central server will need.
8. **Transport (N12) — resolved 2026-09-04: WebSocket stays, behind the seam.** WebTransport is
   evaluated in phase 6 alongside the move to a central server, whose real certificate removes the
   pinning problem; WebRTC data channels are not pursued.
9. **Wire break (N24) — resolved 2026-09-04: accepted, as one protocol version bump.** Sim fields
   leave the schema and every match message changes; the protocol hash (N11) refuses a mismatched
   join with a readable message, which is the guarantee the never-renumber rule existed to give.
   The rule stands for every field that remains.
10. **Order of work — resolved 2026-09-04: two parallel streams after a shared preparation step.**
    First, alone: split `ArenaScene.ts` mechanically into its net half and its render half with no
    behaviour change, and write down the `RenderFrame` and event interfaces (N23, N23a) with a stub
    that fills them from today's schema. Then the netcode phases (§8) and the rendering phases
    (rendering spec §10) run in separate sessions and worktrees, each in its own order, merged into
    `development/main` after every phase with the other stream rebased on it. Three couplings:
    netcode phase 1 (60 Hz) lands before rendering V3 so beam timings are authored once; rendering
    V4 consumes phase 4's events and proceeds on synthesised ones from the bench scene until they
    exist; each worktree runs its own `npm install` and build so it never inlines the other
    stream's shared `dist`.
11. **Tick-rate override — resolved 2026-09-04: deleted in the wire phase (N11).** Nothing relies
    on it.
12. **Browsers — resolved 2026-09-04: Chrome, Edge and Firefox.** The differ runs on Chromium and
    Firefox; the bench scene runs on both.
13. **Tuning tables in the protocol hash (N11) — resolved 2026-09-04: strict.** No case exists where
    server and client should run different tables; a difference is a desync by definition.

## 11. Stop-and-ask items this design touches

- **Drive model: the 60 Hz tick (N1a), authorised by the user on 2026-09-04.** `stepDrive` and
  `stepSim` are unchanged in code, but the step halves and three tick-authored behaviours are
  hand-retuned (N1a names them). Everything else in the drive model is untouched.
- **Angle normalisation — resolved 2026-09-04: on the wire only, and that is enough.** Because the
  server adopts its own quantised state after every tick (N9), the angle is wrapped to the 16-bit
  range on the server each tick as a side effect, and every client resim starts from that wrapped
  value; the number never grows on either side. `stepDrive` is not edited for it. `angle` is wrapped **on the wire**
  only (N9); the client's local body keeps its unbounded angle and every comparison is already
  wrapped. If the reviewer prefers normalising `angle` inside `stepDrive` for cleanliness, that is a
  drive-model edit and is called out here rather than done.
- **Hitbox model: none.** Quantising positions to 1/8 u changes what a *client* predicts against by
  less than the existing reconcile epsilon; the server's hulls are unquantised.
- **Collision-damage and friendly fire: none.** `runCombat` and `canDamage` are untouched.
- **Physics engine: none.** `resolveWorld` and `resolveContacts` move behind `stepWorld` unchanged.

## 12. Documents this supersedes or amends

- `docs/networking.md` — rewritten by phase 3.
- `docs/architecture.md` — the tick and client paragraphs.
- Root `CLAUDE.md` hard invariants 4, 5 and 8 — reworded as in N13, N9 and N15.
- `docs/superpowers/specs/2026-08-27-weapon-system-design.md` "Online-play review" and "Future
  work" — the rewind plan there is replaced by §6.7 of this document; D20 stands.
- `docs/schema-reference.md` — the `PlayerState` table shrinks to the lobby half (N24); a new
  snapshot reference is written beside it.
- `docs/asset-pipeline.md` "How much detail a shot can afford" and `packages/client/CLAUDE.md`'s
  cost notes — superseded by the rendering spec's §1 measurement and R1–R8.

## 13. Reconciliation with the consolidated netcode note (2026-08-30)

Read at the user's direction on 2026-09-04. The note is
`docs/ideas/claude-cursor-netcode-consolidated-architecture-proposal.md`, dated 2026-08-30, which
supersedes the `online-netcode-and-client-architecture-spec.md` the ram spec cites. It was written
against the roster of that date (older weapon names, Mirage at 576 u/s and 4.2 rad/s, ram CC not yet
shipped) and assumed a 60 Hz sim and an authorised physics rewrite. Every number below was
recomputed against the shipped code before deciding.

### 13.1 Where the two agree

| Topic | Note | This document |
|---|---|---|
| Remote cars | C1: predict all six through the shared step with repeat-last-input; delete interpolation | N16, N20 |
| Lag compensation | C2: none; rewind and extrapolation double-count latency in opposite directions; keep a pose history that is authoritative for nothing | §6.7, N14 |
| Clock and lead | C5: run-ahead, server reports buffer occupancy, time dilation never tick skipping, repeat then decay to neutral, late inputs dropped | N3, N4, N5, N6 |
| Ram | C3: predict the continuous half (impulse, velocity, spin), server-only for damage, statuses, elimination | N21 |
| Combat feedback | C11: predict the flash and the tagged spawn, never damage; blend onto the authoritative instance | N22 |
| Transport seam | C7's fallback: keep Colyseus for lifecycle and lobby, move the state channel to raw binary behind a `send(bytes)` seam | N9, N12, N24 |
| Protocol | full snapshots, quantised, `lastInputEcho` per car, car indices | N9 |
| Determinism | no bit-exactness required; no `Math.random`; ticks not milliseconds; sorted iteration | §4 A, §5 |
| Error smoothing | render-time visual offset, never a sim edit | N17, N19 |
| Allocation | none on the sim or frame path, as an invariant | R6 of the rendering spec |
| Reconnect | nearly free under full snapshots | N26 |
| Refusals | no equalised delay, no client-authoritative hit, no interest management | §5 |
| Build order | netcode first; the note's own §5.2 argues this over its physics-first table | §8 |

The note's central measurement — that `v·ω`, the steering term, dominates prediction error and both
earlier drafts had understated it by using throttle — was also right against this document's first
draft, and §6.6 was corrected accordingly.

### 13.2 Where they disagree, and what was chosen

**Tick rate — note 60 Hz, this document first said 30 Hz. Chosen, after discussion the same day:
60 Hz, in phase 1 (N1a).** The note's first reason (its impulse solver) is not adopted, but its
second stands and, once the user's plan for more mobility powers was on the table, decided it: a
finer tick buys exactly the slack the link needs, halves per-tick displacement, and lowers the
wind-up a mobility power needs to be predictable. The cost is a sim behaviour change behind the
drive-model fence — contact damping per tick, `reverseHoldTicks` in ticks, the halved Euler step —
which the user authorised and N1a names as one deliberate retune with every fixture re-pinned.

**Physics rewrite (C8) — note adopts a velocity-vector drive and a sequential-impulse solver; this
document leaves the sim untouched. Chosen: untouched.** C8's stated purpose was to make a ram
*graded* so that a contact disagreement degrades to "slightly less spin" instead of "stunned or not".
The ram-CC design that shipped on 2026-08-29 already did that with severity as a continuous 0–1 from
approach speed and mass, and explicitly chose not to take the rewrite. The remaining C8 benefit, an
angular-velocity ramp that trims reversal error by about a quarter, is real and is recorded as a
lever if the harness shows the tail is too fat — as a drive-model change to be authorised then.

**Transport — note upgrades to Colyseus 0.18 with WebTransport as a first-class path; this document
stays on 0.15 WebSocket behind the seam. Chosen: stay, and re-evaluate at phase 6.** 0.18.5 exists
upstream; the note's own top risk is unverified (whether 0.18 delivers unreliable datagrams
server → client at all). Two further facts weigh against doing it now: WebTransport needs TLS with a
certificate the browser trusts, which for a player-hosted server means certificate-hash pinning on
a two-week rotation; and 0.18's built-in prediction helpers do not fit a hand-packed snapshot path.
The seam is what makes deferring safe.

**Snapshot rate — note 30 Hz then 60 Hz gated; this document first said 30 Hz. Chosen, after
discussion the same day: 60 Hz by default with delta compression, 30 Hz as a knob (N9).** The
snapshot's age is the one slice of the window a rate can shrink, and at 60 Hz the jitter buffer
can be zero because the next snapshot covers a late one; together that is worth about 30 % of the
worst-case remote error. The note gated 60 Hz on head-of-line risk over TCP; the same risk is
accepted here because predict-through and the resim absorb a one-RTT stall, and the fallback knob
exists for uploads that cannot carry it.

**Quantisation — note 1/16 u with the server adopting its own quantised state; this document had
1/8 u with a client-side tolerance band. Chosen: the note's rule.** Quantised positions feed a
collision solve, so precision matters more than for drawing, and a server that rounds its own state
makes the snapshot exactly the truth and the divergence metric a real detector. N9 amended.

**Aim assist — note runs the lock on both sides, collapses seven stateful knobs to one commit timer
plus a steal margin, and replicates the timer; this document keeps the lock server-only and aims
the ghost shot with the last replicated target. Chosen: server-only for the first cut.** The ghost's
aim is visible for under one RTT before the authoritative instance takes over with a blend, which
the acceptance threshold on ghost mismatch already bounds. Collapsing the lock's state is an
aim-feel change (`commitMs` 400 → 150) outside this brief. The note's warning that the steal margin
defends against target-choice divergence is accepted and the margin is kept. Running the shared lock
client-side is the recorded upgrade if the harness shows ghosts diverging.

**Determinism differ — note builds a cross-engine differ hashing contact sets with a pre-committed
lookup-table trigger; this document had a pose-histogram. Chosen: the note's conditions.** §7
amended: contact-set hashing, WebKit in the cross-engine run, the trigger as stated.

**Input redundancy and sampling — note sends the previous 8 inputs per packet and samples inputs
from key events with timestamps; this document sent one input per packet from per-tick key state.
Chosen: both of the note's, in the form N10 and N10a state.** Redundancy is a codec capability
used only by an unreliable transport; event-timestamped sampling is cheap and removes a frame-rate
dependence in where a press lands.

**Jitter margin — note measures a floor of two ticks of buffer occupancy at 30 Hz and calls "1–2
ticks" too optimistic; this document targeted slack in [1, 2]. Chosen: the note's floor.** N4's
controller raises lead whenever the 5th-percentile slack drops below one tick, which is the same
rule; the initial lead of 3 at the design point already sits on it.

**Interpolation buffer today — note's P0 is `interpolationDelayMs` 50 → 67; this document had no
such step. Chosen: adopted into phase 0.** One constant, fixes a measured zero-headroom buffer in
the shipped client at any ping, deleted again when interpolation goes.

**Reconnect — note 60–90 s grace, car coasts to a stop and despawns after 5 s; this document 15 s
and the car stays. Chosen: 60 s, coast to a stop, stays.** A stopped car is a target, not an
invulnerable obstacle, so it needs no despawn; removing it would also end a last-standing round
for a player whose Wi-Fi blinked.

**Volley compression — note sends a pellet fan as one row and lets clients derive the pellets; this
document sends every instance. Chosen: every instance now, the note's compression as a phase 6
optimisation.** Delta compression (N9) was pulled into the wire phase instead when snapshots went
to 60 Hz; per-pellet death events are the protocol surface volley compression would add.

**`D` knob and input logging — note has both; this document had neither. Chosen: both, as N29 and
N30.** Cheap, and the input log is the only way to answer the note's own open question about
whether input changes cluster at contact.

**Weapon exposure — note derives two per-weapon metrics and a "manual zone" fraction; this document
argued from flight time only. Chosen: adopt the metrics as harness measurements** (§7), recomputed
against the live tables because the note's weapon names and numbers predate two roster overhauls.
No balance change follows from either document.

**Hosting — note recommends in-country single-region hosting; this document assumes a player-hosted
server. Not decided here**: adding hosting is a stop-and-ask item and nothing in either document
depends on it.

**Rendering — the note's client section is a page; this document's companion rendering spec is the
whole subject.** No conflict; the note's "no allocation" and "local VFX on the render timeline" rules
are in it.
