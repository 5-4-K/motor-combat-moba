# `@motor-combat-moba/server`

Authority: Express + Colyseus, `ArenaRoom`, 30 Hz `serverTick` that drains input queues into shared `stepSim`. Serves client `dist` in LAN mode. Health `GET /health`, monitor `/colyseus`.

**Local invariant:** never trust client poses. Apply validated `InputMessage`s only; write `{x, y, angle}` from `stepSim`.

`ArenaRoom.tick` is statuses-then-drive-then-ram-then-combat: `statusTick` (sweeps expired statuses and returns the tick's per-player `Modifiers`), `serverTick` (returns each session's `fireSlots` bitmask), `ramTick`, then `combatTick`. Statuses go first so no two phases disagree about whether a car is slowed; `sim/status-bridge.ts` is the only file that maps `PlayerState.statuses` onto the sim and back, and holds no rules. Unlike the other two bridges it owns no room memory — a status has no server-only half, because the client predicts through the same modifiers. Combat rules live in shared `runCombat`; `sim/combat-bridge.ts` is the only file that maps `ArenaState` onto it and back, and holds no rules. Per-player `FireState` (slots, clocks, pending burst), and the weapon-instance id counter and `damageClock`/`pierceLeft` bookkeeping are deliberately **server-only** state, never schema fields — see `CombatMemory` in `combat-bridge.ts`.

**Build order matters here.** `tsup` inlines `@motor-combat-moba/shared`'s built `dist` into `dist/index.js`, so shared must be built first. Use root `npm run build` (shared → server → client), never `npm run build --workspaces`, which does not guarantee that order. A stale bundle runs the previous sim while every unit test passes, because tests import `src`.
