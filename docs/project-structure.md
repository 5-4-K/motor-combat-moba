# Project structure

Source files only — `*.test.ts` sits beside the file it tests and is left out below. Each package has
`package.json`, `tsconfig.json`, `vitest.config.ts`. Server also has `tsup.config.ts`; client has
`vite.config.ts`. Plans and the spec live under `docs/superpowers/`.

```
motor-combat-MOBA/
├── package.json                  # workspaces, npm run dev / build:release
├── tsconfig.base.json
├── .env.example
├── .nvmrc                        # 20
├── CLAUDE.md
├── README.md
├── scripts/build-release.mjs
├── packages/shared/src/
│   ├── index.ts                  # the package's whole public surface
│   ├── constants.ts              # TICK_RATE_HZ, enums, MAX_PLAYERS
│   ├── config/                   # car, color, weapon, combat, drive/camera, flow, net tables
│   ├── schema/                   # PlayerState, ProjectileState, ArenaState
│   ├── arena/                    # ArenaDef types, arena-01, registry
│   ├── net/                      # InputMessage, lobby message names
│   ├── lobby/                    # names, teams, start rules, status → view
│   ├── flow/                     # match-flow reducer, spawn assignment, livingSides
│   └── sim/
│       ├── step.ts               # stepSim: the lockstep (drive, then resolve)
│       ├── drive.ts              # arcade drive model
│       ├── collide.ts            # SAT, MTV, bounds clamp, point tests
│       ├── context.ts            # StepContext parts both sides must share
│       ├── combat.ts             # runCombat: one tick of combat, pure
│       ├── projectiles.ts        # shot motion and hit rules
│       ├── ram.ts                # facing rules
│       └── damage.ts             # applyDamage, the only HP writer
├── packages/server/src/
│   ├── index.ts
│   ├── mode.ts                   # env knobs (DEPLOY_MODE, latency injection, tick rate)
│   ├── health.ts
│   ├── monitor.ts
│   ├── rooms/
│   │   ├── ArenaRoom.ts          # the room: messages, phase machine, tick
│   │   ├── flow-map.ts           # schema enums ↔ flow reducer strings
│   │   ├── match-helpers.ts
│   │   ├── select-next-host.ts
│   │   └── singleton-arena.ts
│   ├── sim/
│   │   ├── tick.ts               # serverTick: drain queues into stepSim
│   │   └── combat-bridge.ts      # ArenaState ↔ runCombat POJOs
│   └── net/
│       ├── input-message.ts      # wire validation
│       └── latency-injector.ts
└── packages/client/
    ├── index.html
    └── src/
        ├── main.ts
        ├── config/client-mode.ts
        ├── net/
        │   ├── connection.ts
        │   ├── prediction.ts     # predict + reconcile-by-replay
        │   ├── interpolation.ts  # remote snapshot buffer
        │   ├── step-context.ts   # the client's half of the lockstep input
        │   └── view.ts           # status + phase → scene
        └── scenes/
            ├── {Boot,Join,Lobby,CarSelect,Arena,Results}Scene.ts
            ├── arena-input.ts    # sim-clock input drain, axis folding
            ├── car-visual.ts     # chassis silhouettes, colours
            ├── combat-visual.ts  # hp bar maths, shot extrapolation
            ├── spectate.ts       # spectate cycle, free-roam pan
            └── lobby-signature.ts
```

`ArenaScene` itself cannot be unit-tested without a browser, so its logic lives in the plain modules
beside it (`arena-input`, `car-visual`, `combat-visual`, `spectate`) and the scene stays a thin shell
over them. Client tests run in the **node** environment and never import Phaser.
