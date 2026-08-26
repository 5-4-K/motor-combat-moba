# Motor Combat MOBA — Multi-Arena Selection and Release Pruning Design

**Designed:** 2026-08-26 · **Recorded in repo:** 2026-08-26
**Status:** Implemented.
**Plan:** [`docs/superpowers/plans/2026-08-26-arena-selection-and-release-pruning.md`](../plans/2026-08-26-arena-selection-and-release-pruning.md)

---

## Problem

The game has exactly one arena. `ARENA_01` (`packages/shared/src/arena/arena-01.ts`) is a frozen
literal of obstacle rects and spawns; `getArena` (`packages/shared/src/arena/registry.ts`) is an
`if` that returns it and throws on anything else; `arena.test.ts` asserts that arena's specific
width, height, and obstacle count. `ArenaScene.drawArena`
(`packages/client/src/scenes/ArenaScene.ts:242`) renders it with a `fillRect` loop and three
hard-coded colours. Nothing arena-shaped exists in the art manifest.

Three things are wanted, in order:

1. **Many arenas.** Author several layouts and keep them all in the repo.
2. **A one-line switch.** Change which arena the game plays by editing a code constant.
3. **A lean release.** The release zip carries only the selected arena's assets, so a repo full of
   experimental arenas does not inflate what players download.

Arenas are drawn procedurally today, but obstacle sprites — and later spawn/power-up art — are
planned. The asset seam must exist now: retrofitting a namespace convention after art has landed
means moving files and rewriting manifest keys across every arena at once.

## Constraints

1. `stepSim` is the lockstep. Anything it reads is shared and networked (invariants 4 and 8).
2. No magic numbers in logic; tweakables live in `shared/config` (invariant 2).
3. Shared is consumed as built `dist` by both server and client (invariant 9), and the root build
   orders shared → server → client.
4. The art pipeline is manifest-driven and drop-in: a PNG under `public/art/` plus a manifest row is
   the whole ceremony. `scripts/import-art.mjs` and the `?dev=assets` tuner depend on that.
5. The release is a self-contained LAN zip; the server serves the client it shipped with.
6. Missing art degrades to procedural drawing rather than failing (established by the asset
   pipeline design).

## Non-goals

- A lobby arena picker or host-selectable arenas.
- Random or rotating arena selection per match.
- A visual arena editor. Layouts are hand-written TypeScript.
- Pruning arena *layout data* from the bundle. Rects are kilobytes; only art has weight.
- Any change to the drive model, the OBB hitbox model, or collision damage rules.

---

## Decisions

### D1 — One active arena, named by a shared config constant

`packages/shared/src/config/arena-config.ts` holds a single exported constant:

```ts
/** The one arena this build plays and ships. Change this line to change arenas. */
export const ACTIVE_ARENA_ID = "arena-01";
```

It lives in `config/` rather than in the registry because that is the documented place tweakables
live (`docs/config-reference.md`). `DEFAULT_ARENA_ID` is removed and replaced by it; its only
current consumers are two client tests.

`ArenaState.arenaId` defaults to `ACTIVE_ARENA_ID` instead of the literal `"arena-01"`, which also
retires a magic string from the schema. The server continues not to assign `arenaId` explicitly —
the schema default is the value, and Colyseus patches it to clients as it does today.

Rejected alternatives:

- **An `ARENA_ID` env var.** Swappable without a code edit, but the release build cannot know at
  bundle time which arena to keep, which defeats requirement 3.
- **A list of enabled arenas with random selection per match.** More variety, but every enabled
  arena's art then ships, which is the weight problem restated.
- **Host picks in the lobby.** Requires all arenas in the build, new lobby messages, and new UI.
  A separate feature, not a prerequisite for authoring arenas.

### D2 — The registry becomes a map

```ts
export const ARENAS = { "arena-01": ARENA_01, "arena-02": ARENA_02 } as const;
export type ArenaId = keyof typeof ARENAS;
export function isArenaId(id: string): id is ArenaId;
export function getArena(id: string): ArenaDef;   // still throws on unknown
export const ARENA_IDS: readonly string[];
```

Adding an arena is a new `arena-0N.ts` plus one row. `getArena` keeps throwing on unknown ids: it is
called from the sim path on the server, where an unknown id is a programming error with no sane
fallback. `isArenaId` exists so the *client* can check before resolving (see D6).

A shared test asserts `ACTIVE_ARENA_ID` is a key of `ARENAS`, so a typo fails the build rather than
throwing inside a live room.

### D3 — The arena validator becomes a rule table over every arena

`arena.test.ts` today asserts facts about `ARENA_01` — `width` is 2400, there are 6 obstacles. Those
pin the exact thing this work exists to iterate on. They are replaced by rules applied to every
entry in `ARENAS`:

- `def.id` equals its registry key.
- `width` and `height` are positive finite numbers.
- Every obstacle lies inside the bounds.
- Every obstacle is at least one car diagonal (`hypot(DRIVE_CONFIG.carWidth, carHeight)`) clear of
  each wall. Already implemented for `ARENA_01`; generalised.
- Every corridor between two obstacles is at least one car diagonal wide. Already implemented;
  generalised.
- At least `MAX_PLAYERS` FFA spawns, and at least `MAX_PLAYERS / 2` spawns per team. Derived from the
  shared constant rather than the literals 6 and 3. Note that `MAX_TEAM_SIZE` is deliberately **not**
  the right floor here: it is 4 because a full lobby needs swap headroom, while `canStart` refuses
  unequal teams and so caps team mode at 3v3.
- Every spawn lies inside the bounds and clear of every obstacle.
- Team A spawns are in the left half, team B spawns in the right half.
- No two spawns within one car diagonal of each other.

This mirrors commit `b277cfb`, which ranged the drive-physics assertions rather than pinning them,
for the same reason: a test that pins a tuning value fails on every legitimate change and teaches
whoever hits it to edit the test without reading it.

Consequence: a badly authored arena fails CI instead of trapping a car inside geometry at runtime.

### D4 — Arena art is namespaced by arena id, by convention

No new field on `ArenaDef`. A naming convention both the client and the release script can act on
with no list to keep in sync:

| Manifest key | On disk | Pruned from the release? |
|---|---|---|
| `arena.<arenaId>.<slot>` | `public/art/arenas/<arenaId>/<slot>.png` | Yes, unless `<arenaId>` is active |
| `arena.common.<slot>` | `public/art/arenas/common/<slot>.png` | Never |
| Anything else (`car.*`, later `powerup.*`) | As today | Never |

Arena-owned art is prunable by prefix. Art shared between arenas, or global to the game, lives
outside the prunable prefix and always ships. Every arena's art set is empty today and `drawArena`
keeps drawing rects, so the convention costs nothing until the first PNG lands.

Rejected alternative: an `assets: readonly string[]` field on `ArenaDef` declaring each arena's
manifest keys. It duplicates on-disk truth into shared, and the two drift the first time a file is
renamed. The convention is enforceable by a test; a hand-maintained list is not.

### D5 — Pruning happens in the release script, on the copied dist

Two new exported functions in `scripts/build-release.mjs`, beside the guards already there:

```
pruneArenaAssets(clientDistDir, activeArenaId) -> { kept, removed, bytesRemoved }
assertOnlyActiveArenaShipped(clientDistDir, activeArenaId)
```

`pruneArenaAssets` deletes `art/arenas/<id>/` for every id that is neither active nor `common`, then
rewrites that copy's `art/manifest.json` to drop the matching `arena.<id>.*` keys.
`assertOnlyActiveArenaShipped` re-walks the tree and throws if any non-active arena file or manifest
key survived — the same belt-and-braces shape as `assertFontsVendored` and `assertNoDevOnlyCode`.

Two properties this depends on:

- **It operates on the copied release folder**
  (`dist-release/motor-combat-moba/packages/client/dist`), not on `packages/client/dist`. The source
  dist stays complete and reusable, and repeated release builds are idempotent.
- **The script reads the active id by importing `packages/shared/dist/index.js`.** That file is plain
  ESM and importable from a `.mjs` script, and `requireBuiltDist` already enforces "build first". One
  source of truth; no constant duplicated into a build script to drift.

`main()` prints the arena it shipped and the arenas it skipped, so pruning is visible rather than
silent.

Rejected alternatives:

- **A Vite plugin filtering `dist` at bundle time.** Would leave `packages/client/dist` lean too, but
  nothing except the release consumes `client/dist`. It moves release-shaping logic into
  `vite.config.ts` and makes it materially harder to unit-test.
- **Moving arena art into `src/` and letting Vite tree-shake static imports.** Fully automatic, but
  it abandons the manifest-driven drop-in pipeline: `import-art.mjs`, the `public/art/` convention,
  and the `?dev=assets` tuner all depend on art being data rather than code.

### D6 — The client loads only the active arena's art, and fails loudly on a mismatch

**Loading.** `BootScene.loadArt` loads every manifest key today. It gains a filter, extracted as a
pure function so it is testable without Phaser:

```ts
shouldLoadAssetKey(key: string, activeArenaId: string): boolean
```

True unless the key is `arena.*` for an arena other than the active one. This is the runtime half of
"only the selected arena loads"; D5 is the same rule applied to files on disk.

**Mismatch.** `ArenaScene.create()` resolves `getArena(this.room.state.arenaId)` at line 189, before
`drawArena`, `shotGfx`, `hpGfx`, and the countdown text are constructed. An unknown id therefore
throws out of Phaser's scene boot with the scene half-built: the player sees a black screen and a
stack trace while the server runs the match normally.

The scene guards with `isArenaId` and, on a miss, renders a full-screen message through the existing
`ScreenOverlay` naming both sides:

> Arena mismatch — server: `arena-03`, this build knows: `arena-01`, `arena-02`. Rebuild shared and
> hard-refresh.

The release zip cannot produce this state: it ships one build of server and client, with one
`ACTIVE_ARENA_ID` inlined into both. It is reachable in development, via the stale-shared-`dist`
gotcha documented in `CLAUDE.md` and its browser-side twin — a tab held open across a server restart,
or a Vite dep cache holding the previous `shared/dist`. That is precisely the loop this feature is
meant to make fast, so the failure deserves a readable message rather than a stack trace.

Rejected alternative: **silent fallback to `ACTIVE_ARENA_ID`**. The client would always render, but
it would render a different arena than the server simulates — invisible walls and continuous
reconciliation snapping. Trading a black screen for a haunted one is not an improvement, and a
mismatched sim is the bug class this repo's documentation works hardest to prevent.

This guard also puts the first validation point on `arenaId` before anything begins writing to it. It
is a networked string that nothing currently assigns; a future lobby picker or room option would make
an unvalidated id a live hazard rather than a build-hygiene one.

### D7 — Optional per-arena palette

`ArenaDef` gains an optional `palette?: { floor: string; obstacle: string; border: string }` of hex
strings, in the manner of `COLOR_TABLE`. `drawArena` falls back to today's `ARENA_FLOOR`,
`OBSTACLE_FILL`, and `ARENA_BORDER` constants when it is absent.

`stepSim` never reads it, so it stays out of the schema and invariant 8 holds. Without it, arenas
that differ only in obstacle layout all read as the same grey box — which undercuts authoring several
arenas before any sprite work lands. Zero build weight.

---

## Architecture

```
shared/config/arena-config.ts     ACTIVE_ARENA_ID  ─────────────┐
shared/arena/registry.ts          ARENAS, getArena, isArenaId   │
shared/arena/arena-01.ts          layout data                   │
shared/arena/arena-02.ts          layout data                   │
shared/arena/types.ts             ArenaDef + optional palette   │
        │                                                       │
        ├── server: ArenaState.arenaId default, tick.ts, ArenaRoom
        │                                                       │
        ├── client: BootScene.shouldLoadAssetKey ───────────────┤
        │           ArenaScene isArenaId guard + drawArena      │
        │                                                       │
        └── scripts/build-release.mjs ──────────────────────────┘
                imports shared/dist for ACTIVE_ARENA_ID,
                prunes art/arenas/<other>/ from the copied dist
```

One constant is read by four consumers, all of them resolving it from built shared. There is no
second place to update when the active arena changes.

## Data flow

1. **Build.** `ACTIVE_ARENA_ID` is compiled into `shared/dist`, then inlined into the server bundle
   by tsup and into the client bundle by Vite.
2. **Room create.** `ArenaState.arenaId` takes the constant as its default; Colyseus patches it to
   every client.
3. **Boot.** The client fetches the manifest and loads every key `shouldLoadAssetKey` admits — all
   non-arena art, `arena.common.*`, and `arena.<ACTIVE_ARENA_ID>.*`.
4. **Arena entry.** `ArenaScene.create()` checks `isArenaId(room.state.arenaId)`, resolves the
   `ArenaDef`, and draws it with the arena's palette or the default constants.
5. **Release.** After copying `client/dist`, the release script imports `shared/dist` for the active
   id, prunes non-active arena directories and manifest keys from the copy, asserts none survived,
   and reports what it kept.

## Error handling

| Condition | Behaviour |
|---|---|
| Unknown `arenaId` reaches the client | Full-screen mismatch message naming both sides (D6) |
| Unknown `arenaId` on the server | `getArena` throws — a programming error, no sane fallback |
| `ACTIVE_ARENA_ID` not a key of `ARENAS` | Shared test fails the build |
| Arena layout violates a clearance rule | `arena.test.ts` fails the build |
| Arena art file missing at runtime | Procedural rect, as today (asset pipeline design) |
| Non-active arena art survives pruning | `assertOnlyActiveArenaShipped` throws, release fails |
| `shared/dist` missing when releasing | `requireBuiltDist` throws, as today |

## Testing

**Shared.** The D3 rule table over every entry in `ARENAS`. `ACTIVE_ARENA_ID` is a key of `ARENAS`.
`getArena` returns the right def per id and throws on unknown; `isArenaId` agrees with `ARENAS`.

**Client.** `shouldLoadAssetKey` as a pure function: non-arena keys always load; `arena.common.*`
always loads; `arena.<active>.*` loads; `arena.<other>.*` does not. The `ArenaScene` guard is covered
by testing `isArenaId` plus the message-building function, keeping Phaser out of the test.

**Release.** `pruneArenaAssets` and `assertOnlyActiveArenaShipped` against a temp-dir fixture in
`build-release.test.mjs`: a dist containing three arena directories and a manifest naming all three
prunes to one; `common` survives; `car.*` keys survive; the assertion throws when a stray file is
planted; pruning twice is idempotent.

## Scope

Delivered by this spec: the registry map, `ACTIVE_ARENA_ID`, the generic validator, the art namespace
convention, the `BootScene` filter, the `ArenaScene` mismatch guard, the optional palette, the
release prune and its assertion, and **one second arena (`arena-02`)** built to exercise the
machinery end to end.

Designing the full set of arenas is the follow-on work, once switching between them is a one-line
edit.

## Documentation to update

- `docs/config-reference.md` — `ACTIVE_ARENA_ID` and how to switch arenas.
- `docs/asset-pipeline.md` — the `arena.<id>.*` namespace, `arena.common.*`, and what release pruning
  removes.
- `docs/deployment.md` — what the release strips and the arena line it prints.
- `docs/project-structure.md` — `shared/src/config/arena-config.ts` and the growing `arena/` directory.
- `CLAUDE.md` — the arena-mismatch symptom belongs beside the stale-`dist` gotcha it descends from.
