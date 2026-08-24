# `@motor-arena/server`

Authority: Express + Colyseus, `ArenaRoom`, 30 Hz `serverTick` that drains input queues into shared `stepSim`. Serves client `dist` in LAN mode. Health `GET /health`, monitor `/colyseus`.

**Local invariant:** never trust client poses. Apply validated `InputMessage`s only; write `{x, y, angle}` from `stepSim`.

`ArenaRoom.tick` is drive-then-combat: `serverTick` (returns who fired) then `combatTick`. Combat rules live in shared `runCombat`; `sim/combat-bridge.ts` is the only file that maps `ArenaState` onto it and back, and holds no rules. Ram pair cooldowns and the projectile id counter are deliberately **server-only** state, never schema fields.
