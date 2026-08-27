# Schema reference

Colyseus `@type` fields. Enums are explicit uint8; never renumber. `pendingCarId` is server-only — not on the schema. Hidden picks stay off `carId` until reveal.

## ArenaState

| Field | Type | Default | Notes |
|---|---|---|---|
| `phase` | uint8 `RoomPhase` | `LOBBY` | LOBBY=0, CAR_SELECT=1, COUNTDOWN=2, MATCH=3 |
| `tick` | uint32 | `0` | Sim tick counter |
| `hostSessionId` | string | `""` | First joiner; transfers on leave |
| `mode` | uint8 `GameMode` | `FFA` | FFA=0, TEAM=1 |
| `arenaId` | string | `"arena-01"` | Current arena definition id |
| `carSelectDeadlineTick` | uint32 | `0` | 0 if not selecting |
| `countdownEndsTick` | uint32 | `0` | 0 if not counting down |
| `winnerTeam` | int8 | `-1` | `-1` none/draw, `0` A, `1` B |
| `winnerSessionId` | string | `""` | FFA winner; else empty |
| `players` | map `PlayerState` | empty | Keyed by sessionId |
| `weapons` | map `WeaponInstanceState` | empty | Live projectile and beam instances, keyed by instance id |

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
| `hp` | uint16 | `0` | Actual HP |
| `alive` | boolean | `true` | False when eliminated |
| `selectLocked` | boolean | `false` | Car-select lock; pick still hidden |
| `weapons` | array `WeaponSlotState` | empty | Per-slot state; array **position** is the slot index |
| `switchLockUntilTick` | uint32 | `0` | Tick a DIFFERENT weapon may fire; the weapon that just fired instead is gated by its own slot's `refireLockUntilTick` |
| `level` | uint8 | `1` | In-match level; pinned to 1 until the level system exists. Gates `unlocksAt` |

`weaponCooldown` (a single counter for the one pre-weapon-system shot) is gone — replaced by
`weapons` above, one row per slot.

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

`ArenaState.weapons` is a `MapSchema`, not an array, keyed by instance id — the bridge **diffs**
live instances by id, and a collection cleared and refilled every tick would patch every instance to
every client every tick, exactly the bandwidth the patch rate exists to avoid. The row is
deliberately minimal: speed, range, shape, dimensions, colour and icon all come from a client-side
`WEAPON_TABLE` lookup by `weaponId`, never duplicated onto the row. `runCombat` spawns, moves and
drops instances; `combat-bridge.ts`'s `applyCombatResult` is the only writer, and the whole map is
cleared when a match starts or ends. `damageClock` and `pierceLeft` are server-only sim state
(`WeaponInstance` in `sim/weapons/instances.ts`) and never reach the wire. Clients read this map to
draw and never write it. See [`combat-model.md`](combat-model.md).

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

**Two fields this design deliberately left off the wire.** `fire.ts`'s `FireState` also tracks
`pending` (the in-progress wind-up/volley) and `lastFiredWeaponId`, and neither was networked. That
is provably harmless against today's shipped `WEAPON_TABLE` — every weapon has `startUpMs: 0` and
`volleys: 1`, so a press resolves within the tick it is pressed, and the only weapon with
`recoveryMs > 0` (`repeater`) is carried by no car, so `switchLockUntilTick` never outlives the tick
it was set on for any equipped weapon. The first weapon placed in a `CAR_TABLE` loadout with
`startUpMs > 0`, `volleys > 1`, or `recoveryMs > 0` needs two more fields added here —
`PlayerState.pendingUntilTick` and `lastFiredSlot` — and the client's HUD updated to read them, or
the car-wide lockout dim (see [`combat-model.md`](combat-model.md#what-the-client-shows)) silently
stops appearing during that weapon's wind-up, mid-volley gap, or recovery window. The same change
should also fix a related gap: mid-volley, a slot's
`stocks` reaches 0 before `rechargeEndsTick` is set (which only happens on the volley's last shot),
and the HUD currently reads that combination as "ready" rather than "nothing left to fire." Both
gaps are commented at their exact call sites — `ArenaScene.drawHudSlot` and `weapon-hud.ts`'s
`slotVisualState` — in `packages/client/src`.

## InputMessage.fireSlots

`fireSlots: number` — a uint8 bitmask, bit 0 = slot 1 — replaced the single `fire: boolean`. The
server masks it to `WEAPON_SLOT_CONFIG.maxWeaponSlots` bits and to the car's actual slot count
before the sim ever sees it; multiple bits set on one tick resolve to the lowest slot. See
[`combat-model.md`](combat-model.md).

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
