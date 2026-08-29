# Glossary

| Term | Meaning |
|---|---|
| **Arena** | The match space and the Colyseus room name (`ROOM_NAME` = `"arena"`). |
| **Colyseus room** | Server instance of `ArenaRoom` holding `ArenaState` and clients. |
| **Tick** | Sim step at `TICK_RATE_HZ` (30). `ArenaState.tick` increments each interval. |
| **Patch** | State broadcast to clients at `DEFAULT_PATCH_RATE_HZ` (20). Not the same as tick. |
| **Prediction** | Client applying `stepSim` locally ahead of patches, reconciled by replay against each patch. |
| **Interpolation** | Smoothing remote poses between patches, sampled `interpolationDelayMs` behind now. |
| **Lockstep** | Server and client use the same `stepSim` on the same inputs. |
| **LAN** | Default deploy: host serves client dist; others join via LAN IP. |
| **hostSessionId** | Session of the room host (first joiner; reassigned on leave). |
| **InputMessage** | `{ seq, steer, throttle, fire }` sent as `"input"`. |
| **Wreck** | A car at 0 HP: `alive = false`. Still solid, no longer fires or can be shot. |
| **Spectate** | What a wrecked player does: a local camera following a living car, or free roam. Server has no notion of it. |
| **Effect** | A timed buff or debuff on one car: a row in `EFFECT_TABLE`, an end tick, and a stack count. Scales numbers the sim already reads; never deals damage and never moves a car. |
| **Channel** | One number an effect may scale (`topSpeed`, `damageDealt`, `weaponCooldown`, …). Always a multiplier, 1 = neutral. |
| **Modifiers** | A car's whole effect list collapsed into one set of multipliers and flags. The only thing the sim reads — driving, ramming and combat never look at an effect list. |
| **Last standing** | Win condition: `livingSides` drops to one side (or none, a draw) and the match ends. |
