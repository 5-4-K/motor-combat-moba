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
| **Wave** | One instance of a multi-volley press. `VolleyDef` sits on `WeaponBase`, so a beam can fire several — `shockwave` is three auras 500 ms apart, each with its own `spawnTick` and its own damage clock, so one car can be caught once per wave. `StatusApplication.onWave` (`"all" \| "final"`, absent = `"all"`) can gate a status onto the last one. |
| **Type** | A chassis's role, and the roster's design tool rather than anything the sim reads: Type 1 Bullseye (moderate damage, long range), Type 2 Mirage (burst damage, high mobility), Type 3 Bastion (crowd control, slow and tanky). Wired as rock-paper-scissors with named counterplay on every edge — 3 beats 2, 2 beats 1, 1 beats 3. |
| **Bullseye** | Type 1. The light, precise skirmisher: lowest hp and mass, the roster's longest reach, the lowest turn *rate*. Carries `needler`, `pepperbox`, `lance`, and applies no status at all. |
| **Mirage** | Type 2. The speedster and `DEFAULT_CAR_ID`: highest speed and accel, highest attack, short-range kit. Carries `fireball`, `shockwave`, `afterburner`. |
| **Bastion** | Type 3. The tank: slowest, heaviest, highest hp, and the highest turn rate in the game — it out-turns everything despite being the slowest. Carries `thumper`, `skewer`, `bulwark`, and owns the roster's hard CC. |
| **Handling** | The 0-100 chassis rating that sets turn **rate** (`turnRateOf` = `baseTurnRate + handling × turnRatePerRating`). **Not turn radius** — radius is `speed / turnRate`, so a fast chassis with average handling still corners wide, and Bullseye's low rate still buys a tighter arc than Mirage's. |
| **ChassisDrive** | The six drive numbers `stepDrive` actually takes, resolved from the roster by `driveOf(carId)` instead of looked up inside the sim. What lets `golden.test.ts` pin the drive equation through a balance retune. |
| **Last standing** | Win condition: `livingSides` drops to one side (or none, a draw) and the match ends. |
