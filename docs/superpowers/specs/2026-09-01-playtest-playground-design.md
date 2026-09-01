# Motor Combat MOBA — Playtest Playground Design

**Designed:** 2026-09-01 · **Recorded in repo:** 2026-09-01
**Status:** Approved, not yet implemented.
**Builds on:** [`2026-09-01-ffa-game-modes-design.md`](2026-09-01-ffa-game-modes-design.md) (whose
respawn/spawn-protection machinery this reuses) and
[`2026-08-29-status-mechanism-design.md`](2026-08-29-status-mechanism-design.md).

Decisions are numbered **PG1–PG23** and referenced by number elsewhere.

---

## Problem

Tuning this game today means: edit a config table, rebuild shared, restart the dev server, open two
browser tabs, click through join → lobby → car select → reveal → countdown, and finally feel the
change for a few seconds before repeating. The headless probes measure what the sim *does*; nothing
short of a full two-player match answers what a change *feels* like. And there is no way to try a
car or a weapon kit that players are not supposed to see yet.

The **playground** is a dev-only single-player sandbox: `?dev=playground` drops the developer
straight onto the match screen against a bot (or a still target), with a pause menu, live sliders
over the balance tables, free car/weapon assignment, and an export of whatever numbers felt right.

---

## Scope

In: a dev-only server room and client overlay, a runtime tuning-override seam in shared, a
chase-and-fire bot, car switching, an `isActive` flag on `CarDef`, persistence and export of
overrides.

Out: any new player-facing feature; multiplayer playground sessions; bot difficulty or behavior
options; editing `isActive` from the playground; changing the drive model, the OBB hitbox model,
collision-damage rules, or friendly-fire; new playtest probes.

---

## Entry and gating

### PG1. A dev-only room beside the arena, not a mode inside it

The playground plays the real game, so it must run the real server pipeline — `runCombat` and the
bridges are server-side, and prediction-feel only exists over a real room. It is therefore a second
Colyseus room type, `"playground"`, living next to the singleton `arena` room. It is **not** a
`GameMode`: nothing about it is selectable by players, nothing about it is networked to a release
client, and the `GameMode` enum stays untouched.

### PG2. Client entry: a `DEV_TOOLS` registry row

`playground` becomes a second row in `DEV_TOOLS` (`packages/client/src/dev/registry.ts`), exactly
like `assets`: lazily imported, reachable only behind `BootScene`'s `import.meta.env.DEV` gate, and
carrying the `DEV_TOOL_MARKER` string so `assertNoDevOnlyCode` in `scripts/build-release.mjs` keeps
it out of release bundles by assertion, not hope.

`?dev=playground` boots a thin `PlaygroundScene` that connects to the `playground` room directly —
auto-generated player name, no Join, no Lobby, no Car Select — then launches the real `ArenaScene`
on that room and mounts the overlay (PG19). The developer is driving seconds after hitting Enter.

### PG3. Server gating: `DEV_TOOLS=1`

`packages/server/src/index.ts` registers the `playground` room **only when `DEV_TOOLS=1`** is in the
environment. `npm run dev` sets it alongside `DEPLOY_MODE=lan`; `build:release` and the release
`.env` never do. A shipped server therefore has no such room and a join attempt fails with
Colyseus's ordinary "no such room" error — which cannot be reached anyway, because release clients
strip the tool that would try (PG2). The room code itself ships inside the server bundle; the
registration gate, plus the client-side strip, is what "dev mode only" means here.

`maxClients = 1`. The playground is single-player by definition, and the room's **name** differing
from `arena` is what lets it coexist with the singleton rule — `shouldRejectSecondArena` queries
listings for `ROOM_NAME` only.

---

## The room

### PG4. The tick pipeline is extracted, never forked

`ArenaRoom.tick`'s simulation core — `statusTick` → `serverTick` → `contactTick` → `combatTick`,
threading `statusMods`, `masks`, `approachSpeeds` and the three memory bags — moves into a helper
module (`packages/server/src/rooms/tick-pipeline.ts`) that **both** rooms call. The deathmatch
respawn pieces (`respawnSweep`, `respawn`, `phaseEndSweep`, `overlapsSolid`) move with it, since the
playground reuses them verbatim (PG6). `ArenaRoom` keeps its flow machine, win checks, and lobby
messages; its behavior is identical before and after the extraction.

This is the one production-touching refactor in the design. The alternative — a `PlaytestWorld`-style
copy of the pipeline inside the playground — is exactly the fork the repo's rules exist to prevent:
it would drift the first time the tick order changed.

### PG5. `PlaygroundState extends ArenaState`

Colyseus schema subclassing carries the base fields plus dev-only additions:

| Field | Type | Meaning |
|---|---|---|
| `paused` | `boolean` | The sim is frozen (PG7). |
| `controlledSessionId` | `string` | The car the human is driving (PG9). |
| `botEnabled` | `boolean` | vs-bot (`true`) or alone (`false`) (PG10/PG11). |
| `tuningJson` | `string` | The active overrides blob, `""` for none (PG13). |

`arenaId` and per-player `carId`/`weapons` already exist on the base schema and carry the arena and
loadout selections. No base schema field changes, so invariant 7 (stable wire values) and invariant
8 (sim-read fields are networked) both hold — the new fields are additive and live only on a room
type release clients can never join.

### PG6. Phase pinned to `MATCH`; endless; deathmatch respawns

The room sets `phase = RoomPhase.MATCH` at creation and never runs `reduceFlow`. There is no
countdown, no reveal, no results — and **no win check**: neither `livingSides` nor
`deathmatchEnded` is ever called. Death runs the extracted deathmatch machinery unchanged — respawn
after `DEATHMATCH_CONFIG.respawnDelaySeconds` at the spawn farthest from the other car, `phased`
protection with the same cap-and-decision lifecycle. A playground session ends when the tab closes
or the client leaves, and `onLeave` disposes the room.

### PG7. Pause freezes `state.tick`

`MSG_PLAYGROUND_PAUSE` toggles `state.paused`. While paused, `tick()` returns before incrementing
`state.tick`, so the entire sim — cooldowns, statuses, respawn timers, shot lifetimes — freezes
coherently, because everything keys off the tick counter. The client mirrors the flag: while
`state.paused` it stops sending inputs and stops predicting. The playground clock is therefore not
wall-time; nothing outside the room reads it, so nothing cares.

The overlay owes one subtlety to the resume edge: input `seq` continues from where it stopped (the
queue is per-session and drained by tick, so a gap in wall-time is invisible to it).

---

## Control, switching, and the bot

### PG8. Two cars: the human's `PlayerState` and a synthetic bot session

`onJoin` creates the human's `PlayerState` as usual, plus a second `PlayerState` under a synthetic
session id (e.g. `"bot"`) with its own input queue and fire-mask entry. Both are in `matchRoster`
from the first tick. The bot's row is schema-ordinary: the client renders it exactly like a remote
player, and no client change is needed to see it.

### PG9. Control is routed, not swapped

`controlledSessionId` names the car the human drives. The room routes the human client's validated
`InputMessage`s into the **controlled** car's input queue; `MSG_PLAYGROUND_SWITCH` flips the field.
The only button that sends it lives in the pause menu, so a switch always happens on a frozen sim;
the room nonetheless accepts it at any time, because refusing would add a guard nothing exercises.

Swapping *control* rather than swapping *state* is the decision: a state swap would have to move
pose, hp, statuses, knock, fire state, damage clocks and last-damager credit between two
`PlayerState`s and three server-side memory maps, and missing any one of them is a silent bug.
Routing moves nothing.

On the client, every place `ArenaScene` means "the car I drive" — prediction, reconciliation,
camera follow, weapon/status HUD — currently reads `room.sessionId`. That becomes one seam
function: `controlledSessionId(state, room)` returning `state.controlledSessionId || room.sessionId`
— the field is absent (empty) on the base `ArenaState`, so real matches resolve to `room.sessionId`
exactly as today. (The seam gets its own name — `controlledCarOf` or similar — rather than
shadowing the field.) On a switch the client clears its `PredictionBuffer` and adopts the server
pose, the same recovery it already performs after a large reconcile correction.

### PG10. The bot is a synthetic client

`playground-bot.ts` (server-side) computes one ordinary `InputMessage` per tick for whichever car
the human is not controlling, and enqueues it through the same validation path a real client's
message takes — the "clients send inputs, never state" invariant holds because the bot *is* a
client, just an in-process one. Behavior, deliberately dumb: steer by signed angle delta toward the
target (the LAN probe's chaser pattern), full throttle beyond a standoff distance, and set a
`fireSlots` bit when roughly aimed and within that slot weapon's range. No dodging, no kiting, no
difficulty knob.

### PG11. Alone mode: the other car is a target dummy

With `botEnabled = false` the un-controlled car receives no input: it rolls to a stop and sits. It
stays fully solid and targetable — `isOnField` and `isSolid` are untouched — so it still takes
hits, still rams back with its mass, and still dies and respawns. Switching cars works identically
in both modes; in bot mode the bot simply starts driving whichever car the human just left.

---

## The tuning seam

### PG12. A module-level tuning store in shared

`packages/shared/src/config/tuning.ts` exports `setTuning(overrides: TuningOverrides | null)`.
Today `CHASSIS_DRIVE` and `WEAPON_TICKS` are resolved and frozen at module load; they become the
**default** resolved tables, and every resolution point — `driveOf`, `weaponDefOf`, `hpOf`, and the
consumers of `WEAPON_TICKS` and `RAM_REFERENCE` — reads through an *active* table that starts as —
and, when tuning is null, **is** — the frozen default. `setTuning(overrides)` recomputes every
resolved and derived table once from `defaults + overrides`; `setTuning(null)` restores the
defaults by reference. Whether a given point becomes an accessor function or keeps a live-bound
table export is an implementation choice per point; the requirement is only that the untuned path
resolves to the identical frozen objects it does today.

Why this shape and not parameter-threading:

- **Zero hot-path cost.** Resolution stays a table read; no per-tick override check, no allocation.
- **Nothing changes when it is never called.** No signature of `stepSim`, `stepDrive`, `runCombat`
  or any render function moves. `golden.test.ts` and every existing suite run against the untouched
  defaults — their staying green *is* the proof the seam is inert in production.
- **Both halves of the lockstep, and rendering, agree for free.** `stepSim`'s internal
  `driveOf(ctx.carId)` picks up overrides on server and client alike once each side has called
  `setTuning`; `combat-visual.ts` already resolves through `weaponDefOf`, so a tweaked hitbox
  draws at the size it hits at — "what you see is what will hit you" survives tuning.

### PG13. Overrides cross the wire as one blob

The overlay sends `MSG_PLAYGROUND_TUNING` with the override object. The server validates it (PG14's
walker doubles as the whitelist: every path must exist in the shipped config, every value must be a
finite number / boolean / known string literal, numbers clamped to the slider range), **rejects the
whole blob on any invalid entry** — a partially-applied tuning is worse than a refused one — then
calls `setTuning` and writes the JSON to `PlaygroundState.tuningJson`. The client watches
`tuningJson` and feeds the same object to the same `setTuning`. Invariant 8 holds: the thing the
sim reads crossed the wire; server sim, client prediction, and client rendering resolve through one
store. A JSON-string schema field is deliberate pragmatism for a dev-only room — the blob's shape
is "a slice of the config tables", which no schema type should try to mirror.

### PG14. What is tunable is walked out of the config, not listed by hand

A pure walker enumerates the tunable surface from the shipped objects themselves:

- Per-car: the six `CAR_TABLE` ratings.
- Global: every field of `DRIVE_CONFIG`, `RAM_CONFIG`, `COMBAT_CONFIG`.
- Per-weapon: the currently-selected six weapons' `WEAPON_TABLE` rows.

Numbers become sliders ranged 0 to ~3× the shipped value; booleans become toggles; string-literal
fields become dropdowns over the values observed across the table. Identity and shape fields are
skipped: `id`, `name`, `kind`, `color`, and the `weapons` kit array (loadout has its own UI, PG17).
Changing a weapon's `kind` is authoring a different weapon, not tuning one. The same walker output
is the server's validation whitelist, so the UI and the validator cannot drift — new config fields
appear in both, for free, the day they are added.

### PG15. The store is process-wide; the room guards the process

A module-level store on the server is shared by every room in the process. Overrides active while a
real arena match runs on the same dev server would silently re-balance that match. Mitigations,
accepting the wart rather than re-plumbing production signatures:

- `PlaygroundRoom.onCreate` refuses (clean error) while the arena room has a player in a match.
- `onLeave`/`onDispose` call `setTuning(null)` unconditionally.
- The room only exists behind `DEV_TOOLS=1` (PG3) — one developer, one machine.

The client-side store needs no guard: one tab, one room, and `ArenaScene` for a real match never
calls `setTuning`.

### PG16. Apply semantics

Stat overrides **hot-apply on resume**: settings are only reachable from the pause menu, the blob is
sent when leaving the settings screen, and the server applies it immediately — the paused sim first
reads the new tables on resume. Cars keep pose, hp, and cooldowns. Changing a **car**, a
**loadout**, or the **arena** instead respawns the affected car(s) through the PG6 respawn path — a
new chassis needs fresh hp and fire state anyway, and reusing the one "nothing survives except the
score" function beats inventing in-place mutation. An arena change respawns both cars.

### PG17. Loadout is per car, distinct within a car

`newFireState(carId, level)` gains an optional explicit slot list — `newFireState(carId, level,
weaponIds?)` — falling back to `slotsOf(carId)` as today, and the room writes the matching
`PlayerState.weapons` rows. Each car's three slots must be **distinct** weapons (the shape every
HUD and fire-machinery assumption was built against); the **same weapon on both cars is allowed**
(mirror-matchup testing). The roster's cross-chassis exclusivity rule (L1) is an authoring rule for
`CAR_TABLE`, not a sim rule, and does not apply here.

---

## The `isActive` flag

### PG18. Authored in config, filtered in the real flow, ignored in the playground

`CarDef` gains `isActive: boolean`; all three shipped cars set `true`. Consumers:

- `CarSelectScene`'s grid shows only active cars.
- `ArenaRoom` rejects `MSG_SELECT_CAR` / `MSG_PREVIEW_CAR` for inactive ids — the server-side
  guard, since the client cannot be trusted to have filtered.
- A config test enforces "at least one active car" and "`DEFAULT_CAR_ID` is active", which also
  keeps `carAtDeadline`'s fallback legal.
- The playground lists `CAR_TABLE` whole and never writes the flag — activating a car is a config
  edit with its documented doc obligations, by design.

Known cost, paid in the same change: `balanceStamp` hashes `CAR_TABLE` whole, so adding the field
moves the stamp — `npm run build:manual` must be re-run and `manual.html` committed, or `npm test`
fails saying so.

---

## The overlay UI

### PG19. A DOM overlay, not Phaser

A dev tool with dozens of generated sliders is a form, and HTML is the right material for a form.
`PlaygroundScene` mounts a DOM panel over the canvas; the canvas keeps rendering underneath.

- **Pause menu** (`P`, or `MSG_PLAYGROUND_PAUSE` from the Resume button): *Resume* · *Switch car* ·
  *Settings*. `P` inside settings backs out to the pause menu; the game stays paused until Resume.
- **Settings sections**, top to bottom: Mode (alone / vs bot) · Arena (dropdown over `ARENAS`) ·
  My car / Opponent car (all cars) · My weapons / Opponent weapons (three slot dropdowns each) ·
  Car stats (per-car ratings + the global group) · Weapon stats (the selected six rows). Every row
  shows the shipped value and a per-row reset; a *Reset all* sits at the top.
- The pure parts — the config walker (PG14), override diffing, slider ranges, the localStorage
  codec (PG20) — live in plain modules with node-env vitest coverage. The DOM mounting stays thin
  and untested, like `ArenaScene` itself.

### PG20. Persist and export

First entry, with nothing stored: vs bot, both cars `DEFAULT_CAR_ID` with their shipped loadouts,
the base `ArenaState`'s default arena, no overrides. After that, selections and overrides are
written to `localStorage` on every change and replayed to the server on entering the playground. Replay is validated by the same walker whitelist, and **stored paths that
no longer exist in the config are dropped silently** — config evolves between sessions, and a stale
saved override must never wedge the playground shut. A **Copy overrides** button puts a JSON object
of only-the-changed-values on the clipboard, ready to paste into a tuning conversation or a config
edit.

---

## What already-shipped rules this leans on

### PG21. Death: endless deathmatch respawns

Chosen over "cars can't die" (which hides kill thresholds and death feel) and over real elimination
(which would end the session every death). The `DEATHMATCH_CONFIG` timers apply unchanged.

---

## Testing and obligations

### PG22. Tests

- **Inertness:** every existing suite, `golden.test.ts` above all, runs without `setTuning` ever
  being called and must stay green **untouched** — that is the release-behavior proof.
- **New units:** `setTuning` recompute/reset round-trip (overridden table, then null restores the
  frozen default by reference); walker paths all exist in the shipped config; blob validation
  (reject-whole on one bad entry); bot steering/fire derivation; input routing and switch; pause
  gating; the `isActive` config test (PG18); `controlledSessionId` seam resolving to
  `room.sessionId` on a base `ArenaState`.
- **Release safety:** `assertNoDevOnlyCode` already fails a release containing `DEV_TOOL_MARKER`,
  which the playground scene carries (PG2).

### PG23. Obligations owed elsewhere

- `docs/config-reference.md`: `isActive`, the tuning store and its dev-only callers.
- `docs/project-structure.md`: the new files.
- Root `CLAUDE.md` doc table: a pointer to this spec.
- `manual.html`: regenerated for the `CAR_TABLE` stamp move (PG18).
- **Playtest:** the pipeline extraction (PG4) and the active-table indirection (PG12) are
  behavior-identical by design but sit squarely in what the probes measure. After implementation,
  run `npm run playtest` and confirm nothing moved. No probe expectation should need editing.
