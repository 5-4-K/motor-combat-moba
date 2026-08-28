# 3v3 Car Brawler — Netcode & Client Architecture Spec

**Version:** 1.0
**Target:** smooth, fair play up to 80ms RTT; browser; 6 players; 60Hz
**Status:** design settled, constants provisional pending playtest

---

## 0. Reading this document

Sections 1–3 are architecture and are load-bearing — changing them later is expensive. Sections 4–8 are systems. Section 9 is the constants table, which is the only part expected to churn during tuning. Section 11 is build order.

Every number marked **[T]** is a tuning target, not a decision. Every number marked **[D]** is derived from another constant and must not be hand-edited.

Three invariants govern everything:

> **I1.** `shared/sim/step.ts` is a pure function `(world, inputs[6], tick) → world`. No DOM, no wall clock, no `Math.random`, no renderer, no viewport.
>
> **I2.** Rewind decisions that don't move bodies. Never rewind decisions that do.
>
> **I3.** The renderer reads `worldAt(T_r)`. It never reads `world.current`.

I3 is cheap now and expensive later. It is the single highest-regret item in this document if skipped.

---

## 1. Tick and clock model

### 1.1 Rates

| | |
|---|---|
| Simulation | 60 Hz fixed, `DT = 1/60 s` |
| Snapshot send | 60 Hz, every tick, to every client |
| Input send | 60 Hz, with redundancy (§3.3) |
| Render | `requestAnimationFrame`, decoupled |

### 1.2 The three client timelines

```
T_snap  = newest authoritative tick received   ≈ S_now − downLatency
T_gen   = tick the client generates input for  = S_now + upLatency + jitterMargin
T_r     = tick the client renders              = T_gen − D
```

`T_gen` is pinned by the network. Below it, inputs arrive after the server has already simulated that tick and get dropped. The span `T_gen − T_snap` is therefore the **full RTT**, not half of it.

```
D = 0      → render at T_gen. No added input lag. Extrapolate remotes by full RTT.
D = RTT    → render at T_snap. Zero extrapolation. Classic delay-based netcode.
```

**Ship `D = 0`.** Build the plumbing; keep it dev-only (§7.6).

### 1.3 Why there is no lag compensation

Because the client generates input for `T_gen` and the server simulates `T_gen` with that input, **the client is firing at the same tick the server will simulate.** It is not firing into the past.

Consequences:

- **No server-side world history ring buffer.** Nothing rewinds. Delete it from your mental model.
- **No rewind cap, no RTT clamping, no lag-switch defense.** There is no rewind to abuse. Inflating latency makes your own inputs arrive late and get dropped — self-punishing.
- The client needs an **input** history for rollback, and a **world** history only for rendering at `T_r` and interpolation.

Residual error is pure prediction error: small, symmetric, and self-correcting every tick.

### 1.4 Clock sync (Overwatch-style feedback loop)

1. Client estimates server tick, runs ahead by `upLatency + jitterMargin`.
2. Server measures per-player input arrival earliness/lateness relative to when it needed them.
3. Server returns a timing correction in every snapshot: signed ticks, 6 bits.
4. Client applies **time dilation** — nudge tick duration by ±1–3%, never skip or duplicate ticks.
5. Target input-buffer occupancy: **1–2 ticks**, sized adaptively from observed jitter.

Buffer occupancy at the server is also your best jitter signal — it directly measures whether inputs arrive in time. Use it rather than RTT variance if you later automate `D`.

### 1.5 Missing input policy

```
tick N input missing → repeat input from N−1
after 5 consecutive → decay toward neutral over 5 ticks
after 60 consecutive (1s) → mark slot STALLED, coast to stop
```

Late inputs are discarded, never retroactively applied.

---

## 2. Transport

### 2.1 Stack

| Priority | Transport | Notes |
|---|---|---|
| 1 | **WebTransport** (HTTP/3 datagrams) | Primary. Looks like HTTPS to middleboxes |
| 2 | **WebRTC DataChannel** (unreliable, unordered) | Fallback |
| 3 | **WebSocket** | Last resort. Head-of-line blocking, but connects everywhere |

Abstract behind `send(bytes)` / `onDatagram(cb)` on day one. Prototype on WebSocket.

**The WebSocket path is not a prototyping crutch — keep it working and tested.** A meaningful share of BD players are on university networks, shared broadband, and CGNAT mobile where UDP is blocked or degraded. Because state is sent as full snapshots, a TCP path degrades into latency rather than desync. Detect and fall back automatically; surface the active transport in the netgraph.

### 2.2 Channels

| Channel | Reliability | Carries |
|---|---|---|
| State | Unreliable, unordered | Snapshots, inputs |
| Control | Reliable, ordered | Lobby, match start/end, score, chat, reconnect handshake |

---

## 3. Protocol

### 3.1 Full snapshots, no delta compression

Six entities makes this affordable, and it buys three things: a lost packet costs exactly nothing, there is no baseline state to desync, and reconnect is free (§8.3).

### 3.2 Snapshot layout

Header (12 B):

| Field | Bits |
|---|---|
| tick | 32 |
| lastInputTickAck (per recipient) | 16 |
| timingCorrection (signed ticks) | 6 |
| matchState | 4 |
| flags | 8 |
| pad | — |

Per car (~15 B × 6 = 90 B):

| Field | Bits | Encoding |
|---|---|---|
| pos.x | 14 | 0.25 u quantization over 4096 |
| pos.y | 13 | 0.25 u over 2048 |
| angle | 12 | 4096 steps (0.088°) |
| vel.x | 12 | ±600 u/s at 0.5 u/s |
| vel.y | 12 | ±600 u/s at 0.5 u/s |
| angVel | 11 | ±12 rad/s at 0.02 |
| health | 8 | |
| controlAuthority | 6 | 0–63 → 0.0–1.0 |
| ccTicksRemaining | 6 | |
| lockTargetId | 3 | 7 = none |
| lockCommitTimer | 6 | ticks |
| stock (per slot, 2 slots) | 8 | |
| stateFlags | 8 | alive, immune, stalled, respawning |
| lastInputEcho | 8 | **required** — drives remote extrapolation |

Volley records (~10 B each, ~12 live):

| Field | Bits |
|---|---|
| volleyId | 12 |
| ownerId | 3 |
| weaponId | 8 |
| spawnTick | 16 |
| spawn pos | 27 |
| exitAngle | 12 |
| pelletCount | 4 |

Events (variable, ~40 B): hits, kills, pellet deaths, pickups.

**Budget:** ≈ 262 B/tick → **~16 KB/s down (~126 kbps)**, ~720 B/s up.

### 3.3 Input packet

| Field | Bits |
|---|---|
| tick | 16 |
| input bitmask | 8 (up/down/left/right + 2 fire slots) |
| **redundancy: previous 8 inputs** | 64 |

~12 B/packet. The redundancy means a single lost input packet is invisible — the next one carries it. This is the cheapest reliability win in the whole protocol.

### 3.4 Quantization rule

**Quantize on send, and have the server quantize its own state identically.** If the server keeps full-precision state and clients receive rounded state, every client is permanently 0.125 u off and rollback fires constantly on noise. The server's authoritative state must be exactly what it transmits.

---

## 4. Determinism rules

Bit-exact determinism is not strictly required — full snapshots plus rollback self-correct divergence every tick. But every avoided divergence is an avoided visible correction.

**Mandatory:**

1. **No transcendentals in the sim.** `sin`, `cos`, `tan`, `atan2`, `acos`, `pow`, `exp`, `hypot` are not specified by IEEE 754 and vary across JS engines. Use a lookup table: angle quantized to 4096 steps, linear interpolation between entries. Build this before rollback debugging, not after.
2. `+ − × ÷ sqrt` on doubles **are** IEEE-754 exact. Safe.
3. **No wall clock in the sim.** No `Date.now()`, no `performance.now()`. Tick number only.
4. **All durations in ticks, not milliseconds.** Convert `Ms` fields once at table load, in shared code. Sweep the weapon table for any `Ms` suffix.
5. **Fixed iteration order.** Entities by slot index. Collision pairs in canonical `(lowId, highId)` order. Weapon slots in index order.
6. **Deterministic tiebreaks.** Any `min`/`max` selection over floats needs a defined answer at equality. Use strict `<` and iterate in ID order so ties resolve to the lower ID. This matters most in exactly-symmetric cases, which are rare, reproducible, and maddening.
7. **No PRNG anywhere.** Pellet fans are deterministic (§6.3). If you later need randomness, use a seeded PCG32 keyed on `(tick, ownerId, seq)` — never `Math.random()`.

**Recommended:** structure-of-arrays with fixed-size pools, so snapshot/restore is a typed-array copy.

---

## 5. Drive model

### 5.1 State

```
pos      : vec2
vel      : vec2      // full velocity, including lateral
angle    : scalar
angVel   : scalar
```

The previous scalar-`speed`-along-heading model cannot represent a car that has been shoved sideways or spun. Both are required by the ram mechanic.

### 5.2 Per-tick integration

```
fwd   = (cosLUT(θ),  sinLUT(θ))
right = (-sinLUT(θ), cosLUT(θ))

v_f = dot(vel, fwd)          // this is exactly the old `speed` scalar
v_l = dot(vel, right)        // new; ≈0 during normal driving

v_f = integrateThrottle(v_f, throttle)   // existing four-rate logic, unchanged
v_l = v_l * LATERAL_KEEP                 // arcade knob

vel = fwd * v_f + right * v_l
pos += vel * DT
```

`LATERAL_KEEP = 0` reproduces the old model exactly. **Verify this as a regression test before layering collisions on top** — if it doesn't reproduce, the projection has a bug.

### 5.3 Throttle rates (unchanged, rate-based)

| Mode | u/s² |
|---|---|
| Accelerate | 780 **[T]** |
| Brake | 1600 **[T]** |
| Coast drag | 900 **[T]** |
| Reverse accelerate | 1100 **[T]** |

Constant rates, not force-driven. Acceleration is linear to the cap, drag is constant subtraction. Invariant to assert in tests: `brakeDecel > drag`.

Retain the stop epsilon (snap to rest) and the 2-tick reverse hold.

**Mass does not appear here.** See §5.5.

### 5.4 Steering — converge angular velocity

```
targetAngVel = steer * TURN_RATE * speedFactor(v_f)
delta        = clamp(targetAngVel - angVel, ±ANG_ACCEL * DT)
angVel      += delta * controlAuthority
angle       += angVel * DT
```

With `ANG_ACCEL` high, this converges within ~2 ticks under normal driving and feels identical to direct heading control. When a collision impulse injects spin into `angVel`, steering cannot cancel it instantly — the player must fight it out.

**Countersteering is free.** The integrator doesn't know why `angVel` is high. Steering against the spin sets `targetAngVel` opposite and the clamp drives it back at `ANG_ACCEL × authority`. No extra code.

Retain: turn rate halves below the stop threshold so a parked car doesn't pirouette.

**Balance consequence:** CC duration is no longer deterministic. A skilled player recovers meaningfully faster. Weapon TTK needs enough headroom that a fast recovery doesn't invalidate the ram.

Optional, defer until tuning: a **catch bonus** — slightly higher `ANG_ACCEL` when steering opposite the current spin sign. Rewards reading spin direction. One multiplier, easy to add or remove.

### 5.5 Mass — collisions only

Mass and inertia appear **only** in the impulse solve. Drive acceleration stays a per-chassis constant.

Rationale: a force-based drive (`a = F/m`) forces heavy ⇒ sluggish, collapsing your archetype space to one axis. Rate-based lets you build a heavy brawler that still accelerates decently, or a light car that's slow but nimble.

```
I = m * (CAR_LEN² + CAR_WID²) / 12 = m * 277.33
```

### 5.6 Consequences to handle

- **`v_f` can go negative from a hit.** A car spun 180° while moving is travelling backward relative to facing. Verify the reverse-hold logic doesn't trap it in a bad throttle state. Correct behavior: forward throttle first decelerates the backward motion.
- **Throttle must not instantly cancel a ram.** This is a feature, not a bug. The three recovery timescales below are what make CC land.

| Knocked | Recovers via | Knob |
|---|---|---|
| Sideways | Lateral scrub | `LATERAL_KEEP` |
| Slowed | Throttle | accel rates |
| Spun | Steering vs angVel | `ANG_ACCEL × authority` |

---

## 6. Physics

### 6.1 Shape

48×32 OBB, centred on `pos`, rotated by `angle`.

OBB rather than capsule because the ram mechanic is angle-dependent: a box gives a contact normal that is genuinely one of four faces or a corner, and corner-to-corner clipping is real skill expression. A capsule's normal varies continuously around the caps, blurring exactly the front/flank/rear classification the design depends on.

**Consider 56×28 [T].** At 48×32 the ratio is 1.5:1; real cars are 2.2–2.5:1. Front/rear faces (32) and side faces (48) are close enough in size that flank and front hits occur at similar frequency, weakening the positional read of ramming.

### 6.2 Narrow phase — already built

SAT over four candidate face normals, minimum-overlap axis, with the containment case handled by measuring travel-to-clear at each end and taking the shorter. Output: contact normal + penetration depth, exit direction chosen by nearest end.

**Keep this.** The containment fix is correct and non-obvious — the naive span-intersection version produces both a too-short push and a wrong min-depth vote.

Broad phase: 15 pairs. Brute force. No BVH, no sweep-and-prune.

### 6.3 World bounds — axis clamp

Keep the axis clamp against the upright AABB of the rotated car, one contact per violated axis so a corner hit reflects off both walls independently. A clamp cannot mispick a separating axis on a deeply penetrating body; thin wall boxes notoriously eject fast cars out the far side.

**One fix required:** the AABB clamp gives correct *position*, but for torque you need the actual car corner that hit. Take the corner with maximum projection along the wall normal and use that as the contact point. Without this, wall ramming produces no spin.

### 6.4 Contact manifold — 2 points

Single-point contact is correct for corner hits and wrong for flush side-by-side, which happens constantly in a 6-car arena. Two cars sliding door-to-door share an *edge*; with one contact point they rotate against each other unphysically.

Reference/incident face clipping (Sutherland–Hodgman):

1. Reference face = the face whose normal is the min-penetration axis.
2. Incident face = the most anti-parallel face on the other box.
3. Clip incident against the reference face's side planes.
4. Keep points with positive penetration. Up to 2.

This is the fiddliest part of box collision. Budget a day and do it properly rather than patching around it.

### 6.5 Response — impulse exchange

Replaces velocity reflection. Reflection cannot produce angular change, is mass-blind, and yields no impulse magnitude — all three are required.

```
for each contact point p:
    r_A = p - A.center
    r_B = p - B.center

    // 2D: ω × r = ω * perp(r),  perp(v) = (-v.y, v.x)
    v_rel = (B.vel + B.angVel*perp(r_B)) - (A.vel + A.angVel*perp(r_A))
    v_n   = dot(v_rel, n)

    if (v_n > 0) continue;              // separating — existing gate, keep

    kn = A.invMass + B.invMass
       + cross(r_A, n)² * A.invI
       + cross(r_B, n)² * B.invI

    j = -(1 + RESTITUTION) * v_n / kn   // ← this is the CC severity input
    J = j * n

    A.vel -= J * A.invMass;  A.angVel -= cross(r_A, J) * A.invI
    B.vel += J * B.invMass;  B.angVel += cross(r_B, J) * B.invI
```

Three properties worth noting:

- **`j` falls out for free** — it's the magnitude the CC formula needs, not a separate computation.
- **Angular response is automatic.** The `cross(r, n)` terms mean an off-centre hit produces spin from geometry alone. No special-casing.
- **Static bodies are `invMass = 0, invI = 0`** and drop out naturally, preserving the unified response path across cars, walls, and obstacles.

**Friction** — same solve along `t = perp(n)`, Coulomb-clamped:

```
j_t = -dot(v_rel, t) / kt
j_t = clamp(j_t, -FRICTION * j, +FRICTION * j)
```

Without friction, a flank scrape neither scrubs speed nor imparts yaw, and it feels wrong immediately.

### 6.6 Positional correction

```
correction = max(depth - SLOP, 0) / (A.invMass + B.invMass) * PERCENT * n
A.pos -= correction * A.invMass
B.pos += correction * B.invMass
```

Mass-weighted, so a car pushing a wall moves alone. Leaving a little overlap (`SLOP`) is intentional — it prevents the separate/lose-contact/re-collide jitter cycle. Moving by the full penetration depth every tick launches cars on deep hits.

### 6.7 Ram CC — torque impulse + control authority

The physical spin comes free from §6.5. Layer a tunable scalar on top so balance doesn't require touching physics constants.

**Attacker determination** uses forward velocity only. A car sliding sideways still shoves people physically — momentum is momentum — but deals no CC:

```
approach_A = dot(A.vel, A.fwd) * dot(A.fwd,  n)
approach_B = dot(B.vel, B.fwd) * dot(B.fwd, -n)

if (approach_A > approach_B) { att = A; vic = B; approach = approach_A }
else                         { att = B; vic = A; approach = approach_B }

severity  = clamp01(approach * att.mass / RAM_REF)
severity *= rearFlankBonus(n, vic.angle)

ccTicks   = lerp(CC_TICKS_MIN, CC_TICKS_MAX, severity)
authority = lerp(1.0, AUTHORITY_FLOOR, severity)
```

**Do not remove lateral velocity from the impulse solve in §6.5** — only from this severity calculation. The physics must use full relative velocity or momentum isn't conserved.

**Impact side classification** — the victim's local frame:

```
n_local = rotate(n, -vic.angle)
|n_local.x| > |n_local.y| → front (x>0) or rear (x<0)
else                      → flank
```

| Side | Bonus |
|---|---|
| Front | 0.3 **[T]** |
| Flank | 1.0 **[T]** |
| Rear | 1.3 **[T]** |

**This table is the single most important balance lever in the game.** It's what makes positioning matter. Expect to spend real time here.

Head-on collisions fall out correctly: both cars have positive approach, the faster/heavier wins the comparison, and the front-face bonus is low anyway — so neither gets meaningfully spun. This matches the intent that head-on ramming isn't the play.

**`AUTHORITY_FLOOR` is the feel dial.** Too low and the player is a passenger regardless of input, which defeats countersteering. Start at 0.35.

### 6.8 CCD

Cars: **not needed.** At 60Hz and 580 u/s, per-tick displacement is 9.7 u against a 48 u car. Well under half a car length.

Projectiles: **required.** See §7.4.

---

## 7. Weapons

### 7.1 Model

Data table. A new weapon is a row, not code. Two slots per chassis (see note below); fire input is a slot bitmask.

**Recommend two slots, not three.** With hands on arrow keys, three slots means three more keys plus a switch lockout that punishes using them. Switch recovery is a good mechanic when weapon choice is a real decision; at three slots in a fast brawl it mostly reads as the game refusing input. This is a design opinion, not an architectural constraint.

**Stock system:** by default one shot, recharging after fire. A weapon may bank several with a short refire gap, recharging one at a time. Two lockouts — refire delay (same slot) and switch recovery (different slot) — both keyed on **slot**, not weapon id, so a loadout carrying the same weapon twice can't dodge the switch lock.

**A press is a commitment.** Stock spent immediately, wind-ups uncancellable, an unfireable press dropped rather than queued. The drop-not-queue rule matters for netcode: a queue is additional path-dependent state that would need replicating.

Each shot of a burst spawns from the car's pose at *its own* tick, so bursts are steerable.

### 7.2 Geometry

| Kind | Motion | Cross-section | Notes |
|---|---|---|---|
| **Projectile** | Travels at fixed speed | Circle or ellipse | Dies at max range, on wall, or on car. `pierce` = budget of extra cars after first damage |
| **Beam** | Origin fixed, reach *grows* at weapon speed to max range, then lingers | Rect or cone | Clipped by walls, not destroyed. Multi-hit. `attached` → origin and angle follow the firing car, dies with owner |

The growing-beam formulation is better than a fast travelling hitbox: reach is a pure function of `(spawnTick, now, speed, maxRange)`, so it carries no per-tick state and cannot desync.

`damageFrequencyTicks` decides whether an instance hurts each car once or re-arms on an interval — this is what makes a lingering beam tick damage.

Shots are drawn **as their hitbox**, never a sprite. What you see is exactly what can hit you. This also makes resolution/zoom fairness automatic — there is no art asset that can disagree with the collision shape.

Teammates, wrecks, and the shooter are not contacts. Shots pass through them free.

### 7.3 Volleys and pellets

A press fires **volleys** (sequential groups) of **pellets** (simultaneous, fanned across a spread angle). One row can therefore be a single shot, a shotgun blast, or a burst.

**Pellet fans are deterministic.** Pellet `i` of `n` gets angle `exitAngle + spreadHalf * (2i/(n−1) − 1)`. No PRNG anywhere in the weapon system.

This buys **volley compression** — pellets are fully determined by `(spawn pose, spawn tick, weaponId, pelletIndex)`, so the wire carries the volley, not the pellets:

| | Naive | Volley record |
|---|---|---|
| 12-pellet blast | 96 B | ~10 B |
| Worst case, 6 blasts | 576 B | 60 B |

Clients derive each pellet and integrate forward. Deaths arrive as events, not per-tick state. Same scheme for beams; an attached beam needs no pose at all.

### 7.4 Hit detection

Swept. A projectile is tested as the convex hull of its shape at last tick and this tick, so a fast shot cannot tunnel through a car or a thin wall.

**Ellipses cannot use SAT.** SAT requires both shapes to be convex *polygons* — it tests a finite set of face normals, and an ellipse has infinitely many. The current path either tests wrong axes or silently degrades to the ellipse's bounding box. The swept version compounds it, since the hull of an ellipse at two poses isn't a polygon either.

**Fix — the scaling trick.** In the ellipse's local frame, scale space by `(1/rx, 1/ry)`. The ellipse becomes a unit circle and the OBB becomes a parallelogram. Then run circle-vs-convex-polygon, which you already have. Exact, cheap, and the swept version becomes capsule-vs-parallelogram.

Fix this before a shipped weapon depends on current behavior.

### 7.5 Beam ownership

| | Behavior |
|---|---|
| Attached | Dies with owner. Not a choice — origin derives from a pose that no longer exists |
| Unattached | `persistOnOwnerDeath` flag per weapon. Retains `ownerId` for damage attribution |

On owner death, an unattached beam **stops growing** and lives out its lifetime at current reach. A beam that keeps extending under the direction of someone who no longer exists looks wrong even though the math is fine.

A kill credited to a dead player is normal and reads fine — same as a grenade thrown before dying.

### 7.6 Prediction and feedback

Predicted projectiles spawn immediately, tagged `(ownerId, slot, fireSeq)`. `fireSeq` is per slot so two slots firing on the same tick are unambiguous. When the authoritative volley arrives with the same tag, blend the predicted transform toward it over ~100ms, then let the server version drive.

| Predict immediately | Wait for server |
|---|---|
| Muzzle flash | Damage numbers |
| Fire sound | Hit confirmation |
| Projectile spawn | Kill feed |
| Impact spark | CC application |

This is a large perceived-fairness win. A ghost shot that produces a spark and no number reads as "I grazed them," not "the game ate my shot."

Stock is in the snapshot, so a mispredicted fire self-corrects within one tick.

---

## 8. Aim assist

### 8.1 Model

**Ambient soft lock.** One lock per car, updated every tick whether firing or not. The trigger cannot override it.

**Acquisition** requires all three of:

| Test | Default | Per weapon |
|---|---|---|
| Cone off nose | 20° | `assistConeDeg` (0 = assist off) |
| Lateral offset from centreline | 120 u | `assistLaneWidth` |
| Range | 400 u | `assistRange` |

The cone alone gets absurdly wide far away; the lane alone gets absurdly wide up close. Intersected, the cone rules contact range and the lane rules long range.

**All three are absolute per-weapon values and are a primary balance lever.** An overperforming weapon can lose lock reach without losing shot reach, or vice versa. `assistConeDeg = 0` is the off switch — one field, no separate boolean.

### 8.2 What the lock changes

**One number: the shot's exit angle.** The muzzle stays welded to the car's nose, so a wide lock can never spawn shots off the side of the hull. Re-derived per shot, so bursts track movers.

This is what makes the whole system netcode-safe — a mispredicted lock costs an angle, not a teleporting muzzle.

**No lead.** The lock aims where the target *is*. Lead would make assisted weapons better at range, reducing the reason to close, undermining ramming. It's a skill substitute rather than a convenience.

### 8.3 Target selection

Algebraic only — no `atan2`, no `acos`:

```
d      = target.pos - self.pos
distSq = dot(d, d)                         // range: distSq < range²
lat    = dot(d, right)                     // lane:  |lat| < laneWidth
cone   = dot(d, fwd)                       // cone:  cone > 0 &&
                                           //        cone² > cos²(θ) * distSq
dist   = sqrt(distSq)                      // one sqrt, IEEE-exact
score  = W_ANGLE * (1 - cone/dist) + W_DIST * dist * INV_RANGE
```

`1 − cos θ` is a monotonic angle proxy and is exact. Lowest score wins. Iterate candidates in entity-ID order, strict `<`, so ties resolve to the lower ID.

**Weight angle heavily.** A strongly discriminating score makes near-ties rare, which is what removes the need for elaborate hysteresis.

### 8.4 Hysteresis — one timer only

**Replaces:** retention padding, LOS grace, commit timer, steal margin, engagement timeout.

**With:** a single commit timer. Once a target is picked, hold it for `LOCK_COMMIT_TICKS` unless it leaves the acquisition region entirely.

Rationale: five interacting stateful rules solving one problem (bracket strobing) is the only genuinely fragile part of the design under rollback. Path-dependent state turns a *transient* divergence into a *persistent* one — if client and server pick different targets at tick 100, the client's timers are now defending the wrong target and the divergence heals slowly or never.

Residual visual flicker is solved in the **renderer**, not the sim. The bracket can debounce a frame or two without the sim knowing. Presentation smoothing belongs in presentation.

Keep commit tight (~150ms) so deliberate target switching by steering doesn't feel sluggish.

### 8.5 Replication

`lockTargetId` (3 bits) and `lockCommitTimer` (6 bits) are in the snapshot — ~3 B per car, 18 B for the match. Lock state resyncs every tick, so a divergence lasts one tick instead of forever.

**Critical:** the server's lock ID is authoritative for *remote* cars' brackets. It **cannot** be authoritative for your own car's shots — the received ID is `RTT` old, and a predicted shot at `T_gen` needs the lock *at* `T_gen`. Using the received ID for your own shots means visibly watching shots leave toward a target you've already turned away from.

The client runs the identical ambient-lock logic locally for its own car, uses the predicted result for predicted shots, and treats the incoming ID as reconciliation. Same code — `shared/sim/aimassist.ts` — running both sides.

### 8.6 Tuning hazard

Because `assistRange` is hand-set, it can exceed the range where a no-lead lock can actually connect against a crossing target:

```
tolerance   ≈ projectileRadius + carHalfWidth
usefulRange ≈ projectileSpeed * (tolerance / crossingSpeed)
```

Beyond that, the assist confidently points at a target and the shot sails behind them — which reads as broken, not as balanced.

Two dev-only safeguards, ~1 hour each:

1. **Load-time warning** if `assistRange > 1.5 × usefulRange`. Not an error — a long lock on a threatening-but-unreliable weapon may be intentional — but you want to know you did it on purpose.
2. **Per-weapon hit-rate readout** in the debug overlay: assisted shots fired vs connecting. If assisted hit rate ≈ unassisted hit rate, the lock is decorative.

### 8.7 Design tension to monitor

Ramming requires closing to contact. Aim assist reduces the cost of not closing. At 400 u against a 3200×1800 arena — about 8 car lengths, an eighth of the arena width — the assist reads as a close-quarters aid and the brawl still collapses to contact range.

If you later widen assist or shrink the arena, ramming quietly stops mattering and the cause won't be obvious. Re-check this ratio whenever either changes.

---

## 9. Client architecture

### 9.1 Prediction

**Local car:** full prediction with rollback. Store input history and predicted state per tick. On snapshot for tick T, compare; if error exceeds epsilon, restore and re-simulate T+1…T_gen from stored inputs.

**Remote cars: predict them forward, don't interpolate.** Run the full shared `step()` for all six cars with repeat-last-input — not per-entity dead reckoning. Collisions during the unknown window are therefore predicted too, and error accumulates only from input divergence.

Interpolating remote cars would mean every collision you see has already resolved differently.

**Why this works here and not in an FPS:** cars have bounded angular and linear acceleration. A mouse can flick 180° between ticks; a car cannot.

**Error magnitude** (worst case, `Δa ≈ 800 u/s²`, 48 u car; relative error between two extrapolated cars is ~2× the single-car figure):

| `RTT − D` | Position error | % of car length |
|---|---|---|
| 20 ms | 0.16 u | 0.3% |
| 40 ms | 0.64 u | 1.3% |
| **80 ms** | **2.6 u** | **5.4%** |
| 120 ms | 5.8 u | 12% |
| 160 ms | 10.2 u | 21% |

A dropped snapshot extends the window by one tick (16.7 ms) — budget for occasional spikes.

At the 80 ms target, disagreement is confined to grazing contacts. Past ~120 ms ramming starts to genuinely misbehave. Because ram outcomes are **graded by impulse magnitude rather than binary**, a slightly-off collision produces slightly less CC rather than a categorical miss. Preserve this property deliberately as modes are added.

### 9.2 Error smoothing

Never snap visually. Maintain a render-time visual offset (position vector + shortest-arc angle delta), decayed exponentially:

| Error | Decay |
|---|---|
| < 0.2 car lengths | 150–200 ms (invisible) |
| > 1 car length | 40–60 ms (a hard correction beats lying about a collision that clearly happened) |

### 9.3 Rendering

- Fixed 60Hz accumulator; `rAF` render loop; interpolate between sim states with `alpha = accumulator / DT`.
- Clamp accumulator to ~5 steps per frame so a hitch doesn't spiral.
- A 240Hz monitor gets smooth motion from a 60Hz sim.
- **WebGL2 (PixiJS)**, not Canvas2D — frame times stay consistent under particle load.
- Camera and HUD read the **render** timeline, or the camera leads the car.
- Local VFX fire on the **render** timeline, not the sim timeline. Missing this is a subtle and nasty bug once `D > 0`.

### 9.4 Camera and fairness

**Fixed aspect, fit-and-letterbox. Non-negotiable.**

```
scale   = min(viewportW / ARENA_W, viewportH / ARENA_H)
offsetX = (viewportW - ARENA_W * scale) / 2
offsetY = (viewportH - ARENA_H * scale) / 2
```

An ultrawide player must never see more arena than a 16:9 player. Put HUD in the letterbox margins so wide monitors get a cosmetic benefit without a gameplay one. This is the most common competitive-integrity bug in top-down games and it is invisible in testing because the whole team has similar monitors.

**Browser zoom** changes CSS pixel size. Size the canvas from `window.innerWidth/innerHeight` and re-run the fit on resize — zoom then changes only effective render resolution, which is correct. Never use CSS `transform: scale()` on the canvas.

**DPR:** backing store `cssSize × devicePixelRatio`, CSS size `cssSize`, cap DPR at 2. Listen for DPR changes via `matchMedia('(resolution: Xdppx)')` — dragging between laptop and external monitor changes it mid-match.

**No gameplay code reads viewport dimensions.** All gameplay constants are world units.

### 9.5 Input sampling

**Do not sample keyboard state once per rendered frame.** At 30fps that quantizes input to 33ms buckets while a 240fps player gets 4ms buckets — a real competitive difference.

```
listen keydown/keyup → record event.timeStamp
bucket each transition into the correct 60Hz tick
use KeyboardEvent.code (layout-independent)
ignore event.repeat
```

This makes input fidelity identical regardless of frame rate.

**Residual refresh-rate advantage** cannot be eliminated — a 240Hz player sees state ~12ms fresher. Don't add to it: keep the render pipeline shallow.

**Local latency budget**, for perspective on where milliseconds actually go: keyboard → OS → browser event (5–15 ms), tick quantization (~8 ms avg), render (4–16 ms), display (5–20 ms). That's 25–60 ms of local pipeline before a packet moves.

### 9.6 Background tabs

`rAF` stops in hidden tabs; timers throttle hard. Run the sim loop in a **Web Worker** so it survives main-thread hitches. On regaining focus, discard the accumulator and request full resync rather than catching up. A silent audio track keeps a tab "audible" and dodges most throttling.

### 9.7 The `D` knob

Dev-only in V1. Runtime cost is **zero** — you simulate to `T_gen` regardless, and `T_r` is inside a ring you already maintain. Rendering with `D` is reading a different index.

Requirements if enabled:

- **Uniform across all cars.** Your car at `T_gen` and remotes at `T_r` draws contacts wrong — visible overlap without impact, or impact without contact. Worse than the error `D` was introduced to reduce. This also means `D` is real input latency on your own car; it is not a free accuracy win.
- **Ramp smoothly** (±1–3%/frame) via the existing time-dilation machinery. Never step.
- **Fractional `D` is fine** — render interpolation already blends.

**Primary value is debugging.** `D = RTT` renders raw server state with prediction fully bypassed. Bug survives → it's in the sim. Bug vanishes → it's in prediction or reconciliation. Put it on a hotkey.

Cap at 2 ticks if ever exposed. Sweet spot is narrow: 1–2 ticks. Beyond that you pay real responsiveness for error that was already small.

---

## 10. Server

### 10.1 Tick loop

```
tick++
inputs = collect(tick)              // pop buffer; repeat-with-decay on miss
world  = step(world, inputs, tick)  // the shared pure function
quantize(world)                     // §3.4 — server state == transmitted state
for p in players:
    send(snapshot(world), inputAck[p], timing[p])
```

No history buffer. Nothing rewinds.

### 10.2 Process model

One process per match, zero shared state, no DB in the tick loop. Six entities at 60Hz — one vCPU hosts 100+ concurrent matches.

The lobby/session service is **separate and latency-insensitive**. It can live in one region forever; it hands the client a game-server address and does not host the game.

### 10.3 Reconnect

Nearly free because of full snapshots — a reconnecting client needs exactly what a connecting client needs: one snapshot. No baseline to reconstruct, no keyframe to wait for.

| Piece | Cost |
|---|---|
| Signed session token (`matchId + slot + secret`) at match start | 0.5 d |
| Room lifecycle: keep room alive with slot `DISCONNECTED` | 1 d |
| Abandoned-car policy | 1 d |
| Rejoin handshake: validate → clock sync → snapshot + match meta | 1 d |
| Client bootstrap: flush prediction, flush input history, resume | 0.5 d |
| UI: "Reconnecting… 42s" / "Teammate reconnecting" | 1 d |
| **Total, designed in now** | **~5 d** |
| Retrofitted in six months | 2–3 weeks |

**Abandoned car: coast to a stop, then despawn after ~5s.** Team plays 2v3 until return. Freezing in place creates a free invulnerable obstacle that could be exploited deliberately; AI autopilot is more work and bad AI in a competitive match is its own complaint.

Grace window 60–90 s, then close the slot.

### 10.4 Input logging

Log the per-tick input stream server-side: ~1.2 KB/s, under 1 MB for a 10-minute match. Gives deterministic bug reproduction now, and if replays or spectating are ever wanted the data already exists. Retrofitting means reproducing bugs you can no longer reproduce.

### 10.5 Hosting

| | |
|---|---|
| V1 | Single region. **Test Dhaka (BDIX-connected) vs Mumbai vs Singapore before committing** |
| Cost | ~$15/month, covers well past 100 PCU |
| Egress | ~450 MB per match-hour → ~$0.04/match-hour at hyperscaler rates, ~$0 on bundled-bandwidth VPS |

Local Dhaka hosting wins twice: 5–15 ms raw latency, and it avoids international gateway congestion entirely. BD international traffic transits IIG operators and submarine cable capacity, where evening peak congestion is well documented locally. Hosting in Mumbai or Singapore puts **every packet** across that boundary. If the game feels fine in the afternoon and bad at 9pm, this is why.

**Region-readiness rules (build now, ~1–2 days, adding region #2 later ≈ half a day):**

1. Game server = one stateless process per match.
2. Lobby service separate.
3. Region is a config row, never a constant.
4. Client pings candidate regions on load, reports RTT with join. Ship this in V1 even at one region — it gives a free latency map of your actual players.

### 10.6 Fairness levers (ranked era, deferred)

**No match-wide equalized delay.** Not V1, not ranked. It taxes a 20 ms player to 120 ms for someone else's benefit — a certain, continuous, highly-perceptible cost imposed to remove an intermittent, marginal one. Rocket League, Overwatch, and Valorant all reject it; the games that use it are lockstep RTS (architecturally forced) and FIFA (persistently complained about).

**Use ping *spread* gating instead.** Extrapolation error scales with `t²`:

| Player RTT | Extrapolation | Relative error |
|---|---|---|
| 20 ms | 20 ms | 1× |
| 80 ms | 80 ms | 16× |
| 140 ms | 140 ms | 49× |

A match where everyone sits at 90 ms is **fairer** than one mixing 20 ms and 120 ms, even though average ping is worse. Constrain `max − min ≤ 50 ms` and treat it as a harder rule than the absolute ceiling.

Also deferred: matchmaking relaxation ladder, off-peak population handling. Both are ranked-era problems.

---

## 11. Constants

**Anchor on times and car-lengths, not raw units.** Those stay meaningful when speeds change. `MAX_SPEED` is the master dial — change it and arena size, turn rate, and derived ranges all move together. Without this you will spend the entire tuning phase re-deriving forty numbers by hand and shipping inconsistencies.

### 11.1 Master

| Constant | Value | Source |
|---|---|---|
| `TICK_HZ` | 60 | fixed |
| `DT` | 1/60 | **[D]** |
| `CAR_LEN` | 48 **[T]** | try 56 |
| `CAR_WID` | 32 **[T]** | try 28 |
| `MAX_SPEED` | 580 **[T]** | **master dial** |
| `ARENA_CROSS_TIME` | 5.5 s **[T]** | |
| `ARENA_W` | 3190 **[D]** | `MAX_SPEED × ARENA_CROSS_TIME` |
| `ARENA_H` | 1794 **[D]** | `ARENA_W × 9/16` |

### 11.2 Drive

| Constant | Value | Notes |
|---|---|---|
| `ACCEL` | 780 **[T]** | |
| `BRAKE` | 1600 **[T]** | assert `> DRAG` |
| `DRAG` | 900 **[T]** | |
| `REVERSE_ACCEL` | 1100 **[T]** | |
| `MAX_REVERSE` | 0.4 × `MAX_SPEED` **[D]** | |
| `TURN_180_TIME` | 0.9 s **[T]** | |
| `TURN_RATE` | 3.49 rad/s **[D]** | `π / TURN_180_TIME` |
| `TURN_RADIUS` | 166 u **[D]** | `MAX_SPEED / TURN_RATE` ≈ 3.5 car lengths |
| `ANG_ACCEL` | 100 rad/s² **[T]** | converge in ~2 ticks |
| `LATERAL_KEEP` | 0.6 **[T]** | per tick; ~1% in 9 ticks. 0 = old model |
| `STOP_EPSILON` | 5 u/s **[T]** | |
| `REVERSE_HOLD` | 2 ticks | |

### 11.3 Physics

| Constant | Value |
|---|---|
| `MASS_BASE` | 1000 **[T]** |
| `MASS_LIGHT` / `MASS_HEAVY` | 800 / 1400 **[T]** |
| `INERTIA_COEF` | 277.33 **[D]** — `(CAR_LEN² + CAR_WID²)/12` |
| `RESTITUTION` | 0.20 **[T]** — lower than the old 0.35, since energy now goes into rotation too |
| `FRICTION` | 0.4 **[T]** |
| `SLOP` | 0.5 |
| `PERCENT` | 0.2 |

### 11.4 Ram CC

| Constant | Value |
|---|---|
| `RAM_REF` | 580,000 **[D]** — `MASS_BASE × MAX_SPEED` |
| `AUTHORITY_FLOOR` | 0.35 **[T]** — the feel dial |
| `CC_TICKS_MIN` / `MAX` | 6 / 24 **[T]** — 100–400 ms |
| `BONUS_FRONT` / `FLANK` / `REAR` | 0.3 / 1.0 / 1.3 **[T]** — **most important table in the game** |

### 11.5 Aim assist

| Constant | Value |
|---|---|
| `assistConeDeg` | 20 **[T]** (0 = off) |
| `assistLaneWidth` | 120 **[T]** |
| `assistRange` | 400 **[T]** |
| `LOCK_COMMIT_TICKS` | 9 **[T]** — ~150 ms |
| `W_ANGLE` / `W_DIST` | weight angle heavily **[T]** |
| `T_MISS` | 60 ms **[T]** — for the §8.6 warning only |

### 11.6 Match

| Constant | Value |
|---|---|
| `RESPAWN_TICKS` | 180 **[T]** — 3 s |
| `IMMUNITY_TICKS` | 120 **[T]** — 2 s |
| `TTK_TARGET` | 4–6 s sustained **[T]** — derives weapon damage |
| `D_DEFAULT` / `D_MAX` | 0 / 2 ticks |
| `RECONNECT_GRACE` | 60–90 s |
| `ABANDON_DESPAWN` | 5 s |

---

## 12. Tooling — build before the solver

Two days that pay back many times. This is also exactly the kind of code an AI assistant writes well: mechanical, well-specified, no emergent behavior.

| Tool | Cost | Why |
|---|---|---|
| **Visual debug overlay** — contact points, normals, penetration depth, impulse vectors, velocity vectors | 0.5 d | Most solver bugs are instantly obvious when you can see the normal pointing the wrong way, and invisible otherwise |
| **Headless deterministic harness** — N ticks from fixed state + scripted inputs → state hash | 0.5 d | Regression suite and determinism check in one. Every physics change runs against it |
| **Scenario replays** — head-on at max speed, rear-end, 90° T-bone, 15° glancing side-swipe, three-car pile against a wall, car wedged in a corner at full throttle | 0.5 d | You will run these hundreds of times |
| **Determinism differ** — same scenario twice, per-tick hash compare, print first diverging tick and field | 0.5 d | Turns "physics is nondeterministic somewhere" into "tick 847, car 3, angularVelocity" |
| Netgraph — RTT, jitter, loss, transport, active `D` | 0.5 d | Useful to you, useful in bug reports |

**A note on expectations for AI-assisted physics work.** Writing the code — SAT, impulse resolution, integrators, swept tests — compresses well; these are textbook algorithms with known-correct forms. *Making it behave* does not. "Cars jitter when three touch a wall" is usually not a bug in any line — the code does exactly what was written, and misbehavior emerges from the interaction of restitution, penetration correction, tick rate, and mass ratios. Plan for "working code fast, then two weeks of tuning."

When prompting, give specific constraints rather than asking for a physics engine: *"sequential impulse resolution for two OBBs with restitution and Coulomb friction, no warm starting, no stacking support, 2-point manifold via face clipping, deterministic iteration order"* produces far better output than *"write 2D collision physics."* Ask for the derivation of the impulse equation, not just the code — it's the only genuinely mathy part and you need to understand it.

---

## 13. Repository layout

```
shared/
  sim/
    step.ts          ← the pure function. I1 lives or dies here
    world.ts         ← SoA state, snapshot/restore via typed arrays
    drive.ts         ← §5
    physics/
      sat.ts         ← existing, keep
      manifold.ts    ← §6.4 face clipping
      solve.ts       ← §6.5 impulse + friction
      correct.ts     ← §6.6
    weapons.ts       ← §7, data table
    aimassist.ts     ← §8, runs on both sides
    trig.ts          ← cos/sin LUT, 4096 steps
    constants.ts     ← §11, with [D] values computed not typed
  net/
    protocol.ts      ← §3 schemas + quantization

server/
  match/  room.ts · inputBuffer.ts · validate.ts
  transport/
  lobby/             ← separate service, latency-insensitive

client/
  net/     transport.ts · clockSync.ts · decode.ts · reconcile.ts
  predict/ inputHistory.ts · rollback.ts · smoothing.ts
  input/   sampler.ts     ← §9.5 event-timestamped
  render/  scene.ts · interpolate.ts · camera.ts · vfx.ts · debug.ts
  ui/
```

---

## 14. Build order

| Phase | Work | Est. |
|---|---|---|
| **0** | Tooling (§12). Trig LUT. Constants with derivations | 2–3 d |
| **1** | Drive model: `vel` vector + `angVel`. **Verify `LATERAL_KEEP = 0` reproduces current feel exactly.** Tune handling solo, no collisions | 3–4 d |
| **2** | Car vs static: real contact point on wall clamp, impulse solve, friction, positional correction | 3–4 d |
| **3** | Car vs car: 2-point manifold, same solver both dynamic | 2–3 d |
| **4** | Ram CC: severity, authority, `rearFlankBonus`. **First real playtest gate** | 2 d |
| **5** | Weapons: volley/pellet derivation, swept tests, ellipse scaling fix | 3–4 d |
| **6** | Aim assist: algebraic scoring, single commit timer | 2 d |
| **7** | Netcode: transport, protocol, clock sync, prediction, rollback, smoothing | 1.5–2 wk |
| **8** | Reconnect, lobby, match flow | 1 wk |
| **9** | **Tuning** | 2–4 wk, ongoing |

Phase 1 before any collision work — driving feel is the foundation and is independently tunable. Phase 4 is the first point where the game's core mechanic is testable; everything before it is scaffolding.

---

## Appendix: open items

Deliberately deferred, not forgotten:

- **All `[T]` constants** — need a playable build, not more discussion.
- **Ranked-era matchmaking:** relaxation ladder, spread thresholds, off-peak population handling (merged playlists → wider ladder → bots → scheduled windows).
- **Automated per-player `D`** — 2 days whenever wanted, no retrofit penalty since the render-clock separation is the hard part and phase 7 does it.
- **Additional game modes.** Re-check §8.7 (assist range vs arena size) and §9.1 (graded ram outcomes) whenever a mode changes arena scale or introduces precise high-speed grazing contact as core skill expression.
- **Rounded-box collision shape** — if OBB corner-vs-corner proves stubborn during tuning. Localized change; entity layout identical.
- **Catch bonus** on countersteer (§5.4).
