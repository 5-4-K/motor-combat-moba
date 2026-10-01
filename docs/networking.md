# Networking

Clients must never send poses. The wire message is `INPUT_MESSAGE` (`"input"`): `{ seq, steer, throttle, fireSlots, aimAngle? }` (`InputMessage` in shared) — `fireSlots` is a uint8 bitmask, bit 0 = **fire slot 0, the basic attack** (abilities are 1..`N`, since the 2026-09-20 index flip), replacing the old single `fire` boolean. `aimAngle` is the world bearing, radians, from the driven car's turret pivot to the crosshair (spec TR21) — sent on every input, but the server reads it only off an input whose fire mask carried a NEW press (TR23); absent means "fire where the turret already points" (TR12). Server `isInputMessage` validates then enqueues, accepting only an absent or finite `aimAngle` (TR22). `withSimulatedLatency` delays enqueue when `SIM_LATENCY_MS` / `SIM_JITTER_MS` are set; otherwise pass-through (and since D5 it delays the other direction too — see [Hardening](#hardening-nr54nr56)).

`ArenaRoom` ticks at sim rate (`TICK_RATE_HZ`, 60) and broadcasts a snapshot at `SNAPSHOT_RATE_HZ` (60): `patchRate` is `null`, and the room calls `broadcastPatch()` itself at the end of every tick `isSnapshotTick` (`rooms/snapshot-cadence.ts`) names, so a snapshot is always the state of exactly one tick and carries that tick (NR12). The snapshot rate is its own constant, and no client code may assume one snapshot per tick (hard invariant 5). `serverTick` applies queued inputs through shared `stepSim`.

## Server

Per tick, per player, in sorted `sessionId` order:

- inputs are applied in **seq** order, not arrival order — independent per-message latency reorders them routinely;
- at most `NET_CONFIG.maxInputsPerTick` are simulated; the rest are still drained and still acked;
- `PlayerState.lastProcessedInputSeq` ends on the highest seq drained;
- only `PlayerStatus.IN_MATCH` players move, and only they are solid to each other.

`lastProcessedInputSeq` is never reset, so a client's `seq` must stay monotonic for the whole connection — a client that restarted its counter would sit below the standing ack and have every pending input discarded.

## Client — movement (P4, real)

`ArenaScene` accumulates frame `delta` and emits exactly one input per `MS_PER_TICK`, so send rate is independent of frame rate. Catch-up after a hitch is capped at `MS_PER_TICK * NET_CONFIG.maxInputsPerTick` — predicting past what the server will apply only manufactures divergence.

**Prediction.** `PredictionBuffer.predict` pushes the input onto a pending buffer capped at `NET_CONFIG.pendingInputCap` (oldest dropped on overflow) and advances the local pose through the same shared `stepSim`. The local car therefore answers on the frame the key is pressed.

**Reconciliation.** On every state patch, `PredictionBuffer.reconcile(authoritative, lastProcessedSeq, currentPredicted, ctx)`:

1. drops pending inputs by the **predicate** `seq <= lastProcessedSeq` — never by position or a remembered cursor. The ack can legitimately walk *backwards* between ticks (a high-seq input can land in tick N's batch while a lower-seq one lands in tick N+1's), and under the predicate a stale lower ack is a harmless no-op;
2. replays the remaining tail from the authoritative pose to get the target;
3. if `hypot(dx, dy) > NET_CONFIG.reconcileSnapPos`, or the **wrapped** angle error exceeds `reconcileSnapAngle`, returns the target outright;
4. otherwise eases `x`, `y` and `angle` by `reconcileEasePerSnapshot()` — `reconcileEaseRate` (authored per 50 ms) rescaled to the snapshot interval, so the correction speed is independent of `SNAPSHOT_RATE_HZ`; angle along the wrapped delta, so it takes the short way — and **snaps** `vx`, `vy` and `angVel` to the target. Those are derived sim fields that feed the next integration; a half-eased value would poison every following step, not merely look wrong.

Angle comparisons are wrapped (`atan2(sin d, cos d)`) because `stepDrive` never normalises `angle`: after minutes of turning it is thousands of radians, and a raw subtraction would measure accumulated winding rather than error.

**Prediction context.** `StepContext` is `stepSim`'s input, so the client's copy must describe the same world the server's does. The parts that decide *who is solid* and *how a hull is sized* are not duplicated — `carIdOf`, `isSolid` and `otherCarHulls` live in `@motor-combat-moba/shared` (`sim/context.ts`) and **both** `serverTick` and the client's `buildStepContext` call them. Change a hull dimension or the fallback chassis there and both sides move together.

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

Note the split gate: `otherCarHulls` takes a `tick` argument and filters entries through `isSolid` (`isOnField && !phased`) — the **wall** half (who is solid). That filter runs in **both** directions: an entry that is phased is dropped from everyone else's hull list, and a phased *caller* is handed back `[]` rather than a real list, so a respawning car neither shoves nor is shoved by whoever it passes through. The **mover** half — whether the local player's inputs move anything — is `ArenaScene.canDrive`, mirroring the server's own mover gate (`isOnField`, unchanged). Remotes enter the context at their last-known server pose; the client predicts only itself.

**Interpolation.** Remotes are drawn from `InterpolationBuffer`, sampled at `now - NET_CONFIG.interpolationDelayMs`. Position lerps between the bracketing snapshots; angle lerps through `atan2` of blended sines and cosines so it crosses the ±π seam the short way. Past the newest snapshot it **holds** rather than extrapolating — a guessed pose slid through a wall the server bounced off is worse than a frame or two of freeze. Old snapshots outside the delay window are pruned, so the buffer does not grow with match length.

**Local render blend.** Prediction advances on the sim clock (`drainTicks`), so at 60 Hz the predicted pose changes every other frame. Drawing it raw makes the local car hold-and-jump while the camera eases and remotes glide, which reads as a doubled, smeared sprite in motion. `ArenaScene.localRenderPose` therefore draws `blendPose(previousPredicted, predicted, accMs / MS_PER_TICK)` — the previous tick blended toward the newest by how far the input accumulator is through the current tick. It is render-only: `predicted` is still what the next step and reconcile read, and a reconcile correction is simply carried across the rest of the tick window by the same blend.

`CAMERA_CONFIG` (`camLerp`, `zoom`, `freeRoamSpeed`) is a render knob only — nothing in `stepSim` reads it.

## Client — combat

Combat is not predicted at all. `fireSlots` rides the wire with steer and throttle as raw key state, and the server decides everything that follows — including **whether a held key is a new press**, which it derives from its own `prevFireMasks` rather than trusting the client to send edges: whether a slot's stocks and locks allowed a shot, where it went, and what it hit. `ArenaScene` draws `state.weapons` (projectile and beam instances alike) and the HP it is told about, and spawns no local shot of its own — a predicted bullet the server never fired either vanishes or, worse, reads as a hit that never happened, and there is no honest way to reconcile "you were dead for 80 ms".

The one client-side liberty is cosmetic: a projectile is advanced along its **own constant velocity** between patches, and a beam's `extent` is grown the same way (`extrapolateShot` / `instanceDrawShape` in `combat-visual.ts`, both capped at one patch interval). That is exact rather than a guess — the server integrates the identical motion — and nothing it produces feeds back into state. See [`combat-model.md`](combat-model.md) for the weapon state machine `fireSlots` is gated by.

Firing rides the same gate as movement. `serverTick` reports the session ids that asked to fire on an input it actually **simulated**, so an input past `NET_CONFIG.maxInputsPerTick` cannot buy a shot the sim never ran. `canDrive` gains `alive` in P5: a wreck stops sending inputs and stops predicting, because the server has stopped stepping it.

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
refused before they were measured, so the loop never saw them; redundant copies are never counted. It is a separate field rather than folded into
`inputSlack`, so the mean keeps its NR21 meaning and the margin a spread is worth stays a client knob.
