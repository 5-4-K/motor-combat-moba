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

**A status does not own its duration** — the applier does (`WeaponDef.applies`, or the room's
`statusRequests`), so `applyStatus` takes an explicit `durationTicks`. A status never stacks with
itself; different statuses on one channel stack by multiplication.

`applyDamage` is no longer the only HP writer — **`sim/damage.ts` is.** `applyHeal` sits beside it for
repair pulses, clamped to `hpOf` and refusing to lift a wreck off 0. Keeping the pair in one file is
what preserves the property the original rule protected.

Expiry runs once per tick, before driving; pulses run first inside `runCombat`; new statuses are only
ever added, at the far end of the tick, and take hold on the next one. `PlayerState.statuses` is
networked in full — unlike `FireState` and the lock, a status has no server-only half, because the
client predicts through the same modifiers (invariant 8). See
[`docs/combat-model.md`](../../docs/combat-model.md#statuses).

An **aura** is a beam with a `disc` hitbox at `origin: "center"`. It reuses `WorldShape`'s circle arm,
so the hit test needed no new geometry, and it needs no change to `canDamage` — that already refuses
the owner.
