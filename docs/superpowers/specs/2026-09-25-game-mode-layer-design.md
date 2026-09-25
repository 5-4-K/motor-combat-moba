# Game-mode layer: base + overrides config, per-mode modules, scoped tests — design

Date: 2026-09-25. Status: approved in chat (design sections A/B/C), written for review.
Clause ids: **GM1–GM40**.

## 0. Why

The user wants to change one game mode — its numbers, its cars' kits, whether the basic attack
exists, its HUD, how it is won — **without having to worry about breaking another mode**, and to
know from a diff which tests and playtests a change owes.

A review of `development/main` at `8d1e45d` found:

1. **Config is ~95 % per-mode already, with one leak and one trap.** Every table a mode could want to
   vary (cars incl. kits, weapons incl. `turret`, slots incl. `basicAttackEnabled`) is in the mode
   bundle. But `BASIC_ATTACK_CONFIG.enabled` is still a global that the bot
   (`bot/brain/firing.ts`), the HUD hint (`config/slot-keys.ts`, `ArenaScene.ts`) and the manual
   generator read directly — so a per-mode basic attack would be honoured by the sim and ignored by
   the bot and HUD. The trap: each mode is a full ~1,400-line copy (3 folders × 14 files), held equal
   by `table-pinning.test.ts` for brawl/deathmatch but **not** conquer. Today the three copies differ
   in exactly one value: Conquer's `arenas`.
2. **The mode layer is scattered.** Mode behaviour is three exhaustive switches (`sidesOf`,
   `winRuleOf`, `respawnsIn` in `shared/src/flow/modes.ts`) plus ~15 inline
   `winRuleOf(mode) === "conquer"` / `"deathmatch"` branches in `ArenaRoom`, `ArenaScene`,
   `results-view`, `lobby-view` (which hard-codes every mode's card), `start-rules`, `car-claims`.
   `ArenaRoom` calls Conquer's `resetZone` on every match start in every mode. A Conquer-only
   change edits files Brawl runs through.
3. **Tests do not separate common from mode-specific**, and no playtest probe exercises a win rule,
   a respawn or a zone.

## 1. Goals and non-goals

**Goals.**
- GM1. Every per-mode difference is expressed **inside that mode's own folder(s)** — config
  overrides, rules, server controller, client HUD — and nowhere else.
- GM2. Common code never names a specific mode (no `GameMode.X` literal, no `=== "conquer"`) outside
  the three registries and the enum itself. A test enforces it.
- GM3. Adding a mode fails to compile until its rules, controller and HUD exist.
- GM4. **Zero behaviour change.** Every mode's resolved bundle is byte-identical before and after
  part A (proved by snapshots captured before the refactor). Parts B and C move logic, they do not
  change it; the existing suite plus the new contract tests prove it.
- GM5. A diff can be mapped mechanically to the test + playtest scope it owes.

**Non-goals.** Retuning anything; changing the wire (`GameMode` values, schema fields); the netcode
rewrite; fixing the two pre-existing `controller.test.ts` G12 failures (bot-tuner question);
the balance harness (skipped by request).

## 2. Part A — config: one base, per-mode overrides

- GM6. **The base is the `config/` globals.** `modes/base.ts` exports `BASE_TABLES: ModeTables`
  assembled from `CAR_TABLE`, `WEAPON_TABLE`, `DRIVE_CONFIG` (hull stripped), `RAM_CONFIG`,
  `IMPULSE_CONFIG`, `COMBAT_CONFIG`, `TURRET_CONFIG`, `STATUS_CONFIG`, `STATUS_TABLE`,
  `STATUS_LIMITS`, `SPIKE_CONFIG`, `WEAPON_SLOT_CONFIG`, `FLOW_CONFIG`, `DEATHMATCH_CONFIG`,
  `CONQUER_CONFIG`, `CAMERA_CONFIG`, plus `arenas: ["arena-01","arena-02"]` and `maxPlayers: 6`.
  The raw globals stop being a "pinned baseline nothing reads" and become what they look like: the
  common defaults. Editing one changes every mode that does not override it — visibly (GM10).
- GM7. **A mode is `defineMode(overrides)`.** Each mode folder (`modes/brawl/`, `modes/team-brawl/`,
  `modes/deathmatch/`, `modes/conquer/`) holds an `index.ts` exporting
  `<MODE>_TABLES = mergeTables(BASE_TABLES, <MODE>_OVERRIDES)` and a `config.ts` exporting the
  overrides object. The 42 copied table files are deleted. `modes/team-brawl/` is new: Team brawl gets its
  own (empty) overrides instead of borrowing Brawl's tables, so it can diverge without touching Brawl.
- GM8. **`ModeOverrides` type.** A `DeepPartial<ModeTables>` with these rules, enforced by
  `mergeTables` and the type:
  - plain objects merge key by key, recursively;
  - arrays and primitives **replace** (a kit override is the whole new kit; `arenas` replaces);
  - a keyed-row map (`cars`, `weapons`, `statusTable`) may add a new row; a new row must be a full
    def, wrapped in `replace(def)`; `replace(def)` on an existing row swaps the whole row (the only
    way to *remove* an optional field such as `turret`);
  - `drive` excludes the hull by type (`Omit<DriveConfig,"carWidth"|"carHeight">` stays);
  - global constants (`TICK_RATE_HZ`, `NET_CONFIG`, enum values, `ABILITY_SLOT_CEILING`,
    `MAX_PLAYERS`, `COLOR_TABLE`, `PRACTICE_CONFIG`, `CHAT_CONFIG`, `LOGICAL_CANVAS`, hull) are not
    in `ModeTables`, so cannot be overridden.
  `mergeTables` never mutates either input and returns a fresh object; `assembleModeConfig` still
  clones and freezes.
- GM9. **Basic attack per mode.** `BASIC_ATTACK_CONFIG` is deleted. The single source is
  `slots.basicAttackEnabled` (base `false`, i.e. `WEAPON_SLOT_CONFIG.basicAttackEnabled: false`
  authored directly). The bot reads `slots().basicAttackEnabled`; the client hint reads
  `slots().basicAttackEnabled` under the room's installed mode; the manual generator reads each
  mode's own bundle. Tests that flipped the global now build an overridden bundle
  (`applyOverrides` or `mergeTables`) and scope it with `withMode`.
- GM10. **The safety net is a resolved-bundle snapshot per mode.** `modes/snapshots.test.ts` writes
  each mode's resolved `ModeTables` (not `derived`) to
  `modes/__snapshots__/<slug>.tables.json` via `toMatchFileSnapshot`, keys sorted, 2-space JSON.
  Consequence: an edit to one mode's overrides moves only that mode's file; an edit to the base moves
  every non-overriding mode's file, so an accidental all-mode edit is visible in review and a
  deliberate one is accepted with `vitest -u`. **The snapshots are generated from the pre-refactor
  bundles first** and committed before any table file is deleted — that commit is the GM4 proof.
- GM11. `table-pinning.test.ts` and `parity.test.ts` (both "the copies are equal" tests) are deleted;
  the snapshot replaces them. `invariants.test.ts` keeps running over every assembled bundle (weapon
  exclusivity, slot range, `maxPlayers` range, conquer arenas have a zone, …).
- GM12. `no-raw-config-in-sim.test.ts` stays: sim/server/client code must read the accessor, never a
  raw global, or a mode's override would be silently bypassed. Its allow-list gains `modes/base.ts`.
- GM13. Overrides are **validated at load**: `mergeTables` throws on an override key that does not
  exist in the base (except inside `replace(...)` rows and new keyed rows), naming the path, so a
  typo'd override cannot silently do nothing.

## 3. Part B — the mode layer

Three per-package modules per mode, each behind one interface, each registered in a map typed
`satisfies Record<GameMode, …>` (GM3).

### 3.1 Shared: `ModeRules` (`packages/shared/src/modes/<slug>/rules.ts`)

- GM14. Interface (in `modes/rules-types.ts`):
  ```ts
  export interface ModeRules {
    readonly sides: "ffa" | "team";
    /** Dead cars come back after the mode's respawn delay; enables the respawn + phase sweeps. */
    readonly respawns: boolean;
    /** The match has a clock (`matchEndsTick` stamped at the green light). */
    readonly hasMatchClock: boolean;
    /** Lobby start gate for this mode, given its own bundle and the READY players only. */
    canStart(config: ModeConfig, ready: readonly StartRulePlayer[]): CanStartResult;
    /** Whether two teammates may not pick the same chassis, read from this mode's own bundle. */
    claimsChassis(config: ModeConfig): boolean;
  }
  ```
  Win logic is NOT on `ModeRules` — it is server authority and lives on the controller (GM19); pure
  outcome helpers live beside the rules in the mode's folder (GM16).
- GM15. `modes/rules-registry.ts`: `MODE_RULES = {…} satisfies Record<GameMode, ModeRules>` and
  `rulesOf(mode: number): ModeRules` — wire-safe, falls back to `DEFAULT_GAME_MODE`'s rules for an
  unknown byte (the same fallback today's switches return). `sidesOf`, `winRuleOf`, `respawnsIn`
  and `flow/modes.ts` are deleted; every caller moves to `rulesOf(mode).x` or to a mode hook.
  Brawl and Team brawl rules: `lastStandingRules("ffa")` / `lastStandingRules("team")` from
  `modes/last-standing/rules.ts` (a shared *rule family*, not a mode); deathmatch and conquer have
  their own.
- GM16. Pure outcome logic moves into mode-family folders in shared:
  `flow/win.ts`'s `livingSides`/`livingAfterLeave` → `modes/last-standing/outcome.ts`;
  `deathmatchEnded`/`deathmatchOutcome` → `modes/deathmatch/outcome.ts`;
  `flow/conquer.ts` → `modes/conquer/outcome.ts`. Genuinely common helpers (respawn point picking,
  spawn assignment, `phased` grant) stay in `flow/`. Public exports from `index.ts` keep their names
  so nothing outside `modes/` needs to know where they live.
- GM17. `lobby/start-rules.ts` becomes a one-liner over `rulesOf(mode).canStart`;
  `lobby/car-claims.ts`'s `uniqueChassisApplies(mode)` becomes
  `rulesOf(mode).claimsChassis(modeConfigOf(mode))`; `flow/spawns.ts` reads `rulesOf(mode).sides`.

### 3.2 Server: `ModeController` (`packages/server/src/modes/<family>/controller.ts`)

- GM18. Interface (in `server/src/modes/types.ts`):
  ```ts
  export interface MatchOutcome { readonly winnerSessionId: string; readonly winnerTeam: number; }
  export interface ModeRoomView {
    readonly state: ArenaState;
    readonly roster: ReadonlySet<string>;
  }
  export interface ModeController {
    /** On the edge into MATCH: stamp clocks, reset per-mode state (e.g. the zone). */
    onMatchStart(room: ModeRoomView): void;
    /** After combat each MATCH tick: advance per-mode state; return an outcome to end the match. */
    afterTick(room: ModeRoomView, combatPlayers: readonly CombatPlayerView[]): MatchOutcome | undefined;
    /** After an in-match leaver is removed from roster and players. */
    afterLeave(room: ModeRoomView): MatchOutcome | undefined;
  }
  ```
- GM19. Implementations: `modes/last-standing/controller.ts` (Brawl + Team brawl, parameterised by
  `sides`), `modes/deathmatch/controller.ts`, `modes/conquer/controller.ts` (absorbs `rooms/conquer-room.ts`'s `advanceConquer`/`resetZone`
  and `conquerLeaveOutcome`). `server/src/modes/registry.ts`:
  `MODE_CONTROLLERS satisfies Record<GameMode, ModeController>` and `controllerOf(mode: number)`.
- GM20. `ArenaRoom` never names a mode: the leave handler calls `controllerOf(mode).afterLeave`,
  the tick calls `afterTick`, `applyFlow`'s MATCH edge calls `onMatchStart`; the respawn sweep and
  `runPhaseSweep` read `rulesOf(mode).respawns`. `resetZone` is no longer called for non-Conquer
  modes (it was a no-op there; the zone fields stay 0).
- GM21. `PracticeRoom` pins `FFA_DEATHMATCH` as today and reads `rulesOf`, not the deleted switches.
  Its "never ends" rule is practice-specific and stays in `PracticeRoom` (practice is a room kind,
  not a mode). `tick-pipeline.ts` reads `rulesOf(state.mode).sides`.

### 3.3 Client: `ModeHud` (`packages/client/src/modes/<slug>/hud.ts`)

- GM22. Interface (in `client/src/modes/types.ts`):
  ```ts
  export interface ModeHud {
    /** The lobby mode card (kicker, body, chips) — `name` still comes from MODE_TABLE. */
    lobbyCard(): ModeCardCopy;
    /** Top-of-screen clock text; "" hides it. */
    clockLabel(state: ArenaState, tick: number): string;
    /** Whether the roster panel shows a kills column. */
    readonly showsKills: boolean;
    /** An extra results-screen line (Conquer's control line), or undefined. */
    resultsLine(state: ResultsViewState, localSessionId: string): string | undefined;
    /** Overrides the results headline (Conquer: "You win"/"You lose"), or undefined for default. */
    resultsHeadline?(state: ResultsViewState, localSessionId: string): string | undefined;
    /** Creates this mode's gutter renderer, or undefined to use the default roster panel. */
    createGutter?(host: GutterHost): ModeGutter;
  }
  export interface ModeGutter {
    /** Draws the gutter and returns its height (the weapon HUD's top inset). */
    render(room: Room<ArenaState>): number;
    /** Every game object it owns, so the scene can route them to the HUD camera. */
    objects(): Phaser.GameObjects.GameObject[];
    destroy(): void;
  }
  ```
  `GutterHost` is the narrow slice of `ArenaScene` a gutter needs (add text/graphics, the roster
  drawing helpers, the local session id, palette) — not the scene itself.
- GM23. `client/src/modes/registry.ts`: `MODE_HUDS satisfies Record<GameMode, ModeHud>` and
  `hudOf(mode: number)` (wire-safe fallback). Conquer's gutter (`renderConquerGutter`, its text pool
  `conquerTexts`/`conquerHud`, and `conquer-hud.ts`) moves to `client/src/modes/conquer/`.
- GM24. The capture-zone ring and the team-B view rotation stay in `ArenaScene`: they are driven by
  **arena data** (`ArenaDef.zone`, `flipForTeamB`), not by the mode, so they are common features any
  mode could use by picking such an arena. They read `rulesOf(mode).sides` where they need sides.
- GM25. `lobby-view.ts`'s hard-coded card list becomes `activeGameModes().map(m => ({ id: m,
  name: MODE_TABLE[m].name, ...hudOf(m).lobbyCard() }))`; `results-view.ts` asks
  `hudOf(mode).resultsLine/resultsHeadline`; `ArenaScene` asks `hudOf(mode)` for the clock, the kills
  column and the gutter; `spectate.ts` reads `rulesOf(mode).respawns`.
- GM26. **Enforcement.** `packages/shared/src/modes/no-mode-branching.test.ts` walks
  `shared/src`, `server/src`, `client/src` (excluding tests, `modes/**`, `constants.ts`,
  `server/src/config/mode-bot.ts`, `PracticeRoom.ts` and `PracticeSetupScene.ts`'s pinned
  `FFA_DEATHMATCH`) and fails on `GameMode.<NAME>` literals, `winRuleOf`, or string comparisons to
  `"conquer"`/`"deathmatch"`/`"last_standing"`. Each allow-listed file carries a one-line reason.

## 4. Part C — tests, playtests, rules

### 4.1 Layout

- GM27. **Mode-specific tests live in the mode's folder** in each package:
  `shared/src/modes/<slug>/*.test.ts`, `server/src/modes/<family>/*.test.ts`,
  `client/src/modes/<slug>/*.test.ts`. Folder names: shared and client use the mode slug
  (`brawl`, `team-brawl`, `deathmatch`, `conquer`) plus the `last-standing` family; server uses the
  family (`last-standing`, `deathmatch`, `conquer`) since Brawl and Team brawl share a controller.
  Rule-family tests (last-standing) live in `modes/last-standing/`.
- GM28. **Contract tests** — one per package, `modes/contract.test.ts` — run `describe.each` over
  every `GameMode` and assert the interface-level behaviour every mode must satisfy (rules are
  internally consistent; `respawns ⇒ hasMatchClock`; a controller ends a match on the documented
  condition built from a fixture; a HUD returns a card with non-empty copy). They are common tests.
- GM29. **Everything else is common** and stays beside its code.
- GM30. **Dedupe criteria**, applied package by package: (a) tests asserting a raw table equals a
  mode copy (made obsolete by GM10/GM11) are deleted; (b) two tests asserting the same behaviour
  through the same entry point with equivalent fixtures are merged into one; (c) tests pinning a
  config *value* already fixed by a snapshot are deleted unless the value is a documented design
  decision (the test names the clause); (d) mode-specific cases found in common test files move to
  the mode folder; (e) nothing is deleted if it is the only test of a behaviour — coverage is
  checked by name before deletion. Every deletion is listed in the commit message.

### 4.2 Playtests

- GM31. `packages/server/playtest/common/` holds the six existing probes (`collision`, `ram`,
  `geometry`, `weapons`, `weapons2`, `prediction`) plus `world.ts`, `reporter.ts`, `mode.ts`.
  They measure the sim under whichever mode bundle `--mode` installs.
- GM32. `packages/server/playtest/modes/<slug>/` holds mode probes that drive the real room tick
  pipeline through the mode's controller (authorised by the user for this work):
  - `last-standing/elimination.ts` — FFA: match ends on the last car, draw on a simultaneous
    wreck, a leaver ends it; team: ends when one team is wiped, friendly fire off.
  - `deathmatch/respawn.ts` — respawn after `respawnDelaySeconds`, `phased` for ≥ `phaseSeconds`
    (not solid, not targetable), clock end, kills-then-deaths ranking.
  - `conquer/zone.ts` — capture after `captureDelaySeconds` uncontested, contest freezes the bar,
    full bar wins before the clock, clock end picks the higher bar, a team leaving empty loses.
  They follow the probe rules (report, never assert; verdicts `OK` / `FINDING` / `KNOWN-BY-DESIGN`;
  sweep the sub-tick phase where contact is involved).
- GM33. `run-all.ts` gains `--scope=common|mode|all` (default `all`): `common` runs the six common
  probes under the chosen mode, `mode` runs only that mode's probes (a mode maps to its family's
  folder: Brawl and Team brawl → `last-standing`), `all` runs both. The report folder name is
  unchanged (`<date-NN>-<mode>`).

### 4.3 Commands and the scoping rule

- GM34. npm scripts: `test:common` (every package's suite excluding `**/modes/*/**` — i.e. common
  tests plus the contract tests), `test:mode -- <slug>` (that mode's folders in every package, plus
  the contract tests), `test:affected` (runs `scripts/test-scope.mjs` against
  `git diff --name-only origin/development/main...HEAD` plus the working tree, prints the scope and
  the exact commands, and runs them).
- GM35. **The rule** (`scripts/test-scope.mjs` implements it; `docs/testing.md` states it):
  - every changed path is under `packages/*/src/modes/<slug>/`, `packages/shared/src/modes/__snapshots__/<slug>.*`
    or `packages/server/playtest/modes/<family>/` for one mode (or one family) → **mode scope**:
    `test:mode -- <slug>` + `playtest --mode=<slug> --scope=mode` (+ `--scope=common` too if the
    mode's `config.ts` changed, since overrides move what the common probes measure);
  - any other path under `packages/` or `scripts/` → **full scope**: `npm test` +
    `playtest --scope=all` for every active mode;
  - docs-only changes → nothing to run (but `manual`/`turn-tuning` doc tests are in `npm test`).
  Changing a *rule family* (`modes/last-standing/`) is mode scope for every mode in that family.
- GM36. `docs/testing.md` documents the layout, the rule, the commands, what the contract tests
  guarantee, and how to add a mode's tests. `CLAUDE.md` gets a short "Which tests to run" section
  pointing at it, and its per-mode config section is rewritten for base + overrides.

## 5. Docs and skills

- GM37. `CLAUDE.md` config section: rewrite "Where to edit" (base = `config/`; one mode = its
  `config.ts` overrides; snapshots show the blast radius); drop the table-pinning trap text; the
  basic-attack paragraph says the flag is per mode (`slots.basicAttackEnabled`).
- GM38. `.claude/skills/game-mode/SKILL.md`: new-mode checklist becomes: overrides folder, rules,
  controller, HUD, registries, snapshot, tests in the mode folders, probe folder.
  `.claude/skills/basic-attack-toggle/SKILL.md`: flip per mode via that mode's overrides.
- GM39. `docs/config-reference.md` and `docs/project-structure.md` updated for the new files.

## 6. Verification

- GM40. After each part: `npm run build` and `npm test` green except the two pre-existing G12
  failures; snapshots unchanged after part A's deletion commit (GM4); `npm run build:manual` produces
  a byte-identical `manual.html` (the page reads bundles, which did not change) — if the stamp
  moves only because a hashed *input* was renamed, rebuild and say so; `npm run playtest -- --mode=<m>`
  runs clean for every active mode after part C.
