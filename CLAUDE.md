# Motor Combat MOBA

LAN-hosted top-down 2D multiplayer car combat (max 6 players). npm workspaces
(`@motor-combat-moba/shared`, `@motor-combat-moba/server`, `@motor-combat-moba/client`), Colyseus
rooms (`ArenaRoom`, `PracticeRoom`, dev-only `PlaygroundRoom`), shared `stepSim` as the lockstep,
Phaser 4 client.

This file describes the **current** state. History lives in the specs and the `EXECUTION.md`
state files linked below. Do not add changelog paragraphs here — update the fact in place.

## Configuration is PER-GAME-MODE — read this before tuning anything

**One BASE plus per-mode OVERRIDES.** `packages/shared/src/modes/base.ts` exports
`BASE_TABLES: ModeTables`, built from the `config/` globals (`CAR_TABLE`, `WEAPON_TABLE`,
`DRIVE_CONFIG` minus the hull, and the rest). **Those globals are the common defaults**: editing one
changes every mode that does not override that value. Each mode folder (`modes/brawl/`,
`modes/team-brawl/`, `modes/deathmatch/`, `modes/conquer/`) has a `config.ts` exporting a
`ModeOverrides` (a `DeepPartial<ModeTables>` naming only what that mode changes) and an `index.ts`
exporting `<MODE>_TABLES = mergeTables(BASE_TABLES, <MODE>_OVERRIDES)`.

- `mergeTables` (`modes/merge.ts`) merges plain objects key by key, **replaces** arrays and
  primitives whole (an overridden kit is the whole new kit), and throws at load, naming the path, if
  an override key does not exist in the base.
- `replace(def)` swaps a whole keyed row (car, weapon, status) or adds a new one; it is the only way
  to *remove* an optional field such as a weapon's `turret`.
- `modes/registry.ts` (`MODE_TABLE`) binds each mode to its bundle and its `isActive` publish gate.
  `modes/active.ts` holds the active bundle and exposes it through the accessors `cars()`,
  `weapons()`, `drive()`, `ram()`, `impulse()`, `combat()`, `turret()`, `statusConfig()`,
  `statusTable()`, `statusLimits()`, `spike()`, `slots()`, `flow()`, `deathmatch()`, `conquer()`,
  `camera()` and `derived()` (per-mode resolved tick tables). `arenas` and `maxPlayers` are
  `ModeTables` fields with no accessor.

**Modes today:**

| Mode | `GameMode` | Active | Overrides | Win rule |
|---|---|---|---|---|
| Brawl | `FFA_LAST_STANDING` (0) | yes | `turret.visible: false` | last standing |
| Team brawl | `TEAM` | **no** | none | last standing |
| Deathmatch | `FFA_DEATHMATCH` (2) | yes | `camera.spectate` | kills, on a clock, with respawns |
| Conquer | `CONQUER` (3) | yes | `arenas: ["arena-03"]`, `camera` | 3v3 zone control |

The base plays `arena-01`/`arena-02` with `maxPlayers: 6`. Never renumber a `GameMode` (invariant 7).

**The mode layer.** A mode's behaviour is `ModeRules` (shared, `modes/rules-registry.ts` →
`rulesOf(mode)`: `sides`, `respawns`, `hasMatchClock`, `winRuleLabel`, `canStart`,
`claimsChassis`), a server `ModeController` (`controllerOf(mode)` — the single answer to "what ends
the match"), and a client `ModeHud`. See
[`docs/superpowers/specs/2026-09-25-game-mode-layer-design.md`](docs/superpowers/specs/2026-09-25-game-mode-layer-design.md).

- **Deathmatch** runs `respawnSweep` on `deathmatch().respawnDelaySeconds`, gives a respawned car a
  `phased` status (driveable, not solid, not targetable), and ends on `ArenaState.matchEndsTick` or
  the kills-then-deaths ranking in `deathmatchOutcome`.
- **Conquer** shares Deathmatch's respawn flow and reads `deathmatch()` for clock/respawn/phase
  windows, but wins when a team fills a control bar by holding `ArenaDef.zone` uncontested
  (`conquer()`: `captureDelaySeconds`, `controlTargetSeconds`, `teamSize`, `uniqueChassisPerTeam`).
  See [`docs/superpowers/specs/2026-09-24-conquer-mode-design.md`](docs/superpowers/specs/2026-09-24-conquer-mode-design.md).
- **`isOnField` vs `isSolid`.** `isOnField` is the mover gate (may this car be simulated);
  `isSolid` (`isOnField && !phased`) gates contacts, rams and weapon targeting. A phased car is the
  only case where they may disagree.

**The camera is per mode** — `camera()` carries `rotate` (`"none"` / `"teamFacing"` /
`"heading"`), `fov` (off in every shipped mode), `spectate`, `camLerp`, `zoom`, `freeRoamSpeed`. The
arena decides nothing about the camera. See
[`docs/superpowers/specs/2026-09-28-camera-behaviors-design.md`](docs/superpowers/specs/2026-09-28-camera-behaviors-design.md).

**The safety net is a resolved-bundle snapshot per mode.** `modes/snapshots.test.ts` writes each
mode's resolved `ModeTables` to `packages/shared/src/modes/__snapshots__/<slug>.tables.json`. A
mode's `config.ts` edit moves only that file; a base/global edit moves every mode that does not
override the value. Accept a deliberate move with `vitest -u` scoped to the moved file(s), never a
blanket `-u`.

### Where to edit

- **Every mode** — edit the raw global in `config/`. A mode that overrides that value keeps its own
  number and its snapshot does not move; check that is what you meant.
- **One mode only** — edit that mode's `config.ts` and re-snapshot that mode. A partial nested
  override is an ordinary object literal; `replace(...)` is only for a new keyed row or removing an
  optional field.
- **A new mode** — use the [`game-mode`](.claude/skills/game-mode/SKILL.md) skill.
  `isActive: false` hides a mode from the lobby with no other change.

Any config edit may still owe a `npm run build:manual` and a `docs/turn-tuning.md` update — see
those sections below.

### What is NOT per-mode

`TICK_RATE_HZ`, `NET_CONFIG`, `SNAPSHOT_RATE_HZ`, enum wire values, `ABILITY_SLOT_CEILING`,
`MAX_PLAYERS` (the ceiling; each mode's `maxPlayers` is held to `[2, MAX_PLAYERS]` by
`modes/invariants.test.ts`), `TILE_SIZE`, `TILE_DEFS`, `COLOR_TABLE`, `PRACTICE_CONFIG`,
`CHAT_CONFIG`, `LOGICAL_CANVAS`, and the OBB hull (`DRIVE_CONFIG.carWidth`/`carHeight`, 60 × 40). The
hull is excluded from `ModeTables` **by type**.

### Two rules that will bite you

- **`cfg()` throws outside a mode scope.** Every entry point — room handlers and ticks, client boot,
  every harness and script — must install a bundle first (`withMode(config, fn)`, or `installMode`
  for a one-shot process). `withMode` is strictly synchronous and refuses a thenable.
  `installMode` is process-wide: **a room must never call it** (that leaks its bundle into every
  other room). `PracticeRoom` and `PlaygroundRoom` hold their own bundle and read through
  `scoped(...)`; `practice-room.test.ts` enforces this for practice.
- **Never read a config accessor at module scope.** `const X = drive().maxSpeed` at the top of a file
  freezes whichever mode was installed first. Cache derived values with `memoOnBundle`
  (`packages/client/src/net/mode-memo.ts`). `modes/no-raw-config-in-sim.test.ts` catches a raw table
  read, but **not** a module-scope accessor call — that one is on you.

The measurement harnesses (`npm run ttk`, `npm run balance`, `npm run playtest`) take
`--mode=<id|name>`, print it in the report header, and suffix report folders with it. An unknown mode
refuses the run; an inactive mode is measurable on purpose. Balance's config fingerprint hashes the
mode's bundle, so `--baseline` refuses a cross-mode comparison.

## Game model — the facts most often needed

### Roster

- **Four active chassis**: the type triangle `mirage`, `bullseye`, `bastion`, plus `taurus` (a heavy
  bruiser, not part of the triangle). Each carries three ability weapons; all twelve ability rows in
  `WEAPON_TABLE` are carried, so there is **no spare weapon** for a new kit.
- **Five inactive prototypes** — `anvil`, `caprico`, `prowler`, `cleaver`, `skorpios` — each
  `isActive: false`, `weapons: []`, a placeholder stat clone of a shipped chassis. They carry no
  design identity; do not balance against them.
- Ratings are seven independent 0-100 values: `speed`, `accel`, `handling`, `attack`, `hp`,
  `ramAttack`, `ramDefence` (there is no `mass`). `brakeDecel` is u/s². **`handling` is turn RATE,
  not radius**; radius is `speed / turnRate`.
- **`CarDef.isActive` is the publish gate everywhere**: car select, select/preview messages,
  practice, the guide and `balanceStamp`, and the balance harness (`--include-inactive` to seat
  prototypes; chassis with an empty kit are always skipped). `check:art` covers the whole table and
  marks inactive rows; `ttk` uses the whole table as defenders and `armedCarIds()` as attackers.
- **Weapon exclusivity is unconditional**: no weapon on two chassis, active or not. An inactive
  chassis may carry no weapons. See [`docs/config-reference.md`](docs/config-reference.md#adding-an-inactive-chassis).

### Drive

`stepDrive` takes a resolved `ChassisDrive` from `driveOf(carId)` (resolved once at `stepSim`'s
production call site), not the roster — that is what lets `golden.test.ts` pin the integration. The
model (ported from Unity, 2026-09-18) uses one always-on drag rate (`baseDrag`/`dragPerRating`) that
sets top speed, wind-up and coast-off together, and a speed-independent yaw rate. Current values and
resolvers: [`docs/config-reference.md`](docs/config-reference.md#drive_config) and
[`docs/turn-tuning.md`](docs/turn-tuning.md). `packages/shared/src/sim/velocity.ts` (`forwardOf`,
`lateralOf`, `speedOf`, `toWorld`) is the **only** place the world/car frame conversion may be
written.

### Rams and impulses

A ram is a one-way rule: nose-first above `RAM_CONFIG.minRamSpeed`, the attacker stops dead and takes
`ramLock` (`attackerLockMs`); the victim takes the shove, the spin and `reeling`
(`modifiers: { grip: 0.6 }`, flags `immobilised`/`steeringLocked`/`spinFree`/`ramBlocked`). A ram
deals **zero HP** — cars never damage each other by contact. Per-victim diminishing returns
(`FalloffStack` in `packages/server/src/sim/ram-bridge.ts`) are server-only and scale the victim's
half only.

Weapons push through an optional **`ImpulseDef`** on `WeaponBase`/`ExplosionDef`, converted to
ticks in `WEAPON_TICKS[id].impulse` (`undefined` when absent). `wildcharge` (the slam) and `tremor`
(an inward radial pull) author one. A slam emits a `SlamEvent` from `sim/contact.ts` and
`ram-bridge.ts` assembles its push; non-maneuver impulses apply once per victim per instance via
`applyWeaponImpulses`. Wall-contact padding is `IMPULSE_CONFIG.wallContactPad`.

The current rule's state file is
[`docs/superpowers/plans/2026-09-18-unity-physics-port/EXECUTION.md`](docs/superpowers/plans/2026-09-18-unity-physics-port/EXECUTION.md)
(stages 1-4 landed; stage 5, tune-and-reconcile, is **paused** at the owner's request). The older
2026-09-06 car-physics rework's contest model is superseded; its `EXECUTION.md` is a record only.

### Statuses

`sim/status/` is the duration layer. The sim reads the active mode's `statusTable()` (the
`STATUS_TABLE` global is the base). Every channel is a **multiplier** with 1 as neutral, and
`Modifiers` is the only type that reaches driving, ramming and combat. The applier owns the duration
(`WeaponDef.applies`, `CombatInput.statusRequests`, or the contact pass for `reeling`/`ramLock`); a
status never stacks with itself, and a flag-carrying debuff is forced to `reapply: "ignore"`.
`sim/damage.ts` is the only HP writer. See [`docs/combat-model.md`](docs/combat-model.md#statuses).

### Weapon slots, the basic attack and the turret

- **Ability slots.** `ABILITY_SLOTS` (`config/weapon-slots.ts`) seeds
  `WEAPON_SLOT_CONFIG.maxAbilitySlots` = `N` = **3**, legal 1..`ABILITY_SLOT_CEILING` (4).
  `maxFireSlots` (`N + 1`) and `basicAttackSlotIndex` (0) are derived. A kit longer than `N` is
  truncated silently. Changing `N` changes `rollPersonality`'s RNG draw count, so it owes a
  `BOT_BRAIN_VERSION` bump. Use the [`ability-slot-count`](.claude/skills/ability-slot-count/SKILL.md)
  skill.
- **Basic attack.** Every car has `CarDef.basicAttack`, a `WeaponId` beside the ability kit, always
  **fire slot 0**. `CarDef.weapons` and `slotsOf` mean the **ability** slots only; `fireSlotsOf`
  joins the two. `basicAttackIds()` is the only honest way to ask which rows are basic attacks (nine
  identical rows spread from `BASIC_ATTACK_BASE` today).
- **The basic attack is OFF in every mode** — `slots.basicAttackEnabled` is `false` in the base and
  no mode overrides it. Five readers honour it: `beginFire` (refuses the press), the bot's
  `chooseSlot`, the client's `hintSlotOrder`, `scripts/build-cars-and-weapons.mjs` (skips the card,
  folds the flag into `balanceStamp`), and `carHasTurretWeapon` (skips slot 0). `fireSlotsOf`, the
  balance harness, `ttk` and the probes deliberately ignore it. Toggle it with the
  [`basic-attack-toggle`](.claude/skills/basic-attack-toggle/SKILL.md) skill.
- **Controls** (`SLOT_KEYS`, client `config/slot-keys.ts`): abilities 1/2/3 on **`LMB` / `RMB` /
  `SPACE`**; the basic attack (slot 0) is parked on **`Q`** and an inert fourth ability on **`E`**.
  `beginFire` scans **descending** and takes the highest set bit, so on a same-tick tie the
  highest-indexed slot wins and the basic attack always loses. A menu opens on `P` (and `Esc`, via
  pointer-lock loss) in every room.
- **Turret.** A weapon carrying `WeaponBase.turret` fires along the bearing the player clicked
  (`InputFrame.aimAngle`), frozen at the press, clamped to `TURRET_CONFIG.maxSwingDeg` (60° arc). The
  turret turns at `turnRateDegPerSec` before wind-up; the shot spawns from `turretPivotOf` plus
  `defaultOffset`, clamped so it is never born through a wall. Turret rows today: the nine
  basic-attack rows (inert while the flag is off) plus `predator`, `magmablast`, `thumper`,
  `fury-horn` and `roadblock` — so **every active chassis aims with the mouse in every mode**, with
  pointer lock and a crosshair. Brawl sets `turret.visible: false`: no turret drawn and an instant
  turn, but mouse aim still applies. See [`docs/combat-model.md`](docs/combat-model.md#turret-muzzle)
  and [`docs/superpowers/specs/2026-09-21-mouse-aim-turret-design.md`](docs/superpowers/specs/2026-09-21-mouse-aim-turret-design.md).

### Notable weapon mechanics

- An **aura/explosion** is a beam with a `disc` hitbox at `origin: "center"`. `magmablast`'s
  detonation is a real detached `WeaponInstance` synthesized by `instanceDefOf(id, isExplosion)`;
  `damageMode` (`"onceEver" | "perEntry"`) is the knob. It is the only source of `corroded`.
- **Volleys are live**: `shockwave` (Taurus) fires three expanding rings with `spiked` on every ring
  (`onWave: "all"`). `onWave: "final"` is unused.
- `stunned` comes from `roadblock`, `thunderclap` and the slam's wall impact.

### Arenas and spikes

- `arena-01` and `arena-02` are **tile arenas**: a 32 × 18 text grid compiled by `compileTileArena`
  (`packages/shared/src/arena/tiles/`) into ordinary `obstacles`, 1200 × 640 playable. Rows are
  one-character keys; a per-arena `legend` merged over `DEFAULT_LEGEND` (`.` floor, `#` wall, `^`
  spike, space void) maps each key to a cell `{ tile, orientation?, art?, artOrientation?, overlay? }`.
  `TILE_DEFS` is **behaviour only** (solidity, hazard, which `sides` hurt); the look is named on the
  cell. A one-sided spike compiles to an obstacle with `damageFaces`; the sim and the bot's
  `spikesAhead` skip its safe faces (`facesOfNormal`). Tile art lives under
  `arena.common.tile.<id>` and is baked into render-texture chunks at load. Specs:
  [tile arenas](docs/superpowers/specs/2026-10-09-tile-arenas-design.md) (TA), superseded in part by
  [tile cells](docs/superpowers/specs/2026-10-09-tile-cells-design.md) (TC).
- `arena-03` (Conquer) is a hand-written chamfered polygon using `ArenaDef.boundary` — inward
  half-planes through `Bounds`, resolved by a positional clamp; `boundsOf(arena)` is the one place a
  `Bounds` is built.
- `width`/`height` mean the image frame and camera bounds (1280 × 720), not the playable area.
- **Spikes** (`spike()`) are the only environmental damage: a flat hit gated on a fresh push into the
  surface above `triggerSpeed`, rate-limited by `retriggerMs`. Holding throttle into a wall does not
  re-trigger; only an externally shoved car keeps paying. Damage is credited to whoever shoved the
  car within `shoverCreditMs`, else to the victim (a self-inflicted kill). See
  [`docs/combat-model.md`](docs/combat-model.md#environmental-hazards-wall-spikes).
- No shipped arena draws a full-floor image; `arena.arena-02.floor` remains in the manifest unused.

### Rooms

- **`PracticeRoom`** ships (no `DEV_TOOLS` gate): 1v1 vs a bot, pinned to `FFA_DEATHMATCH` with
  `matchEndsTick` 0 (no clock, kills panel kept), settings as join options only.
- **`PlaygroundRoom`** is dev-only (`?dev=playground`, needs `DEV_TOOLS=1`). Six fixed seats with
  stable ids `pg-0`…`pg-5`; `controlledSessionId` says which one the human drives; a disabled seat
  keeps its configuration. It tunes through a sibling bundle (`applyOverrides`) kept on the room.
  `shouldRefusePlayground` refuses to open one while an arena or practice room is occupied.
  `BOT_SESSION_ID` is practice's alone.
- Practice and playground open on the same 3-2-1 countdown as a match (`rooms/countdown.ts` is the
  only writer of their `phase`); `applySetup` deliberately does not re-run it.
- **Lobby chat** (`MSG_CHAT`) is accepted only from a `PlayerStatus.READY` sender — the same predicate
  that puts a player on the lobby screen. `ArenaState.chat` keeps the last
  `CHAT_CONFIG.maxMessages` (20), is never cleared, and each row snapshots sender `name`/`colorId`.
  `seq` derives from the previous row because length cannot detect a new message at the cap.

### Playground VFX

Per-weapon bursts live in `fx/table.ts`; the environment (grade, vignette, shake, hit-stop, decals,
occlusion, lava, generated floor, floor art, markings, car lighting) lives in `fx/environment.ts`
(`ENVIRONMENT_FX`). Both are injected by `ArenaScene` **only for a playground room**, so shipped
arenas and practice always render the shipped tables. `floor.*` needs the Regenerate button;
`floor.*` and `floorArt.*` never both apply. A car glow was tried and removed —
`packages/client/CLAUDE.md` says why; it is not a gap to fill.

### Bot

`packages/server/src/bot/brain/` runs perceive → assess → move → shoot → humanize. Tiers
(`easy`/`medium`/`hard`) differ only in `BOT_PROFILES`; no module branches on the tier name. Assess
commits to **one situation** (`recover`, `waitOut`, `evade`, `unpin`, `punish`, `reset`, `fight`,
`close`). The bot presses one slot per tick. Bump `BOT_BRAIN_VERSION` (in `botFingerprint`) when
behaviour changes without the table moving. Feel complaints go through the
[`bot-tuner`](.claude/skills/bot-tuner/SKILL.md) skill onto knobs, never a tier-only branch. See
[`docs/bot-behavior.md`](docs/bot-behavior.md).

### Netcode

Built for a dedicated server up to 80 ms RTT: tick-stamped inputs, every car steps exactly once per
tick (a missing input repeats, then goes neutral); `ClockSync` plus a slack-steered `InputScheduler`
run each client ahead; remotes are drawn tick-keyed at an adaptive delay with capped dead reckoning;
a press is shot-compensated up to `shotCompCapMs` (150 ms) — cars are never rewound and rams never
compensated; interest management (`StateView` tags, server `ViewManager`) is a no-op while FOV is
off. Read [`docs/networking.md`](docs/networking.md) (including "What remains unfair"), then
[`EXECUTION.md`](docs/superpowers/plans/2026-09-29-online-netcode/EXECUTION.md) for measured numbers
and open questions.

## Hard invariants

1. `TICK_RATE_HZ` lives once in `@motor-combat-moba/shared`.
2. No magic numbers in logic — balance comes from the ACTIVE MODE's bundle, read through the
   accessors in `modes/active.ts`; never a raw `config/` table, never captured at module scope.
3. Clients send inputs (and lobby intents), never authoritative sim state.
4. `stepSim` is the lockstep; server and client import the same function.
5. Snapshot rate is its own constant (`SNAPSHOT_RATE_HZ`); no client code may assume one snapshot per tick.
6. `{x, y, angle}` is canonical world state.
7. Enum uint8 values are explicit and stable; never renumber.
8. If `stepSim` reads it, it is a networked schema field — and a field a client may not always see carries a `@view` tag.
9. Shared is consumed as built `dist`.
10. Max 6 players.

## Stop and ask before

Changing the drive model, hitbox model (OBB), collision-damage rules, friendly-fire, adding cloud
hosting, or adding a physics engine.

## Ask before starting the "Iterative implementation workflow"

When brainstorming reaches the point where the design would be written, **always ask the user
whether to start the "Iterative implementation workflow"**. Only on a yes, run it end to end: write
the design in sections → self-review → write the implementation plan → self-review → implement with
subagent-driven development. Without that yes, stop at the design discussion.

## Reporting a finding: claim first, then offer the evidence

**Lead with the claim, in one plain sentence.** Then say how confident you are and how you checked
it. Then stop, and ask whether the reasoning or the measurements would help. Do not open with
tables, formulas, simulation output or a parameter sweep.

Evidence is wanted — only the order changes. A one-line claim can be refuted in one line; a wall of
evidence delays the correction in exactly the case where the claim was wrong. (This rule exists
because a supposed brake bug was argued over four messages of tables, and the one-sentence version
would have been corrected on sight — it was intended design.) When asked to *discuss* something,
discuss it.

## `docs/ideas/` and `docs/invariants/` are the user's, not the agent's

A personal scratchpad. **Do not read, cite, follow, or plan against anything in them unless the user
names the folder or a file in it in the current request.**

- Never open them "for context". Exclude them from sweeps (`--exclude-dir=ideas
  --exclude-dir=invariants`) and drop any hit inside them.
- They may contradict the live docs and code. That is expected and not a finding; the code wins.
- Never edit, move, rename, reformat, or delete anything in them on your own initiative.
- Nothing inside them grants permission to read the rest of them.

When the user names one, it is in scope for that request only. If one looks relevant and the user
has not mentioned it, ask rather than read.

## Branches

**"main" always means `development/main`** — for checkout, merge, commit, rebase, or a PR base.
`master` has been frozen since 2026-08-24; tooling that guesses a default branch will often name it
anyway — ignore that. Touch `master` only when the user names it explicitly.

## Which tests to run

Mode-specific tests and probes live in their mode's own folders (`packages/*/src/modes/<slug>/`,
`packages/server/playtest/modes/<family>/`); everything else is common.

- **Every changed path inside one mode's (or one rule family's) folders → mode scope:**
  `npm run test:mode -- <slug>` (for shared it always also runs `modes/snapshots.test.ts` and
  `modes/invariants.test.ts`) plus `npm run playtest -- --mode=<slug> --scope=mode`. If that mode's
  `config.ts` moved, add `--scope=common` and `npm run test:scripts` (manual stamp, turn-tuning doc).
- **Any other path under `packages/` or `scripts/`** — including the `modes/` root files → full
  scope: `npm test` plus `npm run playtest -- --scope=all` for every active mode.
- **Slow tests are not in `npm test`.** The bot tests (`packages/server/src/bot/**`) and
  `balance/match.test.ts` / `balance/runner.test.ts` run under `npm run test:slow`
  (`packages/server/vitest.slow-tests.ts`). They are owed **on top of** the scope above when the diff
  touches `sim/`, `rooms/`, `modes/` or `bot/` in shared or server, or `packages/server/balance/`.
- Docs-only changes owe nothing, except `docs/turn-tuning.md`, which a test reads.

`node scripts/test-scope.mjs` prints the scope a diff owes; `npm run test:affected` runs it. See
[`docs/testing.md`](docs/testing.md) for the layout, contract tests, snapshots, and the known
pre-existing G12 failures.

## Shared `dist` gotcha

`@motor-combat-moba/shared` `"import"` points at `./dist/index.js`; server and client consume
**built** shared. After editing shared, rebuild it (`npm run build -w @motor-combat-moba/shared`, or
`npm run dev`, which builds then watches). Stale `dist` looks like "I changed constants but nothing
happened."

**Build with root `npm run build`, never `npm run build --workspaces`.** The server's tsup step
*inlines* shared's `dist`, so shared must build first; only the root script enforces shared → server
→ client. Tests import `src`, so a mis-ordered build passes every test while the server runs the old
sim. If a rule works in tests but not in a live room, `grep` the server bundle for your code.

**In a worktree, run `npm install` before the first build.** Otherwise Node resolves
`@motor-combat-moba/shared` through the main checkout's `node_modules` and the build inlines the
**main checkout's** shared. Check the inlined path comment in `packages/server/dist/index.js`:
`// ../shared/dist/…` is correct; `// ../../../../../packages/shared/dist/…` has escaped the worktree.

"Arena mismatch. The server is running "arena-0N", but this build only knows: …" means server and
client run different builds of shared: rebuild shared and hard-refresh.

## Code graph

`code-review-graph` runs as a project-scoped MCP server (`.mcp.json`, launched through `uvx`) over a
local Tree-sitter graph of `src`. It **widens** the search; it does not replace grep.

- **Query it for structure**: `query_graph_tool` (`callers_of`, `callees_of`, `importers_of`,
  `references_to`, `tests_for`) and `get_impact_radius_tool`. It resolves aliased imports and
  re-export chains a name grep misses.
- **Then grep anyway** for untyped wiring the graph has no edge for: weapon/car ids, art manifest
  keys, arena keys, Phaser texture keys, enum names and schema fields used as strings.
- **`npm run build` plus the suites are the ground truth** for typed references.

How it misleads: `not_found` or zero results means **not indexed**, never "no callers" — grep
instead; a bare name returns `ambiguous` — re-query with a `qualified_name`; tests dominate
`callers_of` — pass `detail_level: "minimal"` and read the non-test hits. If
`_graph.head_matches_build` is false, the graph describes other code — rebuild first. Each worktree
needs its own build (`code-graph-install` skill, or `uvx code-review-graph@2.3.8 build`); the graph
lives in gitignored `.code-review-graph/`.

## `docs/turn-tuning.md` is hand-maintained, and a test holds it to the config

It carries three tables (per-car ratings, global knobs, derived values) **once per ACTIVE mode**,
each under that mode's `## <Mode name>` heading. `scripts/turn-tuning-doc.test.mjs` iterates
`activeGameModes()` and recomputes every cell, so a skipped update fails `npm test` naming the mode,
row and chassis; publishing or un-publishing a mode fails it until the sections match. Its prose is
not per-mode and quotes the default mode's figures.

**Update it in the same commit whenever you change** (in the base or any mode's override): a car's
`handling`, `speed` or `brakeDecel`; `DRIVE_CONFIG`'s `baseTurnRate`, `turnRatePerRating`,
`baseMaxSpeed`, `speedPerRating`, `reverseAccelFactor`, `baseDrag`, `dragPerRating`,
`lateralGripRate`, `reverseEpsilon` or `flipSteeringInReverse`; any status row's `turnRate` or
`grip` multiplier (today only `reeling`'s `grip`, with its own "Grip while reeling" row);
`RAM_CONFIG.spinMaxRate`; or `TICK_RATE_HZ`. Adding a chassis needs a new column in three tables.
Use the page's "Keeping this page honest" snippet to print derived values — do not retype them.

**The test cannot see numbers in prose** (`baseDrag`, `dragPerRating`, `lateralGripRate`,
`reverseEpsilon`, `flipSteeringInReverse` appear only there). Re-read the sentences after a tuning
pass even when the suite is green.

## Playtest: say so loudly when the sim changes under the probes

`packages/server/playtest/` holds headless probes that drive the real tick pipeline and measure what
the game does — ram trigger rates, weapon reach, collision depth, prediction error. Not part of the
test suite or the release. `npm run playtest`; reports land in gitignored
`packages/server/playtest/reports/<yyyy-MM-dd-NN>-<mode>/`. See
[`packages/server/playtest/README.md`](packages/server/playtest/README.md).

**After changing anything the probes measure, say so loudly in your summary and recommend a run.
Do not update probes silently or as a matter of course** — name the probe and the number, and update
it only if the user asks. Flag a change that makes a probe's expectation, threshold or verdict
wrong; moves a number a probe comment or report string quotes; or stops a probe compiling or
reaching its code path. **A compile break is the one thing to fix on the spot** — say that you did.

Changes that reach them: `sim/` (drive, collide, ram, combat, damage, status, weapons), the tick
order in `ArenaRoom.tick` or the bridges, any balance table, `NET_CONFIG`, `TICK_RATE_HZ`,
`SNAPSHOT_RATE_HZ`, arena definitions and spawns, and the client's prediction or step-context
assembly.

**Never create a new probe file or scenario on your own initiative.** Keep these properties in any
edit:

- **Probes report, they do not assert.** Verdicts are `OK`, `FINDING`, and `KNOWN-BY-DESIGN`.
- **Anything involving contact sweeps the sub-tick phase**; a single placement measures one arbitrary
  point on the tick grid.
- If you fixed what a probe was measuring, update its expectation so the fix reads `OK`, and say so.
  Do not delete the probe.

## Balance harness: glitches vs balance are different questions

`packages/server/balance/` (`npm run balance`) asks whether a chassis or weapon is **too strong** —
playtest asks whether the sim **misbehaves**. Every report carries a bot fingerprint (`BOT_PROFILES`
+ `BOT_BRAIN_VERSION`) and a config fingerprint (the mode's bundle); `--baseline` refuses
incomparable runs. Known distortion: `corroded`'s amplified damage is credited to the weapon that
lands the hit. See [`packages/server/balance/README.md`](packages/server/balance/README.md) and
[`docs/superpowers/specs/2026-09-03-game-balance-harness-design.md`](docs/superpowers/specs/2026-09-03-game-balance-harness-design.md).

## The cars & weapons guide is generated, committed, and easy to leave stale

`packages/client/public/manual.html` (opened from the join screen) is written by
`scripts/build-cars-and-weapons.mjs`, **never by hand**; numbers come from built shared, prose from
`scripts/cars-and-weapons-copy.mjs`. It publishes **one tab per active mode** (labels from
`MODE_TABLE.name`; with scripting off every mode stacks), each with **Cars** (active chassis'
ratings, then a "Basic attack" card if that mode enables it, then the `min(kit, N)` ability kit) and
**Effects** (every status something active can apply, plus `EFFECT_SOURCES` for `reeling`, `ramLock`
and `phased`). Points that do not apply are omitted, not dashed. Effect chips link to
`#fx-<mode>-<statusId>`; `manual-page.test.mjs` resolves every link both ways, per tab.

**Prose quotes numbers through placeholders** (`{namespace.fact}`, `{token:words}`) defined in
`scripts/manual-facts.mjs` — an unknown token fails the build, and `manual-facts.test.mjs` fails on a
typed-out token value or a spelled-out measurement. `manualFacts()` is `{}` today; add the fact a
new measuring sentence needs.

**Re-run `npm run build:manual` and commit the page whenever you change**, in **any active mode**:
a weapon row, an active chassis row or loadout, the combat, drive, status, slots or turret tables
(including `slots.basicAttackEnabled`), `TICK_RATE_HZ`, the arena a mode plays first (reach
percentages use each mode's `arenas[0]` playable width), the set of active modes, or the copy file.
`balanceStamp` hashes all of it — **whole rows**, so purely visual fields like `WEAPON_TABLE.color`
count — and `scripts/manual-page.test.mjs` fails with the command to run. Inactive chassis reach
neither the page nor the stamp.

The page ships in the LAN zip, links its art, inlines its fonts and reaches nothing off the machine
(asserted by the test). Its URL is `MANUAL_PATH` in `packages/client/src/config/manual.ts`.

### Art is the exception

The page **links** `public/art/`, so swapping a weapon icon (`scripts/import-weapon-icon.mjs`) or a
car sprite (`scripts/import-art.mjs`) changes the guide with no rebuild and no failing test. **After
importing art the guide draws, say so loudly and recommend checking
`http://localhost:5173/manual.html`.** Do **not** run `npm run build:manual` for an art swap.

`npm run check:art` (`:cars`, `:weapons`) guards art that bypassed an importer. Blockers (lost alpha,
a manifest row naming a missing file, an icon the tint would drain) fail `npm test` via
`scripts/check-art.test.mjs`; warnings never do — rows without an icon yet (the basic-attack rows)
warn and fall back to a procedural glyph. Nothing ties a weapon's icon colour to its
`WEAPON_TABLE.color`: when re-importing an icon, check it against the row and flag drift (changing
`color` owes a manual rebuild).

## Commands

```bash
npm run dev            # shared watch + server :2567 + Vite client :5173; sets DEV_TOOLS=1,
                       #   DEPLOY_MODE=lan, CLIENT_ORIGIN=http://localhost:5173
                       #   -- http://localhost:5173/?dev=playground opens the dev-only playground
npm run build          # shared -> server -> client, in that order (never --workspaces)
npm test               # build shared, typecheck, all workspace suites, scripts tests
npm run test:mode -- <slug>  # one mode's tests (+ snapshots/invariants for shared)
npm run test:affected  # run the scope this diff owes (scripts/test-scope.mjs)
npm run test:slow      # bot + real-match balance tests, excluded from npm test
npm run test:scripts   # scripts/*.test.mjs only (manual stamp, turn-tuning doc, art)
npm run build:release  # dist-release/motor-combat-moba/ + zip; --port <n> bakes the port
npm run install-build  # build a release into the folder named in .install-target; --port <n>
npm run build:manual   # regenerate the cars & weapons guide
npm run check:art      # art integrity (:cars, :weapons)
npm run ttk            # full-kit time-to-kill matrix; --mode=<id|name>
npm run playtest       # headless sim probes; --mode=<id|name> --scope=mode|common|all
npm run playtest:lan   # two bot clients against a server you already started
npm run balance        # win-rate/matchup harness; e.g. -- --shape=duel --matches=20 --seed=7 --mode=deathmatch
```

## Read the right doc

| Topic | Doc |
|---|---|
| Walking skeleton / source tree | [`docs/architecture.md`](docs/architecture.md), [`docs/project-structure.md`](docs/project-structure.md) |
| Netcode, input and prediction seams | [`docs/networking.md`](docs/networking.md) |
| Schema fields | [`docs/schema-reference.md`](docs/schema-reference.md) |
| Env knobs and balance tables | [`docs/config-reference.md`](docs/config-reference.md) |
| Weapon, ram, status, elimination rules | [`docs/combat-model.md`](docs/combat-model.md) |
| Turn/aim tuning and every turn stat | [`docs/turn-tuning.md`](docs/turn-tuning.md) |
| Bot behaviour and parameters | [`docs/bot-behavior.md`](docs/bot-behavior.md) |
| Tests, scopes, snapshots | [`docs/testing.md`](docs/testing.md) |
| Art, manifest, asset swapping, shot cost | [`docs/asset-pipeline.md`](docs/asset-pipeline.md) |
| LAN zip / `start.bat` | [`docs/deployment.md`](docs/deployment.md) |
| Language / import rules | [`docs/conventions.md`](docs/conventions.md) |
| Plan sequence | [`docs/roadmap.md`](docs/roadmap.md) |
| Terms | [`docs/glossary.md`](docs/glossary.md) |
| Code graph setup | [`docs/code-review-graph.md`](docs/code-review-graph.md) |
| Playtest / balance harnesses | [`packages/server/playtest/README.md`](packages/server/playtest/README.md), [`packages/server/balance/README.md`](packages/server/balance/README.md), header of [`scripts/ttk.mjs`](scripts/ttk.mjs) |
| Package-local rules (shot looks, VFX, server notes) | `packages/shared/CLAUDE.md`, `packages/server/CLAUDE.md`, `packages/client/CLAUDE.md` |
| Per-mode config (MC1–MC42) and the mode layer (GM1–GM40) | [`2026-09-22-per-mode-config-design.md`](docs/superpowers/specs/2026-09-22-per-mode-config-design.md), [`2026-09-25-game-mode-layer-design.md`](docs/superpowers/specs/2026-09-25-game-mode-layer-design.md) |
| Unity physics port — current drive/ram/slam model (stage 5 paused) | [`plans/2026-09-18-unity-physics-port/EXECUTION.md`](docs/superpowers/plans/2026-09-18-unity-physics-port/EXECUTION.md) |
| Netcode redesign (NR1–NR68) | [`2026-09-29-online-netcode-redesign-design.md`](docs/superpowers/specs/2026-09-29-online-netcode-redesign-design.md) |
| Tile arenas (TA) and tile cells (TC) | [`2026-10-09-tile-arenas-design.md`](docs/superpowers/specs/2026-10-09-tile-arenas-design.md), [`2026-10-09-tile-cells-design.md`](docs/superpowers/specs/2026-10-09-tile-cells-design.md) |
| Camera behaviours | [`2026-09-28-camera-behaviors-design.md`](docs/superpowers/specs/2026-09-28-camera-behaviors-design.md) |
| Conquer (CQ1–CQ62) | [`2026-09-24-conquer-mode-design.md`](docs/superpowers/specs/2026-09-24-conquer-mode-design.md) |
| Deathmatch, kill attribution, respawn, `isSolid` (M1–M33) | [`2026-09-01-ffa-game-modes-design.md`](docs/superpowers/specs/2026-09-01-ffa-game-modes-design.md) |
| Mouse-aim turret (TR) | [`2026-09-21-mouse-aim-turret-design.md`](docs/superpowers/specs/2026-09-21-mouse-aim-turret-design.md) |
| Variable ability slots (VS1–VS34) | [`2026-09-20-variable-weapon-slots-design.md`](docs/superpowers/specs/2026-09-20-variable-weapon-slots-design.md) |
| Basic attack (BA1–BA38) | [`2026-09-17-basic-attack-design.md`](docs/superpowers/specs/2026-09-17-basic-attack-design.md) |
| Weapon system (D1–D22); retired aim lock (A1–A14, record only) | [`2026-08-27-weapon-system-design.md`](docs/superpowers/specs/2026-08-27-weapon-system-design.md), [`2026-08-27-aim-assist-target-lock-design.md`](docs/superpowers/specs/2026-08-27-aim-assist-target-lock-design.md) |
| Weapon roster (L1–L7) and chassis triangle (T1–T22, supersedes L's assignments) | [`2026-08-29-weapon-roster-design.md`](docs/superpowers/specs/2026-08-29-weapon-roster-design.md), [`2026-08-30-chassis-rename-and-weapon-redistribution-design.md`](docs/superpowers/specs/2026-08-30-chassis-rename-and-weapon-redistribution-design.md) |
| Status mechanism | [`2026-08-29-status-mechanism-design.md`](docs/superpowers/specs/2026-08-29-status-mechanism-design.md) |
| Practice mode (PR1–PR31) | [`2026-09-03-practice-mode-design.md`](docs/superpowers/specs/2026-09-03-practice-mode-design.md) |
| Playground (PG1–PG88, EV1–EV34) | [`2026-09-01-playtest-playground-design.md`](docs/superpowers/specs/2026-09-01-playtest-playground-design.md), [`2026-09-02-…-bot-difficulty`](docs/superpowers/specs/2026-09-02-playground-usability-and-bot-difficulty-design.md), [`2026-09-08-…-vfx-settings`](docs/superpowers/specs/2026-09-08-playground-vfx-settings-design.md), [`2026-09-08-…-environment-vfx`](docs/superpowers/specs/2026-09-08-playground-environment-vfx-design.md), [`2026-09-16-…-six-car-select`](docs/superpowers/specs/2026-09-16-playground-six-car-select-design.md) |
| Lobby chat | [`2026-09-06-lobby-chat-design.md`](docs/superpowers/specs/2026-09-06-lobby-chat-design.md) |
| Bot situation play | [`2026-09-05-bot-situation-play-design.md`](docs/superpowers/specs/2026-09-05-bot-situation-play-design.md) |
| v1 spec and tracker | [`2026-08-24-motor-combat-moba-v1-design.md`](docs/superpowers/specs/2026-08-24-motor-combat-moba-v1-design.md), [`v1-master-index`](docs/superpowers/plans/2026-08-24-motor-combat-moba-v1-master-index.md) |
| Skills for common tasks | `game-mode`, `weapon-forger`, `weapon-look`, `bot-tuner`, `ability-slot-count`, `basic-attack-toggle`, `process-car-asset`, `process-weapon-icon`, `code-graph-install` (`.claude/skills/`) |
| The user's own notes | `docs/ideas/`, `docs/invariants/` — **off limits unless named** (see above) |
