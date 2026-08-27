# `@motor-combat-moba/shared`

Lockstep constants, Colyseus schema, input types, and `stepSim`. Server and client import this package’s **built `dist`**.

**Local invariant:** only this package owns sim math. Do not duplicate `stepSim` or tick constants in server/client.

P0: `TICK_RATE_HZ` / `MS_PER_TICK` / `DEFAULT_PATCH_RATE_HZ` / `MAX_PLAYERS` / `ROOM_NAME`, enums (`RoomPhase`, `GameMode`, `PlayerStatus`), `PlayerState` / `ArenaState`, `INPUT_MESSAGE` + `InputMessage`, identity `stepSim`.

P5 combat: `sim/damage.ts` (`applyDamage` — the **only** HP writer), `sim/ram.ts` (facing rules), `sim/combat.ts` (`runCombat`, one pure tick of combat over POJOs). `runCombat` runs *after* driving, never moves a car, and is server-only — the client draws its results and predicts none of them.

Weapon system: `sim/weapons/` — `shapes.ts` (shape → convex polygon, SAT wrappers, the swept smear hull), `fire.ts` (the per-car fire state machine: slots, the three clocks, stocks, volley scheduling), `instances.ts` (projectile travel; beam grow/linger/wall-clip; expiry), `hits.ts` (pose-snapshot hit resolution, per-target damage clocks, pierce), `targets.ts` (`canDamage`, the one friendly-fire predicate weapons and ramming share). Config lives in `config/weapon-types.ts` (the `WeaponDef` discriminated union), `config/weapon-config.ts` (`WEAPON_TABLE`), `config/weapon-slots.ts` (`WEAPON_SLOT_CONFIG`, `slotsOf`), and `config/weapon-ticks.ts` (`WEAPON_TICKS`, the frozen ms→ticks table). `runCombat` stays the orchestrator; it shrank rather than grew. See [`docs/combat-model.md`](../../docs/combat-model.md) and [`docs/config-reference.md`](../../docs/config-reference.md).
