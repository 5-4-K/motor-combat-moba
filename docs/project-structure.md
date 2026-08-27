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
│   │   ├── weapon-types.ts       # WeaponDef discriminated union, StockDef, VolleyDef, Hitbox
│   │   ├── weapon-config.ts      # WEAPON_TABLE
│   │   ├── weapon-slots.ts       # WEAPON_SLOT_CONFIG, slotsOf (loadout, capped and warned)
│   │   ├── weapon-ticks.ts       # WEAPON_TICKS: ms -> ticks, derived and frozen once
│   │   └── arena-config.ts       # the one ACTIVE_ARENA_ID constant
│   ├── schema/                   # PlayerState, WeaponInstanceState, WeaponSlotState, ArenaState
│   ├── arena/
│   │   ├── types.ts              # ArenaDef, Obstacle, Spawn, ArenaPalette
│   │   ├── arena-01.ts           # first arena layout
│   │   ├── arena-02.ts           # second arena layout
│   │   ├── registry.ts           # ARENAS map, ArenaId, isArenaId, getArena, ARENA_IDS
│   │   └── art-keys.ts           # arena.<id>.<slot> namespace parser, used by client and release script
│   ├── net/                      # InputMessage (fireSlots bitmask), lobby message names
│   ├── lobby/                    # names, teams, start rules, status → view
│   ├── flow/                     # match-flow reducer, spawn assignment, livingSides
│   └── sim/
│       ├── step.ts               # stepSim: the lockstep (drive, then resolve)
│       ├── drive.ts              # arcade drive model
│       ├── collide.ts            # SAT, MTV, bounds clamp, point tests
│       ├── context.ts            # StepContext parts both sides must share
│       ├── combat.ts             # runCombat: one tick of combat, pure
│       ├── weapons/
│       │   ├── shapes.ts         # shape -> convex polygon, SAT wrappers, the swept smear hull
│       │   ├── fire.ts           # the state machine: slots, three clocks, stocks, volley scheduling
│       │   ├── instances.ts      # projectile travel; beam grow/linger/wall-clip; expiry
│       │   ├── hits.ts           # pose-snapshot hit resolution, per-target damage clocks, pierce
│       │   └── targets.ts        # canDamage: the single friendly-fire predicate
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
    ├── public/art/                # copied to the dist root unbundled — no rebuild to change art
    │   ├── manifest.json          # namespaced key → sprite entry; ships with `{}`
    │   ├── README.md              # the field table, for whoever is dropping in a PNG
    │   ├── cars/                  # convention for car PNGs, created the first time you add one
    │   └── weapon-icons/          # convention for weapon icon PNGs, created the first time you add one
    └── src/
        ├── main.ts
        ├── config/client-mode.ts
        ├── config/display.ts     # FIT-to-window scaling rationale + fullscreen key
        ├── config/slot-keys.ts   # SLOT_KEYS: key code + glyph per slot; slotMaskFrom
        ├── assets/
        │   ├── manifest-schema.ts # SpriteEntry, SPRITE_DEFAULTS, parseManifest (never throws)
        │   ├── load-manifest.ts   # MANIFEST_URL, fetch + parse, empty manifest on any failure
        │   ├── asset-keys.ts      # carId → "car.<id>"; weaponIconKey(id) → "weapon-icon.<id>"
        │   ├── sprite-fit.ts      # fits art to the hull; the hull never follows the art
        │   └── car-sprite.ts      # the resolution chain ArenaScene and the tuning tool share
        ├── dev/                   # stripped from release builds, asserted by build-release.mjs
        │   ├── registry.ts        # ?dev=<id> → dynamic import, one guard for the whole suite
        │   └── AssetTuningScene.ts
        ├── net/
        │   ├── connection.ts
        │   ├── prediction.ts     # predict + reconcile-by-replay
        │   ├── interpolation.ts  # remote snapshot buffer + local between-tick render blend
        │   ├── step-context.ts   # the client's half of the lockstep input
        │   └── view.ts           # status + phase → scene
        ├── scenes/
        │   ├── {Boot,Join,Lobby,CarSelect,Arena,Results}Scene.ts
        │   ├── arena-camera.ts   # whether the arena fits the view, so the camera need not scroll
        │   ├── arena-input.ts    # sim-clock input drain, axis folding
        │   ├── arena-mismatch.ts # builds the mismatch message string (pure, testable)
        │   ├── arena-visual.ts   # arena palette → Phaser colour ints; inset border rect
        │   ├── car-visual.ts     # chassis silhouettes, colours
        │   ├── combat-visual.ts  # hp bar maths, instance extrapolation and draw shape (projectile + beam)
        │   ├── weapon-hud.ts     # pure HUD derivations: sweepFraction, slotVisualState, countdownSeconds
        │   ├── spectate.ts       # spectate cycle, free-roam pan
        │   └── lobby-signature.ts
        └── ui/screens/arena-mismatch.ts # renders that message as DOM
```

`ArenaScene` itself cannot be unit-tested without a browser, so its logic lives in the plain modules
beside it (`arena-camera`, `arena-input`, `car-visual`, `combat-visual`, `spectate`) and the scene stays
a thin shell
over them. `assets/` is the same idea one directory over: the manifest parse, the key namespace, the
hull fit, and the sprite-or-silhouette decision are all pure modules there, so the only thing left in
a scene is handing them a Phaser object. Client tests run in the **node** environment and never
import Phaser — `dev/registry.ts` and `assets/car-sprite.ts` reference it as `import type` only,
which is erased at compile time.
