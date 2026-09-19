# `@motor-combat-moba/shared`

Lockstep constants, Colyseus schema, input types, and `stepSim`. Server and client import this package’s **built `dist`**.

**Local invariant:** only this package owns sim math. Do not duplicate `stepSim` or tick constants in server/client.

P0: `TICK_RATE_HZ` / `MS_PER_TICK` / `DEFAULT_PATCH_RATE_HZ` / `MAX_PLAYERS` / `ROOM_NAME`, enums (`RoomPhase`, `GameMode`, `PlayerStatus`), `PlayerState` / `ArenaState`, `INPUT_MESSAGE` + `InputMessage`, identity `stepSim`.

P5 combat: `sim/damage.ts` (the **only** place hp moves — `applyDamage` and `applyHeal` — plus `damageFor` and `scaleDamage`, the only places a hit's size is decided), `sim/combat.ts` (`runCombat`, one pure tick of combat over POJOs). `runCombat` runs *after* driving, never moves a car, and is server-only — the client draws its results and predicts none of them. Collision deals no damage.

Weapon system: `sim/weapons/` — `shapes.ts` (shape → convex polygon, SAT wrappers, the swept smear hull), `fire.ts` (the per-car fire state machine: slots, the three clocks, stocks, volley scheduling), `instances.ts` (projectile travel; beam grow/linger/wall-clip; expiry), `hits.ts` (pose-snapshot hit resolution, per-target damage clocks, pierce), `targets.ts` (`canDamage`, the one friendly-fire predicate). Config lives in `config/weapon-types.ts` (the `WeaponDef` discriminated union), `config/weapon-config.ts` (`WEAPON_TABLE`), `config/weapon-slots.ts` (`WEAPON_SLOT_CONFIG`, `slotsOf`), and `config/weapon-ticks.ts` (`WEAPON_TICKS`, the frozen ms→ticks table). `runCombat` stays the orchestrator; it shrank rather than grew. See [`docs/combat-model.md`](../../docs/combat-model.md) and [`docs/config-reference.md`](../../docs/config-reference.md).

Statuses (buffs and debuffs): `sim/status/` — `statuses.ts` (the `ActiveStatus` list: apply, expire,
the two re-apply rules, pulses, cleanse, wire validation) and `modifiers.ts` (`modifiersOf`, the one
function that turns a status list into the multipliers the sim reads). Config lives in
`config/status-types.ts` (the `StatusDef` shape, `StatusChannel`, `StatusFlag`, `StatusPulse`),
`config/status-config.ts` (`STATUS_TABLE`, `STATUS_CONFIG`, `STATUS_LIMITS`) and
`config/status-ticks.ts` (`STATUS_PULSE_TICKS`, sharing `msToTicks` with `weapon-ticks.ts`).

**Every channel is a multiplier with 1 as neutral, and `Modifiers` is the only type that reaches the
sim.** Driving, ramming and combat never look at a status list — they read a `Modifiers`. That is what
makes adding a status free and adding a channel a one-call-site change, and why `NEUTRAL_MODIFIERS`
reproduces the pre-status sim exactly (`golden.test.ts` pins it).

Two rows carry flags rather than modifiers. `stunned` is `fullStop` on top of the older
`immobilised`/`steeringLocked`/`disarmed` trio — engine, steering and trigger dead. **`fullStop` now
zeroes BOTH velocity components every tick, forward and lateral, and that is a real combat-feel
change the 2026-09-18 Unity drive-model port made**: it used to zero the forward component alone and
leave an imposed sideways velocity to bleed off through `bleedLateral`, so a slammed-then-stunned car
kept sliding into the wall. It does not any more — a stunned car pushed sideways by a slam stops dead
where it stands. (`bleedLateral` and `DRIVE_CONFIG.impactGripDecel` are both deleted; one grip model
covers the whole car now.) Injected ram spin is a separate story with a rule of its own — see the
`angVel` note under `stepDrive` below. `armored` is `invulnerable` alone: 0 damage from every source, weapon hits,
contact hits and pulses alike — status riders still land, only hp loss stops. A flag is boolean and
has no counterplay gradient, so every flag-carrying DEBUFF is required to be `reapply: "ignore"`,
and a flag-carrying buff may be `refresh` only by declaring `chainable: true` on its own row
(`status-config.test.ts` polices both, and that a chainable row is always a buff). `armored` and
`phased` are the two chainable rows today: a repeatedly-refreshed invulnerability is a risk owned by
whatever future applier grants it, the same way a stun's duty cycle is owned by its own applier's
cooldown rather than by this rule, and `phased` (spawn protection) must be extendable by the room
while a respawned car still overlaps someone.

**A status does not own its duration** — the applier does (`WeaponDef.applies`, the room's
`statusRequests`, or `contactTick`, which applies two statuses of its own off a ram: `reeling` to
the victim off `RAM_CONFIG.ramUncontrolMs`, scaled by that victim's falloff, and — since the
2026-09-18 Unity ram port — `ramLock` to the attacker off `RAM_CONFIG.attackerLockMs`, unscaled,
since falloff is ram-victim-only), so `applyStatus` takes an explicit `durationTicks`. A status
never stacks with itself; different statuses on one channel stack by multiplication.

`applyDamage` is no longer the only HP writer — **`sim/damage.ts` is.** `applyHeal` sits beside it for
repair pulses, clamped to `hpOf` and refusing to lift a dead car off 0. Keeping the pair in one file is
what preserves the property the original rule protected.

Expiry runs once per tick, before driving; pulses run first inside `runCombat`; new statuses are only
ever added, at the far end of the tick, and take hold on the next one. `PlayerState.statuses` is
networked in full — unlike `FireState` and the lock, a status has no server-only half, because the
client predicts through the same modifiers (invariant 8). See
[`docs/combat-model.md`](../../docs/combat-model.md#statuses).

**Maneuvers (spec S3) own three files.** `sim/maneuver.ts` declares `ManeuverKind`
(NONE/DASH/HOLD/CHARGE, frozen uint8 values) and `NO_MANEUVER`, the four-field neutral spread used to
reset a car. `sim/contact.ts`'s `resolveContacts` is where a maneuver actually does something: it
extends `applyRams`'s pair loop with a dash (reports a `ContactHit`) and a charge (reports a
`SlamEvent` carrying the OBB contact normal and contact point) ahead of the ordinary ram fallback,
and runs where `applyRams` used to. **Neither of those two builds an `Impulse` — only the ram
fallback does.** A slam's push is assembled from the weapon's own `ImpulseDef` in
`packages/server/src/sim/ram-bridge.ts`, beside the statuses that same slam applies (spec P30), which
is what stage 4 of the 2026-09-06 car-physics rework moved and why `contact.ts` got smaller.

**`config/impulse-config.ts`'s `IMPULSE_CONFIG` — renamed from `SLAM_CONFIG` on 2026-09-19, because
neither member turned out to be slam-specific — is two knobs now: `wallContactPad`, a hull inflation
for "is this touching level geometry", and `spinScale`, the slam's own spin calibration, moved here
once a real lever arm made it live (see `ImpulseDef.spin` below).** `knockSpeed`, `wallStunWindowMs`,
`wallStunDurationMs`, `reslamImmunityMs`, `victimAuthority`, `selfKeepFactor` and the whole
`SLAM_TICKS` export were **deleted in stage 4**: the first four moved onto
`WEAPON_TABLE.wildcharge.impulse` (as `speed`, `onWallImpact.windowMs` and its `applies[].durationMs`,
`retriggerImmunityMs`), `victimAuthority`'s successor is that row's own `applies` entry for
`"reeling"` — its `durationMs` is a real `reeling` application, so a slam finally imposes control
loss where before it imposed none — and `selfKeepFactor` has no successor at all, because a slam's
attacker is simply never pushed. (`applies` itself is a 2026-09-19 restructure: the field used to be
a bare `uncontrolMs: number` with `ram-bridge.ts` supplying the status id `"reeling"` in code — the
one place a weapon's effect was decided outside its own row. It is now `ImpulseStatusApplication[]`,
so a row declares which status as well as how long.)
`RAM_CONFIG`'s five equivalents (`authorityFloor`, the two `authority` decay knobs, and the two
`shove` ones) had already gone the same way in stage 3b; an ordinary ram's control loss **came back
in stage 3b as the `reeling` status**, applied by `contactTick` and scaled by a per-victim
diminishing-returns stack that a slam deliberately does not share. **No longer dormant as of the
2026-09-01 weapon-status overhaul (Plan 3):** `thunderclap` (Mirage) is a `kind: "maneuver"` dash and
`wildcharge` (Bastion) is a `kind: "maneuver"` charge, both real rows in `WEAPON_TABLE`, so
`resolveContacts` and the slam path now run from a real match, not only from tests. `wildcharge` is
also the roster's one `isUnInterruptable: true` row, and the only row in the table declaring an
`impulse` at all. See
[`docs/combat-model.md`](../../docs/combat-model.md#maneuvers-and-the-contact-pass).

An **aura** is a beam with a `disc` hitbox at `origin: "center"`. It reuses `WorldShape`'s circle arm,
so the hit test needed no new geometry, and it needs no change to `canDamage` — that already refuses
the owner. `shockwave` shipped as the one aura, on the old Mirage slot 2, but the 2026-09-01 overhaul
gave it a plain single-volley-dart identity on **Bullseye's** slot 1 instead — later renamed
`magmablast` alongside its display name. From there the mechanism sat **dormant** for one release:
the geometry and hit-test path stayed live and covered by generic unit tests with no row driving
them. **The 2026-09-02 predator/magmablast pass ended that.** `magmablast` (now on **Mirage's** slot
1, swapped with `predator`) authors an `ExplosionDef`: on death for any reason, `instanceDefOf(id,
true)` (`config/weapon-config.ts`) synthesizes a detached, centre-origin `disc`-hitbox `BeamWeaponDef`
from it, so a real aura instance spawns on every detonation. `corroded`'s only source in the game is
this explosion. What is still dormant is narrower now: only the multi-wave `VolleyDef` machinery
below, since no row — this one included — authors more than one volley.

**`stepDrive` does not read the roster.** It takes a resolved `ChassisDrive` — **nine** fields as of
the 2026-09-18 Unity drive-model port: `maxSpeed` (emergent, `engineAccel / dragRate` — nothing
clamps to it), `engineAccel`, `reverseAccel`, `brakeDecel` (flat deceleration while braking, resolved
from `CarDef.brakeDecel`), `turnRate` (speed-independent), `dragRate` (the authored per-second rate,
which is what a status scales), `dragPerTick` (what an unmodified tick multiplies the WHOLE velocity
by), `gripPerTick` (`DRIVE_CONFIG.lateralGripRate` per tick, applied to the lateral component alone —
whatever survives it is the drift) and `spinPerTick`. **`reverseMaxSpeed`, `accel`, `turnRateAtStop`
and `coastPerTick` are gone**, along with `CarDef.coastHalfLifeSeconds`: yaw is speed-independent so
there is no at-rest rate, reverse top speed is the emergent `maxSpeed × reverseAccelFactor`, and one
always-on drag rate sets top speed, wind-up and roll together in place of a separate coast curve.

**`spinPerTick` is a real decay, and ram spin reaches the car through `spinFree` alone.** The Unity
ram port's stage 3 set `RAM_CONFIG.reelingSpinDecayRate` to 2.0/s and `spinPerTick` to
`reelingSpinPerTick()` — `perTickDecay(2.0)` ≈ 0.9355 per tick at 30 Hz — replacing stage 1's
identity placeholder, and put `spinFree` on `reeling`'s flags. Steering SETS `angVel` every tick
(U16), so an injected spin survives only while a status carries `spinFree` (`reeling`, for
`RAM_CONFIG.ramUncontrolMs`) or the car is in a HOLD; outside that window the next ordinary tick
overwrites it, which is the model rather than a bug. `docs/turn-tuning.md` tabulates both the knob
and the per-tick factor, and its doc test recomputes them.

The resolved fields come from `driveOf(carId)` (`config/car-config.ts`, frozen per car at module load in `CHASSIS_DRIVE`), and
`stepSim` resolves it at the single production call site. Every other caller of `stepDrive` here is
a test, and that is the point: `golden.test.ts` and `drive.test.ts` pin the drive *equation* against
a frozen fixture, so a per-car `accel` or `handling` retune can never look like a change to the
integration. Balance still lives in shared config; the sim receives it rather than reaching into
`CAR_TABLE` for it.

**Volleys are on `WeaponBase`, pellets are on the projectile.** `VolleyDef` (`volleys`,
`volleyIntervalMs`) applies to both kinds, so a beam can be a wave sequence in principle — the old
`shockwave` shipped that way, three aura instances 500 ms apart, each with its own `spawnTick` and its
own damage clock. As of the 2026-09-01 overhaul no row in `WEAPON_TABLE` authors more than one volley,
including `magmablast`'s revived aura explosion: multi-wave is **dormant machinery**, unlike the aura
mechanism above, which a real weapon drives again. `PelletDef` (`pelletsPerVolley`,
`spreadAngleDeg`) stays on `ProjectileWeaponDef`, because a beam should not have to author
`pelletsPerVolley: 1`; `pepperbox` is the shipped multi-pellet row today (3 pellets × 4 muzzles).
`beginFire` reads `def.volley.volleys` for every kind rather than hardcoding 1 for beams.

`StatusApplication.onWave` (`"all" | "final"`, absent means `"all"`) gates a status on one wave of a
multi-wave press. The wave is frozen at spawn and **never networked**: `ShotOrder.finalVolley` →
`WeaponInstance.finalWave` → the two status-application helpers in `sim/combat.ts`. No schema field
was added; invariant 8 holds because nothing new that `stepSim` reads crosses the wire. Like
multi-wave volleys above, `onWave` is **dormant machinery** since the 2026-09-01
overhaul: no shipped `applies` entry sets it, including `magmablast`'s explosion, so every current
status application runs as `"all"`.
