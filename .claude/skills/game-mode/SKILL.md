---
name: game-mode
description: >-
  Use when someone wants to add, author, publish, hide, or retire a GAME MODE
  — "add a king-of-the-hill mode", "make a sudden-death variant", "turn Team
  brawl back on", "hide Deathmatch from the lobby", "why doesn't my new mode
  show up", "can Deathmatch have its own car stats". Adds a GameMode enum
  value, a mode folder, a MODE_TABLE row and everything that row owes — the
  arena set, the lobby card, the win rule, the guide tab, the turn-tuning
  section, the per-mode tests. Not for tuning a number inside a mode that
  already exists — that is weapon-forger or an ordinary config edit.
---

# Game mode

A game mode is a `GameMode` wire value with a row in `MODE_TABLE` and a **whole configuration of its
own**: its own roster, weapons, drive model, ram rules, statuses, spikes, slot count, flow timings,
camera, arena set and seat count. Two modes can feel like different games. See the root
`CLAUDE.md`'s "Configuration is PER-GAME-MODE" section for the overview and
[`docs/superpowers/specs/2026-09-22-per-mode-config-design.md`](../../../docs/superpowers/specs/2026-09-22-per-mode-config-design.md)
(MC1–MC42) for the design.

Adding one is **build-time**, like `CarDef.isActive` or `BASIC_ATTACK_CONFIG.enabled`: source edits
plus a rebuild, never an env var or a join option.

## What a mode is made of

| Piece | Where | If you skip it |
|---|---|---|
| `GameMode` enum value | `packages/shared/src/constants.ts` | Nothing compiles — `MODE_TABLE` is `satisfies Record<GameMode, ModeDef>` |
| Thirteen table files + `index.ts` | `packages/shared/src/modes/<mode>/` | Nothing to point the row at |
| `MODE_TABLE` row (`id`, `name`, `isActive`, `config`) | `packages/shared/src/modes/registry.ts` | The enum value exists and resolves to nothing |
| `arenas` + `maxPlayers` | that mode's `index.ts` | `invariants.test.ts` fails: an empty `arenas` throws mid-match |
| Lobby card copy | `packages/client/src/ui/lobby-view.ts`, `modeCardsData()` | An ACTIVE mode with no card is silently unpickable — `lobby-view.test.ts` catches it |
| Win rule / sides | `packages/shared/src/flow/modes.ts` | **Nothing compiles** — both functions are exhaustive `switch`es with a `never` check |
| `MODE_ORDER` entry | `packages/shared/src/modes/registry.ts` | `registry.test.ts`'s "orders every mode in MODE_TABLE" fails. Without it the mode has no card, no guide tab, no turn-tuning section and no stamp entry, `isActive` or not |
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
  // next one is 3
}
```

**Hard invariant 7.** These cross the wire as `ArenaState.mode`, a `uint8`. Renumbering silently
re-labels every stored balance report, every playtest folder and every old client's lobby. A mode
that is retired keeps its number and goes `isActive: false`; the number is never reused.

Three cases in `registry.test.ts` pin the current set and will fail the moment a fourth value
exists — "has exactly the three `GameMode` wire values", `isGameMode`'s `expect(isGameMode(3))
.toBe(false)`, and (once it is published) `activeGameModes()`'s exact list. That is the tripwire
doing its job — extend each to the new mode, do not weaken an assertion into a tautology.

## 2. The mode folder — copy one, do not hand-author it

```bash
cp -r packages/shared/src/modes/deathmatch packages/shared/src/modes/<mode>
```

Thirteen table files — `cars.ts`, `weapons.ts`, `drive.ts`, `ram.ts`, `impulse.ts`, `combat.ts`,
`turret.ts`, `status.ts`, `spike.ts`, `slots.ts`, `flow.ts`, `deathmatch.ts`, `camera.ts` — plus an
`index.ts` that assembles them into a `ModeTables` along with `arenas` and `maxPlayers`. Rename every
`DEATHMATCH_*` export to your mode's prefix; the `index.ts` is the only file that has to agree with
them.

Three things about the shape, each of which will bite otherwise:

- **`drive` has no `carWidth`/`carHeight`.** The OBB hull is global (MC35) — it drags car art pixel
  sizes, arena spawn clearance, `inertiaRadiusSquared()` and both `spinScale` constants behind it.
  `ModeTables.drive` is `Omit<DriveConfig, "carWidth" | "carHeight">`, so a mode folder **cannot**
  author one even by accident: an inline literal that tried would fail TypeScript's excess-property
  check. `assembleModeConfig` re-attaches both from the global `DRIVE_CONFIG`.
- **`deathmatch.ts` exists in every mode**, including ones with no respawns. It is a table, not a
  feature flag; `winRuleOf(mode)` is what decides whether anything reads it.
- **`maxPlayers` is the mode's own seat count**, held to `[2, MAX_PLAYERS]` by
  `modes/invariants.test.ts`. `MAX_PLAYERS` (6, hard invariant 10) is the ceiling, not the number.

Weapon exclusivity (L1) is enforced **per mode**, not globally: `invariants.test.ts` fails if two
chassis in the SAME mode carry one weapon id. Two different modes may both slot `predator` — they
are different tables.

## 3. The registry row

`packages/shared/src/modes/registry.ts`:

```ts
[GameMode.YOUR_MODE]: {
  id: GameMode.YOUR_MODE,
  name: "Your mode",
  isActive: false,          // see step 7
  config: assembleModeConfig(GameMode.YOUR_MODE, YOUR_TABLES),
},
```

Then add it to `MODE_ORDER` — the lobby's card order, deliberately not enum order.
**`registry.test.ts`'s "orders every mode in MODE_TABLE, with nothing extra" fails until you do**,
naming nothing else, so this is one red test rather than a mystery.

That guard was added on 2026-09-23 because nothing caught the omission before it — and the previous
version of this page told you the opposite of the truth about when you would find out. You would
NOT have found out on `isActive: true`: `activeGameModes()` filters `MODE_ORDER`, so a mode missing
from the order got no lobby card, no guide tab, no turn-tuning section and no `balanceStamp` entry,
and every one of those guards derives its own expectation from `activeGameModes()` too — so they
all agreed the mode did not exist, before and after the flag flipped. Flipping it changed nothing
anywhere and failed no test. Add it in the same edit as the row.

`assembleModeConfig` `structuredClone`s the tables, resolves the eight derived artifacts
(weapon ticks, chassis drive, burst defs, ram ticks, turret ticks, spike ticks, deathmatch ticks,
status pulse ticks) and deep-freezes the result. It is the **only** place a bundle is made, and two
bundles never share a sub-object — which is why `TEAM` can point at `BRAWL_TABLES` and still be a
distinct frozen object.

**Name it something whose slug is unique.** `modeSlug` lowercases the display name and collapses
non-alphanumerics to hyphens; that slug is both the `--mode=` spelling and the report folder's
suffix. Two modes normalising to the same slug makes one of them unreachable by name, and
`mode-arg.test.ts`'s round-trip case fails.

## 4. The win rule is NOT part of the bundle, but it no longer defaults silently

`packages/shared/src/flow/modes.ts` holds the two mode-shaped facts that are not in any bundle, and
since 2026-09-23 each is an **exhaustive `switch` with a `never` check**:

```ts
export function winRuleOf(mode: GameMode): "last_standing" | "deathmatch" {
  switch (mode) {
    case GameMode.FFA_DEATHMATCH: return "deathmatch";
    case GameMode.FFA_LAST_STANDING: return "last_standing";
    case GameMode.TEAM: return "last_standing";
    default: { const _never: never = mode; void _never; return "last_standing"; }
  }
}
```

`GameMode` is a plain numeric TS enum, so that is real exhaustiveness: **step 1's enum value stops
this file compiling**, in both functions, until you say which side structure and which win rule your
mode plays under. You will meet it at `npm run build`, before any test runs. There is no longer a
silent default to say out loud — write the two cases.

(They were two `if`s until that date, and a new mode defaulted to FFA last-standing with nothing
saying so. The `default` branch still RETURNS a value rather than returning `_never`, because
`mode` is not always a value this build authored — the client reads `room.state.mode` as a uint8 off
the wire and `balance/report.ts` reads one out of a baseline `run.json` — and handing a stray byte
back as the answer is worse than serving the old fallback. The `never` line above it is what makes
the authored case a compile error, which is all it is there for.)

`winRuleOf` is deliberately consumed in exactly one place, the room's end-of-match check, so a grep
for it answers "what does the win condition actually change?" completely. A genuinely new win
condition is a design change, not a config edit: stop and agree it first.

## 5. The client's lobby card

`modeCards()` filters a **hand-authored** list, `modeCardsData()` in
`packages/client/src/ui/lobby-view.ts`, by `isActiveGameMode`. An active mode with no entry there
publishes no card and cannot be picked. `lobby-view.test.ts`'s "offers only active modes, in
activeGameModes order" is the tripwire.

Keep it a **function**, never a module-level const: the Deathmatch card quotes
`deathmatch().respawnDelaySeconds`, and a const built at import time would freeze whichever bundle
was installed first. That is the module-scope-accessor rule, in the one place it has already bitten.

## 6. What an ACTIVE mode changes outside its own folder

Flipping `isActive: true` is one field, and these follow from it with no further edit:

- **The lobby picker** gains a card (step 5), and the Settings → Game modes entry appears once two
  modes are active.
- **`activeArenaIds()`** — the union of every active mode's `arenas`, de-duplicated, registry order
  — grows. That is what `BootScene` preloads and what `scripts/build-release.mjs` puts in the zip,
  so a mode with a new arena changes what ships.
- **The players' guide** gains a tab. `stampOfModes` hashes each tab's id and name, so publishing or
  un-publishing a mode moves `balanceStamp` **even though both shipped modes' tables are
  byte-identical** — `npm run build:manual` is not optional here.
- **`docs/turn-tuning.md`** owes a `## <Mode name>` section carrying all three tables.
  `scripts/turn-tuning-doc.test.mjs` iterates `activeGameModes()` and fails until the page's `##`
  headings match it exactly, in order.
- **`npm run check:art`** already sweeps EVERY mode, active or not (`scripts/mode-rosters.mjs`), so
  a chassis or weapon only your mode carries is checked from the day the folder exists. A row some
  modes carry and others do not prints a `(mode: …)` suffix.

`isActive: false` is the publish gate and nothing else: the bundle stays reachable, and the
playground, practice and the three harnesses all pin or pass a mode directly rather than reading the
flag. Measuring a mode before publishing it is the point of measuring it.

It IS a real gate on the wire, though, as of 2026-09-23: `resolveSetMode`
(`packages/server/src/rooms/match-helpers.ts`) refuses `MSG_SET_MODE` for a mode that is not
`isActiveGameMode`, so an unpublished mode cannot be seated in a real lobby by a hand-built or stale
client — not merely hidden from the picker. (It checked phase and `hasPlayerInMatch` only until
then, which made the registry's own "`set_mode` refuses it" comment false for as long as it had
existed.)

## 7. Author it hidden, publish it in a second commit

`isActive: false` first. It costs one field to flip later, and it keeps the guide rebuild, the
turn-tuning tables and the lobby card out of the commit that is still deciding what the mode IS.
`DEFAULT_GAME_MODE` must stay active (`registry.test.ts`), so never hide the last active mode or the
mode a new lobby opens on.

## 8. The tests that start running over your row the moment it exists

Per-`MODE_TABLE`-row, automatically, naming the mode on failure:

- `modes/invariants.test.ts` — `maxAbilitySlots` in `[1, ABILITY_SLOT_CEILING]`; `maxFireSlots ===
  maxAbilitySlots + 1` and `basicAttackSlotIndex === 0`; weapon exclusivity; `maxPlayers` in
  `[2, MAX_PLAYERS]`; an `impulse` only on a `kind: "maneuver"` row; at least one arena and every
  one registered; no kit past the ceiling; and the MC38 wire-width bounds (hp within uint16,
  `unlocksAt` within uint8, the highest fire-slot index within int8).
- `modes/registry.test.ts` — one bundle per mode, each its own object, the enum-value count, the
  active set, `DEFAULT_GAME_MODE` active, and both resolver forms.
- `modes/registry-arenas.test.ts` — the `activeArenaIds()` union, de-dup and order.
- `modes/mode-arg.test.ts` — `--mode=` accepts your wire id and your slug, and round-trips.
- `modes/no-raw-config-in-sim.test.ts` — no non-test file outside `config/` and `modes/` may name a
  raw global at all.

Not automatic: `modes/parity.test.ts` names Brawl and Deathmatch explicitly. It is the migration's
witness that no balance number moved on day one, **not** a per-mode invariant — a new mode does not
belong in it.

## 9. `table-pinning.test.ts`, and how to diverge on purpose

Every table exists three times today: the raw global in `config/`, and a literal copy in each mode
folder. `modes/table-pinning.test.ts` asserts all three stay equal and fails naming the table.
It is **the alarm, not the fix**.

- **A balance change meant for every mode** — edit the raw global AND every mode folder's copy,
  equal. Tedious on purpose: the raw global is the pinned baseline, and keeping it in step is what
  makes an accidental one-mode edit legible as an accident.
- **A change meant for ONE mode — the whole point of this system** — edit that mode's folder alone,
  then **delete that table's assertion** from `table-pinning.test.ts` with a comment saying the modes
  have intentionally diverged and why. The tripwire exists to catch an accident, not to forbid the
  feature. Deleting the row is the correct action, not a workaround.
- **A brand-new mode's own tables** are not pinned by this file at all unless you add them. Do not
  add them: a mode authored to feel different will diverge by design on its first tuning pass.

## 10. The scope rule, for any new entry point

`cfg()` and all sixteen accessors **throw** outside a mode scope — there is no default-mode
fallback, by design. If this mode needs a new room, harness or script:

- A server room holds its own `ModeConfig` and wraps **every** entry point in
  `scoped(this.modeConfig, fn)` — each message handler, the simulation interval, the synchronous
  tail of `onCreate`. **No room may call `installMode`**: it writes one bundle per PROCESS, so a
  room that installed would hand its numbers to every other live room. `practice-room.test.ts`
  reads the room's own source to hold that.
- A script or harness calls `withMode(modeConfigOf(mode), fn)` once around its work. `withMode` is
  strictly synchronous and **refuses a thenable** — an async callback would restore the previous
  bundle before the awaited work ran.
- Tests use `withDefaultMode(fn)` (`modes/test-setup.ts`) when they need *some* mode, and an explicit
  `withMode(modeConfigOf(MODE), fn)` when the test is about a particular mode's numbers.
- **Never read an accessor at module scope.** `const X = drive().maxSpeed` at the top of a file
  freezes the first bundle installed for the life of the process. `memoOnBundle`
  (`packages/client/src/net/mode-memo.ts`) is the sanctioned fix. No test can see this one — it is
  on you.

## 11. The harnesses

All three take `--mode=<id|name>`, parsed by shared's one `parseModeArg`:

```bash
npm run ttk -- --mode=deathmatch
npm run balance -- --mode=2 --shape=duel --matches=20
npm run playtest -- --mode=your-mode
```

A wire id or the display name in any casing or separator. An unknown mode **refuses the run naming
the ones that exist** rather than falling back to the default — a report labelled with one mode and
filled with another's numbers is worse than no report. An inactive mode is accepted on purpose and
marked `inactive` in every header it reaches. Balance and playtest end the report folder's name with
the mode slug (`2026-09-23-01-your-mode`).

**`--baseline` refuses a cross-mode comparison outright**, before a single match is simulated, the
same way it refuses one across a `BOT_BRAIN_VERSION` change. Balance's config fingerprint hashes the
MODE's bundle, so two modes can never share one.

## Path to add a mode

1. Add the `GameMode` value at the next unused integer.
2. `cp -r` a mode folder, rename its exports, edit its `index.ts` (`arenas`, `maxPlayers`).
3. Add the `MODE_TABLE` row with `isActive: false`, and a `MODE_ORDER` entry.
4. Decide the win rule — `flow/modes.ts` will not compile until you add a case to BOTH `sidesOf`
   and `winRuleOf`, so this is a step the build makes you take rather than one to remember.
5. Root `npm run build` (shared → server → client; **never** `npm run build --workspaces`).
6. `npm test`. Expect the three `registry.test.ts` cases above to fail; extend each.
7. Tune the folder. Delete a `table-pinning.test.ts` assertion per table you diverge, with a comment.
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
- Two browser tabs, two modes, one server: both rooms tick their own numbers. This is the property
  `scoped` exists for; if one room's tuning shows up in the other, something called `installMode`.
- `npm run ttk -- --mode=<yours>` prints a matrix headed with your mode's name and wire id.
- `http://localhost:5173/manual.html` has a tab per active mode, and yours is on it only if
  `isActive` is `true`.
- `npm run check:art` marks any row only your mode carries with a `(mode: …)` suffix.
