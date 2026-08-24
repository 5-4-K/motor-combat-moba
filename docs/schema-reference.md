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
| `projectiles` | map `ProjectileState` | empty | Live shots |

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
| `weaponCooldown` | uint32 | `0` | Ticks remaining |
| `selectLocked` | boolean | `false` | Car-select lock; pick still hidden |

## ProjectileState

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | `""` | Projectile id (map key) |
| `ownerSessionId` | string | `""` | Shooter session |
| `x`, `y`, `angle` | number | `0` | Canonical world pose |
| `speed` | number | `0` | Along heading |
| `spawnTick` | uint32 | `0` | Tick spawned |
| `alive` | boolean | `true` | False when spent |

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
