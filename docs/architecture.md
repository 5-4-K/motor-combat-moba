# Architecture

npm workspaces: `@motor-arena/shared`, `@motor-arena/server`, `@motor-arena/client`. TypeScript ESM. Colyseus `^0.15` + `@colyseus/schema` `^2`. Phaser 3 + Vite 5. Node 20+.

One room: `ROOM_NAME` `"arena"`, class `ArenaRoom`, `maxClients = MAX_PLAYERS` (6); a second `arena` room is rejected with `4003` so LAN stays one room. Simulation interval uses `TICK_RATE_HZ` (30); patches use `DEFAULT_PATCH_RATE_HZ` (20).

**Server tick, in order.** `ArenaRoom.tick` advances `ArenaState.tick`, runs the phase machine (car-select deadline, countdown expiry), then:

1. `serverTick(state, queues, dt, phase)` — drains each session's input queue in `seq` order, steps living on-field cars through shared `stepSim` (drive, then collision resolve), writes `{x, y, angle}` and `lastProcessedInputSeq`, and returns the session ids that asked to fire on a *simulated* input.
2. `combatTick(dt, fired)` — maps `ArenaState` onto plain objects, runs shared `runCombat` (weapon cooldowns, shots fired, shots flown, shots landed, rams), writes HP / `alive` / `weaponCooldown` and the projectile map back, then ends the match when `livingSides` drops to one side or none.

Order is the rule, not an accident: combat reads the poses driving just produced. See [`combat-model.md`](combat-model.md).

**Client.** Boot → Join → Lobby → Car select → Arena → Results, routed by `bindViewRouter` off `PlayerState.status` and `ArenaState.phase`. `ArenaScene` emits one `InputMessage` per `MS_PER_TICK`, predicts the local car through the *same* `stepSim`, reconciles against each patch by replay, and interpolates remotes. Shots and HP are drawn from server state and never predicted. See [`networking.md`](networking.md).

`DEPLOY_MODE=lan` (default): Express serves `packages/client/dist`. Dev: Vite `:5173`, server `:2567` with `CLIENT_ORIGIN` CORS. Cloud mode is an env branch only — do not add hosting.
