# Project structure

Source files only — `*.test.ts` sits beside the file it tests and is left out below. Each package has
`package.json`, `tsconfig.json`, `vitest.config.ts`. Server also has `tsup.config.ts`; client has
`vite.config.ts`. Plans and the spec live under `docs/superpowers/`.

`docs/ideas/` and `docs/invariants/` are the user's own notes and are deliberately **not** part of
the project's documentation. They are left out of the tree below on purpose: do not read them or
treat them as reference unless the user names them in the request — see root `CLAUDE.md`.

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
│   ├── config/                   # car, mode, color, weapon, combat, drive/camera, flow, net tables
│   │   ├── car-config.ts         # CAR_TABLE, DEFAULT_CAR_ID, the derived stats, ChassisDrive/driveOf
│   │   ├── mode-config.ts        # MODE_TABLE, DEFAULT_GAME_MODE, isActiveGameMode / activeGameModes
│   │   ├── drive-config.ts       # DRIVE_CONFIG (base + per-rating scales), CAMERA_CONFIG
│   │   ├── weapon-types.ts       # WeaponDef union, StockDef, VolleyDef (base) / PelletDef (projectile), Hitbox, StatusApplication.onWave
│   │   ├── weapon-config.ts      # WEAPON_TABLE
│   │   ├── weapon-slots.ts       # WEAPON_SLOT_CONFIG, slotsOf (loadout, capped and warned)
│   │   ├── weapon-ticks.ts       # WEAPON_TICKS: ms -> ticks, derived and frozen once; scaleTicks
│   │   ├── status-types.ts      # StatusDef, StatusChannel, StatusFlag, StatusPulse, StatusOnApply
│   │   ├── status-config.ts      # STATUS_TABLE, STATUS_CONFIG, STATUS_LIMITS, isStatusId
│   │   ├── status-ticks.ts       # STATUS_PULSE_TICKS: ms -> ticks, derived and frozen once
│   │   ├── arena-config.ts       # the one ACTIVE_ARENA_ID constant
│   │   ├── deathmatch-config.ts  # DEATHMATCH_CONFIG, DEATHMATCH_TICKS: match/respawn/phase timing
│   │   ├── tuning.ts             # setTuning: dev-only runtime override store over 5 balance tables (PG12)
│   │   ├── tuning-walker.ts      # tunableFields/validateTuning/sanitizeStoredTuning (PG14)
│   │   └── practice-config.ts    # PRACTICE_CONFIG: idle timeout/warning, maxConcurrentRooms (PR26–PR29)
│   ├── schema/                   # PlayerState, StatusState, WeaponInstanceState, WeaponSlotState, ArenaState
│   │   ├── PlaygroundState.ts    # extends ArenaState: paused, controlledSessionId, botEnabled, tuningJson (PG5)
│   │   └── PracticeState.ts      # extends ArenaState: paused only — no controlledSessionId, no tuningJson (PR6)
│   ├── arena/
│   │   ├── types.ts              # ArenaDef, Obstacle, Spawn, ArenaPalette
│   │   ├── arena-01.ts           # first arena layout
│   │   ├── arena-02.ts           # second arena layout
│   │   ├── registry.ts           # ARENAS map, ArenaId, isArenaId, getArena, ARENA_IDS
│   │   └── art-keys.ts           # arena.<id>.<slot> namespace parser, used by client and release script
│   ├── net/                      # InputMessage (fireSlots bitmask), lobby message names
│   │   ├── playground-messages.ts # MSG_PLAYGROUND_*, PlaygroundSetup + validator, defaultPlaygroundSetup (PG13)
│   │   └── practice-messages.ts  # PRACTICE_ROOM_NAME, close codes 4006–4009, PracticeSetup + validator (PR3, PR7)
│   ├── lobby/                    # names, teams, start rules, status → view
│   ├── flow/                     # match-flow reducer, spawn assignment, livingSides
│   │   ├── modes.ts              # sidesOf (ffa|team), winRuleOf (last_standing|deathmatch)
│   │   └── respawn.ts            # farthestSpawn, isDueToRespawn, phaseDecision (the M23 state machine)
│   └── sim/
│       ├── step.ts               # stepSim: the lockstep (drive, then resolve)
│       ├── drive.ts              # arcade drive model; takes a resolved ChassisDrive, never a CarId
│       ├── collide.ts            # SAT, MTV, bounds clamp, point tests
│       ├── context.ts            # StepContext parts both sides must share
│       ├── combat.ts             # runCombat: one tick of combat, pure
│       ├── weapons/
│       │   ├── shapes.ts         # shape -> convex polygon, SAT wrappers, the swept smear hull
│       │   ├── fire.ts           # the state machine: slots, three clocks, stocks, volley scheduling
│       │   ├── instances.ts      # projectile travel; beam grow/linger/wall-clip; expiry
│       │   ├── hits.ts           # pose-snapshot hit resolution, per-target damage clocks, pierce
│       │   └── targets.ts        # canDamage: the single friendly-fire predicate
│       ├── status/
│       │   ├── statuses.ts       # ActiveStatus list: apply, expire, re-apply rules, pulses, cleanse
│       │   └── modifiers.ts      # modifiersOf: a status list -> the multipliers the sim reads
│       ├── ram.ts                # ram severity, side bonus, the knock
│       └── damage.ts             # applyDamage + applyHeal (the only HP writers), damageFor, scaleDamage
├── packages/server/src/
│   ├── index.ts                  # gameServer.define: arena always, practice always, playground DEV_TOOLS=1-only
│   ├── mode.ts                   # env knobs (DEPLOY_MODE, latency injection, tick rate, MAX_PRACTICE_ROOMS)
│   ├── health.ts
│   ├── monitor.ts
│   ├── config/
│   │   └── bot-profiles.ts       # BOT_PROFILES: easy/medium/hard, shared by PlaygroundRoom and PracticeRoom (PR17)
│   ├── rooms/
│   │   ├── ArenaRoom.ts          # the room: messages, phase machine, tick
│   │   ├── tick-pipeline.ts      # runPipeline: statusTick→serverTick→contactTick→combatTick, shared by ArenaRoom, PlaygroundRoom and PracticeRoom (PG4, PR16)
│   │   ├── PlaygroundRoom.ts     # dev-only room ("playground"), DEV_TOOLS=1-gated; pause/switch/tuning/setup, bot-or-alone, endless respawns
│   │   ├── PracticeRoom.ts       # shipped room ("practice"), no DEV_TOOLS gate, maxClients=1; runs runPipeline verbatim, never calls setTuning (PR1)
│   │   ├── practice-rules.ts     # pure predicates: room-cap refusal, playground-busy refusal, opponent roll, idle timeout/warning (PR26–PR29)
│   │   ├── bot.ts                # the synthetic client's InputMessage: chase-and-fire steering, pulsed fire mask (PG10; renamed from playground-bot.ts when PracticeRoom took it too)
│   │   ├── flow-map.ts           # schema enums ↔ flow reducer strings
│   │   ├── match-helpers.ts
│   │   ├── select-next-host.ts
│   │   └── singleton-arena.ts
│   ├── sim/
│   │   ├── tick.ts               # serverTick: drain queues into stepSim
│   │   ├── status-bridge.ts      # ArenaState ↔ status lists; expiry + the tick's modifiers
│   │   ├── ram-bridge.ts         # ArenaState ↔ applyRams POJOs
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
        ├── config/slot-keys.ts   # SLOT_KEYS: J/K/L + LMB/RMB/Space bindings, pill + hint glyphs per slot; slotMaskFrom
        ├── assets/
        │   ├── manifest-schema.ts # SpriteEntry, SPRITE_DEFAULTS, parseManifest (never throws)
        │   ├── load-manifest.ts   # MANIFEST_URL, fetch + parse, empty manifest on any failure
        │   ├── asset-keys.ts      # carId → "car.<id>"; weaponIconKey(id) → "weapon-icon.<id>"
        │   ├── sprite-fit.ts      # fits art to the hull; the hull never follows the art
        │   └── car-sprite.ts      # the resolution chain ArenaScene and the tuning tool share
        ├── practice/
        │   └── storage.ts         # localStorage codec for PracticeSetup under "motor-combat.practice.v1" (PR21) — ships, not stripped
        ├── dev/                   # stripped from release builds, asserted by build-release.mjs
        │   ├── registry.ts        # ?dev=<id> → dynamic import, one guard for the whole suite
        │   ├── AssetTuningScene.ts
        │   ├── PlaygroundScene.ts # ?dev=playground: joins the "playground" room, launches ArenaScene, mounts the overlay (PG2)
        │   └── playground/
        │       ├── overlay.ts     # DOM pause menu + settings shell (untested; wires the pure modules below onto the panel)
        │       ├── ui-model.ts    # pure derivations: view state, auto-generated sliders from tunableFields (PG14, PG19)
        │       └── storage.ts     # localStorage codec under "motor-combat.playground.v1" (PG20)
        ├── net/
        │   ├── connection.ts
        │   ├── prediction.ts     # predict + reconcile-by-replay
        │   ├── interpolation.ts  # remote snapshot buffer + local between-tick render blend
        │   ├── step-context.ts   # the client's half of the lockstep input
        │   └── view.ts           # status + phase → scene
        ├── scenes/
        │   ├── {Boot,Join,Lobby,CarSelect,Arena,Results}Scene.ts
        │   ├── PracticeSetupScene.ts   # thin shell: joins "practice" with the chosen setup, launches ArenaScene (PR21)
        │   ├── PracticeSummaryScene.ts # thin shell over ui/screens/practice-summary.ts; reads a pre-leave kills/deaths snapshot, never a live Room (PR24)
        │   ├── controlled-car.ts # controlledCarOf/isSimPaused/isPracticeRoom: which car to drive, whether the sim is frozen, whether the pause-menu gate applies — resolves to the real match answer on a base ArenaState (PG7, PG9, PR22)
        │   ├── arena-camera.ts   # whether the arena fits the view, so the camera need not scroll
        │   ├── arena-input.ts    # sim-clock input drain, axis folding
        │   ├── arena-mismatch.ts # builds the mismatch message string (pure, testable)
        │   ├── arena-visual.ts   # arena palette → Phaser colour ints; inset border rect
        │   ├── car-visual.ts     # chassis silhouettes, colours
        │   ├── combat-visual.ts  # hp bar maths + allegiance colour, instance extrapolation, draw shape, beam fade
        │   ├── countdown-arrow.ts # the "this one is yours" marker: bob phase, triangle points (screen-up)
        │   ├── weapon-hud.ts     # pure HUD derivations: sweepFraction, slotVisualState, countdownSeconds, slotBarLayout
        │   ├── roster-panel.ts   # pure roster derivations: row order, panel layout, name truncation
        │   ├── status-hud.ts     # pure status badge derivations: order, drain, strip layout
        │   ├── deathmatch-hud.ts # pure Deathmatch derivations: match clock, respawn countdown, killed-by banner
        │   ├── spectate.ts       # spectate cycle, free-roam pan
        │   └── lobby-signature.ts
        └── ui/screens/
            ├── arena-mismatch.ts    # renders that message as DOM
            ├── pause.ts             # the practice pause menu: Resume/Exit, mounted off state.paused (PR22, PR23)
            ├── practice-setup.ts    # the practice settings screen: car/opponent/difficulty, Start/Back (PR21)
            └── practice-summary.ts  # the practice session summary rows — NOT resultsView; a session has no winner or match length (PR24)
```

`ArenaScene` itself cannot be unit-tested without a browser, so its logic lives in the plain modules
beside it (`arena-camera`, `arena-input`, `car-visual`, `combat-visual`, `countdown-arrow`, `weapon-hud`,
`roster-panel`, `status-hud`, `spectate`) and the scene stays
a thin shell
over them. `assets/` is the same idea one directory over: the manifest parse, the key namespace, the
hull fit, and the sprite-or-silhouette decision are all pure modules there, so the only thing left in
a scene is handing them a Phaser object. Client tests run in the **node** environment and never
import Phaser — `dev/registry.ts` and `assets/car-sprite.ts` reference it as `import type` only,
which is erased at compile time.
