# Architecture

npm workspaces: `@motor-combat-moba/shared`, `@motor-combat-moba/server`, `@motor-combat-moba/client`. TypeScript ESM. Colyseus `^0.18` + `@colyseus/schema` `^5` (`@colyseus/sdk` on the client). Phaser 4 + Vite 5. Node 22+.

One room: `ROOM_NAME` `"arena"`, class `ArenaRoom`, `maxClients = MAX_PLAYERS` (6); a second `arena` room is rejected with `4003` so LAN stays one room. Simulation interval uses `TICK_RATE_HZ` (60); snapshots go out at `SNAPSHOT_RATE_HZ` (60), broadcast by the room itself at the end of each snapshot tick (`patchRate = null`, `isSnapshotTick`).

**Server tick, in order.** `ArenaRoom.tick` advances `ArenaState.tick`, runs the phase machine (car-select deadline, countdown expiry), then calls `rooms/tick-pipeline.ts`'s `runPipeline` (shared by `ArenaRoom` and the dev-only `PlaygroundRoom`), which runs:

1. `serverTick(state, buffers, dt, phase, …)` — takes exactly one input per car for `state.tick` from its `TickInputBuffer` (the real tick-stamped frame, else the last one repeated, else neutral), steps living on-field cars through shared `stepSim` (drive, then collision resolve), writes `{x, y, angle}`, `ackRepeated` and the `inputSlack` statistics, and returns each session's new-press `fireSlots` bitmask from a *simulated* input.
2. `combatTick(dt, masks)` (also in `rooms/tick-pipeline.ts`) — maps `ArenaState` onto plain objects, runs shared `runCombat` (recharge, shots fired, shots flown, shots landed), writes HP / `alive` / per-slot weapon state and the live-instance map back, then ends the match when `livingSides` drops to one side or none.

Order is the rule, not an accident: combat reads the poses driving just produced. See [`combat-model.md`](combat-model.md).

**Client.** Boot → Join → Lobby → Car select → Arena → Results, routed by `bindViewRouter` off `PlayerState.status` and `ArenaState.phase`. `ArenaScene` runs on a clock-synced estimate of the server's tick, sends one tick-stamped `InputFrame` per server tick (`InputScheduler`), predicts the local car through the *same* `stepSim` (`TickPrediction`), reconciles against each snapshot's tick by replay, and interpolates remotes. Shots and HP are drawn from server state and never predicted. See [`networking.md`](networking.md).

`DEPLOY_MODE=lan` (default): Express serves `packages/client/dist`. Dev: Vite `:5173`, server `:2567` with `CLIENT_ORIGIN` CORS. Cloud mode is an env branch only — do not add hosting.
