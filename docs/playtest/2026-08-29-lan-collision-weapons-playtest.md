# Playtest — car-on-car collision, and weapons/damage/effects

**Date:** 2026-08-29 · **Base:** `development/main` @ `8308f77` · **Suite:** green (54 node tests,
all vitest files passing) before and after.

Two harnesses, both under `packages/server/playtest/`:

- **Offline** — `world.ts` drives the exact `ArenaRoom.tick` pipeline (`statusTick` → `serverTick` →
  `ramTick` → `runCombat` through the real bridges) with no Colyseus room, so a scenario can be
  *placed* at exact poses, speeds and ticks.
- **LAN** — `lan.ts` runs two real `colyseus.js` clients over WebSockets against the built server,
  through the real lobby → car select → reveal → countdown → match flow, with `SIM_LATENCY_MS`.

Everything below was reproduced offline first and, where marked, confirmed over the wire.

---

## Findings

### F1 — A ram lands on roughly one contact in eight. `severity: high`

**Symptom.** Driving your nose into another car usually does nothing at all. No shove, no spin, no
steering loss. Occasionally the same manoeuvre lands a full-strength knock.

**Measured.**

| | offline sweep | real LAN server |
|---|---|---|
| Hexagon, top speed, into a parked Oval | **14.4%** of approach phases | — |
| Rectangle, top speed | **8.4%** | — |
| Accelerating from rest (as a player drives), 40 run-ups | 15–20% | — |
| Alice charges Bob for 20s, 25±8 ms simulated latency | — | **20 contacts → 4 knocks (20%)** |

Whether it fires depends only on the sub-tick phase of the impact, which the player cannot see or
control. The trigger window is a contiguous **~1.5 world units** out of a per-tick step of 10.5
(Hexagon) to 18 (Rectangle).

**Root cause.** The room tick is `serverTick` (drive **and** `resolveWorld`) → `ramTick`.
`applyContact` inside `resolveWorld` reflects `speed` on the tick a contact is resolved, rebounding
the attacker to about −35% of its impact speed. `resolveRam` then reads *that already-reflected*
`speed` as its approach term:

```
t1: attacker speed 315.0 -> -110.3 after resolve; ram sees -110.3 (below minApproachSpeed) -> no ram
```

So on any tick where the hulls actually overlapped, the approach term is already negative and
`resolveRam` returns `null`. A ram fires only on the rarer tick where the pair lands inside
`RAM_CONFIG.contactPad` **without** overlapping — `contactNormalBetween` sees them, `resolveWorld`
did not touch them, and `speed` is still the impact speed.

This contradicts the design. `docs/superpowers/specs/2026-08-29-ram-cc-and-knockback-design.md` R4
treats the rebound as what damps *re-triggering* ("the second and subsequent triggers score near
zero anyway"), and R5's "head-on hits resolve without a special case. Both approaches are positive"
is only true of a pre-collision velocity. The first trigger was never meant to read a rebounded one.

**Why the suite is green.** Every case in `shared/src/sim/ram.test.ts` hand-constructs `RamCar`
objects with a chosen `speed`; none drives a car through `resolveWorld` first. The pure function is
correct — it is fed the wrong number in the integrated tick.

**Fix direction (not applied — `CLAUDE.md` says stop and ask before changing collision rules).**
Capture each car's pre-resolution `speed` in `serverTick` and hand it to `ramTick` as the approach
term, leaving poses read post-resolution exactly as R4 requires. Reordering ram before
`resolveWorld` would break the "measure the poses cars actually ended at" rule instead; widening
`contactPad` would only widen a window that is reading the wrong number anyway.

---

### F2 — Pepperbox cannot hit a car dead ahead past ~263u, but ships as "Reach 600". `severity: medium`

`volley.pelletsPerVolley` is 2 with `spreadAngleDeg: 10`. `fanOffset` places two pellets
symmetrically about the axis, so they leave at **−5° and +5° and nothing travels down the centre
line**. The gap between them grows with range:

| range | phases that connected | mean damage (of 168) | pellet offset from axis |
|---|---|---|---|
| 60u | 27/27 | 132 | 5u |
| 120u | 27/27 | 132 | 10u |
| 200u | 27/27 | 132 | 17u |
| 300u | 14/27 | 68 | 26u |
| 450u | **0/27** | **0** | 39u |
| 560u | **0/27** | **0** | 49u |

A car's half-width is 16u and the pellet radius is 7u, so both pellets clear a car dead ahead beyond
`23 / tan(5°) ≈ 263u` (≈354u against a broadside target). Past that the weapon cannot hit a single
car at all.

The shipped `manual.html` advertises **"Damage 132 · Reach 600"** and the copy says driving straight
"clusters all six into one fist". They never cluster — they form two diverging lines — and more than
half the advertised reach is dead. This is balance/copy, not a crash: either drop `range` to what the
fan can actually deliver, or make the pellet count odd so one pellet holds the centre line.

*(This is what the first pass mis-flagged as projectile tunneling. It is not — see C2.)*

---

### F3 — Prediction is exact alone and snaps hard on contact. `severity: medium (architectural)`

Correction applied to the local car by one `reconcile`, running a real `PredictionBuffer` against
the real server pipeline over a delay line at the shipped 30 Hz sim / 20 Hz patch rate:

| one-way latency | free driving | head-on collision (mean) | collision (peak) |
|---|---|---|---|
| 0 ms | 0.00u | 2.29u | 2.98u |
| 15 ms | 0.00u | 2.29u | 2.98u |
| 30 ms | 0.00u | 5.90u | **80.23u** |
| 60 ms | 0.00u | 7.57u | **107.37u** |
| 120 ms | 0.00u | 15.43u | **153.57u** |

Driving alone the prediction is *bit-exact at every latency* — the lockstep is doing its job. All of
the error is contact. The client predicts only itself and enters remotes at their last-known server
pose, so during contact it resolves its hull against a box 2–6 ticks stale (36–108u of travel at
Rectangle's top speed). `resolveWorld` is a hard positional constraint, not a soft force, so that
disagreement lands as a push-out in the wrong place rather than a small drift.

A 107u snap is over two car lengths. On a wired LAN (<5 ms) this is ~3u and invisible; on LAN Wi-Fi
(15–30 ms) it starts to bite, and the largest snap arrives just *after* separation, when the server's
bounce reaches a client that never predicted it.

---

## Confirmed by design, but worth a second look

| | Observed |
|---|---|
| **D1 — Shockwave stuns and damages through solid walls** | Hexagon on the west face of a 200×200 block dealt 100 and applied `stunned` to a car on the far side. `instances.ts` states a disc "grows to its full range and passes through level geometry" — deliberate, but from the receiving end it is a stun through a wall. It got *wider* in the cone→ring change, so this reaches behind the block too now. |
| **D2 — A wreck blocks cars but not bullets** | Shots dealt 388 straight through a wreck to the car behind it (a wreck leaves the hit snapshot the moment it dies), while a living car still collided with it and stopped. You can shelter behind a living team-mate and not behind a corpse. |
| **D3 — Crush concession into level geometry** | A car pinned between an attacker and an obstacle held up to **3.3u** of hull inside the wall. `collide.ts` warns this can reach "a full car dimension"; measured it is far milder than the docs fear. |
| **D4 — Reported `speed` sign flips at ~30.6° off a wall** | At 30° a car bounces off (speed 452 → −279); at 31° it pins and grinds (452 → +285). Documented in `applyContact`. The magnitude is continuous but the sign is not, and the HUD reads `speed` — one degree of approach decides "the wall threw me off" vs "the wall grabbed me". |

---

## Clean — corner cases probed and not reproduced

Scenarios drawn from what breaks in comparable car-combat and top-down arena games.

**Collision**

- **Car-car tunneling** — none at any reachable speed. Ordinary head-on driving closes 36 u/tick
  against a 48u hull. The first tunnel needs **600 u/s of injected shove on both cars**; the shipped
  ram caps at 416 u/s and only in a three-car sandwich, so it is out of reach.
- **Six-car corner pile-up** (300 ticks in, 200 reversing out) — peak pairwise overlap 4.6u, no NaN,
  nothing ejected, residual overlap 0.68u. The pile resolves.
- **Crush against the arena wall** — 0.0u overlap for all three chassis; the bounds clamp held, no
  car left the arena.
- **Rammed into a wall while silent** (alt-tabbed victim, the `hasKnock` coast path) — victim pinned
  at exactly wall-flush for all three chassis, never clipped through.
- **Slow-nudging a parked silent car** — 0.00u overlap; the mover is pushed out each tick.
- **Wedging in level geometry** (arena-02, 36 headings × 2 chassis into a free-standing block) —
  deepest penetration 2.36u, and **0/72 cars failed to reverse back out**.
- **Concave inner corners of the plus-shape** (16 approaches into the four re-entrant notches) — no
  penetration above 1u, nothing ejected.
- **Energy gain from a contact** — no heading gained speed/shove magnitude across a contact.
- **Session-id resolution order** — identical outcomes with ids sorted the other way in a three-car
  squeeze.
- **Spawn seats** — no pair overlaps and none sits inside geometry, on either arena, all three tables.
- **Ram chain / stun-lock** — two attackers pumping the throttle on one victim for 300 ticks left it
  with degraded steering 46% of the time, floor 0.57 against an `authorityFloor` of 0.35. Edge
  triggering holds.

**Weapons, damage and effects** *(all nine weapons unless noted)*

- **Projectile tunneling** — 0 misses across 80 sub-tick phases each, up to Skewer's 46.7 u/tick
  against a 32u hull. The smear works.
- **Crossing target** — 0/41 lateral phases where a shot passed within 20u of a car crossing at
  540 u/s and dealt nothing. No ghost shots despite the target not being smeared.
- **Point-blank** — all nine weapons connected from **all 24 approach angles** with hulls in contact,
  and at every centre distance from 40u to 80u. The 24u muzzle offset never spawns a shot past its
  target.
- **Friendly fire and self-damage** — zero to teammates in team mode, zero to self, full damage to
  enemies, all nine weapons.
- **Damage after death** — hp never went negative, never moved after the wreck, and no bleed ticked a
  corpse.
- **Fire-rate exploit** — flooding 8 inputs/tick produced *exactly* the same shot count as 1/tick for
  all nine weapons over 10s. The cooldown, not the input cap, is doing the limiting.
- **Perma-CC** — two Hexagons spamming Shockwave for 30s held `stunned` on one car only 14% of the
  time; `reapply: "ignore"` holds. Sustained Afterburner held `overheated` 35%. The `maxActive` cap
  is unreachable by an attacker today, so no eviction exploit exists.
- **Shooting through level geometry** — 0 damage through a 200×200 block for all nine, including
  beams fired with the muzzle buried inside the wall (extent clipped to 0). The disc aura is the one
  documented exception (D1).
- **Aim-assist through a wall** — locked 0/120 ticks through the block, 120/120 in the open at the
  same range.
- **Instance leak** — 0 live instances and 0 schema rows after 600 ticks of firing plus 300 idle, all
  nine weapons.
- **Attached beam vs owner death** — 0 instance-ticks after the owner was wrecked.
- **Skewer pierce** — exactly 2 cars of 3 in a line, as R-spec'd.
- **Unbounded spin** — 400 ticks at the ram spin ceiling reached |angle| 80 rad (12.7 unwrapped
  turns) with no NaN anywhere. `@type("number")` tolerates it.

---

## Running it

```bash
npm run playtest        # all six offline probes -> packages/server/playtest/reports/<yyyy-MM-dd-NN>/
npm run playtest:lan    # the two-bot LAN run, against a server you started yourself
```

Full step-by-step, including the LAN server's environment variables and the shared-`dist` trap, is in
[`packages/server/playtest/README.md`](../../packages/server/playtest/README.md).

The numbers in this document come from run `2026-08-29-01`. Report folders are gitignored, so
reproduce them rather than looking for them in the repo.
