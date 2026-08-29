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
| **Status** | A timed condition a car is in: a row in `STATUS_TABLE` plus a start and end tick. Scales numbers the sim already reads, and may pulse hp or cleanse on arrival. Never moves a car. Its duration belongs to whatever applied it, not to the row. |
| **Channel** | One number a status may scale (`topSpeed`, `brakeDecel`, `damageDealt`, …). Always a multiplier, 1 = neutral. |
| **Modifiers** | A car's whole status list collapsed into one set of multipliers and flags. The only thing the sim reads — driving, ramming and combat never look at a status list. |
| **Pulse** | A status's periodic hp change (burn or repair), authored per pulse rather than per second and counted from the status's own `startTick`. |
| **Aura** | A beam with a `disc` hitbox anchored at the car's centre: a field around a car rather than a line of fire. Passes through walls; drawn as a ring. |
| **Last standing** | Win condition: `livingSides` drops to one side (or none, a draw) and the match ends. |
