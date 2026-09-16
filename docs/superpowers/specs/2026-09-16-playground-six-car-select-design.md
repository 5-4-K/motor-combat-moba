# Playground six-car select — design

**Date:** 2026-09-16
**Status:** approved
**Clauses:** PG56–PG88 (continuing the playground series; PG1–PG23, PG24–PG40, PG41–PG55, EV1–EV34)

## 1. What this replaces

The dev-only playground (`?dev=playground`) has shipped since 2026-09-01 as a **two-car sandbox**:
the human's car and one opponent. That pair is baked into every layer — `PlaygroundSetup` carries a
`me` and an `opponent` field, `PlaygroundRoom` holds a `humanSessionId` and a single reserved
`BOT_SESSION_ID`, `otherPlaygroundId` answers "the other one" by flipping between exactly two ids,
and the settings panel draws exactly two car rows.

That was the right shape when the roster was three chassis and the question was "how do these two
feel against each other". It is the wrong shape now. `CAR_TABLE` carries **eight** rows as of
2026-09-16 — three shipped plus five unreleased prototypes, all five of which now have art — and the
questions worth asking in the sandbox are crowd questions: how a chassis reads in a six-car brawl,
whether a weapon's reach is oppressive with five targets on the field, whether the arena's spike
ring plays differently when there is nowhere to retreat to.

This spec widens the playground to **six cars**, and folds every car-and-match choice out of the
Physics settings panel into a new **Car select** panel of its own.

### 1.1 What does not change

- The playground is still dev-only, still `DEV_TOOLS`-gated, still `maxClients = 1`, still refuses
  to open while an arena or practice room has anyone in it (PG15/PR10).
- There is still **no win check** (PG6). Death runs the deathmatch respawn machinery forever.
- `beginCountdown` is still stamped at match start only, never re-run by `applySetup` — or every
  weapon swap would cost a three-second freeze.
- The tuning store is still process-wide and still cleared on leave and dispose (PG15).
- `PlaygroundScene`'s join-time replay is unchanged in order and reasoning: tuning first, then
  setup, because `applySetup` respawns and reads hp through the tuning store (PG20).
- Nothing in `packages/shared/src/sim/` changes. No balance table moves. The playtest probes drive
  `ArenaRoom.tick` and are not on this path.

## 2. Seats and identity

The load-bearing decision, and the one every other section rests on.

**PG56. The playground has six fixed seats.** `PLAYGROUND_SEATS` is derived from `MAX_PLAYERS`
rather than typed as `6`, so hard invariant 10 and the sandbox's capacity cannot drift apart.
`PLAYGROUND_SEAT_IDS` is a frozen list of six stable session ids — `"pg-0"` … `"pg-5"` — in seat
order.

**PG57. The human's client session owns no car.** Every seat, including the one the human drives,
is keyed by its `PLAYGROUND_SEAT_IDS` entry. `client.sessionId` identifies the *connection*, never a
car.

This is a deliberate reversal of the old model, where the human's car was keyed by their Colyseus
session id. Three things follow, and all three are why:

1. **Switching the driven car is one field write.** `controlledSessionId = "pg-3"` and nothing else
   moves — no re-keying a row in `state.players`, no destroy-and-recreate on the client.
   `ArenaScene.drivenSid` already resolves through `controlledCarOf`, which already prefers
   `controlledSessionId` when the state carries one, so the client needs no change at all.
2. **A car tint survives a reload.** `fx/car-tint.ts` keys its overrides by session id (deliberately
   — PG31 lets two cars wear the same `colorId`, so keying on the slot would repaint both). Under
   the old model the human's key was a fresh Colyseus session id on every connection, so *your own*
   tint was silently lost on every page reload while the bot's persisted. Seat ids fix that as a
   side effect rather than as a feature.
3. **Every per-session map keys off something stable** — the bot controllers, their RNG streams, the
   input queues, the fire states.

**PG58. `bindViewRouter` no-opping in the playground is expected, not a regression.**
`packages/client/src/net/view.ts` reads `players.get(room.sessionId)` and returns early when that
row is absent. Under PG57 it is always absent in a playground room, so the router never routes.
That is the same observable behaviour as today (where it found an `IN_MATCH` row and stayed on the
arena scene), and the playground's scene is launched directly by `PlaygroundScene` rather than by
the router. Nothing is added to make the router "work" here.

**PG59. `BOT_SESSION_ID` stays, and the playground stops using it.** `PracticeRoom` keys its single
bot on that constant and is unaffected by any of this. The playground's references to it are
replaced by seat ids; `otherPlaygroundId` and `PlaygroundRoom.humanSessionId` are **deleted
outright**, not generalised — "the other one" is not a question a six-seat room can ask.

## 3. The wire type

**PG60. `PlaygroundCarSetup` gains `enabled: boolean`** — is this seat on the field.

**PG61. `PlaygroundSetup` carries a fixed-length seat list and a driven index**, replacing `me` and
`opponent`:

```ts
interface PlaygroundSetup {
  botEnabled: boolean;
  botDifficulty: BotDifficulty;
  arenaId: string;
  /** Exactly `PLAYGROUND_SEATS` entries, in seat order. Index is the seat. */
  cars: readonly PlaygroundCarSetup[];
  /** Which seat the human drives. In range, and always an ENABLED seat. */
  drivenSeat: number;
}
```

**PG62. A disabled seat still carries a full, valid configuration.** All six entries always hold a
chassis, a colour and three distinct weapons, whether or not the seat is on the field. Unchecking a
seat parks its configuration; it does not discard it. This is what makes "try this five-car mix,
drop to a duel, go back" cost two clicks instead of a re-setup, and it is what lets the storage
codec be a plain round-trip rather than a merge.

**PG63. `isPlaygroundSetup` rejects whole.** The existing reject-whole rule (PG13) is unchanged; the
seat model adds four conditions to it. A payload is rejected if any of:

- `cars` is not an array of exactly `PLAYGROUND_SEATS` entries;
- any entry fails the existing per-car check (real `CarId`, real `colorId`, three real and pairwise
  **distinct** `WeaponId`s) or lacks a boolean `enabled`;
- no entry is `enabled`;
- `drivenSeat` is not an integer in `[0, PLAYGROUND_SEATS)`, or names a seat that is not `enabled`.

The same weapon on two *different* seats stays legal (PG17), as does the same `colorId` on two seats
(PG31). Neither gets a guard here or on the wire.

**PG64. Six is structural, not a counted cap.** There are six seats, so "at most six cars" is a
property of the type rather than a rule anything enforces. The panel never has to refuse a seventh
check, and no validator counts enabled entries against a ceiling. The only *floor* is PG63's
"at least one enabled".

**PG65. `defaultPlaygroundSetup()` opens on the sandbox it opens on today.** Seats 0 and 1 enabled,
both on `DEFAULT_CAR_ID` with its shipped kit, `colorId` 0 and 1 so the pair reads as two cars;
seats 2–5 disabled and carrying the same chassis and kit with colours 2–5. `drivenSeat: 0`. The bot
off, on medium, on `ACTIVE_ARENA_ID` — unchanged from today, because most sessions still open by
driving rather than by fighting.

## 4. Server

**PG66. `applySetup` adds and removes cars as `enabled` flips.** It is still the one apply path
(PG16) and still runs on the first setup of a room's life. Per seat:

| was | is | action |
|---|---|---|
| absent | enabled | `addCar` for that seat id, then `respawnPlayer` |
| present | disabled | remove the seat (PG67) |
| present | enabled, chassis or loadout changed | write them, then `respawnPlayer` |
| present | enabled, colour only changed | write the colour; **no respawn** |

**PG67. Removing a seat clears every per-session map it appears in**, not merely `state.players`.
A seat re-enabled later must arrive as a new car, never inheriting a stale lock, a half-finished
maneuver or a ram-falloff stack from its previous life. Three groups, and the third is the one that
is easy to miss:

1. **The room's own maps** — `inputQueues`, `prevFireMasks`, `matchRoster`, `phaseCaps`.
2. **`CombatMemory`'s session-keyed maps** — `fireStates`, `locks`, `maneuverWeapons`,
   `maneuverPressIds`, `lastDamagers`, `loadouts`.
3. **`ContactMemory`** — `slammed` and the `falloff` stack by key, the spike memory through the
   existing `clearShover`, and `contacts` by **purging every pair key naming the removed seat**. The
   last is the subtle one: `contacts` exists so a ram fires on *entry* rather than every tick, so a
   pair key left behind would make the next genuine contact between those two cars read as a
   continuing one and land no ram at all.

Live weapon instances *owned* by a removed seat are left to expire on their own clocks rather than
being swept. They are already detached from their owner by the time they are in flight, and
`runCombat` resolves an instance whose owner is gone without incident — the same situation a car
dying mid-flight already produces.

**PG68. The respawn rule is unchanged.** Chassis and loadout respawn (PG16); colour does not
(PG32); an arena change respawns **every enabled seat**. `loadoutOrChassisChanged` keeps its
signature and its meaning.

**PG69. One bot per non-driven enabled seat.** `PlaygroundRoom` holds a `Map<seatId,
HumanController>` and a `Map<seatId, Rng>` in place of its single `bot` and `botRng`. Each seat gets
its own seeded stream via `deriveSeed(seed, "playground-seat", index)` — a shared stream would make
one seat's draw depend on another's turn order, which is not what "seat 3's bot" means. This is the
pattern `packages/server/balance/match.ts` already runs for six headless seats; it is copied, not
invented.

A controller is rebuilt when the difficulty changes, and dropped for every seat when the bot is
switched off, when the driven seat moves, or when a setup arrives — all three are the existing
staleness rule (PG29), now applied per seat.

**PG70. Bots pick their own targets.** No `targetSessionId` is passed at construction and
`setTarget` is not called, so each bot resolves a target through `pickTarget` against everything it
can see. Bots therefore fight each other as well as the human. This is a deliberate behaviour change
from the two-car room, where the single bot was pinned to the driven car every tick: a five-bot
brawl in which every bot ignores every other bot is not the crowd this feature exists to test.

**PG71. Alone mode still pushes a neutral input, per seat.** `botEnabled: false` queues
`{steer: 0, throttle: 0, fireSlots: 0}` for every non-driven enabled seat, exactly as PG11 describes
for one. Silence is still wrong for the same reason: a car handed no input is left unstepped, keeps
the velocity it was carrying, and is scored as an attacker at that speed in every subsequent
contact. A neutral input coasts it to rest through the ordinary drive model.

**PG72. The bot debug read-out follows the bot targeting the driven car.** H12's read-out is one
bot's, and five stacked two-line entries over the arena would be unreadable, so `PlaygroundRoom`
picks exactly one controller to broadcast: the first seat, in seat order, whose
`currentTargetSessionId` equals `controlledSessionId`; failing that, the first bot seat in seat
order. The pick is **recomputed at every broadcast window**, never held — a controller held across a
seat being disabled would broadcast a dead bot's last thought. The payload shape,
`MSG_PLAYGROUND_BOT_DEBUG`, the 5 Hz throttle and the overlay's two-line render are all unchanged.

The read-out may switch between bots mid-session. That is accepted: the alternative — a picker in
the panel — is UI for an instrument that is only reached for while tuning the bot, and the
`bot-tuner` workflow it serves is a 1v1 workflow, where this rule resolves to the one bot there is.

**PG73. A seat is created with its setup's colour, and `pickColor` leaves the playground.** Today
`addCar` draws a colour through `pickColor(usedColorIds, Math.random)` and `applyCarSetup`
immediately overwrites it, so the draw is never observed — and it is a `Math.random` call in a room
that otherwise runs off seeded streams. `addCar` takes the seat's `colorId` instead. There are
exactly six seats and exactly six `COLOR_TABLE` rows, so `defaultPlaygroundSetup` hands every seat a
distinct colour; nothing enforces distinctness beyond that (PG31).

## 5. Client — the Car select panel

**PG74. The pause menu gains "Car select" and loses "Switch car".** The menu becomes Resume / Car
select / Physics settings / VFX settings / Environment settings. `OverlayView` gains `"cars"`;
`pauseKeyAction` treats it exactly as it treats the other three panels — P backs out to the menu
without touching pause.

`MSG_PLAYGROUND_SWITCH` and its handler are **deleted**. Control is now chosen in the panel (PG77),
which is where the six-way choice has to live: a cycle key through six seats is a worse control than
a radio you can see.

**PG75. Car select holds, in this order:**

1. Play alone / Vs bot radios, with the bot difficulty select beside them — disabled while Alone is
   selected, as today.
2. The arena dropdown.
3. The Show hitboxes checkbox.
4. Six collapsible car sections.

All four move out of Physics settings. Each keeps the apply semantics it has today: the mode, the
difficulty, the arena and every per-seat control send `MSG_PLAYGROUND_SETUP` on `change`; Show
hitboxes applies on the spot and persists, because it changes nothing but what this browser paints.

**PG76. A car section's header is `[x] Car N — <Chassis>` plus a drive radio**, and its body holds
the chassis select, the colour select with its tint swatch/hex/toggle trio, and the three loadout
selects with the restore-shipped-kit button (PG34). The chassis name in the header tracks the
chassis select, so a collapsed section still says what is in it.

Sections are collapsible; a section opens expanded when its seat is enabled and collapsed when it is
not. Collapse state is **local to the panel session and not persisted**, the same ruling `activeTab`
already has (PG35): it is a scroll convenience, not a setting.

**PG77. Exactly one seat is driven, chosen by a radio in its section.** The radio is on every
section, including disabled ones. Selecting the radio of a **disabled** seat enables that seat —
reaching for "drive this one" is asking for it to be on the field, and making that two clicks would
be a control that does nothing on first use. (This mirrors the ruling the tint picker already
carries: picking a colour switches the tint on.)

**PG78. Disabling the driven seat moves the wheel down, never off.** Unchecking the seat you are
driving hands the wheel to the lowest-numbered remaining enabled seat, and the panel repaints the
radio to match. `drivenSeat` can therefore never name a disabled seat, which is what PG63's
validation asserts rather than discovers.

**PG79. The last enabled seat cannot be unchecked.** Its checkbox is disabled, with a title saying
why. This is the panel's half of PG63's "at least one enabled" floor — the wire rejects such a
payload anyway, and a control that silently produces a rejected send is exactly the failure
`env-panel.ts` names for `floor.*`/`floorArt.*`.

**PG80. There is no maximum to enforce.** Six sections, six seats (PG64). The panel never disables
an unchecked box for being over a limit, because there is no limit to be over.

**PG81. Physics settings becomes stats-only, and the illegal-loadout guard moves with the loadout
selects.** After PG75's move Physics settings holds the tab bar, the stats rows, Reset all and Copy
overrides — nothing else. It keeps its name, its `leaveSettings` exit point and its
send-the-tuning-blob-once-on-exit rule (PG13) unchanged.

The guard goes where the controls went. Car select owns the `pg-illegal` outline, the
"duplicate weapon in a loadout" hint and the disabled Back button, and evaluates them over **every
enabled seat** — an illegal loadout on any of the six traps the user in Car select until it is
fixed, exactly as it trapped them in Physics settings before. Physics settings has no loadout
control left to make illegal, so its Back is never disabled and its `settingsIllegal` guard is
deleted rather than left always-false.

`pauseKeyAction` returning `"back-to-menu"` for both panels is unchanged; the P-key exit re-checks
whichever guard that panel owns, so P is not a side door out of Car select while a loadout is
illegal.

**PG82. `statsTabs` filters on the enabled seats.** Its Cars tab lists every distinct chassis among
the enabled seats and its Weapons tab every distinct weapon among their loadouts — up to six chassis
and eighteen weapons, where it was up to two and six. The PG13 filter rule is unchanged in
intent ("only what is actually on the field is tunable"); only the source of the list widens. Its
signature takes the setup, as now.

**PG83. The panel seeds per seat: live row, else stored seat, else default.** `setupFromState`
resolves each of the six seats in that order. A seat with a row in `state.players` is enabled and
takes its live chassis, colour and loadout from it; a seat with no row is disabled and takes its
configuration from `loadStored().setup.cars[n]`, falling back to `defaultPlaygroundSetup()` only
when storage has nothing usable for that seat.

The stored middle step is load-bearing, not belt-and-braces. **A disabled seat has no state to read
from** — that is what disabled means — so seeding it from defaults would silently discard the
configuration the user typed into it before unchecking it, every time the panel was reopened. PG62
says a parked seat keeps its configuration; storage is the only thing in a live session that
remembers one, since `PlaygroundScene` replays the stored blob into the room on join and never
again. Live state still wins wherever it exists, so an enabled seat can never show a stale stored
value.

`drivenSeat` is the index of `controlledSessionId` in `PLAYGROUND_SEAT_IDS`, falling back to the
lowest enabled seat when that id is empty or unknown (a fresh join, mid-flight to the server). The
existing per-field leniency is kept throughout — a row with an unreadable `carId` or an illegal
loadout falls back rather than crashing the panel.

**PG84. Tints are keyed by seat id.** `tintPicker` is handed `PLAYGROUND_SEAT_IDS[n]` instead of
`room.sessionId` / `BOT_SESSION_ID`. `fx/car-tint.ts` is otherwise untouched — its map is still
`Record<string, CarTint>`, still client-only, still never crosses the wire.

## 6. Storage

**PG85. A stored two-car setup upgrades to six seats.** `upgradeStoredSetup` gains a branch: a
stored `setup` record carrying `me`/`opponent` and no `cars` becomes a six-entry list with `me` at
seat 0 and `opponent` at seat 1, both `enabled: true`, seats 2–5 taken from
`defaultPlaygroundSetup()` and disabled, and `drivenSeat: 0`. Each upgraded car gains
`enabled` only if it lacks one, in the same narrow, additive style the existing `colorId` and
`botDifficulty` upgrades use.

The existing narrowness rule holds: this never invents a whole missing section. A blob missing
`arenaId`, `botEnabled` or both car records stays invalid and falls back whole, exactly as before.
It never loosens the wire — the server still rejects an incomplete payload; only what this browser
saved for itself is upgraded.

**PG86. One tint key migrates; the rest are dropped.** A stored `carTint` entry under `"bot"` moves
to `PLAYGROUND_SEAT_IDS[1]` — the seat that car becomes under PG85. Every other stored key is left
where it is and simply never resolves, which `sanitizeCarTints` already tolerates (a stale session
id costs that one car its tint, never the whole blob).

The human's own old tint key is an expired Colyseus session id and cannot be identified, so it is
lost. That is not a regression: under the old keying it was **already** lost on every reload (PG57),
and this is the change that stops that happening again.

## 7. Testing

**PG87. The new rules are held by tests at the layer that owns them.**

- **shared** (`playground-messages.test.ts`): `PLAYGROUND_SEAT_IDS` shape and length against
  `MAX_PLAYERS`; each of PG63's four rejection conditions; a legal six-seat payload; the same
  weapon on two seats accepted; the same colour on two seats accepted; `defaultPlaygroundSetup`
  matching PG65.
- **client storage** (`storage.test.ts`): PG85's upgrade from a real two-car blob; a blob already
  carrying `cars` passing through untouched; a blob missing a required section still falling back
  whole; PG86's tint migration and the dropping of an unknown key.
- **client ui-model** (`ui-model.test.ts`): PG82's `statsTabs` over one, two and six enabled seats,
  and that a *disabled* seat's chassis and weapons do not appear; PG78's "wheel moves down";
  PG79's last-seat rule as a pure predicate.
- **server** (`playground-room.test.ts`): enabling a seat adds a car and disabling it removes the
  row and every map entry (PG67); a chassis change respawns and a colour change does not (PG68); an
  arena change respawns every enabled seat; the driven seat's queue is the one `INPUT_MESSAGE`
  feeds; a non-driven enabled seat gets a neutral input in Alone and a bot intent in Vs bot (PG71);
  PG72's debug pick, including its fallback.

The deleted `otherPlaygroundId` test goes with the function.

## 8. Risks and what is deliberately not done

**PG88. Five bots at 30 Hz is measured, not assumed.** `snapshotWorld` and the ring push run once
per tick regardless of seat count, but `buildBotView` and `HumanController.decide` run per bot. The
balance harness already runs six seats headless at full rate, so the expectation is that this is
fine. If the playground drops frames with six cars enabled, that is a **finding to report**, not a
reason to quietly cap the seat count or to thin the bots' decision rate — either would be a
behaviour change smuggled in as a fix.

Deliberately out of scope:

- **Per-seat bot difficulty.** One shared difficulty, as today. A per-seat select was considered and
  rejected: it contradicts putting the control in the shared header, and "watch easy fight hard" is
  not a question the playground is for.
- **A bot-debug picker.** PG72's rule instead. See its rationale.
- **Teams.** Every seat is FFA. `PlayerState.team` is still written (0 and 1 alternating is
  meaningless under `sidesOf(FFA_LAST_STANDING) === "ffa"`, which is why `canDamage` never consults
  it here) and is not made configurable.
- **More than one human.** `maxClients` stays 1.
- **Duplicate chassis across seats.** Already legal and stays legal — two seats may both be Bastion.
  This is what the seat model buys over the one-section-per-chassis alternative that was considered
  first.
