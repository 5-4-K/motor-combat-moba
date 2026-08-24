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

Do not renumber enums.
