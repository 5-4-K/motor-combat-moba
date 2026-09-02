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
`immobilised`/`steeringLocked`/`disarmed` trio — engine, steering and trigger dead, and speed forced
to 0 every tick, though shove and injected ram spin still resolve, so a slammed-then-stunned car still
slides into the wall. `armored` is `invulnerable` alone: 0 damage from every source, weapon hits,
contact hits and pulses alike — status riders still land, only hp loss stops. A flag is boolean and
has no counterplay gradient, so every flag-carrying DEBUFF is required to be `reapply: "ignore"`,
and a flag-carrying buff may be `refresh` only by declaring `chainable: true` on its own row
(`status-config.test.ts` polices both, and that a chainable row is always a buff). `armored` and
`phased` are the two chainable rows today: a repeatedly-refreshed invulnerability is a risk owned by
whatever future applier grants it, the same way a stun's duty cycle is owned by its own applier's
cooldown rather than by this rule, and `phased` (spawn protection) must be extendable by the room
while a respawned car still overlaps someone.

**A status does not own its duration** — the applier does (`WeaponDef.applies`, or the room's
`statusRequests`), so `applyStatus` takes an explicit `durationTicks`. A status never stacks with
itself; different statuses on one channel stack by multiplication.

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
extends `applyRams`'s pair loop with a dash (reports a `ContactHit`, no knock) and a charge (a hard
slam — a fixed impulse, replacing the graded ram) ahead of the ordinary ram fallback, and runs where
`applyRams` used to. `config/slam-config.ts`'s `SLAM_CONFIG`/`SLAM_TICKS` tune the slam alone — knock
speed, victim authority, wall-stun window, re-slam immunity — kept separate from `RAM_CONFIG` because
a slam is deliberately not graded like a ram. **No longer dormant as of the 2026-09-01 weapon-status
overhaul (Plan 3):** `thunderclap` (Mirage) is a `kind: "maneuver"` dash and `wildcharge` (Bastion) is
a `kind: "maneuver"` charge, both real rows in `WEAPON_TABLE`, so `resolveContacts` and
`SLAM_CONFIG`/`SLAM_TICKS` now run from a real match, not only from tests. `wildcharge` is also the
roster's one `isUnInterruptable: true` row. See
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

**`stepDrive` does not read the roster.** It takes a resolved `ChassisDrive` — `maxSpeed`,
`reverseMaxSpeed`, `accel`, `reverseAccel`, `turnRate`, `turnRateAtStop` — from `driveOf(carId)`
(`config/car-config.ts`, frozen per car at module load in `CHASSIS_DRIVE`), and `stepSim` resolves it
at the single production call site. Every other caller of `stepDrive` here is a test, and that is the
point: `golden.test.ts` and `drive.test.ts` pin the drive *equation* against a frozen fixture, so a
per-car `accel` or `handling` retune can never look like a change to the integration. Balance still
lives in shared config; the sim receives it rather than reaching into `CAR_TABLE` for it.

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
