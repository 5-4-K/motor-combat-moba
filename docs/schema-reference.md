# Schema reference

Schema fields land in P1. P0 has `PlayerState` / `ArenaState` only.

## PlayerState

| Field | Type | Notes |
|---|---|---|
| `sessionId` | string | Colyseus session |
| `x`, `y`, `angle` | number | Canonical world pose |
| `status` | uint8 `PlayerStatus` | READY=0, IN_MATCH=1, POST_MATCH=2 |
| `lastProcessedInputSeq` | uint32 | Last applied `InputMessage.seq` |

## ArenaState

| Field | Type | Notes |
|---|---|---|
| `phase` | uint8 `RoomPhase` | LOBBY=0 … MATCH=3 |
| `tick` | uint32 | Sim tick counter |
| `hostSessionId` | string | First joiner; transfers on leave |
| `mode` | uint8 `GameMode` | FFA=0, TEAM=1 |
| `players` | map `PlayerState` | Keyed by sessionId |

Do not renumber enums.
