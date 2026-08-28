# Netcode Invariants

**Project:** 6-player top-down car combat shooter, browser client, TDM + FFA.

**Purpose:** Non-negotiable technical constraints for multiplayer. Every proposed change is
checked against this before implementation.

**How to use:** Run the [Review Procedure](#review-procedure) before writing code. **HARD**
violations block implementation — report the invariant ID and propose a compliant alternative.
**GUARDED** items are implemented but flagged with the measurement needed to confirm them.
Never relax an invariant to make a feature easier.

Companion: `BROWSER_CLIENT_INVARIANTS.md`.

---

## Project Constants

| Constant | Value | Notes |
|---|---|---|
| Max players per match | **6** | Both TDM and FFA. |
| Simulation tick rate | **60 Hz** | Fixed. Never frame-dependent. |
| Input send rate | **60 Hz** | Every tick, with redundancy (§5.3). |
| Snapshot send rate | **30 Hz** | Correction stream, not the primary source of remote motion. |
| Remote entity handling | **Predicted, not interpolated** | See §3. |
| Max rewind (lag comp) | **150 ms** | Beams and contact only. |
| Max client tick lead | **250 ms** | Adaptive; hard ceiling. |
| Target bandwidth/client | **≤ 12 KB/s down, ≤ 4 KB/s up** | Generous at this scale. |
| Server tick budget | **≤ 4 ms** at 6 players | Of a 16.6 ms budget. |
| Transport | **WebRTC DataChannel**, `ordered: false, maxRetransmits: 0` | See §5. |

---

## 0. Chosen Model

This project uses **server-authoritative simulation with full input replication and
client-side prediction of all entities.**

Concretely: every client sends its input to the server; the server simulates authoritatively and
broadcasts *all six players' inputs* plus a periodic corrective snapshot; every client predicts
every car forward from those inputs using the same shared simulation code.

This is chosen over classic snapshot-interpolation because:

- Inputs here are a few bits per player per tick. Replicating all six costs nothing.
- Aim is derived from car facing, which is derived from input. The client never sends an angle.
- Arcade tank-like handling has low chaotic divergence, so input-based prediction of *remote*
  cars stays accurate over the prediction window.
- It removes interpolation delay on remote cars, which is the largest single source of perceived
  latency in the conventional model.

**I-N0.1** This model is a project-level decision. Individual features may not opt out of it, and
no feature may reintroduce interpolation-in-the-past for cars.

**I-N0.2** Full rollback/lockstep (dropping the corrective snapshot entirely) is **not** adopted,
because it would require bit-exact cross-machine determinism. If fixed-point math is ever
adopted project-wide, revisiting this is a project decision, not a feature change.

---

## 1. Server Authority — HARD

**I-N1.1** The server is the sole authority on game state. Clients send **inputs only**.

**I-N1.2** The client **never transmits**: position, velocity, facing angle, aim direction,
health, damage, hit confirmations, ammo, score, or kill events. All are derived server-side.

**I-N1.3** Aim direction is never a network field. It is a pure function of car facing, and car
facing is a pure function of replayed inputs. **Any change that adds an aim, angle, or direction
field to a client→server message violates this document.** This is the invariant that makes
aimbots structurally impossible here — protect it.

**I-N1.4** Inbound input packets are validated for: legal input bits only, plausible tick range
(not far in the past, not beyond the max client lead), and arrival rate. Malformed or
out-of-range inputs are dropped, not clamped and accepted.

**I-N1.5** Every new gameplay action is added to the server simulation first. Client-only
gameplay logic is forbidden, even temporarily.

**Violation smells:** a `fireAngle` field in an input packet; server code reading a damage value
off the wire; a "trust the client for this one thing" fast path.

---

## 2. Deterministic Shared Simulation — HARD

**I-N2.1** Simulation runs on a **fixed 60 Hz timestep**. No gameplay code may read frame delta.
Rendering interpolates between simulation states; simulation never varies its step.

**I-N2.2** Car movement, collision, projectile flight, beam evaluation, and damage are
implemented **once** in a shared module executed identically on client and server. No duplicated
or "close enough" second implementation.

**I-N2.3** The shared simulation module is **environment-free**: no DOM, no Phaser, no canvas, no
`window`, no rendering types. It must import and run in plain Node with nothing else present.

**I-N2.4** **Phaser Arcade Physics may not be used for authoritative gameplay.** It is
delta-time driven and cannot run on the server. Car physics, collision, and projectile motion are
implemented in the shared module. Phaser renders the result; it does not compute it.

**I-N2.5** All gameplay randomness (weapon spread, pickup placement, spawn selection) comes from a
seeded, tick-indexed PRNG whose state is part of the simulation state. Never `Math.random()` in
simulation code.

**I-N2.6** Entity iteration order inside the tick is deterministic — arrays or explicitly sorted
collections, never `Map`/`Set`/object-key iteration in the simulation step.

**I-N2.7** Simulation must not read wall-clock time, `Date.now()`, `performance.now()`, frame
counters, or anything else that differs between machines. Time inside the simulation is the tick
number.

**Violation smells:** `this.physics.add.collider(...)` for a gameplay collision; `delta` used in
a movement calculation; a car-handling constant that exists in two files.

---

## 3. Prediction & Reconciliation — HARD

**I-N3.1** The local player's input is applied immediately on the client. There is never a
network round trip between key press and visible car response.

**I-N3.2** Remote cars are **predicted forward from their last received input**, not interpolated
in the past. When a newer input for a remote player arrives, the client replays from the last
authoritative state.

**I-N3.3** When a remote player's input is missing for a tick (loss or lateness), the simulation
**repeats their last known input** rather than treating it as no-input. A car with high inertia
continues; treating a dropped packet as "released all keys" produces a visible stutter.

**I-N3.4** Every input is stamped with a tick number and buffered until acknowledged. On
receiving an authoritative snapshot, the client rewinds to it and **replays all buffered inputs**
for all players.

**I-N3.5** Reconciliation must be silent in the common case. A visible correction means the
client and server simulations diverged, which is a **bug in shared code** — not something to
smooth over. Do not add lerping to hide desync; fix the divergence.

**I-N3.6** A small position error may be visually smoothed over a few frames **only** after the
divergence has been shown to be numerical float drift, never as the primary correction mechanism.
Smoothing is capped in magnitude; a large error snaps and is logged.

**I-N3.7** Any new mechanic that is predicted must be rollback-safe: its complete state is in the
snapshot struct, restorable, and re-simulable. If it cannot be rolled back, it must not be
predicted.

**I-N3.8** Non-rollback-safe side effects — audio, particles, screen shake, HUD events, analytics,
network sends — must never fire from a replayed tick. Guard every one behind a "fresh tick, not a
replay" check.

**Violation smells:** an explosion sound repeating during correction; a new weapon storing state
outside the snapshot; remote cars visibly rubber-banding on every packet.

---

## 4. Combat Resolution — HARD

Three damage sources exist: **travelling projectiles**, **contact/ramming**, and **beams**.
Each has a different resolution rule. There is no hitscan in this project; do not add hitscan
handling.

### Projectiles

**I-N4.1** A projectile's entire trajectory is a pure function of its spawn tick, spawn position,
and the firing car's facing at that tick — all of which are derivable from inputs. Projectiles are
therefore **fully predicted on the client**, not spawned as cosmetic fakes.

**I-N4.2** The server remains authoritative for the damage event. A predicted projectile may show
an impact effect, but health only changes when the server says so.

**I-N4.3** Projectile-vs-car collision is evaluated in the shared module at fixed tick
granularity, with the same swept-collision approach on both sides. Fast projectiles must use
swept tests, never per-tick point overlap — tunnelling through a car at 60 Hz is a correctness bug.

### Contact / ramming

**I-N4.4** **Car-vs-car contact is the hard case: both entities are predicted, so neither client's
view can be authoritative.** The server resolves contact at its own current tick using its own
state, and its result is final for both players.

**I-N4.5** Contact **damage is not predicted**. Clients predict the physical bounce (so the cars
visibly separate immediately) but wait for server confirmation before applying health change.
A mispredicted ram — where you saw a hit and take no damage, or vice versa — is far more jarring
than a short delay on the number.

**I-N4.6** Lag compensation is **not** applied to contact. Rewinding one car necessarily
un-rewinds the other. The server's present-tick state is the tiebreaker, and the rule is
symmetric: no player gets favourable treatment based on ping.

### Beams

**I-N4.7** Beams are evaluated **per tick**, not per shot. A beam is a continuous state, and each
tick it is active the server tests it against current geometry and applies that tick's damage.

**I-N4.8** Beam origin and direction are derived from the firing car's simulated state at that
tick. Never transmitted.

**I-N4.9** Beam hits may be lag-compensated up to the rewind cap, by rewinding *target* positions
to the tick the shooter's client had simulated. Shots referencing a tick older than the cap are
rejected, not clamped and accepted.

**I-N4.10** Beam damage is applied server-side and confirmed to clients. Clients predict the
visual beam and may predict damage ticks, but a client-predicted damage tick that the server
does not confirm must be silently reverted, not left applied.

### All weapons

**I-N4.11** Collision geometry is defined once in shared data. There is no separate "visual"
hitbox in Phaser and "authoritative" hitbox on the server.

**I-N4.12** The server independently validates fire rate, cooldown, ammo, and weapon availability
for every shot. Never trust that the client only fired when it was allowed to.

---

## 5. Transport — HARD

**I-N5.1** Primary transport is **WebRTC DataChannel** configured `{ ordered: false,
maxRetransmits: 0 }`. This is the only unreliable-unordered option available across the full
browser support matrix. Browsers cannot open raw UDP sockets.

**I-N5.2** WebTransport is **not** an acceptable sole transport (no Safari support). It may be
added as a preferred path only alongside a working DataChannel path.

**I-N5.3** **Input packets carry redundancy.** Each packet includes the last **16 ticks** of that
player's input history, not just the current tick. At a few bits per tick this is nearly free and
makes single-packet loss invisible. This replaces retransmission entirely for the input stream.

**I-N5.4** Reliable-ordered delivery is used **only** for: match join/leave, round transitions,
chat, and final results. Never for per-tick state or input.

**I-N5.5** A WebSocket fallback, if it exists, is **degraded mode** and the player is told so.
Silent TCP fallback in a competitive game is worse than a refused connection.

**I-N5.6** Snapshots are delta-compressed against the last snapshot the client acknowledged. Full
state is sent on join and after a lost baseline only.

**I-N5.7** Positions, velocities, and angles are quantized to the minimum precision the arena
requires. Never serialize raw `Float64`. Adding a replicated field requires stating its bit width
and send frequency.

**I-N5.8** Packets stay within a 1200-byte payload budget. At 6 players this is not a constraint
you should ever approach — if a change pushes near it, something is wrong.

**I-N5.9** Every channel has sequence numbers. Duplicate and out-of-order packets are handled
explicitly, never assumed away.

**Violation smells:** `JSON.stringify` in the send path; a per-tick field on the reliable channel;
input packets containing only the current tick.

---

## 6. Timing & Tick Sync — HARD

**I-N6.1** Clients run **ahead** of the server by an adaptive offset (roughly RTT/2 plus a jitter
buffer) so that inputs arrive just before the server needs them. The offset is measured
continuously and adjusted gradually.

**I-N6.2** Tick offset adjustment is **smooth**, never a jump. A sudden retime is indistinguishable
from a teleport to the player.

**I-N6.3** The adaptive offset is capped at the max client lead constant. A player whose
connection cannot meet the cap is disconnected with a clear message rather than allowed to play
in a state that degrades the match for others.

**I-N6.4** Nothing may assume RTT is stable. It drifts, spikes, and changes with network path.

**I-N6.5** Client timing uses `performance.now()`, never `Date.now()`. The system clock is
user-editable.

---

## 7. Information Security — HARD

**I-N7.1** The current mode shows the whole arena, so all car positions are legitimately visible
and full state replication is correct **for this mode only**.

**I-N7.2** **Replication must still go through a per-client outbound filter**, even though that
filter is currently pass-through. This is a forward-compatibility requirement: a future
fog-of-war or follow-camera mode must be implementable by changing the filter, not by
re-architecting replication. Any change that bypasses the filter and writes directly to the
socket violates this.

**I-N7.3** Any state that is *not* legitimately visible in the current mode — pickup contents
before collection, teammate-only information, upcoming spawn locations, another player's remaining
ammo if the design hides it — must be filtered server-side today, not "hidden in the UI."

**I-N7.4** When a limited-visibility mode is added, note that it **conflicts with input-based
prediction of remote cars** (§3.2): you cannot predict a car whose inputs you are not sent. That
mode will need snapshot interpolation for out-of-view entities, and that is a project-level
design task, not something to improvise inside a feature.

**I-N7.5** No debug or spectator path may deliver full-world state to a normal client build.

---

## 8. Server Performance — GUARDED

**I-N8.1** Server tick work stays within budget at **6 players with maximum projectiles and beams
active**, not at an average moment.

**I-N8.2** No blocking I/O — disk, database, HTTP, synchronous logging — inside the tick loop.

**I-N8.3** Zero allocation in the tick loop. Snapshot buffers, rewind history, projectile pools,
and entity arrays are preallocated with fixed capacity.

**I-N8.4** Rewind history is a fixed-size ring buffer sized to the 150 ms cap. It must not grow
with match duration.

**I-N8.5** At 6 players, naive O(n²) car-vs-car checks are acceptable and a broadphase is
premature. Projectile-vs-car is the volume case — that is where a spatial structure earns its
keep, if profiling shows it does.

---

## 9. Connection Lifecycle — GUARDED

**I-N9.1** A dropped client can reconnect into an in-progress match and receive a full baseline.

**I-N9.2** Packet loss is normal. Missing input degrades via input repetition (§3.3); missing
snapshots degrade via continued prediction. Neither may crash, teleport, or desync permanently.

**I-N9.3** Browser tab backgrounding must not disconnect a player within a defined grace period.
Heartbeats are **not** driven by `requestAnimationFrame` — it stops when the tab is hidden. See
`BROWSER_CLIENT_INVARIANTS.md` §5.

**I-N9.4** Every connection has resource limits: max input buffer depth, per-message-type rate
limits, max in-flight reliable messages. A broken or malicious client must not consume unbounded
server memory or CPU.

**I-N9.5** Clean disconnect on page close frees the match slot promptly.

---

## 10. Versioning & Testability — HARD

**I-N10.1** Client and server carry a compatibility version. Mismatched versions are rejected at
connect with a clear message — never allowed to connect and desync.

**I-N10.2** **Simulation constants are part of the protocol version.** Changing car acceleration,
projectile speed, or beam damage changes simulation behaviour; a client with old tuning values
will diverge from the server. Content and tuning data are versioned with the code.

**I-N10.3** The simulation runs headless in Node at faster-than-realtime speed.

**I-N10.4** Any change to shared simulation code requires a determinism check: the same input
sequence from the same start state produces the same end state within the accepted epsilon,
across Node and browser.

**I-N10.5** Netcode changes are verified under **simulated latency, jitter, and packet loss** —
at minimum 100 ms RTT, 30 ms jitter, 3% loss. Localhost testing proves nothing.

**I-N10.6** Matches are replayable from a recorded input stream. Replay divergence is a
determinism bug and is treated as one.

---

## Review Procedure

Before implementing any change:

1. **Authority** — Does this add client-authoritative state, or trust unvalidated client input? (§1)
2. **Aim leak** — Does this add any angle, direction, or aim field to a client→server message? (§1.3)
3. **Determinism** — Frame-time dependence, unseeded randomness, unordered iteration, Phaser
   physics in gameplay, or a second implementation of shared logic? (§2)
4. **Rollback safety** — If predicted: is full state in the snapshot? Do side effects fire on
   replay? (§3)
5. **Combat rule** — Which of the three damage paths does this touch, and does it follow that
   path's resolution rule? Is contact damage still unpredicted? (§4)
6. **Transport** — Right channel, right reliability, input redundancy intact, field sizes
   declared? (§5)
7. **Timing** — Does this assume stable RTT, jump the tick offset, or read wall-clock time? (§6)
8. **Visibility** — Does this send a client anything it isn't entitled to, or bypass the outbound
   filter? (§7)
9. **Server cost** — Per-tick cost at 6 players worst case; any allocation, blocking I/O, or
   unbounded growth? (§8)
10. **Failure modes** — Behaviour on loss, reorder, duplicate, backgrounded tab, disconnect,
    malicious client? (§9)
11. **Versioning** — Does this change anything that must match between client and server,
    including tuning values? (§10)
12. **Verification** — How is this tested headless, deterministically, and under 100 ms / 3% loss?

### Output format when reviewing

- All clear: proceed, noting any GUARDED items touched.
- **HARD** violation: **do not implement.** State the invariant ID, explain the violation in one
  or two sentences, propose a compliant alternative.
- **GUARDED** risk: implement, flag the invariant ID and the measurement needed.

### Standing rules

- Aim is derived, never transmitted. This is the project's strongest anti-cheat property.
- Contact damage is never predicted. Bounce yes, damage no.
- Phaser renders; it does not simulate.
- Smoothing a desync hides a bug instead of fixing it.
- "Temporarily client-authoritative" means permanently exploitable.
- Editing this document is a project decision, not part of a feature change.
