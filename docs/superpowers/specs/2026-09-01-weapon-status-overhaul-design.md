# Weapon and status overhaul — design

**Date:** 2026-09-01
**Status:** Approved in brainstorm; awaiting implementation plans
**Supersedes:** the weapon assignments in
[`2026-08-30-chassis-rename-and-weapon-redistribution-design.md`](2026-08-30-chassis-rename-and-weapon-redistribution-design.md)
(T1's type triangle and the chassis ratings stand; the kits do not) and the status roster in
[`2026-08-29-status-mechanism-design.md`](2026-08-29-status-mechanism-design.md) (the mechanism —
channels, `Modifiers`, re-apply, clamps, applier-owned durations — stands; the table does not).

## What this is

A full pass over the nine weapon slots and the status table, plus the sim mechanics the new roster
needs and does not have: aim-assist lead, per-weapon assist range, multi-muzzle fire, homing
projectiles, a dash, a bouncing projectile, a bar-shaped projectile, car maneuvers as sim state,
hard slam, and stun as a true interrupt. Timed detonation was considered and dropped from this pass
(O1): no shipped weapon uses it, and the project does not build mechanics nothing exercises.

Two long-standing rules are deliberately amended by this design, both explicitly chosen by the
project owner:

- **Contact can now deal hp** — but only through the two maneuver mechanics (Thunderclap's dash,
  Wild Charge's hard slam), each a weapon press with an owner, routed through `damageFor` /
  `scaleDamage` / `applyDamage` and gated by `canDamage` like any hit. Ordinary collision and
  ordinary ramming still deal zero hp. The doctrine "weapons are the only damage source" survives
  as "every point of damage is a weapon's, including the two that arrive through the hull".
- **A stun now cancels committed weapon states** (O14) — the old rule was "a press already
  committed still finishes". See Stun interruption below for the exact sweep and the
  `isUnInterruptable` escape hatch.

## Decisions

| # | Decision |
|---|---|
| O1 | Timed detonation is dropped from this pass. |
| O2 | Wild Charge ends at 10 s **or on the first slam landed**, whichever is first. One window: the charge state, its Fortified, and the slam threat begin and end together. |
| O3 | Wild Charge is exempt from the no-slam-on-stunned rule: it slams a stunned target, deals its damage, and ends. The rule exists to stop slam-chaining, and a one-hit charge cannot chain. |
| O4 | `overheated` becomes a pure burn: all three modifiers dropped, pulse 8 dmg / 400 ms added. The handling-debuff identity leaves the game. |
| O5 | `fortified` becomes pure damage reduction: `ramMass` 1.25 and the heal pulse are dropped. The game ships with no healing source. |
| O6 | `stunned` gains an instant full stop: speed zeroed on application. Ram spin and shove are untouched — a stunned car still tumbles when hit. |
| O7 | `armored` ("takes 0 damage") ships as a row with no applier, like `overhauled` — reachable through `statusRequests`, waiting on future weapons/pickups. Implemented as a new `invulnerable` flag, not a `damageTaken: 0` multiplier (the clamp floor is 0.4). |
| O8 | Stun interrupts running weapon states — pending fire, attached beams, maneuvers — unless the responsible weapon authors `isUnInterruptable: true`. Default false; `wildcharge` is the only true. |
| O9 | Pepperbox fires a 3-dart fan from each of four muzzles (0°, 90°, 180°, 270°): 12 darts per press. |
| O10 | Lance's beam becomes attached and sweeps: during its hold the car cannot translate but steers at the stopped-turn rate, sweeping the beam. |
| O11 | Predator freezes its locked target at fire time and tracks it for the homing duration wherever it goes; target death or timer end means straight flight. Fired with no lock, it never homes. |
| O12 | Thunderclap's dash ends at the first enemy contact (100 damage + 1 s stun to them) or at a wall; one target per dash. The car's own hull is the hit volume — no spawned instance. |
| O13 | Car-moving combat is server-authoritative now, structured for later prediction (arch decision C): maneuver state is networked `PlayerState` fields that `stepSim` integrates, so upgrading to client-predicted triggers is additive, never a redesign. |
| O14 | No stock refund on interruption: a windup cancelled by a stun has spent its press. Interruption is the stun's payoff. |
| O15 | Roadblock pierces everything (pierce 5 = max players − self): one bar can stun a whole line. |
| O16 | New Shockwave = fireball's flight profile (900 speed / 900 range, circle r12, assist on) with needler's damage **and cooldown** (22 dmg / 600 ms → needler's old 37 sustained DPS). |
| O17 | The four retired ids — `fireball`, `needler`, `skewer`, `bulwark` — leave `WeaponId` and `WEAPON_TABLE` entirely. `shockwave` is redefined, not retired. |
| O18 | The two hard-slam anti-pin guards (0.6 s per-target re-slam immunity; no slam on a stunned target) are built into the mechanic even though Wild Charge — exempt from one and ended-on-first-hit past the other — exercises neither. They exist for future slam sources, and the spec says so rather than pretending they are load-bearing today. |

## Mechanics

### Targeting: per-weapon assist range and lead

`WeaponBase` gains `aimRangeUnits`, required exactly when `usesAimAssist: true` (a test guard
enforces the pairing both ways). Every assisted row in this pass authors **400** — today's
`AIM_CONFIG.lockRange` — so behavior is identical until tuned. The ambient lock stays one per car:

- **Acquisition** uses the car's largest `aimRangeUnits` across its assisted weapons (a per-car
  derived constant, frozen at table build).
- **At fire time**, a weapon whose own `aimRangeUnits` is smaller than the current lock distance
  fires straight ahead instead. Invisible while every range is 400.
- The old guard "assisted weapon `range` ≥ `AIM_CONFIG.lockRange`" becomes "≥ its own
  `aimRangeUnits`".
- Thunderclap's dash distance reads this same field (its dash *is* its assist range).

**Lead.** When an assisted projectile fires at a lock, the fired angle solves first-order intercept:
target position plus target velocity × t, where t is flight time at the weapon's `speed`
(quadratic; no real solution, or a degenerate case, falls back to firing at the current position).
Computed once at the fire tick; the shot is still a frozen straight line. The muzzle stays the
physical nose (A11b unchanged); the HUD bracket is unchanged. Slow assisted shots gain the most —
Thumper at 450 u/s most of all.

### Multi-muzzle

`WeaponBase` gains `muzzles: readonly number[]` — degree offsets from the heading, default `[0]`.
`spawnInstances` loops muzzles × pellets (projectiles) or muzzles × 1 (beams); each muzzle's exit
point is the hull edge along its own direction and each fan/beam is centered on its muzzle
direction. Users: `pepperbox` `[0, 90, 180, 270]`, `afterburner` `[0, 180]` (two attached cones per
press, each its own instance with its own damage clock). Guard: more than one muzzle requires
`usesAimAssist: false` — a lock cannot steer four directions at once.

### Homing

`ProjectileWeaponDef` gains `homing?: { turnRateDegPerSec: number; durationMs: number }`. At spawn
the instance freezes the locked target's session id (server-only, never networked). Each tick while
the timer runs and the target lives, the server bends the instance's velocity toward the target's
current position, capped at the turn rate; afterwards it flies straight forever. Counterplay is the
turning circle: at Predator's proposed numbers (600 u/s, 120°/s) the circle is ~286 u radius —
Mirage and Bullseye corner inside it, Bastion mostly cannot, which fits the triangle. Guard:
`homing` requires `usesAimAssist: true` (homing without a lock source is meaningless — O11).

Client drawing needs nothing new: instances already patch `x/y/angle`, and constant-velocity
extrapolation between 20 Hz patches puts sub-pixel error on a curving shot.

### Bounce

Projectiles gain `bounce?: { lifetimeMs: number }`. A bouncing projectile reflects its velocity
across the surface normal on wall/obstacle/arena-edge contact instead of dying, and expires on its
lifetime clock rather than at `range` (`range` is ignored; author it equal to
`speed × lifetime` for the manual's reach figure). It still dies on damaging a car, subject to
pierce as usual. Guard: `bounce.lifetimeMs < cooldownMs`, so a second instance can never coexist
with the first — the property `thumper` is authored around.

### Bar hitbox

`ProjectileHitbox` gains `{ shape: "bar"; radiusAlong: number; radiusAcross: number }` — a thin
convex rectangle, long axis perpendicular to flight, travelling along its short axis. One more
polygon through the existing SAT + smear pipeline; no new hit-test math. Drawn as its hitbox like
everything else, so Roadblock renders with zero art.

### Maneuvers

One maneuver machine per car, beside the fire state machine. `PlayerState` gains a networked block
read by `stepSim` (invariant 8, per O13):

- `maneuver`: uint8 enum, explicit stable values — `0 NONE`, `1 DASH`, `2 HOLD`, `3 CHARGE`.
- `maneuverTicksLeft`: uint16.
- `maneuverAngle`: float32 (used by DASH).

A car is in at most one maneuver; a press that would start one while another runs is ignored (same
doctrine as the fire state machine). All three end early on wreck. The server writes the block;
`stepDrive` integrates it; client prediction picks the motion up from the patched fields exactly as
it does the ram knock today.

- **DASH** (Thunderclap): on a successful press, if a lock is held the heading snaps to the target
  direction, else the dash runs along the heading. For the dash ticks the car translates at
  `dashSpeed` along `maneuverAngle`, throttle and steer ignored; normal collision resolution still
  runs. First enemy hull contact → the weapon's damage + its `applies` (1 s stun) to that one car,
  dash ends, the dasher's speed is set to its chassis top speed (exit driving, not frozen). Wall
  contact ends the dash. Teammates take no damage (`canDamage`) but are shoved by ordinary
  resolution as always.
- **HOLD** (Lance): set for windup + beam growth + linger. Translation zeroed at hold start;
  steering works at the stopped-turn rate, sweeping the attached beam. Ends on schedule or by stun.
- **CHARGE** (Wild Charge): set for 10 s. Driving is completely normal — the maneuver arms the
  hard-slam contact rule and the visual state, nothing else. Ends at 10 s or on the first slam
  (O2); ending it also expires the statuses it applied (statuses already carry `source`; a small
  helper expires all statuses from a given source).

### Hard slam

Runs in the contact pass (the pure step behind `ramTick`, extended): on fresh enemy hull contact
where the attacker is in CHARGE, the normal ram is **replaced** by a slam:

- A **fixed** knock impulse — `SLAM_CONFIG.knockSpeed`, proposed 520 (2× `RAM_CONFIG.knockMaxSpeed`)
  — independent of mass, speed, side, and angle. Delivered through the same shove/spin/authority
  fields a ram uses, so decay and countersteer behave identically.
- Reduced self-cost: the attacker's collision rebound is scaled by `SLAM_CONFIG.selfSlowFactor`,
  proposed 0.3 (keep 70% more speed than a normal collision would leave).
- The weapon's damage (250 base; 230 on Bastion's 0.92×), through `damageFor` / `scaleDamage` /
  `applyDamage`, gated by `canDamage`.
- Charge end (O2), which also expires the self Fortified.
- **Wall stun:** if the victim contacts a wall or obstacle within `SLAM_CONFIG.wallStunWindowMs`
  of the slam (proposed 500 ms — roughly while the slam shove is still strong), they are stunned
  for 500 ms.
- Anti-pin guards per O18: a per-victim re-slam immunity of `SLAM_CONFIG.reslamImmunityMs`
  (proposed 600 ms, playtest to tune) and no slam on a stunned victim — with Wild Charge exempt
  from the latter (O3) and ended by its first slam regardless. Neither is exercised by this roster;
  both are config for future slam sources.

### Stun interruption

Applying `stunned` to a car now, beyond the three existing flags:

1. Zeroes forward speed (O6). Shove and spin are untouched.
2. Cancels the pending fire state (windup or remaining volleys). No stock refund (O14).
3. Kills the car's **attached** beam instances. Detached beams and projectiles in flight are
   committed shots and persist, exactly as they do when their owner is wrecked.
4. Ends the car's maneuver.

Each of 2–4 is skipped when the responsible weapon authors `isUnInterruptable: true` (`WeaponBase`,
default false; only `wildcharge` sets it — a stunned charging Bastion stops dead but keeps the
charge, O8). Wrecking ends everything regardless of the flag.

## The status table

| Status | Kind | Effect | Re-apply | Change from today |
|---|---|---|---|---|
| `overheated` | debuff | pulse 8 dmg / 400 ms (20 hp/s) | refresh | modifiers dropped; pulse added (O4) |
| `corroded` | debuff | damageTaken 1.3 | refresh | unchanged effect; applier changes |
| `stunned` | debuff | full stop + `immobilised`, `steeringLocked`, `disarmed` + interrupt sweep | ignore | instant stop (O6) + interruption (O8) |
| `spiked` | debuff | topSpeed 0.6 | refresh | 0.82 → 0.6; pulse dropped |
| `fortified` | buff | damageTaken 0.7 | refresh | ramMass and heal dropped (O5) |
| `overhauled` | buff | cleanse all debuffs, no hp restored | ignore | unchanged; still the pickup row |
| `armored` | buff | new `invulnerable` flag: takes 0 damage | refresh | **new row**, no applier yet (O7) |

Appliers and durations (the applier owns the duration, unchanged doctrine):

| Status | Applied by | Duration |
|---|---|---|
| `overheated` | `afterburner` | 1500 ms |
| `corroded` | `predator` | 2000 ms |
| `stunned` | `roadblock` | 1000 ms |
| `stunned` | `thunderclap` | 1000 ms |
| `stunned` | hard-slam wall impact | 500 ms |
| `spiked` | `thumper` | 3000 ms |
| `fortified` | `wildcharge`, self | 10000 ms, ended early with the charge (O2) |
| `overhauled`, `armored` | nothing yet | — |

Notes:

- `armored` breaks the "flag rows must be `reapply: ignore`" test rule; the rule gets a documented
  carve-out for it. A repeatedly-refreshed invulnerability is a real design risk — it is the future
  applier's to own, the same way stun duty cycle is `thumper`'s old lesson.
- `spiked` at 0.6 sits above `STATUS_LIMITS.topSpeed.min` (0.5).
- With `fortified`'s pulse gone the game has no healing. `applyHeal` stays in `sim/damage.ts`,
  tested and unused, for pickups.
- The turn-tuning doc loses `overheated`'s `turnRate` row — same commit as the table edit
  (`docs/turn-tuning.md` is hand-maintained and its test will fail until it agrees).

## The roster

⚙ marks first-pass numbers expected to be retuned from play. Shapes and slot assignments are
settled; ⚙ numbers are not commitments.

| Chassis / slot | Weapon | Kind | Numbers | Assist | Applies |
|---|---|---|---|---|---|
| Bullseye 1 | `shockwave` | projectile | 22 dmg, 900 u/s, 900 range, cd 600 ms, circle r12 | ON, 400 | — |
| Bullseye 2 | `pepperbox` | projectile | 45 dmg/dart, 800 u/s, 600 range, cd 1800 ms, muzzles ×4, 3-dart 12° fan each, ellipse 9×3 darts | OFF | — |
| Bullseye 3 | `lance` | beam, attached, HOLD | 170 dmg, 1200 range, windup 700 ms, lifetime 1500 ms, cd 16000 ms | OFF | — |
| Mirage 1 | `predator` | projectile, homing | 50 dmg, ⚙600 u/s, ⚙900 range, cd 2000 ms, capsule 14×6, homing ⚙120°/s × ⚙1200 ms | ON, 400 | corroded 2 s |
| Mirage 2 | `thunderclap` | maneuver: dash | 100 dmg, dash 400 u @ ⚙1600 u/s, cd ⚙5000 ms | ON, 400 | stunned 1 s |
| Mirage 3 | `afterburner` | beam, attached | as today + muzzles [0°, 180°] | OFF | overheated 1.5 s |
| Bastion 1 | `thumper` | projectile, bouncing | 60 dmg, 450 u/s, capsule 24×15, cd 3000 ms, lifespan ⚙2900 ms | ON, 400 | spiked 3 s |
| Bastion 2 | `roadblock` | projectile, bar | 100 dmg, bar 120×12, ⚙600 u/s, ⚙500 range, pierce 5, cd ⚙6000 ms | ⚙OFF | stunned 1 s |
| Bastion 3 | `wildcharge` | maneuver: charge | 250 contact dmg, 10 s duration, cd ⚙20000 ms, `isUnInterruptable` | OFF | fortified (self), charge window |

- `WeaponDef` grows a third kind: `{ kind: "maneuver"; maneuver: "dash" | "charge"; ... }`. It
  spawns no instance; `damage` is its contact damage, `applies` rides its contact, `cooldownMs` /
  `recoveryMs` / the fire state machine treat the press like any other. Guard: a maneuver row's
  active duration must be shorter than its `cooldownMs`.
- Colors keep the chassis theming by inheritance from the retired rows: `shockwave` → needler's
  `#22579E`, `predator` → fireball's `#D63A14`, `thunderclap` → old shockwave's `#7A1D1D`,
  `roadblock` → skewer's `#C89A14`, `wildcharge` → bulwark's `#D9A814`.
- Art: retired ids come off the manifest. The existing `shockwave` icon depicts the retired aura —
  owner to re-import or accept the procedural fallback; the four new ids start on procedural
  fallbacks.
- Roster-level consequences, named rather than discovered later: Bullseye still applies no status;
  Mirage becomes a stun chassis (Thunderclap); nothing heals; the aura machinery (`disc` hitbox,
  `origin: "center"`, multi-wave volleys, `onWave: "final"`) loses its only user and goes dormant —
  code and tests stay, the spec records the dormancy.

## Client

- Shots draw as their hitboxes, so the bar, the 12-dart spray, the rear cone, and the sweeping
  lance render with no new art.
- **Wild Charge state visual:** a clearly visible distinct-colored outline drawn around the hull
  (the cheap option the owner chose over a glow), driven off the networked maneuver state so every
  client — spectators included — sees it.
- A render-only dash streak for Thunderclap.
- The cars & weapons guide needs a full rebuild **and new prose** in
  `scripts/cars-and-weapons-copy.mjs` for four new weapons and every changed row. A real writing
  task in the plan, not just `npm run build:manual`.

## Tests and guardrails

- Rewrite the table-pinned tests: `weapon-config.test.ts` (fireball digit-pin and friends),
  `weapon-ticks.test.ts`, `fire.test.ts`'s table-driven blocks, `combat.test.ts` fixtures.
- Aim-cliff guard becomes per-weapon and keeps working (600 ms Shockwave is 33% clear of 1.25 Hz).
- New guards: `aimRangeUnits` present iff `usesAimAssist`; assisted `range` ≥ own `aimRangeUnits`;
  `muzzles.length > 1` ⇒ assist off; `homing` ⇒ assist on; maneuver duration < cooldown;
  `bounce.lifetimeMs` < cooldown; flag-status rows `ignore` except the documented `armored`
  carve-out.
- `golden.test.ts` and `scripts/turn-tuning-doc.test.mjs` must pass **unchanged** except for
  deleting `overheated`'s row from the turn-tuning page — nothing here touches `DRIVE_CONFIG`,
  chassis ratings, or existing `RAM_CONFIG` values. Either failing otherwise is an implementation
  bug.
- `npm run ttk` needs its kit model updated to run at all, and cannot model dash damage, slam
  damage, or homing accuracy — its output will understate Mirage and Bastion. Say so in its header.
- **Playtest probes:** this pass moves nearly everything they measure. The W7 stun-duty-cycle
  probe's subject no longer stuns; reach probes name four deleted ids; ram probes predate slams.
  Compile breaks get fixed on the spot (per project policy); stale expectations get flagged loudly
  in implementation summaries and updated only on request. A `npm run playtest` after landing is
  strongly recommended — `reslamImmunityMs` in particular is explicitly a playtest-tuned number.

## Sequencing

One spec, three implementation plans, executed in order, game shippable between each:

1. **Mechanics** — targeting (lead, per-weapon range), muzzles, homing, bounce, bar, the maneuver
   block, hard slam, stun interruption. All landable behind the existing roster with unit tests;
   no player-visible change.
2. **Status table** — the seven rows, `invulnerable`, instant stop, the interrupt sweep wiring.
3. **Roster cutover** — the nine rows, id deletions, guide rebuild + prose, Wild Charge outline,
   dash streak, art manifest cleanup. The only stage players can see.

## Future work

- Client prediction of maneuver triggers (arch decision B) — the deferred half of O13, for online
  play at 80–130 ms RTT. The maneuver block is already sim-native; the upgrade adds client-side
  press prediction and misprediction reconciliation, no redesign.
- Appliers for `armored` and `overhauled` (pickups or future weapons).
- Per-slot lock split, if per-weapon `aimRangeUnits` ever diverge enough that the max-range
  acquisition region misleads.
- A future slam source that actually exercises the O18 anti-pin guards.
