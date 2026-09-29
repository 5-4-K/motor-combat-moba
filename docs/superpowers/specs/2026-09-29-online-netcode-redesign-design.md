# Online netcode redesign — design

**Date:** 2026-09-29 · **Status:** approved in conversation, section by section · **IDs:** NR1–NR68

This replaces nothing that is live: the 2026-09-04 netcode and rendering specs and their fourteen
plans were deleted unexecuted on 2026-09-29 (`3000aeb`). This spec starts from the code as it is on
`development/main` at `3000aeb`, not from those documents.

## 1. Goal

Make online play on a **dedicated server** fair and smooth up to **80 ms RTT**, without making LAN
or practice feel worse than today, and close the cheats a modified client can use against it.

- **NR1** Target link: RTT ≤ 80 ms, jitter ≤ ±10 ms, loss ≤ 1 %. Everything must also still work,
  degraded but playable, at 150 ms.
- **NR2** A player with lower ping will have *some* advantage. The design minimizes it and states
  what is left (§11) rather than claiming it is zero.
- **NR3** LAN and practice must be no worse than today on any measured number (§10).
- **NR4** Hosting is a dedicated server nobody plays on. One match per server process is assumed;
  multi-room hosting, TLS termination, matchmaking and accounts are **out of scope** (decided).
  Nothing here may add a new per-process global that would make multi-room hosting harder.

### Success criteria (measured by the netsim harness, §10)

At 80 ms RTT, ±10 ms jitter, 1 % loss, six cars, one minute of scripted driving and firing:

| Metric | Target |
|---|---|
| Server steps per car per tick | exactly 1, always (speed hack closed) |
| Ticks a car is simulated on a repeated (missing) input | ≤ 2 % |
| Remote path error p95 (drawn pose to the car's true trajectory from 400 ms before to 100 ms after the frame) | ≤ 12 u |
| Frames a remote is held/frozen (buffer starvation) | ≤ 1 % |
| Local reconcile correction, p95 | ≤ 4 u |
| A hidden enemy's car or shot present in a client's decoded state | never |

On LAN (1 ms RTT, 0 jitter): input-to-server delay ≤ 34 ms (today 0–33 ms); remote interpolation
delay ≤ 50 ms (today 50 ms), and total remote display delay as measured by the harness no worse than
today's.

## 2. What is wrong today (findings)

- **F1 Speed hack.** `serverTick` simulates up to `NET_CONFIG.maxInputsPerTick` (5) inputs per
  player per tick. A client sending five inputs per tick moves five times as far; the config's own
  comment says so.
- **F2 Remote stutter.** A car advances only when its owner's input packets arrive, so jitter
  gives ticks with 0 steps and ticks with 2. The client times interpolation by patch *arrival*
  (`performance.now()`), not by server tick, with a 50 ms delay equal to the 50 ms patch interval,
  so any jitter starves the buffer and the car holds, then jumps.
- **F3 Collide-with-what-you-don't-see.** Local prediction collides against each remote's latest
  server pose while the remote is drawn ≥ 50 ms older.
- **F4 FOV is client-side only** (camera spec CB6). Every car, shot, HP and status reaches every
  client; the roster and kill panels leak too (CB45).
- **F5 No latency compensation.** Hits are current-tick; the shooter's own shot appears a round
  trip late. Rams are server-time and are not compensable.
- **F6 Unauthenticated monitor.** `mountMonitor` serves `@colyseus/monitor` at `/colyseus` in every
  deploy mode. On a public server anyone can read every room's full state (FOV bypass) and dispose
  rooms.
- **F7 Unbounded intake.** Input and lobby messages have no rate limit and no size cap beyond the
  transport default.
- **F8 Blind measurement.** `SIM_LATENCY_MS`/`SIM_JITTER_MS` delay inputs only; nothing delays,
  jitters or drops what the server sends, and no harness measures any of F2–F5.

## 3. Decisions settled in conversation

- **NR5** Dedicated server (not player-hosted).
- **NR6** Scope: netcode and anti-cheat only (NR4).
- **NR7** Shot fairness: **hybrid**, favouring the shooter a little, **capped at 100 ms** (§7).
- **NR8** An enemy outside your vision reveals **scoreboard facts only** (§8).
- **NR9** Delivery: **upgrade to Colyseus 0.18 / `@colyseus/schema` 5** and filter per client with
  `StateView`, as its own first stage with no behaviour change (§9).
- **NR10** Tick rate was delegated to the design: **60 Hz** (§4).

## 4. Tick rate and snapshot rate

- **NR11** `TICK_RATE_HZ` becomes **60**. Reason: input quantization, the server's input buffer and
  the client's interpolation delay are all counted in ticks; their floor is ≈ 115 ms of added delay
  at 30 Hz and ≈ 58 ms at 60 Hz. Dash travel per tick halves (53 → 27 u).
- **NR12** A new shared constant `SNAPSHOT_RATE_HZ` (default 60) sets how often the server
  broadcasts. The room sets `patchRate = null` and calls `broadcastPatch()` itself at the end of
  every tick whose number is a multiple of `TICK_RATE_HZ / SNAPSHOT_RATE_HZ`, so a snapshot is
  always the state of exactly one tick and carries that tick (`ArenaState.tick`).
  `DEFAULT_PATCH_RATE_HZ` is deleted.
- **NR13** Hard invariant 5 ("sim rate ≠ patch rate") is **reworded**, not dropped: *snapshot rate
  is its own constant, and no client code may assume one snapshot per tick*. Every client consumer
  is keyed on the snapshot's tick, never on arrival count.
- **NR14** Every duration already authored in ms and resolved through `msToTicks` rescales by
  itself. Values authored **in ticks** are converted to ms-authored values first (so the flip is a
  one-line change afterwards): the sixteen `*Ticks` knobs in `BOT_PROFILES` and the tick-authored
  knob in `ram-bridge.ts`. Bot knobs become `*Ms` with the same wall-clock value at 30 Hz, resolved
  per tick through `msToTicks`; `BOT_BRAIN_VERSION` bumps.
- **NR15** Fixtures pinned at 30 Hz (`golden.test.ts` and the tests that hardcode `1 / 30` or
  `* 30`) are re-derived from `TICK_RATE_HZ` where they can be and re-pinned where they cannot. The
  drive model is Euler-integrated per tick, so handling moves slightly at 60 Hz; the flip measures
  and reports it (turn radius, time to top speed, `npm run ttk`) and updates `docs/turn-tuning.md`
  and the players' guide in the same change. It changes no rule of the drive model.
- **NR16** 60 Hz is a server-CPU question only for the bot planner; `planner.bench.test.ts` must
  stay under its budget at 60 Hz with six bots, or the bot replans on its own `recomputeMs`
  cadence (already how it works) — no per-tick bot cost may double silently.

## 5. Time and inputs (approved section 1)

- **NR17 One authoritative clock.** Every tick, every on-field car steps exactly once, together, with
  the input its owner sent *for that tick*. `serverTick`'s per-player drain loop is replaced.
- **NR18 Clock sync.** `MSG_TIME` (client → server `{ c: clientMs }`, server → client
  `{ c, t: serverTick, p: msIntoTick }`). The client keeps the last 16 samples and takes its tick
  estimate from the lowest-RTT third (RTT ties go to the newest sample), so a delayed pong cannot drag the
  estimate. The estimate slews at a RATE, `NET_CONFIG.clockSlewMsPerSec` (20 ms/s) times the time since
  the previous pong, so it tracks a 1 % clock drift at any ping interval; an error over 50 ms snaps. Sent every 500 ms,
  and every 100 ms for the first second after joining.
- **NR19 Server-measured RTT.** The server also pings each client (`MSG_PING { s }` echoed back),
  so the numbers the server relies on (§7) do not come from the client.
- **NR20 The client runs ahead.** Input tick `P = estimatedServerTick + leadTicks`, where
  `leadTicks = ceil((rtt / 2 + safetyMs) / msPerTick)`, with the lead clamped to
  `maxInputLeadMs - 1 tick` (the server drops anything further ahead). The local car is predicted at `P`.
- **NR21 Slack feedback.** Each snapshot carries, for its recipient only, `inputSlack`: the mean
  over the last 30 received inputs of (input tick − server tick at arrival). The client steers
  `safetyMs` so slack sits at `NET_CONFIG.targetSlackTicks` (1.5), by running its tick clock up to
  `NET_CONFIG.maxDilation` (4 %) faster or slower — never by jumping. The integrator runs once per NEW
  slack sample (not per frame) with gain 0.03 and a ±0.25-tick deadband around the target.
- **NR22 Input buffer.** A shared `TickInputBuffer` per player, keyed by tick. On tick `T`:
  input for `T` present → consume it; absent → repeat the last consumed input with its fire bits
  held (a repeat can never create a press, because press detection compares against the previous
  consumed mask); absent for longer than `NET_CONFIG.inputRepeatMs` (250) → neutral input.
  Inputs for ticks `< T` are dropped; inputs for ticks `> T + maxLeadTicks` (250 ms) are dropped.
  This replaces the silent-coast branch: a car is simulated every tick whatever its owner does.
- **NR23** `maxInputsPerTick`, `silentCoastGraceMs`, `pendingInputCap` and the per-tick "masks of
  several inputs OR-ed together" rule are deleted. One tick, one input, one step.
- **NR24 Redundancy.** An input packet carries the newest input plus the previous three
  (`InputPacket { inputs: InputFrame[] }`, newest last, each with its own `tick`). Duplicates are
  idempotent.
- **NR25 Wire shape.** `InputFrame { tick, steer, throttle, fireSlots, aimAngle?, viewTick? }`.
  `seq` is gone — the tick is the sequence number. `viewTick` is §7's. Validation keeps today's rules
  (`isInputMessage`) plus: `tick`/`viewTick` are safe unsigned integers, `inputs.length ∈ [1, 4]`.
- **NR26 Ack and reconcile.** Every car steps every tick (NR17), so a snapshot's car state is
  always the state at the end of the snapshot's own tick `S` (`ArenaState.tick`) — no separate ack
  tick is needed. Two owner-only fields ride with it: `ackRepeated` (whether tick `S` used a repeated
  input for this car) and `inputSlack` (NR21). The client restores its authoritative car at `S` and
  replays its own stored inputs `S+1 … P`. The ease/snap thresholds of today's reconcile are kept.
  `lastProcessedInputSeq` is deleted.
- **NR27 Bots and harnesses** offer their input for the current tick straight into the same
  `TickInputBuffer` (lead 0), so the bot, practice, playground, balance and playtest paths use the
  one consumption rule. A paused playground stops consuming, not buffering.
- **NR28 LAN.** RTT ≈ 1 ms gives `leadTicks` 1–2 (17–33 ms): no worse than today's 0–33 ms.

## 6. Remote cars and local prediction

- **NR29 Tick-keyed interpolation.** Each snapshot is stored under its tick. A remote is drawn at
  render tick `R = estimatedServerTick − delayTicks` (fractional), interpolating the two snapshots
  that bracket `R`. Arrival time is used only to measure jitter.
- **NR30 Adaptive delay.** Each snapshot's *lateness* is how far the synced server clock has
  moved past the snapshot's tick when it arrives (one-way delay plus jitter). `delay = clamp(p95 of
  the last 120 latenesses + one snapshot interval, minDelayMs, maxDelayMs)` with `minDelayMs` 33
  and `maxDelayMs` 250, so the render tick always has a snapshot on both sides of it. It moves by at
  most 1 ms per frame so nothing visibly jumps. LAN settles near 33 ms (today 50); 80 ms RTT near
  70 ms.
- **NR31 Capped extrapolation.** If `R` is past the newest snapshot, the remote is advanced with
  shared `stepSim` from that snapshot using its last known input (NR33), for at most
  `NET_CONFIG.maxExtrapolateMs` (100). Past that it holds. When the next snapshot lands, the drawn
  pose eases to the interpolated one over 100 ms instead of snapping.
- **NR32 Remote hulls in prediction.** The local car is predicted at tick `P`. Each remote enters
  `StepContext.others` at its **dead-reckoned pose at `P`**: the newest snapshot stepped forward
  with shared `stepSim` and the remote's last known input, capped at `maxExtrapolateMs`. Walls and
  obstacles are respected because it is the same `stepSim`. Dead-reckoned poses are cached per
  snapshot and extended incrementally, never recomputed from scratch per frame.
- **NR33** `PlayerState.lastSteer`/`lastThrottle` (int8 each) become networked fields for visible
  cars, written from the input consumed on the tick. They are what dead reckoning needs (and hard
  invariant 8 requires anything `stepSim` reads to be networked). Leak assessment: an enemy's
  steer/throttle is only sent while they are visible, where their motion already shows it.
- **NR34 Contact blend.** When a remote's drawn pose is within `NET_CONFIG.contactBlendRange`
  (2 car lengths) of the local car, its drawn pose blends toward its dead-reckoned pose, fully at
  1 car length. What you can hit is what you see at contact range; far away, remotes stay on the
  smooth, correct interpolated path.

## 7. Combat under latency (decision NR7)

- **NR35 `viewTick`.** Every input frame carries the render tick `R` the client was drawing remotes
  at when the frame was produced.
- **NR36 Staleness.** For a press on input tick `P`, `staleTicks = P − viewTick`. The server clamps
  it: `k = clamp(staleTicks, 0, min(capTicks, allowedTicks))`, where `capTicks =
  msToTicks(NET_CONFIG.shotCompCapMs)` (100 ms → 6 ticks) and `allowedTicks` is what an honest
  client on this link could have: `ceil((serverRttMs / 2 + slackMs + allowedDelayMs) / msPerTick)`,
  with `serverRttMs` from NR19, `slackMs` from NR21's measurement and `allowedDelayMs = 2 snapshot
  intervals + 2 × the server-measured input-arrival jitter`. A lying client gains at most the gap
  between its true staleness and `allowedTicks`, never more than `capTicks`.
- **NR37 Shot fast-forward.** A weapon instance born this tick from a press with `k > 0` is stepped
  `k` extra times inside the same `runCombat`, against the current world — walls, obstacles,
  bounces, cars, hits and detonations all resolve through the same per-instance step as a normal
  tick. It is therefore where it would be had it been fired `k` ticks ago, which is what a shooter
  leading a target they see `k` ticks late needs. Maneuvers (the car itself moves) and statuses are
  never fast-forwarded.
- **NR38** Attached beams fast-forward their `extent` growth the same way; they stay attached.
- **NR39 Own shot drawn at once.** When the local client presses a slot whose local state says it
  can fire (stock available, no refire or switch lock, not pending), it draws a **provisional**
  shot at the predicted muzzle, stepped each frame with the shared instance motion (no hits). The
  first server instance with the same owner and `spawnTick` within ±2 ticks of `P` replaces it; an
  unconfirmed provisional fades out after `rtt + 100 ms`. The client applies the same fast-forward
  the server will (NR37) using its own `staleTicks` clamped to `capTicks`, so a confirmed shot does
  not jump; any difference from the server's clamp eases out over 100 ms. The expected spawn tick
  includes the weapon's wind-up (`pendingUntilTick`). Provisional shots never deal damage, never
  spawn impact FX and never feed prediction.
- **NR40 Enemy shots drawn at present.** A shot not owned by the local player is drawn advanced
  from its newest snapshot to the local predicted tick `P` with the shared instance motion (walls
  and bounces included, cars ignored), capped at `maxExtrapolateMs + delay`, so a dodge is judged
  against where the shot is relative to your predicted car. Its end (hit, expiry) comes from the
  server. This replaces `extrapolateShot`'s one-patch linear advance.
- **NR41 Rams are not compensated.** Contacts resolve in server time between cars that all stepped
  the same tick (NR17). A high-ping player sees an approaching car later; §11 states it.

## 8. What a client may know (decision NR8)

- **NR42 Field tags, not a schema split.** `PlayerState` stays one schema. Measured against
  `@colyseus/schema` 5.0.34 on 2026-09-29: a field declared `@view()` reaches a client only while
  that object is in the client's `StateView`; when the object leaves the view the client's copy of
  the field is cleared (decoded as `undefined`), and re-adding it resends the current value. A
  `@view(tag)` field reaches only views that added the object with that tag, and the tag reaches
  nested child schemas (a slot's timer inside `weapons`). A map declared `@view()` delivers only
  the entries added to the view. So:
  - **Public, untagged (scoreboard facts):** `sessionId`, `name`, `colorId`, `team`, `status`,
    `joinedAtTick`, `carId`, `selectLocked`, `lockedCarId`, `alive`, `diedAtTick`, `kills`,
    `deaths`, `killedBySessionId`, `level`, and each slot's `weaponId` (the loadout is public in
    car select).
  - **`@view()` (visible car):** `x`, `y`, `angle`, `vx`, `vy`, `angVel`, the maneuver fields,
    `hp`, `statuses`, `turretAngle`, `lastFiredSlot`, `lastSteer`, `lastThrottle`, and a new
    `inView: boolean` that is always `true` on the server — so a client reads `inView === true` as
    "this car is visible to me" and never has to guess from a pose of `undefined`.
  - **`@view(OWNER)` (owner, and teammates in team modes):** each slot's `stocks`,
    `rechargeEndsTick`, `refireLockUntilTick`; `switchLockUntilTick`, `pendingUntilTick`,
    `ackRepeated`, `inputSlack`.
  - `ArenaState.weapons` (instances) becomes a `@view()` map.
- **NR43 Tags are the whole mechanism.** No field is duplicated, the server keeps reading and
  writing `PlayerState` exactly as today, and bots, balance and playtest (which never encode) are
  untouched by §8. A new test encodes a snapshot through a `StateView` for a viewer and asserts the
  hidden car's tagged fields and hidden instances are absent from the decoded state.
- **NR44 View rule.** A client's `StateView` holds: its own car; teammates' cars; every enemy car in
  vision (NR46); every weapon instance owned by itself or a teammate or in vision. With the mode's
  `fov.enabled` false, every car and instance is in vision, and the same code path runs.
- **NR45 Spectators.** A wreck (or a spectator) sees what its perspective player sees
  (`spectate.target`/`noTargetVision`, camera spec CB19/CB26). A `"none"` target in an FOV mode sees
  only its own frozen death vision (`"pov"`) or nothing (`"blind"`).
- **NR46 Vision on the server.** `camera/vision.ts`'s pure functions (`visionShapeOf`, `inVision`,
  `carVisible`, `shotSamplePoints`) move to shared (`packages/shared/src/vision/`) and the client
  and server both import them. The server evaluates vision every tick from the viewer's
  authoritative pose with the ellipse's semi-axes and the cone apex distance grown by
  `visionMarginUnits = ceil(max chassis top speed × 0.25 s)` (≈ 71 u, about one car length), so an
  enemy is on the client before it crosses the drawn edge. The client keeps drawing with the exact,
  unmargined shape.
- **NR47 Hysteresis.** An enemy enters the view at the margined shape and leaves only after it has
  been outside the margined shape for `NET_CONFIG.visionExitMs` (250), so the view does not churn on
  the edge.
- **NR48 Scoreboard HUD.** The roster panel shows HP as unknown (`?`) for an enemy whose `inView`
  is not `true`. The kill feed is unchanged (a death is public). FX events are derived only
  from what is in view (already true of CB27's client filter; now enforced by absence).
- **NR49** Bots read the server's full state, as today. Bots under FOV remain out of scope (CB5).

## 9. Transport, Colyseus 0.18 and hardening

- **NR50 Colyseus upgrade first, no behaviour change.** Server: `colyseus`/`@colyseus/core` 0.18,
  `@colyseus/ws-transport` 0.18, `@colyseus/monitor` 0.18. Schema: `@colyseus/schema` 5 in **both**
  `shared` and `server` in the same commit. Client: `colyseus.js` → `@colyseus/sdk` 0.18. Callback
  sites move to `Callbacks.get(room)` / `getStateCallbacks(room)`. Node ≥ 22 (`engines`,
  `docs/deployment.md`; Node 20 has been end-of-life since 2026-04-30). The stage ends with every
  suite, `npm run build` and a two-client smoke run green, and no gameplay number moved.
- **NR51 What 0.18 is used for, and what it is not.** Used: `StateView`/`@view()` (§8),
  field types `float32`/`int8`/`uint16` for bandwidth, `broadcastPatch()` per tick. **Not used:**
  its `defineInput`/`setFixedTimestep` input pipeline, `allowRewindState` rewind and client
  `Predict` helpers — the sim is a shared `stepSim` that the bot, balance and playtest harnesses run
  with no Room at all, so input buffering must live in shared code (NR22); rewind is position
  rewind for instant hits, which NR7 rejected; and `@unreliable`/WebTransport needs TLS and is
  marked experimental upstream. Unreliable transport is future work behind a measured need.
- **NR52 Quantization.** Pose `x`/`y`/`angle`, velocity and `turretAngle` become `float32`. The
  client's prediction reads the *decoded* float32 values, the same values the server's snapshot
  carried, so replay starts from exactly what was sent. The server keeps full precision internally
  and **does not** round its own state to float32 (a quantization step between ticks would be a
  second source of divergence); the reconcile ease absorbs the sub-unit difference.
- **NR53 Monitor.** `/colyseus` is mounted only when `DEV_TOOLS=1`, or when `MONITOR_PASSWORD` is
  set, behind HTTP basic auth. A cloud deploy with neither serves 404.
- **NR54 Rate limits.** Per client, a token bucket per message type: input packets `2 ×
  TICK_RATE_HZ`/s with burst 30; `MSG_TIME`/pong 20/s; every lobby message 10/s. Over-limit messages
  are dropped and counted; a client over any limit for 5 s straight is disconnected. The WebSocket
  transport sets `maxPayload` to 4 KiB.
- **NR55 Protocol version.** `PROTOCOL_VERSION` (shared, an integer bumped on every wire change) is
  a join option; a mismatch is refused with a readable error, the way arena mismatches already are.
- **NR56 Latency injector.** `SIM_LATENCY_MS`/`SIM_JITTER_MS` gain `SIM_LOSS_PCT` and apply to both
  directions: inputs as today, and outgoing snapshots and messages per client (in-order, so loss is
  modelled as a TCP retransmit delay of one RTT, which is what WebSocket does).

## 10. Measurement

- **NR57 The netsim harness.** A vitest suite in `packages/server/src/netsim/` that runs the real
  server pipeline (`runPipeline`, the input buffers, the view rule) and N simulated clients built
  from the real client net modules — clock sync, input scheduler, prediction, interpolation — with no
  Phaser. A `Link` models one-way delay, jitter and loss per direction with in-order delivery (loss
  delays everything behind it by one RTT). Scripted drivers produce inputs. It records every metric
  in §1's table and the LAN numbers.
- **NR58** The harness lands **before** any netcode change and records today's baseline, so every
  stage is judged against a number, not a feeling.
- **NR59** To make the client net modules runnable there, the pure logic moves out of
  `ArenaScene`: `ClockSync`, `InputScheduler`, `PredictionBuffer` (re-keyed by tick),
  `TickInterpolation`, `RemoteReckoner` and `ShotView` live in `packages/shared/src/net/` (pure, no
  Colyseus, no Phaser). `ArenaScene` wires them.

## 11. What remains unfair, and what is not prevented

- **NR60 Residual ping advantage.** Seeing a threat: an enemy shot reaches a target's screen
  `k + rttTarget + safety` ticks into its flight (NR37 + transport). At 80 ms against a 1–2 s flight
  that is ≈ 10–20 % of the dodge window; for the 6000 u/s beam it is most of it (it is a flash by
  design). Rams: a high-ping player sees an approaching car ≈ `rtt/2 + delay` late (≈ 90 ms at
  80 ms RTT). The shooter comp cap (100 ms) is the dial.
- **NR61 Not prevented.** Aim assistance and trigger bots (the client has to know where visible
  enemies are), input macros, reading visible enemies' exact numbers, and seeing the vision margin
  band (≈ one car length beyond the drawn edge). The design removes position, HP and status of
  anything not in the margined vision, and bounds movement to one step per tick.

## 12. Stages

Each stage merges on its own, green, with its measured numbers recorded in the plan's state file.

- **NR62 A — Colyseus 0.18 / schema 5 / Node 22**, no behaviour change (NR50), plus the monitor gate
  (NR53).
- **NR63 B — netsim harness and baseline** (NR57–NR59 for the modules that exist today; later stages
  extend it).
- **NR64 C — 60 Hz and per-tick snapshots** (NR11–NR16).
- **NR65 D — time and inputs** (NR17–NR28), rate limits and protocol version (NR54–NR56).
- **NR66 E — remotes and prediction** (NR29–NR34).
- **NR67 F — combat under latency** (NR35–NR41).
- **NR68 G — interest management** (NR42–NR49), then docs: `docs/networking.md`,
  `docs/schema-reference.md`, `docs/config-reference.md`, `docs/deployment.md`, and `CLAUDE.md`'s
  hard invariant 5 (NR13). `docs/networking.md` states §11's residual unfairness in full.

- 2026-09-29 (D2 fix round): NR18 slew is a rate (20 ms/s) with a recency tie-break; NR20 lead clamped to `maxInputLeadMs - 1 tick`; NR21 integrates per new sample, gain 0.03, ±0.25 deadband.
