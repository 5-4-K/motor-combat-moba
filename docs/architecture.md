# Architecture (P0 walking skeleton)

npm workspaces: `@motor-arena/shared`, `@motor-arena/server`, `@motor-arena/client`. TypeScript ESM. Colyseus `^0.15` + `@colyseus/schema` `^2`. Phaser 3 + Vite 5. Node 20+.

One room: `ROOM_NAME` `"arena"`, class `ArenaRoom`, `maxClients = MAX_PLAYERS` (6). Simulation interval uses `TICK_RATE_HZ` (30); patches use `DEFAULT_PATCH_RATE_HZ` (20). Shared `stepSim` is identity — poses do not move.

Server `serverTick(state, queues, dt)` drains per-session input queues and writes `{x, y, angle}` plus `lastProcessedInputSeq`. Client joins via `joinOrCreate`, draws green (self) / red (others) squares, camera follows local.

`DEPLOY_MODE=lan` (default): Express serves `packages/client/dist`. Dev: Vite `:5173`, server `:2567` with `CLIENT_ORIGIN` CORS. Cloud mode is an env branch only — do not add hosting.
