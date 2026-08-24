# `@motor-arena/server`

Authority: Express + Colyseus, `ArenaRoom`, 30 Hz `serverTick` that drains input queues into shared `stepSim`. Serves client `dist` in LAN mode. Health `GET /health`, monitor `/colyseus`.

**Local invariant:** never trust client poses. Apply validated `InputMessage`s only; write `{x, y, angle}` from `stepSim`.
