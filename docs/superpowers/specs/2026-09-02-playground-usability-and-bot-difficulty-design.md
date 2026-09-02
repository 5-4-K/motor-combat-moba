# Motor Combat MOBA — Playground Usability and Bot Difficulty Design

**Designed:** 2026-09-02 · **Recorded in repo:** 2026-09-02
**Status:** Designed, not yet implemented.
**Builds on:** [`2026-09-01-playtest-playground-design.md`](2026-09-01-playtest-playground-design.md),
whose room, overlay, tuning seam and bot this extends. Decisions there are **PG1–PG23**; decisions
here continue the same sequence at **PG24–PG40** and are referenced by number elsewhere.

---

## Problem

The playground shipped and is in daily use, and eight things about it get in the way:

1. The **bot has one setting, and it is relentless.** It charges at full throttle, never coasts,
   recomputes its intent every tick, and pulses its fire mask every other tick. There is no room to
   line up a shot, watch a status expire, or read a turn arc — every measurement is taken while
   being rammed. The only alternative is a motionless dummy.
2. **Settings opens against a bot** even though most sessions start alone.
3. The **Back button is at the bottom** of a panel that scrolls for dozens of slider rows, so
   leaving settings means scrolling past every stat first.
4. Changing a car's chassis **keeps whatever weapons were selected**, and getting back to that
   chassis's real kit means three dropdowns and a memory of the roster.
5. The **Stats area is one long scroll** — car sections, then Global, then up to six weapon
   sections — with no way to jump to the group being worked on.
6. Sliders are **drag-only**. A range input whose step is `max/100` cannot be nudged by one step
   without pixel-hunting.
7. Both cars are **assigned random colours** from `COLOR_TABLE` at join. A pair that reads badly
   together is re-rolled by rejoining, and a specific pair cannot be reproduced at all.
8. `?dev=assets` **cannot show a weapon on no kit.** Its grid is one row per chassis by kit slot, so
   `tremor` — the only orphan today — is named in the header as "not shown" and never drawn. An
   inactive chassis is drawn, but is indistinguishable from a live one.

This design fixes all eight. It **deliberately reverses one line** of the original spec's Out list,
which read "bot difficulty or behavior options": PG27–PG29 add exactly that, and the reasons the
original gave (scope, not principle) no longer hold now that the tool is the primary tuning surface.

---

## Scope

In: three new fields on the `PlaygroundSetup` wire contract, a bot difficulty profile table with two
new behaviour knobs, per-car colour selection, a re-laid-out settings panel (sticky header, tabbed
stats, per-row steppers, restore-shipped-loadout), and two additions to `?dev=assets`.

Out: any player-facing change; anything in `sim/`; any balance table edit; multiplayer playground
sessions; new bot *states* (the profiles tune one behaviour, they do not add stances); editing
`isActive` from a dev tool; new playtest probes.

Nothing here moves `balanceStamp`, so `npm run build:manual` is not owed. Nothing here changes a
turn stat, so `docs/turn-tuning.md` is untouched. No probe in `packages/server/playtest/` measures
any of it — `playground-bot.ts` is consumed only by `PlaygroundRoom` and its own test; the LAN probe
carries its own copy of the chaser.

---

## The wire contract

### PG24. `PlaygroundSetup` gains three fields, strictly validated

`packages/shared/src/net/playground-messages.ts`:

```ts
export type BotDifficulty = "easy" | "medium" | "hard";

export interface PlaygroundCarSetup {
  carId: CarId;
  colorId: number;                                   // new
  weapons: readonly [WeaponId, WeaponId, WeaponId];
}

export interface PlaygroundSetup {
  botEnabled: boolean;
  botDifficulty: BotDifficulty;                      // new
  arenaId: string;
  me: PlaygroundCarSetup;                            // carries colorId
  opponent: PlaygroundCarSetup;                      // carries colorId
}
```

`isPlaygroundSetup` stays **strict**: a payload missing `botDifficulty`, or carrying a `colorId` that
is not an integer present in `COLOR_TABLE`, or a `botDifficulty` outside the three literals, is
rejected whole — the same reject-whole rule PG13 set for tuning blobs, and for the same reason. A
partial apply would leave the panel's view of the setup disagreeing with the room's.

A new `isBotDifficulty(value): value is BotDifficulty` guard sits beside `isCarId`/`isWeaponId` and
is exported, so the overlay can narrow a `<select>`'s string without a cast.

### PG25. Stored setups are upgraded on load, not invalidated

`isPlaygroundSetup` also guards what `storage.ts` replays (PG20), so making it stricter would make
every setup saved before this change fail validation and fall back to `defaultPlaygroundSetup()` —
silently discarding a car, a loadout and an arena the developer chose.

`decodeStored` therefore **upgrades before validating**: a parsed `setup` record is merged over
`defaultPlaygroundSetup()` (and each of its `me`/`opponent` records over the corresponding default
car setup) field by field, and the merged result is what `isPlaygroundSetup` sees. A v1 blob keeps
its `carId`, `weapons` and `arenaId` and inherits the new fields' defaults; a blob that is still
invalid after the merge — a retired `carId`, a duplicated weapon — falls back whole, exactly as
today.

`PLAYGROUND_STORAGE_KEY` stays `"motor-combat.playground.v1"`. The merge is a codec concern, lives
in `storage.ts`, and never loosens the wire: the server still rejects an incomplete payload.

### PG26. First entry is alone, on medium

`defaultPlaygroundSetup()` returns `botEnabled: false` and `botDifficulty: "medium"`, and two
**distinct** default `colorId`s (`0` and `1` — Crimson and Azure).

Alone is the default because most sessions open by driving: reading a turn arc, checking a sprite,
feeling a speed change. A bot is something you switch on when the question is combat. Medium is the
default *difficulty* rather than hard so that the first time the bot is switched on it is not the
thing this design was written to fix — even though, with alone as the default mode, that select
starts disabled.

### PG27. Bot difficulty is a profile table; hard is today's bot by construction

`BOT_CONFIG` in `packages/server/src/rooms/playground-bot.ts` is replaced by:

```ts
export interface BotProfile {
  readonly standoffUnits: number;
  readonly deadbandUnits: number;
  readonly reactionTicks: number;
  readonly aimToleranceRad: number;
  readonly fireConeRad: number;
  readonly firePeriodTicks: number;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>>;
```

| knob | easy | medium | hard | meaning |
|---|---:|---:|---:|---|
| `standoffUnits` | 170 | 110 | **70** | distance it tries to hold |
| `deadbandUnits` | 60 | 30 | **0** | half-width of a band around standoff where throttle is `0` |
| `reactionTicks` | 6 | 3 | **1** | how often intent is recomputed; held in between |
| `aimToleranceRad` | 0.55 | 0.42 | **0.30** | steering deadzone — wider settles further off target |
| `fireConeRad` | 0.60 | 0.48 | **0.35** | how well aimed it must be to fire |
| `firePeriodTicks` | 10 | 5 | **2** | fire-mask pulse cadence |

The hard column is **exactly** today's `BOT_CONFIG` plus today's module-level
`OPPONENT_FIRE_PERIOD`, and a test asserts that equality by value rather than by comment — "the
current one should be hard" is then true by construction and stays true.

**`aimToleranceRad < fireConeRad` is an invariant of every profile, and a test asserts it.** The two
knobs interact: tolerance is the deadzone the bot *stops steering inside*, and the cone is the gate it
must be inside *to fire*. A profile whose tolerance exceeded its cone would let the bot settle at a
heading it is content with but may never shoot from — an easy bot that never fires, which is worse
for testing than one that fires badly. Today's hard column already satisfies this (0.30 < 0.35); the
new columns widen both together rather than pulling them apart.

Widening both is what makes a lower difficulty aim worse: it settles further off target *and* is
willing to release a shot from there. That lever is **secondary**, though, and this design should not
oversell it — `resolveAimAngle` (`sim/combat.ts`) rotates a shot toward the locked target for any
weapon with `usesAimAssist`, so a misaligned shot from a bot holding a lock is partly corrected. The
dominant easy levers are `standoffUnits`, `deadbandUnits`, `reactionTicks` and `firePeriodTicks`.

`OPPONENT_FIRE_PERIOD` (today a module-level constant in `PlaygroundRoom.ts`, not in the bot module)
is deleted; its role is `firePeriodTicks`.

### PG28. Two new behaviour knobs: a coast band and a reaction delay

The relentlessness has two sources beyond raw fire rate, and each gets one knob.

**`deadbandUnits` — the bot may now coast.** Today `throttle` is
`distance > standoffUnits ? 1 : -1`: the bot is always either charging or reversing, and at the
standoff distance it oscillates between the two, in your face, every tick. With a deadband it holds
`throttle: 0` while `|distance - standoffUnits| <= deadbandUnits`, running the ordinary drive model's
deceleration exactly as letting go of the throttle does. `deadbandUnits: 0` collapses to today's
expression precisely, which is what keeps hard unchanged.

**`reactionTicks` — the bot may now be late.** The room recomputes bot intent only every
`reactionTicks` ticks and re-enqueues the *previous* intent in between, so a lower difficulty
over- and under-shoots a dodge instead of tracking it frame-perfectly. `reactionTicks: 1` is
today's every-tick behaviour.

### PG29. `botInput` stays pure; the room keeps owning cadence

`botInput(seq, self, target, slotRanges, profile)` gains the profile as a parameter and remains a
pure function of its arguments — no timers, no held state, node-testable, and its existing tests
survive by passing `BOT_PROFILES.hard`.

Reaction lag and fire pulsing are **both** room concerns, held in `PlaygroundRoom` beside the
existing `opponentSeq` and `prevFireMasks`, because they are decisions about what reaches the wire
rather than about what the bot wants — the same reasoning the current code already gives for pulsing
the fire mask in the room rather than in `botInput`. The room holds a `lastBotIntent` and recomputes
on `tick % profile.reactionTicks === 0`; it pulses fire on `tick % profile.firePeriodTicks === 0`.
The two cadences are independent and are not required to divide evenly into one another.

A held intent is re-enqueued with a **fresh `seq`** every tick — `serverTick` needs one input per
tick per car, and reusing a sequence number would look like a duplicate rather than a repeat.

The held intent is **cleared** whenever it could go stale: on any `applySetup` (a difficulty, chassis
or loadout change), while the bot is off (alone mode already enqueues a neutral input and returns
early — it must also drop the hold, so switching the bot back on cannot replay an intent computed
against a pose from minutes ago), and when the target is not alive. A cleared hold recomputes on the
next tick regardless of the cadence.

### PG30. `botDifficulty` is a networked schema field

`PlaygroundState` gains `@type("string") botDifficulty = "medium"` beside `botEnabled` and
`tuningJson`. Nothing in `stepSim` reads it — it is networked because `setupFromState()` seeds the
settings panel off the schema, and a difficulty that lived only in the room would make the select
show a stale value every time settings reopened.

`applySetup` writes it alongside `botEnabled`.

---

## Colour

### PG31. Colour is a `colorId` from `COLOR_TABLE`, and duplicates are allowed

The game paints a car from `PlayerState.colorId`, an index into `COLOR_TABLE`'s six named colours,
and `carFillOf`, the roster swatches, the HP bars, the dash ghosts and the lobby/results views all
read that one id. Selecting a colour is therefore choosing a `colorId`, not a hex string: nothing new
goes on the wire beyond two integers, and every consumer already paints correctly.

**Both cars may select the same colour.** No guard, client or server. This is a dev tool, and "can I
tell these two apart by silhouette alone" is a readability question worth being able to ask.

### PG32. A colour change never respawns

`applyCarSetup` writes `player.colorId` but does **not** count a colour change as a change requiring
a respawn — only `carId` and the loadout do, as today. Repainting a car mid-test must not reset its
hp, cooldowns and pose.

`ArenaScene` already keys its car container on `` `${carId}:${colorId}:${alive}` ``, so the sprite is
rebuilt in the right paint on the next patch with no client change.

`onJoin` keeps its `pickColor` assignment: it is what colours the two cars for the instant before the
client replays its stored setup, and `applySetup(defaultPlaygroundSetup())` overwrites it in the same
call.

---

## The settings panel

### PG33. A sticky header, with Back top-right

`<h2>Settings</h2>` and the Back button share one flex row, `justify-content: space-between`,
`align-items: center`, with Back overriding `.pg-panel button`'s `display: block; width: 100%`. The
row is `position: sticky; top: 0` against the panel's own background, because `.pg-settings` is
`max-height: 80vh; overflow-y: auto` and a non-sticky header is "on top" only until the first scroll.

Back stays disabled while either loadout is illegal (PG17), and `leaveSettings` keeps re-checking
`settingsIllegal` so the `P` key is not a side door. Because the red `pg-illegal` outline that
explains the disabled button may now be scrolled out of view, the header shows a short hint beside
Back while it is disabled: *duplicate weapon in a loadout*.

Panel `min-width` goes 360px → 420px to fit the widened car rows.

### PG34. A restore-shipped-loadout button beside each car select

Each car row becomes `[ car ▾ ] [ colour ▾ ] [↺]`, with the loadout row beneath it unchanged. `↺`
reads `slotsOf(carId)` — the chassis's shipped kit from shared, the same function
`defaultPlaygroundSetup` uses — writes the three weapon selects, then runs the existing
`evaluate(true)` and `renderStats()` so the send, the persistence and the stats sections all follow
the ordinary edit path.

The glyph is the same `↺` the stat rows use for "reset to shipped", because it means the same thing.
Its `title` names the chassis: *Restore Bastion's shipped loadout*. It is disabled when
`slotsOf(carId)` does not yield three distinct weapons, so a future chassis with a short or
duplicated kit produces a dead button rather than an illegal loadout.

Changing the car select does **not** restore the loadout implicitly. Trying a kit on a chassis it was
not designed for is a thing this tool exists to allow; the button is the opt-in.

### PG35. Stats become three tabs: Global, Cars, Weapons

`sliderGroups(setup)` in `ui-model.ts` is replaced by:

```ts
export type StatsTabKey = "global" | "cars" | "weapons";
export function statsTabs(setup: PlaygroundSetup):
  { key: StatsTabKey; title: string; groups: { title: string; fields: TunableField[] }[] }[];
```

Three tabs, always in that order, each holding exactly the groups today's `sliderGroups` already
produces — **the filter does not change** (PG13): Cars holds the one or two currently selected
chassis, Weapons the up to six currently selected weapons, Global the drive/ram/combat rows. Tuning a
chassis that is not on the field changes nothing observable, so widening the filter would only
lengthen the scroll.

A tab with no groups is still drawn and shows a short empty line rather than being hidden, so the tab
bar's shape does not change under the pointer.

The active tab is local to the settings session, opens on **Global**, and is not persisted.
`renderStats()` preserves it across a car/weapon change. Switching tabs rebuilds the rows from the
same `overrides` map, so nothing is lost; it is never called mid-drag, since a tab click and a slider
drag cannot overlap.

### PG36. Stepper buttons on number rows only

A `number` row becomes `[label] [−] [slider] [+] [value] [↺]`. `boolean` and `enum` rows are
unchanged — a checkbox and a select have nothing to step.

Each button steps by `field.step`, clamped to `[field.min, field.max]`, and then routes through the
row's existing `onEdit`, so the `isAtShipped` half-step tolerance, the readout repaint and the
localStorage save all apply exactly as a drag's do.

A range input snaps every write to its `min`/`step` grid, so the steppers **read the control's
current (already snapped) value and add `step` to that**, rather than tracking a float of their own —
which is what makes up-then-down a round trip instead of a drift. The exact shipped value very often
does not sit on that grid (see `isAtShipped`'s own note), so `↺` remains the only way back to it
precisely; that is unchanged and correct.

The pure part — clamping a stepped value into range — is a small exported function in `ui-model.ts`
with its own tests. `TunableField`'s `min`, `max` and `step` are all optional (`tuning-walker.ts`), so
it returns the value unchanged when any of the three is absent, and the buttons are omitted for such
a row rather than rendered dead. The buttons themselves are overlay DOM and stay untested, per PG19.

---

## `?dev=assets`

### PG37. Weapons on no kit get their own row

`drawWeaponGrid` draws one row per chassis and one cell per kit slot, so a weapon no chassis carries
has no cell. `orphanWeaponIds` already computes exactly that set and `summary()` already names it —
as *"not shown"*.

After the chassis rows, the grid draws an **`unassigned`** row (sub-label *on no kit*) filling left to
right and wrapping every `WEAPON_GRID_COLS = 3` cells. `drawWeaponCell(weaponId, row, col)` is
position-agnostic and is reused untouched, so an orphan is drawn through the same HUD resolver, slot
circle and shot-palette swatch as every other weapon — which is the whole point, since an orphan is
usually a weapon being brought up.

`tuning-layout.ts` gains `WEAPON_GRID_COLS` and a pure
`unassignedCellPosition(index, chassisCount): { row, col }`, tested beside `orphanWeaponIds`. The
header note loses *"not shown"* and reads `(tremor on no kit)`.

### PG38. An inactive chassis says so

`drawCell` already draws every row of `CAR_TABLE` with no `isActive` filter, so an inactive chassis
is not hidden — it is just indistinguishable from a live one. It gains an amber `inactive` tag under
its manifest key, and the same tag on its weapon-grid row label.

No chassis is inactive today (PG18's flag exists and all three are `true`), so this is defensive. It
costs two lines and is the difference between the tool telling the truth and looking like it has.

---

## Testing and obligations

### PG39. Tests

- `playground-messages.test.ts` — `isPlaygroundSetup` accepts a full v2 payload; rejects a missing
  `botDifficulty`, an unknown difficulty string, a non-integer `colorId`, a `colorId` outside
  `COLOR_TABLE`, and (still) a within-car duplicate weapon. `isBotDifficulty` narrows the three
  literals and rejects prototype-chain names. `defaultPlaygroundSetup()` is alone, medium, and two
  distinct colours.
- `storage.test.ts` — a v1 blob (no `botDifficulty`, no `colorId`) keeps its car, weapons and arena
  and gains the defaults; a blob invalid for an older reason still falls back whole; the overrides
  half is unaffected either way.
- `playground-bot.test.ts` — `BOT_PROFILES` is frozen; **`hard` equals today's `BOT_CONFIG` values
  and `OPPONENT_FIRE_PERIOD` by value**; a target inside the deadband yields `throttle: 0` while the
  same pose under `hard` yields `-1`; **every profile satisfies `aimToleranceRad < fireConeRad`**;
  easy's `reactionTicks` and `firePeriodTicks` are strictly the largest of the three and hard's the
  smallest; the existing steering/fire cases pass `BOT_PROFILES.hard` and keep their current
  expectations.
- `playground-room.test.ts` — a colour-only setup change repaints without respawning (hp and pose
  survive); a chassis change still respawns; `state.botDifficulty` mirrors the applied setup; with
  `reactionTicks: 3` the room enqueues the held intent on the two intervening ticks, each with a
  fresh `seq`; a setup change clears the hold, and so does toggling the bot off and back on.
- `ui-model.test.ts` — `statsTabs` returns the three keys in order, puts the selected chassis under
  `cars` and the selected weapons under `weapons`, dedupes when both cars pick the same chassis or
  weapon, and returns an empty group list rather than dropping a tab; the stepper clamp holds
  `[min, max]` and steps by `step`.
- `tuning-layout.test.ts` — `unassignedCellPosition` wraps at `WEAPON_GRID_COLS` and starts below the
  last chassis row; `orphanWeaponIds` is unchanged.
- `overlay.ts` and `AssetTuningScene.ts` stay untested DOM/Phaser shells (PG19).
- Root `npm test` and `npm run build` are the gate. `golden.test.ts` must stay green untouched.

### PG40. Obligations owed elsewhere

- **Root `CLAUDE.md`**: the doc table's playground row points at this spec alongside the original.
- **`docs/project-structure.md`**: no new files beyond tests, so a line only if the plan adds one.
- **`docs/config-reference.md`**: `BOT_PROFILES` replaces `BOT_CONFIG` as the named dev-only table.
- **Not owed:** `npm run build:manual` (no `balanceStamp` input moves), `docs/turn-tuning.md` (no
  turn stat moves), and any playtest probe edit (nothing here is measured by one). If implementation
  drifts into `sim/` or a balance table, that stops being true and the run must be recommended
  loudly, per the root `CLAUDE.md` rule.
