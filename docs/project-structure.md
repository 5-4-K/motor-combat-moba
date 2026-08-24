# Project structure (P0)

```
motor-combat-MOBA/
├── package.json                  # workspaces, npm run dev / build:release
├── tsconfig.base.json
├── .env.example
├── .nvmrc                        # 20
├── CLAUDE.md
├── README.md
├── scripts/
│   ├── build-release.mjs
│   └── build-release.test.mjs
├── packages/shared/src/
│   ├── index.ts
│   ├── constants.ts
│   ├── net/input.ts
│   ├── schema/PlayerState.ts
│   ├── schema/ArenaState.ts
│   ├── schema/schema.test.ts
│   ├── sim/step.ts
│   └── sim/step.test.ts
├── packages/server/src/
│   ├── index.ts
│   ├── mode.ts
│   ├── health.ts
│   ├── monitor.ts
│   ├── rooms/ArenaRoom.ts
│   ├── sim/tick.ts
│   ├── sim/tick.test.ts
│   ├── net/input-message.ts
│   ├── net/input-message.test.ts
│   ├── net/latency-injector.ts
│   └── net/latency-injector.test.ts
└── packages/client/
    ├── index.html
    └── src/
        ├── main.ts
        ├── config/client-mode.ts
        ├── config/client-mode.test.ts
        ├── net/connection.ts
        ├── net/prediction.ts
        ├── net/prediction.test.ts
        ├── net/interpolation.ts
        ├── net/interpolation.test.ts
        └── scenes/{Boot,Join,Arena}Scene.ts
```

Each package has `package.json`, `tsconfig.json`, `vitest.config.ts`. Server also has `tsup.config.ts`; client has `vite.config.ts`. Plans/spec live under `docs/superpowers/`.
