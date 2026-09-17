# Basic attack — design

**Date:** 2026-09-17
**Status:** approved
**Clauses:** BA1–BA38

## 1. What this adds

Every car gains a **basic attack**: a fourth weapon it always carries, fires from its own input, and
never sees in the HUD's weapon panel. It is a weapon in every mechanical sense — a `WEAPON_TABLE`
row, a fire slot, a cooldown, a projectile, a damage number run through `damageFor` — and it differs
from the three ability weapons in exactly two places: which input presses it, and whether the slot
bar draws it.

The nine rows ship **identical** on purpose. This spec is the mechanism; the balance pass that makes
Mirage's basic attack read differently from Bastion's is a later edit to nine rows that already
exist.

### 1.1 What does not change

- `stepSim` is still the lockstep, and the basic attack rides the fire state machine already there.
  No new pending slot, no second press pipeline, no new sim phase.
- **A car's KIT is still three weapons.** `CarDef.weapons`, `slotsOf`, weapon exclusivity (L1), the
  at-least-one-weapon floor for active cars, and the three-weapon playground loadout editor all keep
  their current meaning and their current values. A prototype still carries `weapons: []`.
- The three ability slots keep fire-slot indices 0, 1 and 2. Nothing renumbers.
- No drive knob, no `CAR_TABLE` rating, no status row and no ram constant moves, so
  `docs/turn-tuning.md` is untouched and `golden.test.ts` cannot move.
- Friendly fire, `canDamage`, kill attribution and spike credit are unchanged — a basic attack is an
  ordinary damage source booked exactly like any other.

## 2. The weapon

**BA1. Nine ids, one per chassis, named after the chassis.** `WeaponId` gains a template-literal
arm:

```ts
type BasicAttackId = `basic-attack-${CarId}`;
```

so `basic-attack-mirage` … `basic-attack-caprico` are weapon ids the compiler enumerates from
`CarId`. Adding a tenth chassis makes `Record<WeaponId, WeaponDef>` demand its basic-attack row,
which is the failure we want: a car cannot be authored without one.

**BA2. Every prototype gets one too.** All nine chassis — the three shipped and the six unreleased —
carry a basic attack. A prototype is driven in the playground to judge its handling, and a chassis
that cannot shoot cannot be judged in a fight; and activating it later stays the one-field change
`CarDef.isActive` was designed to be.

**BA3. Nine explicit rows, one shared base.** `WEAPON_TABLE` is
`as const satisfies Record<WeaponId, WeaponDef>` and this file's own comments depend on a bare index
yielding a specific union member, which a computed spread would destroy. So the rows are written
out, each spreading one frozen `BASIC_ATTACK_BASE`:

```ts
"basic-attack-mirage": { ...BASIC_ATTACK_BASE, id: "basic-attack-mirage" },
```

"Exactly the same" is then structural rather than nine copies kept in sync by hand, and a later
per-car divergence is a field appended after the spread — the smallest possible edit, which is the
whole reason nine ids exist rather than one.

**BA4. The numbers.**

| Field | Value | Why |
|---|---|---|
| `kind` | `projectile` | |
| `hitbox` | `{ shape: "circle", radius: 12 }` | magmablast's, so the bolt reads at the same size |
| `speed` | `900` | predator's |
| `range` | `960` | 3/4 of `arena-01`'s 1280 frame width, as authored — see BA33 |
| `damage` | `20` | ~25 DPS sustained, a third of pepperbox's 75 |
| `cooldownMs` | `800` | |
| `startUpMs` | `0` | a weapon pressed this often cannot have a wind-up |
| `recoveryMs` | `0` | BA20 |
| `pierce` | `0` | |
| `volley` | `{ volleys: 1, volleyIntervalMs: 0 }` | |
| `pellets` | `{ pelletsPerVolley: 1, spreadAngleDeg: 0 }` | |
| `unlocksAt` | `1` | |
| `damageFrequencyMs` | `0` | one car, one hit, once |
| `applies` / `impulse` / `explosion` / `homing` / `stock` / `muzzles` | absent | |

At 900 u/s a bolt crosses its 960 range in 1.07 s against a 0.8 s cooldown, so a player can have two
of their own in the air at once. That is deliberate and it is what makes the weapon read as a
*stream* rather than as a poke.

**BA5. `name` is `"Basic Attack"` on all nine rows.** The name is render-only and the manual prints
the card's own label (BA26), so nine identical names collide nowhere. The id carries the chassis.

**BA6. One colour for all nine, and it is near-black.** `color: "#101014"`.

**BA7. Nine weapons sharing a colour is a deliberate exemption from the uniqueness rule, not an
oversight.** `weapon-config.test.ts` asserts every weapon has its own colour, because "the colour is
the only thing telling two shots apart on screen". That rationale is about telling *weapons* apart,
and the basic attacks are one weapon wearing nine ids: a player must not be able to tell Mirage's
bolt from Bastion's, because there is nothing to tell. The test is reworded to assert uniqueness
across the ability weapons and a single shared colour across the basic attacks — which is a
*stronger* guard than the one it replaces, since it would now also catch a stray nine-way divergence.
The never-a-player-colour half of the rule still applies to all nineteen rows.

**BA8. "Shiny black" is authored, not implied.** A weapon with no `WEAPON_GLOW_STYLES` entry draws as
a flat fill of its `color`, and on this game's LIGHT arena floors a flat `#101014` disc is already
highly visible — it just reads as a flat hole punched in the ground rather than as an object. One
shared `GlowStyle` — a near-black rim on the hitbox edge, a lighter mid band, and a small pale
core — is registered for all nine ids from a single authored constant, the same one-source shape the
table rows use, and it is that lighter band and pale core that turn the hole into a sphere. The
highlight is a CORE rather than an off-centre specular because a band is a radius and not a position:
concentric rings are all this renderer has, so the bolt reads as a polished sphere lit from inside.
The outermost solid band must sit at `radiusScale: 1` — a `combat-visual` test holds every style to
that, since a band outside the hitbox would draw a silhouette larger than the thing that can hurt
you. No halo and no flicker: `magmablast`'s comment about a 12-unit disc's pulsing outline reading as
a rendering fault applies here exactly.

## 3. The slot model

**BA9. `CarDef` gains `basicAttack: WeaponId`.** Required on every row, so the compiler enforces BA2.
`basicAttackOf(carId)` is its accessor, beside `slotsOf`.

**BA10. `weapons` keeps meaning the three ABILITY slots.** This is the load-bearing decision of the
whole spec. `slotsOf` has roughly fifteen consumers — the HUD, the manual, the playground loadout
editor, the balance harness's armed filter, ttk, three playtest probes, the bot's reach model — and
every one of them means "the kit this chassis was designed around". Widening `slotsOf` would have
made all fifteen say something new at once, including the ones that must not (BA30, BA31).

**BA11. `WEAPON_SLOT_CONFIG.maxWeaponSlots` is renamed `maxAbilitySlots`, and `maxFireSlots` joins
it.** `maxAbilitySlots` stays 3; `maxFireSlots` is 4. The rename is the point: a constant called
"max weapon slots" reading 3 while every car carries four weapons is precisely the quiet lie this
codebase documents its way out of everywhere else. `maxFireSlots` is derived as
`maxAbilitySlots + 1` rather than typed as 4, so the two cannot drift.

**BA12. `fireSlotsOf(carId)` is the one place the two concepts are joined.**

```ts
fireSlotsOf(carId) === [...slotsOf(carId), basicAttackOf(carId)]
```

The rule that decides which of the two a caller wants: **`fireSlotsOf` answers "what can this car
fire", `slotsOf` answers "what kit was this chassis designed around".** Exactly three readers ask the
first question, and they are named here so a fourth is a deliberate act rather than a habit:

1. `newFireState` — the sim's fire state, and the only one on the tick path. It is server-side only;
   the client never builds a fire state, so there is no lockstep half to keep in agreement here.
2. `packages/server/balance/stats.ts` — the per-weapon accumulator seeding (BA30).
3. `scripts/ttk.mjs` — `simulateTtk`'s rotation and the one-press input table (BA31).

Everything else — the HUD, the manual, the playground editor, the balance seat filter, ttk's
`armedCarIds`, the bot's reach model, the playtest probes — keeps calling `slotsOf` and keeps seeing
three.

**BA13. The basic attack is fire slot 3, always.** Last, so the three ability indices are unmoved and
`slotsFrom`'s truncation still guards the kit at three. `basicAttackSlotIndex` is
`maxAbilitySlots`, derived, not typed.

**BA14. The playground's explicit loadout gets a basic attack too.** `newFireState`'s `weaponIds`
override (PG13) and `loadoutFor` in `combat-bridge.ts` both append `basicAttackOf(carId)` after
`slotsFrom`. The override names three ability weapons; the basic attack is a property of the chassis
and not of the loadout, so it is not overridable and the settings panel does not draw it.

**BA15. The wire mask widens to four bits and the schema carries four slots.** `SLOT_MASK` in
`packages/server/src/sim/tick.ts` becomes `(1 << maxFireSlots) - 1`; `slotMaskFrom` on the client
runs to `maxFireSlots`. `PlayerState.weapons` now holds four `WeaponSlotState` rows for every car.
That is a schema-visible change and owes `docs/schema-reference.md` an edit. Nothing else about the
protocol moves: `lastFiredSlot` is already an `int8` with room, and press-edge detection is per bit.

## 4. Input

**BA16. The bindings.**

| Fire slot | Key | Mouse-hand |
|---|---|---|
| 3 — basic attack | H | LMB |
| 0 — ability 1 | J | RMB |
| 1 — ability 2 | K | SHIFT |
| 2 — ability 3 | L | SPACE |

**BA17. `SLOT_KEYS` needs no new field.** SHIFT is a second `keyCode` (16) on slot 1, exactly as
SPACE (32) already is on slot 3; only the basic attack and ability 1 carry a `buttonsMask` (1 and 2).
The array gains a fourth entry at index 3 and is still indexed by fire slot.

**BA18. `"SHIFT"` fits the pill.** `SLOT_KEY_COLUMN_PX` was measured against five characters, which
is what `"SPACE"` already spends. A sixth would overflow the gutter's right edge.

**BA19. The countdown action hint becomes the only place the basic attack's binding is taught, and
that is a known cost.** The controls rule from 2026-08-30 is that a binding nobody prints breaks
quietly later, and the gutter pill is what prints a slot's binding — but the basic attack has no
pill, because hiding it from the panel is the feature. The hint therefore reads
`"H J K L or LMB RMB SHIFT SPACE to fire"`, and a player who joins after the countdown has nothing
telling them LMB fires. Accepted for now; the cheapest later fix is a one-line control legend, not a
pill.

## 5. Locks and press resolution

**BA20. The basic attack shares the fire state machine, and authors `recoveryMs: 0`.** It is spent,
recharged, refire-locked and switch-locked by exactly the code every other weapon runs. Zero recovery
means firing it never locks an ability out.

**BA21. A simultaneous ability press beats it.** `beginFire` takes the lowest set bit the car can
use, and the basic attack is the highest index. Pressing an ability and the basic attack on one tick
fires the ability; the basic-attack press is dropped, not queued, like every other press this game
has ever refused.

**BA22. An ability's own recovery briefly blocks the basic attack.** `afterburner` and `thunderclap`
author `recoveryMs: 200`, `lance` more; during that window the basic attack cannot fire, because it
is a different slot and `switchLockUntilTick` does not care which. This is the shared machinery
doing its job rather than a special case going wrong. An independent second track was considered and
rejected: it would duplicate `pending`, both locks and their schema projection, and every rule
written once would then exist twice.

## 6. Bot

**BA23. The bot gets it for free, and must.** `BotController`'s candidate loop iterates
`self.slots.length` and solves a firing solution per ready slot, so a fourth slot is considered with
no new branch. A bot that could not press the weapon every human presses constantly would make every
practice match measurably easier than the game it is practice for.

**BA24. `rollPersonality` draws a fourth per-slot weight.** Its loop runs to `maxAbilitySlots` today
and moves to `maxFireSlots`. This shifts every bot's RNG stream by one draw.

**BA25. `BOT_BRAIN_VERSION` is bumped, `duel.fixture` is re-pinned, and every balance baseline
predating this change is void.** The fingerprint is what stops a reader comparing two reports across
a behaviour change, and `--baseline` refuses the comparison rather than trusting them to remember.
Re-pinning the fixture bars is expected fallout of BA24, not a regression to investigate.

`duel.fixture.ts` also builds its own expected press-rate model by looping `slotsOf(carId)` over
cooldowns. That loop reads `fireSlotsOf` — it is asking what the bot can fire, not what kit the
chassis was designed around (BA12) — which moves its expected-presses bar on top of the RNG shift.

## 7. The players' guide

**BA26. Each active chassis's weapon list opens with a "Basic attack" card.** First, above the three
ability cards: it is the weapon a player presses most.

**BA27. `weaponCard` takes an explicit label instead of indexing `SLOT_LABEL` by slot.** The three
abilities keep `"Slot 1"` … `"Slot 3"` from their kit position; the basic attack passes
`"Basic attack"`. Indexing a label array by a fire-slot index that is 3 would print `undefined`.

**BA28. It needs one `WEAPON_COPY` line, and the page publishes active chassis only.** The three
published rows get the same line; the six prototype rows get one too, so the copy map stays complete
and `isActive` stays a one-field flip. The icon falls back to the procedural glyph until art exists
(BA32). The Effects section is untouched — a basic attack applies no status.

**BA29. `balanceStamp` moves, so `npm run build:manual` ships in the same commit.** The stamp hashes
`WEAPON_TABLE` and the active `CAR_TABLE` subset whole; nineteen rows and a new `CarDef` field move
it on both counts.

## 8. Tests, harnesses and tooling

**BA30. The balance harness's armed filter stays on abilities, but its per-weapon table must seed
from `fireSlotsOf`.** Two different reads, and conflating them breaks the report:

- `runner.ts` seats `slotsOf(id).length > 0`. Unchanged, so the six prototypes stay out of a default
  run even though they can now shoot — a chassis whose only weapon is the one every chassis carries
  measures nothing about that chassis.
- `stats.ts` pre-seeds a row per weapon from `slotsOf` and then builds the whole weapons table from
  `weaponCarOf.entries()`. A weapon the bots press but nobody seeded accumulates damage into maps
  that are never read and is **silently absent from the report** — precisely the "an ignored weapon
  becomes invisible" failure that seeding comment exists to prevent. It seeds from `fireSlotsOf`.

The basic attack fires in every match the harness runs, because the bots press it (BA23).

**BA31. `npm run ttk` counts the basic attack in its rotation, and its attacker axis does not
widen.** `simulateTtk`'s kit and the one-press input table read `fireSlotsOf` — a time-to-kill that
ignored a trigger the car actually pulls would be answering a question nobody asked — so every kill
time in the matrix drops. `armedCarIds()` keeps reading `slotsOf`, so the prototypes stay off the
attacker axis for BA30's reason. The defender axis already covers the whole table and is unchanged.

**BA32. `npm run check:art` grows nine icon-less warnings.** A weapon with no manifest row warns and
falls back to the procedural glyph, exactly as `tremor` does today. Warnings never fail the suite;
these nine are expected until someone draws an icon.

**BA33. The playtest probes measure what this changes, and this spec does not touch them.** Weapon
reach, fire cadence and per-press damage all move. `npm run playtest` is the user's call to make
after this lands; a probe that no longer compiles is fixed on the spot and said so in the summary,
and nothing else is edited silently.

**BA34. New and changed config assertions.**

- `weapon-config.test.ts`: the roster count goes ten → nineteen; colour uniqueness splits per BA7;
  a new rule that every `basic-attack-*` row is a `kind: "projectile"` carrying no `applies`,
  `impulse` or `explosion`, so the "identical, boring, no mechanics" promise is enforced rather than
  merely written here.
- `weapon-slots.test.ts`: a new rule that a car's `basicAttack` never appears in its own `weapons`,
  and that `basicAttackOf(carId)` is the row whose id ends in that `carId`. Exclusivity (L1) holds by
  construction, and the existing unconditional-exclusivity test now also covers the nine new ids
  through `fireSlotsOf`.
- `fire.test.ts`: a car's fire state carries four slots; a mask of `1 << 3` fires the basic attack;
  an ability and the basic attack pressed together fire the ability; the basic attack's zero recovery
  leaves `switchLockUntilTick` at the current tick.
- `slot-keys` tests: four entries, the H/LMB row at index 3, and `slotMaskFrom` setting bit 3.

**BA35. Docs owed in the same commit:** `CLAUDE.md` (a basic-attack paragraph beside the statuses and
roster ones), `docs/combat-model.md`, `docs/config-reference.md` (`CarDef.basicAttack`, the renamed
slot constants), `docs/schema-reference.md` (four `WeaponSlotState` rows), and the rebuilt
`manual.html`.

**BA37. The playground's loadout dropdowns must exclude the basic attacks.** `weaponOptions()` in
`dev/playground/ui-model.ts` builds the per-seat weapon pickers from the whole `WEAPON_TABLE`, so
without a filter a tester could seat `basic-attack-bastion` in Mirage's slot 1 — a car with two basic
attacks, one of them another chassis's — and nine entries all reading "Basic Attack" would be
unusable anyway. The pickers list ability weapons only. This is the same distinction as BA12 wearing
a UI hat: the dropdown is choosing a KIT.

**BA38. The playground's tuning panel gains them per seat, titled by id.** `statsTabs` builds its
weapons tab from the ENABLED SEATS' own loadouts (`seats.flatMap((car) => car.weapons)`), not from
`WEAPON_TABLE`, so a basic attack reaches the panel only if it is added — and it should be, because
live-tuning its damage or range is exactly the knob BA36 expects someone to reach for. Each enabled
seat contributes `basicAttackOf(car.carId)` alongside its three abilities. Two seats on different
chassis then produce two groups both titled "Basic Attack" (BA5), so a group whose name is shared by
more than one `WEAPON_TABLE` row is titled by its id instead — the smallest fix, and one that needs
no second name field on the table.

## 9. Known risk, stated rather than solved

**BA36. 960 units is a long reach for a weapon with no ammunition.** It out-ranges `magmablast`
(900), is 1.6× `pepperbox` (600) and nearly 2× `roadblock` (500), on an `arena-01` whose playable
area is 1132 × 612. There is no standoff distance on either shipped arena where a car is safe from
chip damage, and the cheapest line in a fight becomes plinking from range rather than closing. A
start nearer 500–600 would have made the basic attack a close-range default and left the long pokes
to the weapons that pay a cooldown for them. Shipped at 960 by explicit decision, with the retune
expected; if the first playtest reads as "everyone kites", this number is the cause and it is a
one-field fix on nine rows.

## 10. Out of scope

- Cooldown feedback for the basic attack. It is off the panel and nothing else shows it: a player
  learns its rhythm by pressing it. If that reads badly, a crosshair-adjacent readout is the fix, and
  it is a separate change.
- Per-chassis divergence. Nine rows exist so it can happen; none of it happens here.
- Art. Nine icons, and whether a basic attack deserves one at all given it never appears in the HUD.
- Auto-fire on a held input. Rejected for now: the sim's fire mask deliberately carries presses, and
  server-side edge detection is what stops a hand-rolled client buying auto-fire back.
