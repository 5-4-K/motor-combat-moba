# Per-mode configuration — design

**Date:** 2026-09-22
**Status:** approved, not yet executed
**Decision ids:** MC1–MC42

## Problem

Every balance table in the game is a module-level singleton. `stepSim` and everything under
`sim/` reach them through direct imports, and `setTuning` overrides them by mutating those objects
in place — **process-wide**. One process therefore plays one set of numbers.

That blocks the goal: game modes that *feel* different. Slower cars and shorter weapon range in one
mode, faster cars and longer range in another; a chassis carrying a different kit per mode; the
basic attack on in one mode and off in another.

It is not a hypothetical conflict. `index.ts` registers `ArenaRoom`, `PracticeRoom` and
`PlaygroundRoom` on one Colyseus `Server`; `shouldRejectSecondArena` caps arenas at one, but
`PRACTICE_CONFIG.maxConcurrentRooms` is 6. Practice is pinned to one mode and offers no picker, so
the moment an arena hosts a *different* mode, two configurations must be live in one process at the
same time.

## Goals

- **G1.** Every configurable value is per-mode, except a short, justified global list (MC30–MC38).
- **G2.** Two rooms running different modes in one process are each correct.
- **G3.** Adding a mode is a folder copy plus a registry row. Disabling one is a single flag, and a
  disabled mode does not appear in the lobby.
- **G4.** Brawl and Deathmatch ship today's values. Day one is behaviourally a no-op.
- **G5.** Every tool that reports numbers (manual, balance, ttk, playtest, turn-tuning doc) names
  the mode it speaks for, and cannot silently report one mode's numbers as another's.

## Non-goals

- **N1.** No host-facing arena picker. A mode authors an arena *set*; the match uses the first entry.
  A picker is a later `MSG_SET_ARENA` handler plus a lobby control and is out of scope here.
- **N2.** No bot work for new modes. `BOT_PROFILES` enters the `ModeConfig` shape (MC29) but every
  mode seeds identical values, so bot behaviour does not change.
- **N3.** No new game mode is authored. This delivers the mechanism plus the two existing modes.
- **N4.** No retune. Not one number moves.

## Decisions

### The bundle

- **MC1.** A mode's configuration is a single frozen object, `ModeConfig`, built once at module load
  and never mutated.
- **MC2.** A mode is a folder under `packages/shared/src/modes/<modeKey>/`, one file per table, with
  an `index.ts` exporting the assembled `ModeConfig`.
- **MC3.** Mode configs are **full literal copies**, not diffs against a base. The user's stated
  expectation is that over 60% of values will differ between modes and that cars may carry entirely
  different weapon sets; at that ratio a base-plus-override layer degenerates into copies written in
  a worse notation. Legibility of one mode's real numbers wins over de-duplication.
- **MC4.** **Types are never copied.** `WeaponDef`, `CarDef`, `ChassisDrive`, `StatusDef`, `ModeDef`
  and every other interface stay single-source in `config/`. Only *values* are per-mode, so the
  compiler catches structural drift across all modes for free.
- **MC5.** **IDs are never copied.** One global `WeaponId`, `CarId`, `StatusId` and `ArenaId`
  universe. `weaponId`, `carId` and `statusId` cross the wire as strings and are art-manifest keys;
  a mode-private id would force per-mode art manifests and a client that cannot render another
  mode's match.
- **MC6.** Each mode's weapon and car tables are **total** `Record`s over those global unions, not
  `Partial`. A mode expresses "different weapons" through car kits and per-mode `isActive`, never by
  omitting a row. This keeps `weaponDefOf`, `driveOf` and `hpOf` total — a `Partial` would make them
  return `undefined` and ripple through ~50 call sites. A row carried by nobody is already legal
  (`tremor` is one today).
- **MC7.** Derived artifacts are **baked into the bundle** at module load and frozen: `weaponTicks`,
  `chassisDrive`, `burstDefs`, `ramTicks`, `turretTicks`. Today these are five mutable
  module-level singletons (`ACTIVE_TICKS`, `ACTIVE_DRIVE`, `ACTIVE_BURST_DEFS`, `ACTIVE_RAM_TICKS`,
  `TURRET_TICKS`) that `setTuning` tears down and rebuilds on every call. Per-mode they are computed
  once per mode and never rebuilt; switching mode is a pointer assignment.
- **MC8.** No module outside a bundle builder may derive anything from a config at import time.
  `client/src/config/slot-keys.ts`'s `HINT_SLOT_ORDER` is the only such derivation outside
  `config/` today and becomes a function call.

### The scope

- **MC9.** One module, `modes/active.ts`, holds a single `current: ModeConfig | null` pointer.
- **MC10.** `withMode(config, fn)` sets the pointer, runs `fn` synchronously, and restores the
  previous value in a `finally`. Save-and-restore rather than set-and-clear, so nesting and
  re-entrancy are safe.
- **MC11.** The scope is safe because a tick is **synchronous**. Node's event loop cannot preempt
  it, so two rooms can never interleave inside one scope. `withMode` must never wrap an `async`
  function or a callback that resumes after an `await`; a config test and a code-review rule enforce
  this.
- **MC12.** `cfg()` **throws** when read outside a scope. It must not fall back to a default mode:
  silently serving Brawl's numbers to a Deathmatch room is precisely the failure that would survive
  for weeks. A hard throw surfaces it on the first tick.
- **MC13.** Config access is through accessors — `weapons()`, `cars()`, `drive()`, `ram()`,
  `impulse()`, `combat()`, `turret()`, `status()`, `spike()`, `slots()`, `flow()` and
  `deathmatch()` — each a thin read of `cfg()`. Raw table imports are removed from `sim/`.
- **MC14.** The ~50 existing accessor call sites in `sim/` (`weaponDefOf`, `driveOf`, `weaponTicksOf`,
  `hpOf`, `statusDefOf`, `slotsOf`, `basicAttackOf`, `ramAttackOf`, `ramDefenceOf`, `turretMountOf`,
  `instanceDefOf`) change **zero characters**. Only the accessors' bodies change. This is why the
  refactor is ~66 edits rather than ~116: `WEAPON_TABLE` and `CAR_TABLE` are already dereferenced
  zero times inside `sim/`.
- **MC15.** Server rooms install the scope at every entry point: `onCreate`, `onJoin`, `onLeave`,
  every `onMessage` handler, and the `setSimulationInterval` callback. A shared base class or mixin
  exposes `this.scoped(fn)` so an entry point cannot be silently forgotten.
- **MC16.** The client installs the scope on room join, re-installs when `state.mode` changes, and
  wraps its prediction step, `buildStepContext` and HUD reads.
- **MC17.** Harnesses (`balance`, `ttk`, `playtest`) and every test wrap their run in `withMode`.

### Modes, the registry and the lobby

- **MC18.** `MODE_TABLE` gains a `config: ModeConfig` field and an `arenas: readonly ArenaId[]`
  field. `id`, `name` and `isActive` keep their current meaning.
- **MC19.** `isActive: false` continues to hide a mode from the lobby picker and make `set_mode`
  refuse it. No new gate is introduced — the existing one gains a payload.
- **MC20.** Adding a mode: a new `GameMode` enum value at the next unused integer (never renumber —
  invariant 7), a folder, a registry row. Removing one: delete the row and the folder; the enum value
  is retired, never reused.
- **MC21.** A room resolves its `ModeConfig` from `state.mode` and holds it until `state.mode`
  changes. `ArenaRoom` re-resolves on every `MSG_SET_MODE` **while in `LOBBY`** — car select must
  already show that mode's roster and kits, so resolution cannot wait for match start — and the
  bundle is frozen for the match once the room leaves `LOBBY`. `PracticeRoom` and `PlaygroundRoom`
  resolve once at creation.
- **MC22.** `PracticeRoom` keeps its current pin, `GameMode.FFA_DEATHMATCH` with `matchEndsTick` 0.
  Changing the pin would change behaviour and is out of scope (N4).
- **MC23.** A mode's arena set is `ModeConfig.arenas`; both shipped modes carry
  `["arena-01", "arena-02"]`. A match uses `arenas[0]` (N1).
- **MC24.** `BootScene` loads the **union** of every active mode's arena set, not
  `ACTIVE_ARENA_ID`'s art alone. Without this, switching mode in the lobby reaches the "Arena
  mismatch" screen.

  > **Erratum (2026-09-23).** That last sentence is wrong, and the requirement stands without it.
  > The "Arena mismatch" overlay fires on an **unregistered** arena id — `!isArenaId(arenaId)` in
  > `packages/client/src/scenes/ArenaScene.ts` — and every arena in every mode's set is registered
  > by definition (MC23's own test pins it). Missing *art* is a different thing entirely:
  > `resolveArenaFloor` (`packages/client/src/assets/arena-floor.ts`) returns `undefined` and the
  > scene falls back to the procedurally generated asphalt floor. So the real consequence of
  > loading less than the union is a **correctly-playing arena drawn with the wrong floor** — a
  > visual defect, not a crash or an error screen. MC24 is unchanged; only this rationale was.
- **MC25.** `build-release.mjs` prunes to that same union, and its post-build assertion checks the
  union rather than a single id.
- **MC26.** `ACTIVE_ARENA_ID` stops being the source of truth for play. It survives as the
  playground's default and the asset pipeline's default.

### What is per-mode

- **MC27.** Per-mode: `CAR_TABLE` entire (ratings, kits, `basicAttack`, `isActive`, `turretMount`,
  `brakeDecel`), `WEAPON_TABLE` entire, `DRIVE_CONFIG` minus the hull, `RAM_CONFIG`,
  `IMPULSE_CONFIG`, `COMBAT_CONFIG`, `TURRET_CONFIG`, `STATUS_TABLE`, `STATUS_CONFIG`,
  `STATUS_LIMITS`, `SPIKE_CONFIG`, `BASIC_ATTACK_CONFIG.enabled`,
  `WEAPON_SLOT_CONFIG.maxAbilitySlots`, `DEATHMATCH_CONFIG`, `FLOW_CONFIG`, `CAMERA_CONFIG`, the
  arena set, and `ModeConfig.maxPlayers` (the per-mode seat cap, `2 <= maxPlayers <= MAX_PLAYERS`;
  a duel mode caps at 2).
- **MC28.** `WEAPON_SLOT_CONFIG.maxAbilitySlots` (`N`) is per-mode; `maxFireSlots` and
  `basicAttackSlotIndex` stay derived from it, never typed.
- **MC29.** Bot configuration is per-mode but **stays in the server package**. `BOT_PROFILES` and
  `BOT_BRAIN_VERSION` live in `packages/server/src/config/bot-profiles.ts`; moving them into
  shared's `ModeConfig` would drag server-only bot code across the package boundary. Instead the
  server keeps a parallel `MODE_BOT_CONFIG: Record<GameMode, BotModeConfig>` resolved by the same
  room that resolves the shared bundle. Every mode seeds identical values, so no bot behaviour
  changes (N2).

### What stays global, and why

- **MC30.** `TICK_RATE_HZ` / `MS_PER_TICK`. Hard invariant 1. Colyseus sets the interval per room,
  so per-mode is technically reachable, but `msToTicks` converts every authored duration against it
  at load, the client's input cadence and prediction buffer assume one rate, `golden.test.ts` is
  pinned to it, and the netcode rewrite plans to move it to 60. Large risk, no feel payoff the drive
  tables cannot deliver.
- **MC31.** `DEFAULT_PATCH_RATE_HZ` and all of `NET_CONFIG`. Transport and reconciliation plumbing;
  mis-set values read as rubber-banding bugs rather than as a different game. If a future mode ever needs a
  larger `reconcileSnapPos`, **derive it from that mode's max speed** rather than authoring it
  per-mode. Nothing in this work changes `NET_CONFIG` (N4).
- **MC32.** Enum wire values (`GameMode`, `RoomPhase`, `PlayerStatus`, `WeaponKind`,
  `ManeuverKind`). Invariant 7.
- **MC33.** `ABILITY_SLOT_CEILING` (4). Structural: it sizes `SLOT_KEYS`, bounds the wire mask, and
  the HUD gutter has no room above 4.
- **MC34.** `MAX_PLAYERS` (6). Invariant 10, and the spawn tables carry exactly six rows. A mode may
  cap lower; never higher.
- **MC35.** `DRIVE_CONFIG.carWidth` / `carHeight` — the OBB hull. It is the hitbox model, which
  `CLAUDE.md` flags as stop-and-ask, and it drags a derived chain behind it: car art pixel size,
  arena spawn clearance against spikes, `inertiaRadiusSquared()`, both `spinScale` constants, and
  the countdown arrow and hp-bar scaling. `tuning-walker.ts` already excludes it for this reason.
- **MC36.** `COLOR_TABLE`. `colorId` is a uint8 index into it; per-mode would make a player's colour
  mean different things in different modes.
- **MC37.** `PRACTICE_CONFIG` (process resource limits), `CHAT_CONFIG` (a lobby buffer that lives
  before the mode governs anything), `LOGICAL_CANVAS` (fixed render resolution).
- **MC38.** **Wire-width bounds, not bans.** Per-mode values must fit their schema type: `hp` ≤
  65535 (uint16); `kills`, `deaths`, `level`, `team`, `maneuver`, `colorId` ≤ 255 (uint8);
  `lastFiredSlot` within int8. A config test asserts this for every mode.

### `setTuning` and the playground

- **MC39.** `setTuning`'s mutate-in-place store is retired. The playground builds an ad-hoc
  `ModeConfig` from a base mode plus its overrides and installs it **for its own room only**.
- **MC40.** This removes the documented constraint that `PracticeRoom` must never call `setTuning`
  because the store is process-wide. `tuning-walker.ts`'s enumerable field surface and its
  validation survive unchanged — it describes paths into a bundle rather than into live singletons.

### Tooling

- **MC41.** Every tool that reports numbers gains a mode axis and names the mode in its output:
  `manual.html` gets one tab per active mode and `balanceStamp` hashes every active mode's tables;
  `npm run balance`, `npm run ttk` and `npm run playtest` take `--mode=<id>` and default to
  `DEFAULT_GAME_MODE`; `balance`'s `--baseline` refuses a cross-mode comparison the same way it
  already refuses a cross-bot-version one; `docs/turn-tuning.md` carries its three tables per active
  mode and `turn-tuning-doc.test.mjs` iterates modes and names the offender.
- **MC42.** Every existing config invariant runs per mode and names the mode on failure: weapon
  exclusivity (L1), `DEFAULT_CAR_ID` active, `DEFAULT_GAME_MODE` active, `impulse` only on a
  `kind: "maneuver"` row, `maxAbilitySlots` within `[1, ABILITY_SLOT_CEILING]`, and MC38's wire
  bounds.

## Architecture

```
packages/shared/src/modes/
  types.ts        ModeConfig interface (values only — types stay in config/)
  active.ts       current pointer, withMode(), cfg(), the accessors
  registry.ts     MODE_TABLE: GameMode -> { id, name, isActive, arenas, config }
  build.ts        assembleModeConfig(tables) — computes the five derived artifacts, freezes
  brawl/          cars weapons drive ram impulse combat turret status spike slots flow
                  deathmatch index          (twelve tables + index; bot config is server-side, MC29)
  deathmatch/     the same thirteen files
```

`config/` keeps every **type**, every **global** config (MC30–MC37), and the accessor helpers whose
bodies now read `cfg()`.

**Data flow.** Lobby fixes `ArenaState.mode` → room resolves `MODE_TABLE[mode].config` once →
every room entry point runs inside `withMode(config, …)` → accessors in `sim/` read `cfg()` →
`stepSim` is unchanged. The client reads `state.mode` off the wire and installs the same bundle, so
the lockstep halves resolve identical numbers from the same source.

## Risks

- **R1. An unscoped read.** The defining risk of the ambient approach. Mitigated by MC12's hard
  throw, MC15's single auditable entry-point list, and MC8's ban on import-time derivation.
- **R2. `withMode` wrapping something asynchronous.** Would let two rooms interleave and corrupt
  both. Mitigated by MC11 and a lint/test rule.
- **R3. Collision with in-flight work.** The Unity physics port's stage 5 and the netcode rewrite's
  phase 3 both rewrite files this touches. Mitigated by the accessor approach: MC14's ~50 call sites
  are untouched, and `stepSim`'s signature does not change, so the planned `stepSim` → `stepWorld`
  wrap still applies cleanly.
- **R4. Tooling drift.** Six tools × N modes is a recurring cost (MC41). Accepted as the price of
  60%-divergent modes; `balanceStamp` over every active mode is what keeps the manual honest.
- **R5. Copy divergence.** Structural drift is caught by the compiler (MC4); *value* drift between
  modes is intentional (MC3) and therefore not a failure mode.

## Testing

- Phase 1 is a pure refactor: the entire existing suite must pass unchanged, and `golden.test.ts`
  must produce a byte-identical fixture.
- A test asserts `cfg()` throws outside a scope.
- A test runs two `ModeConfig`s through `stepSim` in an interleaved sequence and asserts each result
  matches that mode run alone — the direct test of G2.
- MC42's invariants run per mode.
- MC38's wire-width bounds run per mode.
- After phase 2, a test asserts Brawl's and Deathmatch's bundles are deep-equal to the pre-change
  tables, proving G4.

## Exit criteria

1. `npm test`, `npm run build` green.
2. An arena room on one mode and a practice room on another tick correctly in one process.
3. `golden.test.ts` unchanged from before the work.
4. Disabling a mode removes it from the lobby; enabling restores it; neither needs a code change
   beyond the flag.
5. `npm run build:manual` regenerates a page carrying every active mode, and `balanceStamp` fails a
   stale one.
