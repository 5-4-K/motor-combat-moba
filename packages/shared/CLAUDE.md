# `@motor-combat-moba/shared`

Lockstep constants, Colyseus schema, input types, config, the mode layer, and `stepSim`. Server and
client import this package's **built `dist`** — rebuild after editing.

**Local invariant:** only this package owns sim math. Do not duplicate `stepSim` or tick constants in
server/client.

This file describes the current state; history lives in the specs. Update facts in place.

## Layout

- `constants.ts` — `TICK_RATE_HZ`, `MS_PER_TICK`, `SNAPSHOT_RATE_HZ`, `MAX_PLAYERS`, `ROOM_NAME`,
  `PROTOCOL_VERSION`. Enums (`RoomPhase`, `GameMode`, `PlayerStatus`) have frozen uint8 values.
- `schema/` — `PlayerState`, `ArenaState`. Fields carry `@view` tags (`schema/view-tags.ts`'s
  `VIEW_OWNER`); a field a client may not always see must carry one, and **every wire change bumps
  `PROTOCOL_VERSION`**. See [`docs/schema-reference.md`](../../docs/schema-reference.md#what-each-client-receives).
- `net/` — pure, Phaser-free netcode so server, client and netsim run the same code:
  `TickInputBuffer`, `ClockSync`, `InputScheduler`, `TickPrediction`, `RemoteTimeline`, `ShotView`,
  `ProvisionalShots`, `isShotEnding`, `step-context.ts`, message validators. See
  [`docs/networking.md`](../../docs/networking.md).
- `vision/` — field-of-vision geometry and spectate rules, used by both the client's drawn cone and
  the server's `ViewManager`.
- `config/` — config TYPES and BASE values. `modes/` — per-mode assembly (below).
- `arena/` — arena defs, `boundsOf`, and `arena/tiles/` (`compileTileArena`, `TILE_DEFS`,
  `DEFAULT_LEGEND`).
- `sim/` — drive, contact, combat, damage, statuses, weapons.

## Configuration: `config/` owns types and base values, `modes/` owns assembly

`modes/base.ts` assembles `BASE_TABLES` from the `config/` globals (hull stripped from `drive`) —
the common defaults every mode reads unless it overrides them. Each mode folder (`modes/brawl/`,
`modes/team-brawl/`, `modes/deathmatch/`, `modes/conquer/`) holds exactly `config.ts` (a
`ModeOverrides`), `index.ts` (`<MODE>_TABLES = mergeTables(BASE_TABLES, <MODE>_OVERRIDES)`) and
`rules.ts`. `modes/last-standing/` holds the shared last-standing outcome.

- `modes/merge.ts`'s `mergeTables` merges plain objects key by key, replaces arrays/primitives
  whole, and throws at load naming the path for an override key the base lacks.
- `modes/build.ts`'s `assembleModeConfig` clones the merged tables, resolves the derived tick
  artifacts and deep-freezes the result.
- `modes/registry.ts`'s `MODE_TABLE` binds each `GameMode` to its bundle and `isActive`.
- `modes/active.ts` holds the installed bundle behind the accessors (`cars()`, `weapons()`,
  `drive()`, … `derived()`) and `cfg()`, which **throws outside a `withMode` scope** — there is
  deliberately no default-mode fallback. `withMode` is strictly synchronous and refuses a thenable;
  `installMode` (no restore, one per process) is for the client's boot and tests, never a server room.
- `modes/rules-registry.ts`, `modes/rules-types.ts` and each `rules.ts` are the shared third of the
  mode layer (`ModeRules`); the server's `ModeController` and the client's `ModeHud` are the others.

Guards: `modes/snapshots.test.ts` (each mode's resolved `ModeTables` in
`modes/__snapshots__/<slug>.tables.json`; accept a deliberate move with `vitest -u` scoped to the
moved file), `modes/no-raw-config-in-sim.test.ts` (no non-test file in shared, server, client or the
harnesses may read a raw table), `modes/invariants.test.ts` (every config invariant re-run per mode).
**Nothing may read an accessor at MODULE scope.** Adding a mode is the
[`game-mode`](../../.claude/skills/game-mode/SKILL.md) skill. Specs:
[per-mode config](../../docs/superpowers/specs/2026-09-22-per-mode-config-design.md) (MC1–MC42),
[mode layer](../../docs/superpowers/specs/2026-09-25-game-mode-layer-design.md) (GM1–GM40).

## Combat

- `sim/damage.ts` is the **only** place HP moves (`applyDamage`, `applyHeal` — clamped to `hpOf`,
  never lifting a dead car off 0) and, with `damageFor`/`scaleDamage`, the only place a hit's size is
  decided.
- `sim/combat.ts`'s `runCombat` is one pure tick of combat over POJOs. It runs *after* driving,
  never moves a car, and is server-only — the client draws its results and predicts none of them.
  Collision deals no damage.
- `sim/weapons/`: `shapes.ts` (shape → convex polygon, SAT, swept smear hull), `fire.ts` (the
  per-car fire state machine: slots, the three clocks, stocks, volley scheduling), `instances.ts`
  (projectile travel; beam grow/linger/wall-clip; expiry), `hits.ts` (pose-snapshot hits, per-target
  damage clocks, pierce), `targets.ts` (`canDamage`, the one friendly-fire predicate),
  `press.ts`, `turret.ts`, `impulse-source.ts`.
- Weapon config TYPES: `config/weapon-types.ts` (the `WeaponDef` union), `config/weapon-slots.ts`
  (`WeaponSlotConfig`, `slotsOf`), `config/weapon-ticks.ts` (`resolveTicks`, ms → ticks). The sim
  reads the active mode's VALUES: `weapons()`, `slots()`, `derived().weaponTicks`.
- **Volleys are on `WeaponBase`, pellets on the projectile.** `VolleyDef` (`volleys`,
  `volleyIntervalMs`) applies to every kind and `beginFire` reads it for all of them; `PelletDef`
  stays on `ProjectileWeaponDef` so a beam need not author `pelletsPerVolley: 1`. Live users:
  `shockwave` (three-ring disc beam, Taurus), `pepperbox` (3 pellets × 4 muzzles).
- `StatusApplication.onWave` (`"all" | "final"`, absent = `"all"`) gates a status on one wave. The
  wave is frozen at spawn and **never networked** (`ShotOrder.finalVolley` →
  `WeaponInstance.finalWave`). `"final"` is unused by any shipped row.
- An **aura** is a beam with a `disc` hitbox at `origin: "center"`; it reuses `WorldShape`'s circle
  arm and needs no `canDamage` change (that already refuses the owner). `magmablast`'s detonation is
  one: `instanceDefOf(id, true)` (`config/weapon-config.ts`) synthesizes a detached centre-origin
  disc beam from its `ExplosionDef`. That explosion is the only source of `corroded`.

## Statuses

`sim/status/`: `statuses.ts` (the `ActiveStatus` list: apply, expire, the two re-apply rules, pulses,
cleanse, wire validation) and `modifiers.ts` (`modifiersOf`, the one function that turns a status
list into multipliers). Types in `config/status-types.ts`, `config/status-config.ts`,
`config/status-ticks.ts`; the sim reads `statusTable()`, `statusConfig()`, `statusLimits()`,
`derived().statusPulseTicks`.

- **Every channel is a multiplier with 1 as neutral, and `Modifiers` is the only type that reaches
  the sim.** Driving, ramming and combat never look at a status list. `NEUTRAL_MODIFIERS` reproduces
  the status-free sim exactly (`golden.test.ts` pins it).
- **Flags.** `stunned` is `fullStop` plus `immobilised`/`steeringLocked`/`disarmed`; `fullStop`
  zeroes **both** velocity components every tick, so a slammed-then-stunned car stops where it
  stands. `armored` is `invulnerable`: 0 damage from every source, but status riders still land.
  Every flag-carrying DEBUFF must be `reapply: "ignore"`; a flag-carrying buff may `refresh` only by
  declaring `chainable: true` (`armored`, `phased`). `status-config.test.ts` polices both.
- **A status does not own its duration** — the applier does (`WeaponDef.applies`, the room's
  `statusRequests`, or `contactTick`: `reeling` to the victim off `RAM_CONFIG.ramUncontrolMs`
  scaled by falloff, `ramLock` to the attacker off `attackerLockMs`, unscaled). `applyStatus` takes
  explicit `durationTicks`. A status never stacks with itself; different statuses on one channel
  multiply.
- Order: expiry once per tick before driving; pulses first inside `runCombat`; new statuses are
  added at the end of the tick and take hold on the next. `PlayerState.statuses` is networked in full
  (`@view()`), because the client predicts through the same modifiers (invariant 8). See
  [`docs/combat-model.md`](../../docs/combat-model.md#statuses).

## Maneuvers and impulses

- `sim/maneuver.ts` declares `ManeuverKind` (NONE/DASH/HOLD/CHARGE, frozen uint8) and `NO_MANEUVER`.
- `sim/contact.ts`'s `resolveContacts` extends the ram pair loop with a dash (reports a `ContactHit`)
  and a charge (reports a `SlamEvent` with the OBB contact normal and point) ahead of the ordinary
  ram. **Only the ram fallback builds an `Impulse`**; a slam's push is assembled from the weapon's
  `ImpulseDef` in `packages/server/src/sim/ram-bridge.ts`, beside the statuses it applies.
- Live maneuvers: `thunderclap` (Mirage, dash) and `wildcharge` (Taurus, charge — the one
  `isUnInterruptable: true` row). `wildcharge.impulse` carries `speed`, `applies` (`reeling`),
  `onWallImpact` (`stunned`) and `retriggerImmunityMs`. `ImpulseDef.applies` is an
  `ImpulseStatusApplication[]`, so the row names the status, not code.
- A non-maneuver `impulse` (`tremor`, an inward radial pull) is applied once per victim per instance
  on its first damaging hit (`WeaponInstance.impulsedVictims`), reported on `CombatResult.impulses`.
- `config/impulse-config.ts`'s `IMPULSE_CONFIG` has two knobs: `wallContactPad` (hull inflation for
  "touching level geometry") and `spinScale` (the slam's spin calibration). See
  [`docs/combat-model.md`](../../docs/combat-model.md#maneuvers-and-the-contact-pass).

## Drive

**`stepDrive` does not read the roster.** It takes a resolved `ChassisDrive` (nine fields):
`maxSpeed` (emergent, `engineAccel / dragRate` — nothing clamps to it), `engineAccel`,
`reverseAccel`, `brakeDecel` (flat), `turnRate` (speed-independent; there is no at-rest rate),
`dragRate` (the per-second rate a status scales), `dragPerTick` (applied to the whole velocity),
`gripPerTick` (`DRIVE_CONFIG.lateralGripRate`, lateral component only — what survives is the drift)
and `spinPerTick`. Reverse top speed is emergent, `maxSpeed × reverseAccelFactor`.

**Ram spin reaches a car through `spinFree` alone.** Steering SETS `angVel` every tick, so injected
spin survives only while a status carries `spinFree` (`reeling`) or the car is in a HOLD; it then
decays by `spinPerTick` (`reelingSpinPerTick()`, from `RAM_CONFIG.reelingSpinDecayRate`). Outside that window the
next tick overwrites it — that is the model, not a bug. `docs/turn-tuning.md` tabulates both.

`driveOf(carId)` (`config/car-config.ts`) reads the active mode's `derived().chassisDrive`, resolved
once per mode by `assembleModeConfig`. `stepSim` calls it at the single production call site; every
other `stepDrive` caller is a test, so `golden.test.ts` and `drive.test.ts` pin the drive *equation*
against a frozen fixture and a rating retune can never look like an integration change.
(`CHASSIS_DRIVE` still exports shipped-roster values for a few tests; `driveOf` does not read it.)
