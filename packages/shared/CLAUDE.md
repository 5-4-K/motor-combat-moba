# `@motor-combat-moba/shared`

Lockstep constants, Colyseus schema, input types, and `stepSim`. Server and client import this package’s **built `dist`**.

**Local invariant:** only this package owns sim math. Do not duplicate `stepSim` or tick constants in server/client.

P0: `TICK_RATE_HZ` / `MS_PER_TICK` / `DEFAULT_PATCH_RATE_HZ` / `MAX_PLAYERS` / `ROOM_NAME`, enums (`RoomPhase`, `GameMode`, `PlayerStatus`), `PlayerState` / `ArenaState`, `INPUT_MESSAGE` + `InputMessage`, identity `stepSim`.

P5 combat: `sim/damage.ts` (`applyDamage` — the **only** HP writer, and `damageFor`, the only place a hit's size is decided), `sim/combat.ts` (`runCombat`, one pure tick of combat over POJOs). `runCombat` runs *after* driving, never moves a car, and is server-only — the client draws its results and predicts none of them. Collision deals no damage.

Weapon system: `sim/weapons/` — `shapes.ts` (shape → convex polygon, SAT wrappers, the swept smear hull), `fire.ts` (the per-car fire state machine: slots, the three clocks, stocks, volley scheduling), `instances.ts` (projectile travel; beam grow/linger/wall-clip; expiry), `hits.ts` (pose-snapshot hit resolution, per-target damage clocks, pierce), `targets.ts` (`canDamage`, the one friendly-fire predicate). Config lives in `config/weapon-types.ts` (the `WeaponDef` discriminated union), `config/weapon-config.ts` (`WEAPON_TABLE`), `config/weapon-slots.ts` (`WEAPON_SLOT_CONFIG`, `slotsOf`), and `config/weapon-ticks.ts` (`WEAPON_TICKS`, the frozen ms→ticks table). `runCombat` stays the orchestrator; it shrank rather than grew. See [`docs/combat-model.md`](../../docs/combat-model.md) and [`docs/config-reference.md`](../../docs/config-reference.md).

Buffs and debuffs: `sim/effects/` — `effects.ts` (the `ActiveEffect` list: apply, expire, the three
stacking rules, wire validation) and `modifiers.ts` (`modifiersOf`, the one function that turns an
effect list into the multipliers the sim reads). Config lives in `config/effect-types.ts` (the
`EffectDef` shape, `EffectChannel`, `EffectFlag`), `config/effect-config.ts` (`EFFECT_TABLE`,
`EFFECT_CONFIG`, `EFFECT_LIMITS`) and `config/effect-ticks.ts` (`EFFECT_TICKS`, the frozen ms→ticks
table, sharing `msToTicks` with `weapon-ticks.ts`).

**Every channel is a multiplier with 1 as neutral, and `Modifiers` is the only type that reaches the
sim.** Driving, ramming and combat never look at an effect list — they read a `Modifiers`. That is
what makes adding an effect free and adding a channel a one-call-site change, and it is why
`NEUTRAL_MODIFIERS` reproduces the pre-effect sim exactly (`golden.test.ts` pins it). Expiry runs
once per tick, before driving; new effects are only ever added, at the far end of the tick, and take
hold on the next one. `PlayerState.effects` is networked in full — unlike `FireState` and the lock,
an effect has no server-only half, because the client predicts through the same modifiers
(invariant 8). See [`docs/combat-model.md`](../../docs/combat-model.md#buffs-and-debuffs).
