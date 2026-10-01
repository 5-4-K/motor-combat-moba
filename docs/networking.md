# Networking

Clients must never send poses. The wire message is `INPUT_MESSAGE` (`"input"`): an `InputPacket`, `{ inputs: InputFrame[] }` — the newest frame plus up to three before it (`inputRedundancy`, NR24), oldest first. An `InputFrame` is `{ tick, steer, throttle, fireSlots, aimAngle?, viewTick? }`. **`tick` is the tick the frame is FOR** (NR17, NR25) and doubles as the sequence number: there is no `seq`, no `InputMessage` type and no per-frame ack. `fireSlots` is a uint8 bitmask, bit 0 = **fire slot 0, the basic attack** (abilities are 1..`N`); it carries key state, never presses. `aimAngle` is the world bearing, radians, from the turret pivot to the crosshair (TR21), read by the server only off a frame whose mask carried a NEW press (TR23). `viewTick` is the render tick the client was drawing remotes at; the validator accepts it, but no client sends it yet (Phase F's shot compensation, NR35). `isInputPacket` (shared `net/tick-input.ts`) validates the whole packet before anything is enqueued: 1–4 frames, an index loop over every one (a sparse array cannot skip the check), each with a safe-integer `tick` ≥ 0, `steer`/`throttle` exactly -1, 0 or 1, a fire mask that is an integer within the structural ceiling, and an absent-or-finite `aimAngle`. Everything a client sends is untrusted; the buffer copies only whitelisted fields.

`ArenaRoom` ticks at sim rate (`TICK_RATE_HZ`, 60) and broadcasts a snapshot at `SNAPSHOT_RATE_HZ` (60): `patchRate` is `null`, and the room calls `broadcastPatch()` itself at the end of every tick `isSnapshotTick` (`rooms/snapshot-cadence.ts`) names, so a snapshot is always the state of exactly one tick and carries that tick (NR12). The snapshot rate is its own constant, and no client code may assume one snapshot per tick (hard invariant 5). The room holds the tick rate through `FixedStepper` (`rooms/fixed-step.ts`): one tick per `MS_PER_TICK` of measured wall clock, at most `NET_CONFIG.maxCatchUpTicks` (5) per frame, the rest of a stall's backlog dropped.

## Server

**One input per car per tick (NR17, NR22).** Each session owns a `TickInputBuffer` (shared `net/tick-input.ts`), keyed by the tick a frame is for. On arrival `offer(frame, lastCompletedTick)` returns `accepted`, `duplicate` (the redundant copies), `late` (the tick has already run) or `early` (more than `maxInputLeadMs`, 250 ms, past the next tick — dropped, not buffered). `serverTick` then calls `take(state.tick)` exactly once per car per tick:

- the real frame for the tick if it arrived in time;
- otherwise the **last real input repeated** for `inputRepeatMs` (250 ms) — held keys stay held, and a repeat can never create a fire press, because press detection compares against the previous consumed mask;
- then **neutral keys**, so a vanished client's car coasts and stays rammable.

So a car steps exactly once per tick however many frames its client sent. That closes the old speed hack (a client sending five inputs a tick moved five times as far): the netsim reads `stepsPerTickMax` 1 on every link. `PlayerState.ackRepeated` reports whether this tick ran on a fill. The same call refreshes `inputSlack` and `inputSlackStd` (see [Slack spread](#slack-spread-nr21-d5-ruling-e)). A car whose input was consumed but is not on the field still *takes* its tick's frame, so the buffer never holds a stale frame into the moment the gate opens; only `PlayerStatus.IN_MATCH` players move, and only they are solid to each other. In-process producers — bots, the playground's parked seats, the balance and playtest harnesses — go through the same buffer (`offerForTick`, `net/offer-input.ts`), so every car on every path obeys one consumption rule.

**Time sync (NR18, NR19).** Every room (`ArenaRoom`, `PracticeRoom`, `PlaygroundRoom`) registers the pair through `net/net-session.ts`. `MSG_TIME` (`"time"`): the client sends `{ c }` (its send time), the server answers a `TimePong` `{ c, t, p }` — its last completed tick `t` and how many ms past that tick's due time it answered, `p` (`>= 0` and deliberately not capped at one tick: the room's 16 ms interval can answer after tick `t + 1` fell due, and `t × MS_PER_TICK + p` is the server time either way), so a pong describes the steady tick grid rather than the jittery moment a handler ran. Every server-side time-sync time — the grid's due times, a pong's asking time, the ping stamps and their echoes — is read from `netNowMs()`, a monotonic clock (`performance.now()`), never `Date.now()`, which a host's time service can step. `MSG_PING` (`"ping"`): the server probes `{ s }` every second, in every phase, and the client echoes it unchanged — bound once per room join in `net/connection.ts` (`bindTimeEcho`), not by a scene, so the lobby, car select, results and setup screens answer too and the server has an RTT before the arena starts; `NetSessions` remembers the last four stamps it sent each session and accepts an echo of one of them, once, so a forged old stamp cannot inflate the server's RTT figure (which Phase F will use to cap shot compensation).

## Client — movement

**Clocks.** `ClockSync` (shared `net/clock-sync.ts`) estimates the server's tick clock from pongs: a **weighted** least-squares fit of offset against time (weight `1 / (clockWeightFloorMs + excess/2)²`, excess being a pong's RTT above the window minimum, so a 250 ms spike weighs about 0.5 % of a clean pong), with a **drift** slope fitted over `clockFitWindowMs` (24 s) and capped at ±`clockSlewMsPerSec`/1000 (2 %). The offset follows the newest `clockOffsetWindowMs` (6 s); it slews at most `clockSlewMsPerSec` (20 ms/s) and snaps only past `clockSnapMs` (50 ms) — two pongs in a row more than twice that off are read as a server clock step. A pong gap of 6 s or more guards the fit. Pings go every `timeSyncIntervalMs` (500 ms), every `timeSyncBurstMs` (100 ms) for the first `timeSyncBurstWindowMs` (1 s) after join. `rttMs()` is the median of per-bucket minimum RTTs over `clockRttWindowMs` — **approximately the minimum RTT, deliberately steady, so it must never be shown to a player as "ping"**; it sizes the input lead, nothing else. `ArenaScene`'s `InputClock` (`scenes/arena-input.ts`) wraps clock, scheduler and prediction cadence, and is rebuilt on a practice or playground resume, since a paused room's tick stood still while pongs kept arriving.

**Input scheduling (NR20, NR21).** The client no longer emits one input per render-derived tick; it runs **ahead of the server's tick clock** and sends, for each server tick, the frame for that tick. `InputScheduler.due` returns the ticks to produce this frame: the target tick is `floor(serverTick(now)) + ceil(lead / MS_PER_TICK)`, where the lead is `rttMs()/2 + safety`. `safety` is a slack loop: the server reports the mean slack of the owner's last 30 frames (`PlayerState.inputSlack`, in ticks: frame tick minus the tick the server was about to run when it arrived), and each NEW sample (one per snapshot) moves the safety by `(target − slack) × 0.03 × MS_PER_TICK`, with a ±0.25-tick deadband. The target is `targetSlackTicks` (1.5) plus `slackSpreadK × max(0, inputSlackStd − 0.5)`. The lead is clamped to `maxInputLeadMs − 1 tick` (the server drops anything further ahead) and slews at most `maxDilation` (4 %) of elapsed time per call, so the client's tick clock runs up to 4 % fast or slow and never jumps. After a stall of more than `clientMaxCatchUpTicks` (8) ticks the scheduler resyncs and skips rather than bursting. Nothing is sent until the first pong has arrived.

**Prediction (NR26).** `TickPrediction` (shared `net/prediction.ts`) keeps the local frames, ascending by tick. `predict(state, frame, ctxFor)` pushes the frame and advances the local pose through the same shared `stepSim`, so the local car answers on the frame the key is pressed. A snapshot's `tick` prunes the pending list (there is no `pendingInputCap` any more); a safety bound of `maxInputLeadMs + 1000` ms of frames only guards a long snapshot silence.

**Reconciliation.** There is no ack to match: every car steps every tick, so a snapshot's pose IS the pose at the end of its own tick. On every state patch, `TickPrediction.reconcile(authoritative, snapshotTick, currentPredicted, ctxFor)`:

1. drops frames with `tick <= snapshotTick` (remembering the newest as the base the server would repeat from);
2. replays the remaining frames from the authoritative pose to get the target. A tick with no frame (a stall-skip gap) replays what the server simulated for it under NR22: the last known frame repeated for `inputRepeatMs`, then neutral;
3. if `hypot(dx, dy) > NET_CONFIG.reconcileSnapPos`, or the **wrapped** angle error exceeds `reconcileSnapAngle`, returns the target outright;
4. otherwise eases `x`, `y` and `angle` by `reconcileEasePerSnapshot()` — `reconcileEaseRate` (authored per 50 ms) rescaled to the snapshot interval, so the correction speed is independent of `SNAPSHOT_RATE_HZ` — angle along the wrapped delta, so it takes the short way, and **snaps** `vx`, `vy`, `angVel` and the maneuver state to the target. Those are derived sim fields that feed the next integration; a half-eased value would poison every following step, not merely look wrong.

Angle comparisons are wrapped (`atan2(sin d, cos d)`) because `stepDrive` never normalises `angle`: after minutes of turning it is thousands of radians, and a raw subtraction would measure accumulated winding rather than error.

**Redundancy (NR24).** Each packet carries `prediction.recent(1 + inputRedundancy)` — the newest frame and the three before it — so a lost or late packet costs nothing unless four in a row are gone. The server's `duplicate` result absorbs the extra copies; only a frame's first late arrival feeds the slack statistics.

**Prediction context.** `StepContext` is `stepSim`'s input, so the client's copy must describe the same world the server's does. The parts that decide *who is solid* and *how a hull is sized* are not duplicated — `carIdOf`, `isSolid` and `otherCarHulls` live in `@motor-combat-moba/shared` (`sim/context.ts`) and **both** `serverTick` and the client's `buildStepContext` call them. Change a hull dimension or the fallback chassis there and both sides move together.

**Remotes in the prediction context (NR32).** Remotes are not frozen at their last snapshot, and not at the interpolated pose they are drawn at (a render delay behind): `buildStepContext(..., poseOf?)` takes a per-car pose resolver, and the client answers it with `RemoteTimeline.reckonedPose(id, tick)` — the remote dead-reckoned (`RemoteReckoner`, shared `stepSim` fed that car's `lastSteer`/`lastThrottle`, NR33), capped at `maxExtrapolateMs`. Which tick it is reckoned to follows `serverTick`'s step order: cars are stepped one after another in sorted `sessionId` order against the others' current poses, so for the local car's step on tick T a remote that sorts before it stands at the end of T and one that sorts after it at the end of T − 1 (`remotePoseTickFor`, applied inside `buildStepContext`). The context is asked per tick (`StepContextFor`), so the first prediction of a frame and every later replay of it ask the same question for that tick — but each answers it from the newest snapshot the client holds at the time, so a replay after a new snapshot sees the remote reckoned from that snapshot, not the pose the first prediction used. Each frame's statuses are read at the frame's own tick rather than the snapshot's. The reckoner caches one run per snapshot, so a reconcile replaying several frames costs one reckoning, not one per frame. A remote with no track (never pushed, hidden, not on the field) falls back to its schema pose; a dead remote still has a track and an answer, but is not solid, so it never enters the context's hulls. On a practice or playground resume the prediction buffer is cleared, so the first post-resume frames are not refused as non-ascending.

What each side still owns is getting its roster into **sorted `sessionId` order** before calling `otherCarHulls`: `resolveWorld` resolves contacts sequentially and the last one resolved is the one guaranteed to end separated, so order changes the result. The server sorts once per tick and reuses the array; the client rebuilds it from `MapSchema.forEach`.

The third part of the context is the car's **status modifiers**, and it follows the same rule.
`StepContext.modifiers` is deliberately required rather than optional-with-a-neutral-default: the two
builders must describe the same tick, and a default would let one of them silently forget while the
other did not. The server derives the whole room's modifiers once per tick in `statusTick`, before
driving; the client derives its own car's through `localModifiers`, which reads
`PlayerState.statuses` off the schema and hands the rows to the *same* shared `modifiersFromRows`.

Both sides filter by `tick < endsTick` rather than trusting the list. The server's expiry sweep is
authoritative, but a snapshot is never guaranteed every tick (hard invariant 5) and arrives a link delay late, so
without the independent filter a client would predict ticks of a status the server had already dropped. A status list is
therefore neither snapped nor eased on reconcile: it is not a value being integrated, it is the rules
the integration runs under, and both halves derive it from the same tick through the same function.

That tick is the **frame's own**, not the snapshot's. `ctxFor` is a builder `TickPrediction` asks
once per step, with the server tick that step simulates — `predict` asks for `frame.tick`, the replay
for every tick after the snapshot — so a slow that lapses on tick X stops slowing the predicted car on
tick X, not `lead` ticks later (phase D review M5). The first prediction of a frame and every replay of
it ask the same question, answered from the newest snapshot each time. (A plain `StepContext` is still
accepted, for tests and the playtest probe.)

Note the split gate: `otherCarHulls` takes a `tick` argument and filters entries through `isSolid` (`isOnField && !phased`) — the **wall** half (who is solid). That filter runs in **both** directions: an entry that is phased is dropped from everyone else's hull list, and a phased *caller* is handed back `[]` rather than a real list, so a respawning car neither shoves nor is shoved by whoever it passes through. The **mover** half — whether the local player's inputs move anything — is `ArenaScene.canDrive`, mirroring the server's own mover gate (`isOnField`, unchanged). Remotes enter the context at their **dead-reckoned pose at the tick being stepped** (NR32): `buildStepContext`'s `poseOf` replaces each remote's `x`/`y`/`angle` with `RemoteTimeline.reckonedPose(id, tick)` — the newest snapshot stepped through the shared `stepSim` with the remote's last input, capped at `maxExtrapolateMs` past that snapshot and held there (on a slow link, that slow player's cost). Solidity, chassis and `ramDefence` still come off the roster. On each patch the remotes are pushed **before** the local car is reconciled, so the replay reckons them from that same snapshot. The client still predicts only itself.

**Interpolation.** Remotes are drawn through the shared `RemoteTimeline` (`net/tick-interpolation.ts`, NR29–NR31): each snapshot is stored under its server tick in a `TickInterpolation`, and a remote is drawn at render tick `R = serverTick − delay`, blending the two snapshots that bracket it (position lerped, angle the short way through `blendPose`). The delay is `DisplayDelay`'s: `clamp(p95 of the last 120 snapshot latenesses + one snapshot interval, minDelayMs, maxDelayMs)`, slewed at most 1 ms per frame; each server tick is sampled once, so a paused room re-broadcasting its frozen tick cannot inflate it. Past the newest snapshot the remote is dead-reckoned with the shared `stepSim` and its last input (`RemoteReckoner`, `lastSteer`/`lastThrottle`) for at most `maxExtrapolateMs`, then holds; when a later snapshot lands under an extrapolated frame, the gap is eased out over `extrapolateSettleMs` rather than snapped. Before the clock has synced, and while a practice or playground room is paused (`beginFrame`'s `paused`, from `isSimPaused`), a remote is HELD at its newest snapshot instead — a paused room's tick stands still while the clock runs on, so nothing is reckoned past the frozen pose — and the frame that leaves the hold (the clock becoming ready on a late join or a resume) eases like an extrapolated one. A patch whose tick did not advance but whose pose changed (a playground edit while paused) replaces the newest snapshot and is drawn; a re-broadcast of the same pose adds nothing. A death, a respawn, or a jump of more than `remoteTeleportCars` car lengths resets that remote's history. The render tick is fixed once per frame and recorded as `lastRenderTick` for Phase F's `viewTick`.

**Contact blend (NR34).** A remote far from you is drawn on its interpolated path; one you can touch is drawn where your prediction will meet it, so a ram you land on screen is a ram the sim sees. `contactBlendWeight(distance, carLength, contactBlendRangeCars)` (`net/contact-blend.ts`) is 0 at `contactBlendRangeCars` (2) car lengths or more, 1 at one car length or less, linear between; the drawn pose is `blendPose(interpolated, reckoned-at-the-fractional-tick, weight)`, with the reckoning sampled at the fractional server tick, the weight slewed frame to frame so crossing the range edge never jumps the sprite. The final pose is eased only when its target is REPLACED — a snapshot rebases the reckoning, or the anchor tick moves by more than half a tick outside an advance of zero to one frame's worth — and the eased gap is the old target minus the new one at a tick BOTH reckonings reach. Past the `maxExtrapolateMs` cap the old reckoning holds while the new one (a snapshot later) reaches one snapshot interval further; that advance is the car's own motion and is drawn as it comes, not eased — so a steady drive or turn the reckoner already had right arms nothing, inside the cap or past it. Only an advance of more than one snapshot interval (snapshots lost or late) has its excess eased with the rebase. Past the cap the whole-tick reckoning would move only once per snapshot, which at display rates above 60 Hz draws a contact-range remote hold-and-jump; so the DRAWN cap (never prediction's: `reckonedPose` keeps the whole-tick cap, NR32) extends continuously by the time since the newest snapshot was first due to arrive — its tick plus the slewed minimum recent lateness — up to one snapshot interval. The drawn remote therefore leads the pose prediction collides with by at most one tick of its motion, never lags it, and moves by its own motion per frame; the rebase gap is measured at the old reckoning's drawn cap, so a steady car arms nothing across an arrival. While paused, the reckoned target is clamped to the newest snapshot like the render tick. The anchor is built by the shared `localAnchorOf`, used by both `ArenaScene` and the netsim client. Distance is measured from the local car's drawn pose. Beyond the extrapolation cap the reckoned pose holds, so the blend degrades to a held pose rather than flinging a car away.

**Local render blend.** Prediction advances once per server tick, so at 60 Hz the predicted pose changes every other frame. Drawing it raw makes the local car hold-and-jump while the camera eases and remotes glide, which reads as a doubled, smeared sprite in motion. `ArenaScene.localRenderPose` therefore draws `blendPose(previousPredicted, predicted, alpha)`, where `alpha` is `InputClock.blendAlpha` — the fractional part of the **server tick phase** (`localBlendAlpha` of `ClockSync.serverTick(now)`), not a render-side accumulator. It is render-only: `predicted` is still what the next step and reconcile read, and a reconcile correction is simply carried across the rest of the tick window by the same blend.

`CAMERA_CONFIG` (`camLerp`, `zoom`, `freeRoamSpeed`) is a render knob only — nothing in `stepSim` reads it.

## Client — combat

Combat is not predicted at all. `fireSlots` rides the wire with steer and throttle as raw key state, and the server decides everything that follows — including **whether a held key is a new press**, which it derives from its own `prevFireMasks` rather than trusting the client to send edges: whether a slot's stocks and locks allowed a shot, where it went, and what it hit. `ArenaScene` draws `state.weapons` (projectile and beam instances alike) and the HP it is told about, and spawns no local shot of its own — a predicted bullet the server never fired either vanishes or, worse, reads as a hit that never happened, and there is no honest way to reconcile "you were dead for 80 ms".

The one client-side liberty is cosmetic: a projectile is advanced along its **own constant velocity** between patches, and a beam's `extent` is grown the same way (`extrapolateShot` / `instanceDrawShape` in `combat-visual.ts`, both capped at one patch interval). That is exact rather than a guess — the server integrates the identical motion — and nothing it produces feeds back into state. See [`combat-model.md`](combat-model.md) for the weapon state machine `fireSlots` is gated by.

Firing rides the same gate as movement. `serverTick` reports the session ids that asked to fire on an input it actually **simulated**, so a frame the sim never consumed cannot buy a shot. `canDrive` gains `alive` in P5: a wreck stops sending inputs and stops predicting, because the server has stopped stepping it.

v1 hit detection is **current-tick**: no rewind, no lag compensation, so a shooter leads a moving target by roughly their own latency. LAN latency is what makes that acceptable. See [`combat-model.md`](combat-model.md).

## Client — lobby

`MSG_CHAT` (`{ text }`) is a lobby intent, not state (invariant 3): the client sends raw text and the
server decides everything else. It passes three server-side gates before a row is appended to
`ArenaState.chat` — the sender is `PlayerStatus.READY` (the status `viewFor` maps to the lobby
screen for any player the room's state machine can actually produce), a `CHAT_CONFIG.sendCooldownMs`
cooldown since that sender's last message, and
`validateChatText`. All three drop the message silently, matching every other lobby handler in the
file except `MSG_START_ERROR`, which replies because a host needs to know why a start was refused —
a refused chat message needs no reply, since the client ran the same validator first and anything the
server still rejects is a stale or hostile client. See
[`schema-reference.md`](schema-reference.md#lobby-messages) for the full lobby message list and
[`config-reference.md`](config-reference.md#chat_config) for `CHAT_CONFIG`.

## Hardening (NR54–NR56)

Three guards stand between a room and a hostile, flooding or old client. None of them may ever touch a
client of the current build in normal play — `rate-limit.test.ts` drives an honest client's whole
message mix (inputs from a 144 fps loop with catch-up bursts, the time-sync burst and steady rate, ping
echoes, lobby clicking, jitter and two TCP retransmit stalls) through the limits for 60 s and requires
zero refusals.

**Rate limits (NR54).** `packages/server/src/net/rate-limit.ts`. Every `onMessage` handler in all three
rooms is wrapped in `limited(this.limits, kind, …)`, which charges the message to a per-client token
bucket before the handler runs: `"input"` (`INPUT_MESSAGE`) at `2 × TICK_RATE_HZ`/s with a burst of 30,
`"time"` (`MSG_TIME` and the `MSG_PING` echo) at 20/s burst 20, `"lobby"` (every other message) at 10/s burst 10. A message type the room never registered
disconnects the client at once (`refuseUnknownMessages`, `CLOSE_CODES.UNKNOWN_MESSAGE` — fail-closed,
as Colyseus's own production default is), and `Room.maxMessagesPerSecond` is set to
`MAX_MESSAGES_PER_SECOND` (1000) in every room as a pre-decode backstop. It is sized for the burst a
TCP stall releases into one Colyseus counting window (~65 frames per stalled second, so a 10 s stall
lands ~715), not for the buckets' throughput; the 4 KiB payload cap bounds the decode cost. An over-limit message is
dropped and counted (`ClientLimits.droppedFor`). A client continuously over any one limit for more than
`RATE_LIMIT_KICK_MS` (5 s) is disconnected with `CLOSE_CODES.RATE_LIMITED`. "Continuously" means
refusals keep coming at least once a second and no allowed message finds the bucket with tokens to
spare; a flood trickled through at exactly the refill rate is still the flood. The WebSocket transport
refuses any frame over `MAX_WS_PAYLOAD_BYTES` (4 KiB, `http-app.ts`) — Colyseus 0.18's own default,
now set explicitly.

**Protocol version (NR55).** `PROTOCOL_VERSION` (shared `constants.ts`) rides every join as the
`protocol` option (`joinOptions` in the client's `net/connection.ts`; `playtest/lan.ts` does the same).
Every room's `onJoin` — and `PracticeRoom.onCreate`, before its own setup check — refuses a mismatch
with `CLOSE_CODES.PROTOCOL_MISMATCH` and "Client and server are different versions (client protocol X,
server Y). Refresh the page.", which each scene's existing join-error path shows. A client older than
D5 sends no `protocol` and reads "client protocol none". Bump it on every wire change.

**Close codes.** Every code the game chooses is in `CLOSE_CODES` (shared `net/close-codes.ts`), in
4100–4199: Colyseus 0.18 owns 4000–4003 and 4010 (`CloseCode`) and 4217 (`ErrorCode.INVALID_PAYLOAD`),
and a server test holds the table clear of both.

**Matchmaker CORS.** Colyseus core answers `/matchmake/*` ahead of Express with the caller's Origin
reflected. With `CLIENT_ORIGIN` set, `restrictMatchmakerCors` (`http-app.ts`) pins
`Access-Control-Allow-Origin` to that origin for every route; unset (the LAN release, same-origin),
the reflection stands. `/colyseus` keeps its own same-site guard (`monitor.ts`).

**Server RTT is not forgeable.** `NetSessions` remembers the last four `MSG_PING` stamps it sent each
session and accepts an echo only of one of those, once — the server's RTT will cap shot compensation
(Phase F), so an invented old stamp must not buy a longer window.

**Latency injection, both directions (NR56).** Dev only: `SIM_LATENCY_MS` (one-way), `SIM_JITTER_MS`
and `SIM_LOSS_PCT`, all unset in a release. Both directions run on a `DelayLine` per client — in order,
like the WebSocket it models (a FIFO with one timer armed for its head: a timer per message can fire
inverted in Node, and an out-of-order patch breaks the client's decoder), with a lost message retransmitted `2 × SIM_LATENCY_MS` later and
everything behind it held (the netsim `Link` model). Client → server wraps input delivery
(`InputDelay`, one line per session, dropped when the client leaves). Server → client wraps the client's `raw` send
(`OutgoingDelay.wrapClient`), which in Colyseus 0.18 every outgoing frame passes through — snapshots
from `broadcastPatch`, the `MSG_TIME` pong, `MSG_PING`, errors — copying the bytes so a delayed
snapshot is still the tick it was encoded at. It is installed per client only when a latency is
configured, so nothing touches a release build's transport. `ArenaRoom` and `PracticeRoom` inject;
`PlaygroundRoom` deliberately does not (PG9: simulated lag makes a feel test lie).

**Slack spread (NR21, D5 ruling E).** `PlayerState.inputSlackStd` carries, beside `inputSlack`, the
standard deviation of the same 30 slack samples. The client's `InputScheduler` steers the mean slack to
`targetSlackTicks + slackSpreadK × max(0, inputSlackStd − SLACK_QUANTISATION_STD_TICKS)`, so a
jittery input path aims further from the late edge instead of landing its slow tail late. The 0.5-tick
floor is worst-case integer quantisation: a steady path whose true lead is fractional reads as two
neighbouring whole-tick slacks, std up to 0.5, and must not pay for it. `TickInputBuffer` also counts
a frame's FIRST late arrival as a (negative) slack sample — the frames that cause repeats used to be
refused before they were measured, so the loop never saw them; redundant copies are never counted. A late sample is **floored** at `LATE_SLACK_FLOOR_TICKS` (-1): how far a frame missed mostly measures how long the path stalled (after a 10 s outage the backlog reads ~600 ticks late and would pin the safety margin at its clamp for seconds), so only "it was late" is recorded. The floor is the shallowest value at which a window of floored samples still moves the safety faster than `maxDilation` lets the lead follow, at the scheduler's gain of 0.03 per new sample. It is not free on a lossy link: a loss burst's held inputs land 2–5 ticks late, and flooring them narrows that player's measured spread, so his own margin sits a little lower — less latency, a few more repeats, paid by him alone. D6 chose that trade (latency first; `slackSpreadK` stays 1). The estimator has one known defect, carried to a later phase: when only the uplink stalls, the server keeps re-reporting a stale slack window and the client integrates it as if each snapshot were new. It is a separate field rather than folded into
`inputSlack`, so the mean keeps its NR21 meaning and the margin a spread is worth stays a client knob.

**What a lossy link costs.** The slack loop is per player, so a bad link degrades only its own owner: more latency or repeated inputs for him, never for the others. The netsim links are `lan`, `net80clean` (80 ms RTT, ±2 ms jitter, no loss), `net80` (±10 ms, 1 % loss) and `net150`; the strict targets bind `lan` and `net80clean`, and the measured numbers per phase are in the netcode plan's [`EXECUTION.md`](superpowers/plans/2026-09-29-online-netcode/EXECUTION.md#baseline-and-per-phase-numbers-netsim-10-of-the-spec).
