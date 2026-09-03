# Schema reference

Colyseus `@type` fields. Enums are explicit uint8; never renumber. `pendingCarId` is server-only — not on the schema. Hidden picks stay off `carId` until reveal.

## ArenaState

| Field | Type | Default | Notes |
|---|---|---|---|
| `phase` | uint8 `RoomPhase` | `LOBBY` | LOBBY=0, CAR_SELECT=1, COUNTDOWN=2, MATCH=3 |
| `tick` | uint32 | `0` | Sim tick counter |
| `hostSessionId` | string | `""` | First joiner; transfers on leave |
| `mode` | uint8 `GameMode` | `FFA_LAST_STANDING` | FFA_LAST_STANDING=0 (renamed from FFA; wire value unchanged), TEAM=1, FFA_DEATHMATCH=2 |
| `arenaId` | string | `"arena-01"` | Current arena definition id |
| `carSelectDeadlineTick` | uint32 | `0` | 0 if not selecting |
| `countdownEndsTick` | uint32 | `0` | 0 if not counting down |
| `matchStartedAtTick` | uint32 | `0` | Stamped on the transition into MATCH. Display only — `stepSim` never reads it |
| `matchEndsTick` | uint32 | `0` | The tick `FFA_DEATHMATCH` ends on; `0` in every other mode. Stamped on the same edge as `matchStartedAtTick`, for the same reason: one number patched to everyone beats a local stopwatch per machine |
| `winnerTeam` | int8 | `-1` | `-1` none/draw, `0` A, `1` B |
| `winnerSessionId` | string | `""` | FFA winner; else empty |
| `players` | map `PlayerState` | empty | Keyed by sessionId |
| `weapons` | map `WeaponInstanceState` | empty | Live projectile and beam instances, keyed by instance id |

## PracticeState

`packages/shared/src/schema/PracticeState.ts` — `ArenaState` plus exactly one field.

| Field | Type | Default | Notes |
|---|---|---|---|
| `paused` | boolean | `false` | The sim is frozen. `PracticeRoom.tick()` returns before incrementing `tick` while this is true |

Additive only, and deliberately minimal: `PracticeRoom` reuses `ArenaScene`, which decodes this
state with the ordinary `ArenaState` reader, so nothing here may renumber or shadow a field
`ArenaState` already ships. The omissions matter as much as the one field kept:

- No `controlledSessionId` (`PlaygroundState` has one). The player always drives their own car —
  there is no control-routing feature in practice — so `controlledCarOf` resolves through its
  absent-field path exactly as a real match does.
- No `tuningJson`. Practice never calls `setTuning`; there is nothing to carry.
- No `botEnabled`. There is always exactly one bot — the room's second car — so the flag has no
  second state to encode.
- No `botDifficulty`. The player's choice at the settings screen is resolved once, server-side, at
  room creation (`onCreate` reads it off the join options); networking it would only be a second
  source of a truth nothing on the wire reads.

`isSimPaused` (`packages/client/src/scenes/controlled-car.ts`) duck-types off a bare `ArenaState`
rather than off `PracticeState` or `PlaygroundState` specifically, which is what lets one predicate
cover a paused playground **and** a paused practice session: a real match's state has no `paused`
field at all, so the check is always false there. See root `CLAUDE.md` and
[`docs/superpowers/specs/2026-09-03-practice-mode-design.md`](superpowers/specs/2026-09-03-practice-mode-design.md).

## PlayerState

| Field | Type | Default | Notes |
|---|---|---|---|
| `sessionId` | string | `""` | Colyseus session |
| `x`, `y`, `angle` | number | `0` | Canonical world pose |
| `status` | uint8 `PlayerStatus` | `READY` | READY=0, IN_MATCH=1, POST_MATCH=2 |
| `lastProcessedInputSeq` | uint32 | `0` | Last applied `InputMessage.seq` |
| `name` | string | `""` | Display name |
| `colorId` | uint8 | `0` | Index into `COLOR_TABLE` |
| `team` | uint8 | `0` | 0 = A, 1 = B (FFA unused) |
| `joinedAtTick` | uint32 | `0` | Host-succession order |
| `carId` | string | `""` | `""` until reveal |
| `speed` | number | `0` | Signed along heading |
| `reverseHold` | uint16 | `0` | Ticks held in reverse |
| `angVel` | number | `0` | Ram-injected spin, rad/s. Decays toward `0` |
| `shoveX`, `shoveY` | number | `0` | Ram-injected lateral knock, u/s. Decays toward `0` |
| `authority` | number | `1` | Steering multiplier; `1` = full control. A ram dips it toward `RAM_CONFIG.authorityFloor`, then it decays back toward `1`. Defaults to `1`, not `0` — a `0` default would mean "no steering" for every player never touched, presenting as an undriveable car on first spawn |
| `maneuver` | uint8 `ManeuverKind` | `0` | NONE=0, DASH=1, HOLD=2, CHARGE=3 |
| `maneuverTicksLeft` | uint16 | `0` | Ticks left in the current maneuver; `0` whenever `maneuver` is NONE |
| `maneuverAngle` | number | `0` | The locked heading a DASH translates along (radians); `0` and unread for HOLD/CHARGE |
| `maneuverSpeed` | number | `0` | The locked speed a DASH translates at (u/s); `0` and unread for HOLD/CHARGE |
| `hp` | uint16 | `0` | Actual HP |
| `alive` | boolean | `true` | False when eliminated |
| `diedAtTick` | uint32 | `0` | The tick this car's hp reached 0, or `0` while it lives. Drives the client's death fade; also the "has not died" sentinel `isDueToRespawn`/`respawnSeconds` read |
| `kills` | uint8 | `0` | Counted in every mode; only `FFA_DEATHMATCH` decides a winner from them. `uint8` is ample: six players over a three-minute match cannot approach 255 |
| `deaths` | uint8 | `0` | Counted in every mode; the tie-break under `deathmatchOutcome` |
| `killedBySessionId` | string | `""` | Who landed the killing blow, or `""` while alive. Render-only — `stepSim` never reads it. Networked for the same reason `diedAtTick` is: a spectator or a late joiner who never saw the death still needs to be able to name the killer. Cleared on respawn, which is also what dismisses the "killed you" banner |
| `selectLocked` | boolean | `false` | Car-select lock; pick still hidden |
| `weapons` | array `WeaponSlotState` | empty | Per-slot state; array **position** is the slot index |
| `switchLockUntilTick` | uint32 | `0` | Tick a DIFFERENT weapon may fire; the weapon that just fired instead is gated by its own slot's `refireLockUntilTick` |
| `level` | uint8 | `1` | In-match level; pinned to 1 until the level system exists. Gates `unlocksAt` |
| `pendingUntilTick` | uint32 | `0` | Tick a committed press next puts a shot out (wind-up, or the next volley of a burst). `0` = nothing pending; the HUD reads mid-press as `tick < pendingUntilTick` |
| `lastFiredSlot` | int8 | `-1` | Slot the car most recently committed to firing; `-1` = never fired. Signed because `-1` is the natural "never" for an index |
| `lockTargetSessionId` | string | `""` | Session id of this car's aim-assist target, or `""`. The only part of the lock that is networked |
| `statuses` | array `StatusState` | empty | The statuses this car is in, capped at `STATUS_CONFIG.maxActive` (6). Sorted by `statusId` so a patch carries a diff rather than a reshuffle |

`weaponCooldown` (a single counter for the one pre-weapon-system shot) is gone — replaced by
`weapons` above, one row per slot.

`angVel`, `shoveX`, `shoveY`, and `authority` are the ram knock state (see
[`combat-model.md`](combat-model.md#ramming)). They join `speed` and `reverseHold` in
`PredictionBuffer.reconcile`'s always-**snap** set rather than the ease path — all four feed the
next `stepSim` integration directly, so a half-eased value would poison every subsequent step rather
than merely look wrong. See [`config-reference.md`](config-reference.md#ram_config) for the tuning
that produces them.

`maneuver`, `maneuverTicksLeft`, `maneuverAngle`, and `maneuverSpeed` are the maneuver state behind
dash/hold/charge (see [`combat-model.md`](combat-model.md#maneuvers-and-the-contact-pass)) —
networked for the same reason as the ram knock fields (`stepDrive` reads all four, invariant 8) and
snapped, never eased, on `PredictionBuffer.reconcile` for the same reason: they are rules for the
next integration, not a drawn pose. `maneuverWeaponId` — which maneuver-kind weapon is running — is
**not** one of the four: it stays server-only, carried in `CombatMemory` alongside `fireState`,
because `stepSim` itself only ever reads the `ManeuverKind` and the two locked numbers, never the
weapon id. Every trigger that writes these fields is dormant — no chassis carries a maneuver-kind
weapon yet (Plan 3).

## StatusState

One running status on one car. Array position carries no meaning — `modifiersOf` multiplies and OR-s,
both of which commute — so the sim keeps rows sorted by `statusId` purely to keep patches small.

| Field | Type | Default | Notes |
|---|---|---|---|
| `statusId` | string | `""` | Lookup key into `STATUS_TABLE`. Validated through `isStatusId` by every reader |
| `startTick` | uint32 | `0` | The tick it was applied on. Two readers need it and neither can derive it: pulses are counted from here, and the drain bar's total is not in the status table because the applier chose it |
| `endsTick` | uint32 | `0` | The tick it stops applying. Active while `tick < endsTick` — a tick, not a countdown, so it stays right between two patches at 20 Hz |
| `sourceSessionId` | string | `""` | Who applied it; `""` for the world (a pickup, a hazard). The sim never reads it |

There is deliberately **no `stacks` field**. A status cannot stack with itself — one id on one car is
exactly one instance at exactly the strength its row states — so a count would only ever be 1.

**Statuses are the one system with no server-only half.** `FireState`'s `pending` machine, an
instance's `damageClock`, and the lock's commit timers all stay off the wire because the client is
told the result rather than the rules. A status is the opposite case: `stepSim` reads the modifiers
derived from these rows (invariant 8), so the client must hold the same list to predict the same car.
`sourceSessionId` is the one field the sim does not read, and it is networked anyway so the schema
stays the whole truth about a car's statuses rather than half of it beside a server-only map.

Reconciliation does **not** snap or ease these. `angVel`/`shoveX`/`shoveY`/`authority` are values
being integrated, so a half-eased one poisons the next step; a status list is the *rules* the
integration runs under, and both halves of the lockstep derive it from the same tick through the same
shared `modifiersFromRows`. See [`combat-model.md`](combat-model.md#statuses) for the model and
[`config-reference.md`](config-reference.md#status_table) for the tuning.

## WeaponInstanceState

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | `""` | Instance id (map key) |
| `ownerSessionId` | string | `""` | Shooter session |
| `weaponId` | string | `""` | Lookup key into `WEAPON_TABLE` |
| `kind` | uint8 `WeaponKind` | `PROJECTILE` | PROJECTILE=0, BEAM=1 |
| `x`, `y`, `angle` | number | `0` | Canonical world pose |
| `extent` | number | `0` | Beams: current reach. Projectiles: always 0 |
| `spawnTick` | uint32 | `0` | Tick spawned |
| `alive` | boolean | `true` | False when spent |
| `isExplosion` | boolean | `false` | True when this row is its weapon's explosion, not its shell |

`ArenaState.weapons` is a `MapSchema`, not an array, keyed by instance id — the bridge **diffs**
live instances by id, and a collection cleared and refilled every tick would patch every instance to
every client every tick, exactly the bandwidth the patch rate exists to avoid. The row is
deliberately minimal: speed, range, shape, dimensions, colour and icon all come from a client-side
`WEAPON_TABLE` lookup by `weaponId`, never duplicated onto the row. Colour is the case worth
naming, because it used to come from somewhere else: an instance draws in its weapon's own
`WEAPON_TABLE.color`, not its owner's `PlayerState.colorId`. `ownerSessionId` is a **sim** field —
`canDamage` reads it for friendly fire, and an attached beam is re-anchored to (and killed with)
its owner through it. The client does not read it at all; drawing a shot needs only `weaponId`. `runCombat` spawns, moves and
drops instances; `combat-bridge.ts`'s `applyCombatResult` is the only writer, and the whole map is
cleared when a match starts or ends. `damageClock` and `pierceLeft` are server-only sim state
(`WeaponInstance` in `sim/weapons/instances.ts`) and never reach the wire. Clients read this map to
draw and never write it. See [`combat-model.md`](combat-model.md).

`isExplosion`, added for the 2026-09-02 predator/magmablast pass, is on the wire for the same reason
`weaponId` is: a burst row still carries its **parent** shell's `weaponId` (a projectile), not one of
its own, so without a flag the client would resolve `magmablast`'s dart def and draw a 12 u circle
where a 60 u disc belongs. Both `combat-visual.ts`'s `drawDefOf` and the sim's own `instanceDefOf`
take it alongside `weaponId` and route to a synthesized `BeamWeaponDef` when it is true. It is
derivable in principle — a row whose `kind` disagrees with its own weapon's authored `kind` can only
be an explosion — but networked anyway as a hedge against a future weapon spawning some other kind of
child instance, where that inference would stop holding. Frozen at spawn: written once when the row
is created, never patched after.

## WeaponSlotState

| Field | Type | Default | Notes |
|---|---|---|---|
| `weaponId` | string | `""` | Lookup key into `WEAPON_TABLE` |
| `stocks` | uint8 | `0` | Charges currently held |
| `rechargeEndsTick` | uint32 | `0` | Tick the running recharge completes; `0` = not recharging |
| `refireLockUntilTick` | uint32 | `0` | Tick this same weapon may fire again |

`PlayerState.weapons` is an `ArraySchema<WeaponSlotState>` — array **position** is the slot index,
matching `CAR_TABLE[car].weapons`' own ordering (index 0 = slot 1). Populated when the chassis is
revealed; a player with no chassis yet (or an unrecognised `carId`) has an empty array and can fire
nothing.

**What a slot row cannot say.** Two facts the car-wide lockout needs are per *car*, not per slot, so
they live on `PlayerState` rather than here: `pendingUntilTick` and `lastFiredSlot` (both above).
`fire.ts`'s `pending` machine itself stays server-only — like `damageClock` and `pierceLeft` — and
only the tick it next fires on crosses the wire.

With those two, a weapon with `startUpMs > 0`, `volleys > 1`, or `recoveryMs > 0` is a `CAR_TABLE`
edit and nothing else: the HUD dims every slot through a wind-up or volley and the other slots
through recovery, and a mid-volley slot — `stocks` already spent at press time, `rechargeEndsTick`
not written until the volley's last shot — reads as locked rather than as a full-brightness "ready"
slot with nothing left to fire.

## InputMessage.fireSlots

`fireSlots: number` — a uint8 bitmask, bit 0 = slot 1 — replaced the single `fire: boolean`. The
server masks it to `WEAPON_SLOT_CONFIG.maxWeaponSlots` bits and to the car's actual slot count
before the sim ever sees it; multiple bits set on one tick resolve to the lowest slot.

It carries **key state, not presses**. The server derives the press edge itself from its own
`prevFireMasks`, so holding the trigger fires once — see [`combat-model.md`](combat-model.md).

## Join options

`joinOrCreate(ROOM_NAME, { name })`. `name` is required (1–16 characters after trim). The server rejects invalid names (`4000`) and duplicates (`4001`, `"Name is taken"`). A 7th joiner is rejected by `maxClients`; creating a second `arena` room is rejected with `4003` `"Room is full"` so LAN stays one room.

## Lobby messages

Client → server (intents only; never sim state):

| Type | Constant | Payload | Who |
|---|---|---|---|
| `switch_team` | `MSG_SWITCH_TEAM` | none | Ready player (flips `team` 0↔1) |
| `set_mode` | `MSG_SET_MODE` | `{ mode }` (`GameMode` FFA=0 / TEAM=1) | Host, and only when nobody is In match |
| `start_match` | `MSG_START_MATCH` | none | Host. Server runs `canStart`; on failure replies `start_error` |
| `kick` | `MSG_KICK` | `{ sessionId }` | Host. Target must be Ready or Post-match, not self (`4002`, `"Kicked"`) |

Server → client:

| Type | Constant | Payload |
|---|---|---|
| `start_error` | `MSG_START_ERROR` | `{ error }` (stable strings from `canStart`) |

Do not renumber enums.
