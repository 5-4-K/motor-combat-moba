---
name: game-mode
description: >-
  Use when someone wants to add, author, publish, hide, or retire a GAME MODE
  — "add a king-of-the-hill mode", "make a sudden-death variant", "turn Team
  brawl back on", "hide Deathmatch from the lobby", "why doesn't my new mode
  show up", "can Deathmatch have its own car stats". Adds a GameMode enum
  value, an overrides folder, a rules/controller/HUD triple and everything
  that owes — the arena set, the lobby card, the win rule, the guide tab, the
  turn-tuning section, the mode-scoped tests and probes. Not for tuning a
  number inside a mode that already exists — that is weapon-forger or an
  ordinary config edit.
---

# Game mode

A game mode is a `GameMode` wire value with a row in `MODE_TABLE` (a config bundle) plus three more
pieces, one per package: a `ModeRules` (shared), a `ModeController` (server) and a `ModeHud`
(client). Two modes can feel like different games. See the root `CLAUDE.md`'s "Configuration is
PER-GAME-MODE" section for the overview and
[`docs/superpowers/specs/2026-09-25-game-mode-layer-design.md`](../../../docs/superpowers/specs/2026-09-25-game-mode-layer-design.md)
(GM1–GM40) for the design — it supersedes
[`docs/superpowers/specs/2026-09-22-per-mode-config-design.md`](../../../docs/superpowers/specs/2026-09-22-per-mode-config-design.md)'s
copy-a-folder/table-pinning mechanics, which no longer exist.

Adding one is **build-time**: source edits plus a rebuild, never an env var or a join option.

## What a mode is made of

| Piece | Where | If you skip it |
|---|---|---|
| `GameMode` enum value | `packages/shared/src/constants.ts` | Nothing compiles — `MODE_TABLE`, `MODE_RULES`, `MODE_CONTROLLERS` and `MODE_HUDS` are all `satisfies Record<GameMode, …>` |
| A `config.ts` (overrides) + `index.ts` | `packages/shared/src/modes/<slug>/` | Nothing to point the row at |
| `MODE_TABLE` row (`id`, `name`, `isActive`, `config`) | `packages/shared/src/modes/registry.ts` | The enum value exists and resolves to nothing |
| `arenas` + `maxPlayers` | that mode's `config.ts` (as overrides) or the base | `invariants.test.ts` fails: an empty `arenas` throws mid-match |
| `rules.ts` + a `MODE_RULES` row | `packages/shared/src/modes/<slug>/`, `modes/rules-registry.ts` | **Compile error** — `MODE_RULES` is exhaustive |
| A server controller + a `MODE_CONTROLLERS` row | `packages/server/src/modes/<family>/controller.ts`, `server/src/modes/registry.ts` | **Compile error** — `MODE_CONTROLLERS` is exhaustive |
| A client `hud.ts` + a `MODE_HUDS` row | `packages/client/src/modes/<slug>/hud.ts`, `client/src/modes/registry.ts` | **Compile error** — `MODE_HUDS` is exhaustive |
| A resolved-bundle snapshot | `packages/shared/src/modes/__snapshots__/<slug>.tables.json` | `snapshots.test.ts` writes one for you the first time you run it; commit it |
| A `## <Mode name>` section in `docs/turn-tuning.md` | that page | `scripts/turn-tuning-doc.test.mjs` fails naming the mode |
| A rebuilt guide | `npm run build:manual` | `scripts/manual-page.test.mjs` fails: the stamp moved |

`arenas[0]` is the arena the mode actually plays; the rest of the list is what it *may* play.
Spawn points are per-ARENA and per-SIDES (`ffaSpawns` / `teamASpawns` / `teamBSpawns`), not
per-mode — a new FFA mode reuses `ffaSpawns` with nothing to author.

## 1. The enum value — at the next unused integer, never renumbered

`packages/shared/src/constants.ts`:

```ts
export enum GameMode {
  FFA_LAST_STANDING = 0,
  TEAM = 1,
  FFA_DEATHMATCH = 2,
  CONQUER = 3,
  // next one is 4
}
```

**Hard invariant 7.** These cross the wire as `ArenaState.mode`, a `uint8`. Renumbering silently
re-labels every stored balance report, every playtest folder and every old client's lobby. A mode
that is retired keeps its number and goes `isActive: false`; the number is never reused.

## 2. The overrides folder — write only what your mode changes

```ts
// packages/shared/src/modes/<slug>/config.ts
import type { ModeOverrides } from "../merge.js";
export const YOUR_MODE_OVERRIDES: ModeOverrides = {
  arenas: ["arena-04"],
  // only the values that differ from `modes/base.ts`'s BASE_TABLES
};
```

```ts
// packages/shared/src/modes/<slug>/index.ts
import { BASE_TABLES } from "../base.js";
import { mergeTables } from "../merge.js";
import type { ModeTables } from "../types.js";
import { YOUR_MODE_OVERRIDES } from "./config.js";
export const YOUR_MODE_TABLES: ModeTables = mergeTables(BASE_TABLES, YOUR_MODE_OVERRIDES);
```

A folder with **empty overrides is legal and normal** — that is how Brawl, Team brawl and Deathmatch
ship today, each with its own folder so it can diverge later without touching a sibling. Three
things about the shape, each of which will bite otherwise:

- **`drive` has no `carWidth`/`carHeight`.** The OBB hull is global — `ModeTables.drive` is
  `Omit<DriveConfig, "carWidth" | "carHeight">`, so an override cannot author one even by accident.
- **A typo'd override key throws at load, naming the full path.** `mergeTables` checks every key
  against the base; `cars.mirage.sped` fails immediately rather than silently doing nothing.
- **To add a new row (a car, a weapon, a status) or to swap one whole (including removing an
  optional field like a weapon's `turret`), wrap it in `replace(def)`.** A plain nested object
  merges key by key into the base row instead.

Weapon exclusivity (L1) is enforced **per mode's resolved bundle**, not globally:
`invariants.test.ts` fails if two chassis in the SAME mode carry one weapon id. Two different modes
may both slot `predator` — they resolve to different bundles.

## 3. The registry row

`packages/shared/src/modes/registry.ts`:

```ts
[GameMode.YOUR_MODE]: {
  id: GameMode.YOUR_MODE,
  name: "Your mode",
  isActive: false,          // see step 8
  config: assembleModeConfig(GameMode.YOUR_MODE, YOUR_MODE_TABLES),
},
```

`assembleModeConfig` `structuredClone`s the merged tables, resolves the nine derived artifacts
(weapon ticks, chassis drive, burst defs, ram ticks, turret ticks, spike ticks, deathmatch ticks,
conquer ticks, status pulse ticks) and deep-freezes the result. It is the **only** place a bundle is
made, and two bundles never share a sub-object.

**Name it something whose slug is unique.** `modeSlug` lowercases the display name and collapses
non-alphanumerics to hyphens; that slug is both the `--mode=` spelling and the report folder's
suffix, and it names the mode's folders in every package (`modes/<slug>/`).

## 4. `rules.ts` — the shared facts every mode must state

`packages/shared/src/modes/<slug>/rules.ts` (or reuse a **rule family** — see below) exports a
`ModeRules` (`modes/rules-types.ts`):

```ts
export interface ModeRules {
  readonly sides: "ffa" | "team";
  readonly respawns: boolean;
  readonly hasMatchClock: boolean;
  readonly winRuleLabel: "last_standing" | "deathmatch" | "conquer";
  canStart(config: ModeConfig, ready: readonly StartRulePlayer[]): CanStartResult;
  claimsChassis(config: ModeConfig): boolean;
}
```

Add a row to `packages/shared/src/modes/rules-registry.ts`'s `MODE_RULES` — it is `satisfies
Record<GameMode, ModeRules>`, so the object literal fails to compile until your mode has one.
`rulesOf(mode)` is the wire-facing accessor everywhere else reads (falls back to
`DEFAULT_GAME_MODE`'s rules for an unrecognised byte).

**A rule FAMILY is a shared implementation several slugs point at**, not a mode of its own — Brawl
and Team brawl both resolve to `lastStandingRules("ffa" | "team")` from
`modes/last-standing/rules.ts`. If your new mode is genuinely a variant of last-standing or
deathmatch play, parameterise the family instead of writing a fourth near-duplicate; if it needs its
own win test, write `modes/<slug>/rules.ts` from scratch, the way Deathmatch and Conquer did. Pure
outcome logic (who won, when to end) belongs beside the rules in the same family folder — see
`modes/last-standing/outcome.ts`, `modes/deathmatch/outcome.ts`, `modes/conquer/outcome.ts`.

## 5. The server controller — reuse a family, or add one

`packages/server/src/modes/types.ts`'s `ModeController` has **four** hooks:

```ts
export interface ModeController {
  onStartRequested(room: ModeRoomView): void;   // MSG_START_MATCH, before car select (CQ29)
  onMatchStart(room: ModeRoomView): void;       // the edge into MATCH — stamp the clock, reset state
  afterTick(room: ModeRoomView, combatPlayers: readonly CombatPlayerView[]): MatchOutcome | undefined;
  afterLeave(room: ModeRoomView): MatchOutcome | undefined;
}
```

`onMatchStart` should call `stampMatchClock(room)` (`packages/server/src/modes/match-clock.ts`),
which reads `rulesOf(mode).hasMatchClock` and stamps `matchEndsTick` accordingly — every existing
controller does this rather than repeating the ternary. Add your implementation to
`packages/server/src/modes/<family>/controller.ts` and a row to `server/src/modes/registry.ts`'s
`MODE_CONTROLLERS` (`satisfies Record<GameMode, ModeController>`, same exhaustiveness guard).
`controllerOf(mode)` resolves fresh on every call — a room never caches it, so a host switching mode
between matches gets the new family's behaviour immediately.

If your mode plays by the same win condition and respawn flow as an existing family (last-standing,
deathmatch, conquer), point your `MODE_TABLE` row's controller at that family's controller and skip
writing a new one — that is exactly how Brawl and Team brawl share `LAST_STANDING_CONTROLLER`.

## 6. The client HUD

`packages/client/src/modes/types.ts`'s `ModeHud`:

```ts
export interface ModeHud {
  lobbyCard(): ModeCardCopy;
  clockLabel(state: ArenaState, tick: number): string;   // "" hides the clock
  readonly showsKills: boolean;
  resultsLine(state: ResultsViewState, localSessionId: string): string | undefined;
  resultsHeadline?(state: ResultsViewState, localSessionId: string): string | undefined;
  createGutter?(host: GutterHost): ModeGutter;   // omit to get the default roster panel
}
```

Write `packages/client/src/modes/<slug>/hud.ts` and add a row to `client/src/modes/registry.ts`'s
`MODE_HUDS` (`satisfies Record<GameMode, ModeHud>`). `lobbyCard()` must return non-empty copy — the
contract test checks it. A mode that needs its own gutter layout (Conquer's control bar) supplies
`createGutter`; everything else leaves it out.

## 7. The snapshot — your safety net, and your proof of what changed

```bash
npx vitest run packages/shared/src/modes/snapshots.test.ts -u
```

Run this once your mode's tables resolve. It writes
`packages/shared/src/modes/__snapshots__/<slug>.tables.json` — the resolved `ModeTables`, keys
sorted. Commit it. On every later change, re-running the same command (scoped to `snapshots.test.ts`,
never a blanket `-u` across the repo) shows you exactly which modes' resolved bundles moved: your
mode's file if you touched its `config.ts`, every non-overriding mode's file if you touched
`modes/base.ts` or a `config/` global. A snapshot that moved when you did not expect it is the
tripwire this system runs on.

## 8. Author it hidden, publish it in a second commit

`isActive: false` first. It costs one field to flip later, and it keeps the guide rebuild, the
turn-tuning tables and the lobby card out of the commit that is still deciding what the mode IS.
`DEFAULT_GAME_MODE` must stay active (`registry.test.ts`), so never hide the last active mode or the
mode a new lobby opens on.

## 9. Tests in the mode's own folders, and the contract tests that run over it automatically

**Write mode-specific tests inside the mode's folders**, mirroring the folder split:
`packages/shared/src/modes/<slug>/*.test.ts` (or `<family>/*.test.ts` for a shared rule family),
`packages/server/src/modes/<family>/*.test.ts`, `packages/client/src/modes/<slug>/*.test.ts`. That
is what makes `npm run test:mode -- <slug>` and `node scripts/test-scope.mjs` scope correctly to a
diff that touches only your mode.

Automatically, the moment your row exists in every registry, `describe.each` over `GameMode` picks
it up:

- `modes/contract.test.ts` (one per package) — your `ModeRules` is internally consistent
  (`respawns ⇒ hasMatchClock`); your controller ends a match on the condition it documents, from a
  fixture; your HUD returns a card with non-empty copy.
- `modes/invariants.test.ts` — slot range, weapon exclusivity, `maxPlayers` in `[2, MAX_PLAYERS]`,
  an `impulse` only on a `kind: "maneuver"` row, at least one registered arena, wire-width bounds.
- `modes/registry.test.ts`, `modes/registry-arenas.test.ts`, `modes/mode-arg.test.ts` — one bundle
  per mode, the active set, `DEFAULT_GAME_MODE` active, `activeArenaIds()`, `--mode=` round-trip.
- `modes/no-mode-branching.test.ts` — fails if common code names your mode by literal instead of
  going through `rulesOf`/`controllerOf`/`hudOf`.
- `modes/no-raw-config-in-sim.test.ts` — no non-test file outside `config/` and `modes/base.ts` may
  name a raw global at all.

See [`docs/testing.md`](../../../docs/testing.md) for the full layout and the scoping rule.

## 10. The probe folder

If your mode has its own win condition or flow worth measuring at scale, add
`packages/server/playtest/modes/<family>/` — the mode probes are authorised, real-room-tick-pipeline
harnesses that drive the actual controller through `ModeWorld` (`playtest/modes/shared.ts`). Follow
the existing ones (`last-standing/elimination.ts`, `deathmatch/respawn.ts`, `conquer/zone.ts`) for
shape: report, never assert; verdicts `OK` / `FINDING` / `KNOWN-BY-DESIGN`; sweep the sub-tick phase
where contact is involved. `run-all.ts --scope=mode` picks the probe folder up automatically once it
exists, keyed off `FAMILY_OF` (`playtest/common/mode.ts`). **Never invent a scenario the user did not
ask for** — adding the folder for your mode's documented win condition is expected; anything beyond
that is their call.

## 11. What an ACTIVE mode changes outside its own folder

Flipping `isActive: true` is one field, and these follow from it with no further edit:

- **The lobby picker** gains a card, and the Settings → Game modes entry appears once two modes are
  active.
- **`activeArenaIds()`** — the union of every active mode's `arenas` — grows, changing what
  `BootScene` preloads and what `scripts/build-release.mjs` ships in the zip.
- **The players' guide** gains a tab, and `balanceStamp` moves — `npm run build:manual` is not
  optional here, even if both modes' resolved tables happen to be byte-identical.
- **`docs/turn-tuning.md`** owes a `## <Mode name>` section carrying all three tables;
  `scripts/turn-tuning-doc.test.mjs` fails until the page's `##` headings match `activeGameModes()`.
- **`npm run check:art`** already sweeps every mode, active or not — a chassis or weapon only your
  mode carries is checked from the day the folder exists.

`isActive: false` is the publish gate and nothing else: the bundle stays reachable, and the
playground, practice and the three harnesses all pin or pass a mode directly. It is also a real wire
gate: `resolveSetMode` refuses `MSG_SET_MODE` for a mode that is not `isActiveGameMode`.

## 12. The harnesses

All three take `--mode=<id|name>`:

```bash
npm run ttk -- --mode=your-mode
npm run balance -- --mode=your-mode --shape=duel --matches=20
npm run playtest -- --mode=your-mode --scope=all
```

An unknown mode refuses the run naming the ones that exist. An inactive mode is accepted on purpose.
`--baseline` refuses a cross-mode comparison outright.

## Path to add a mode

1. Add the `GameMode` value at the next unused integer.
2. Write `modes/<slug>/config.ts` (overrides, possibly empty) and `index.ts`.
3. Add the `MODE_TABLE` row (`isActive: false`).
4. Write or reuse a `rules.ts`; add it to `MODE_RULES`. Write or reuse a server controller; add it
   to `MODE_CONTROLLERS`. Write a client `hud.ts`; add it to `MODE_HUDS`. The build will not compile
   until all three registries have your row.
5. `npx vitest run packages/shared/src/modes/snapshots.test.ts -u` and commit the new snapshot file.
6. Root `npm run build` (shared → server → client; **never** `npm run build --workspaces`), then
   `npm test`.
7. Add mode-folder tests, and a probe folder if the mode's own flow is worth measuring at scale.
8. To publish: `isActive: true`, add the lobby card, `npm run build:manual`, add the
   `## <Mode name>` section to `docs/turn-tuning.md`, `npm run check:art`, `npm test`.
9. Say the playtest/balance part out loud — see below.

## Say it loudly

A new or retuned mode changes the sim's tables for every match played in it. Per this repo's own
rule:

- Name the change in your summary, loudly.
- **Recommend `npm run playtest -- --mode=<yours>` and `npm run balance -- --mode=<yours>`. Do not
  run them on the user's behalf**, and do not update a probe as a matter of course.
- Say that reports from another mode are **not comparable** to this one's, and that `--baseline`
  will refuse the comparison rather than trust the reader to remember.
- A probe that no longer **compiles** is the one case to fix on the spot — say that you did.

## Verifying it actually took

- `npm run dev`, host a lobby: the Game modes picker shows your card, and picking it changes
  `state.mode` — the client reinstalls the bundle through `watchRoomMode` before the next scene
  renders, so car select immediately offers **that mode's** roster.
- Two browser tabs, two modes, one server: both rooms tick their own numbers.
- `npm run ttk -- --mode=<yours>` prints a matrix headed with your mode's name and wire id.
- `http://localhost:5173/manual.html` has a tab per active mode, and yours is on it only if
  `isActive` is `true`.
- `npm run check:art` marks any row only your mode carries with a `(mode: …)` suffix.
