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
| **Spectate** | What a dead player does: a local camera following a living car, or free roam. Server has no notion of it. |
| **Death fade** | A dead car is intangible and frozen from the tick its hp hits 0 — there is no wreck. The client fades it out over `DEATH_FADE_MS` from the networked `diedAtTick`, then stops drawing it. |
| **Fire edge** | `fireSlots` carries key state; the server turns it into presses with `prevFireMasks`, so holding the trigger fires once. |
| **Status** | A timed condition a car is in: a row in `STATUS_TABLE` plus a start and end tick. Scales numbers the sim already reads, and may pulse hp or cleanse on arrival. Never moves a car. Its duration belongs to whatever applied it, not to the row. |
| **Channel** | One number a status may scale (`topSpeed`, `brakeDecel`, `damageDealt`, …). Always a multiplier, 1 = neutral. |
| **Modifiers** | A car's whole status list collapsed into one set of multipliers and flags. The only thing the sim reads — driving, ramming and combat never look at a status list. |
| **Pulse** | A status's periodic hp change (burn or repair), authored per pulse rather than per second and counted from the status's own `startTick`. |
| **Aura** | A beam with a `disc` hitbox anchored at the car's centre: a field around a car rather than a line of fire. Passes through walls; drawn as a ring. Was **dormant machinery** from the 2026-09-01 roster cutover, when `shockwave` (renamed `magmablast`) lost the identity and no row used a `disc` hitbox — revived by the 2026-09-02 predator/magmablast pass, which gave `magmablast` an `ExplosionDef`: its shell detonates on death into a real `disc`-hitbox burst that applies `corroded`. |
| **Wave** | One instance of a multi-volley press. `VolleyDef` sits on `WeaponBase`, so a beam could fire several — the old `shockwave` shipped three auras 500 ms apart, each with its own `spawnTick` and its own damage clock. **Dormant machinery**: no row in the current roster, including `magmablast`'s revived aura, authors more than one volley. `StatusApplication.onWave` (`"all" \| "final"`, absent = `"all"`) exists to gate a status onto the last wave of such a press and is likewise unused today. |
| **Type** | A chassis's role, and the roster's design tool rather than anything the sim reads: Type 1 Bullseye (moderate damage, long range), Type 2 Mirage (burst damage, high mobility), Type 3 Bastion (crowd control, slow and tanky). Wired as rock-paper-scissors with named counterplay on every edge — 3 beats 2, 2 beats 1, 1 beats 3. |
| **Bullseye** | Type 1. The light, precise skirmisher: lowest hp and mass, the roster's longest reach, the lowest turn *rate*. Carries `predator`, `pepperbox`, `lance`, and applies no status at all. |
| **Mirage** | Type 2. The speedster and `DEFAULT_CAR_ID`: highest speed and accel, highest attack, short-range kit. Carries `magmablast`, `thunderclap`, `afterburner`. |
| **Bastion** | Type 3. The tank: slowest, heaviest, highest hp, and the highest turn rate in the game — it out-turns everything despite being the slowest. Carries `thumper`, `roadblock`, `wildcharge`; its hard CC (`roadblock`'s `stunned`, and the wall-slam stun off `wildcharge`) now shares the CC role with Mirage's `thunderclap`, which also stuns on hit. |
| **Handling** | The 0-100 chassis rating that sets turn **rate** (`turnRateOf` = `baseTurnRate + handling × turnRatePerRating`). **Not turn radius** — radius is `speed / turnRate`, so a fast chassis corners wide even on a decent rating, and Bullseye's low rate still buys a tighter arc than Mirage's. Which knob to reach for is indexed in [`turn-tuning.md`](turn-tuning.md). |
| **ChassisDrive** | The six drive numbers `stepDrive` actually takes, resolved from the roster by `driveOf(carId)` instead of looked up inside the sim. What lets `golden.test.ts` pin the drive equation through a balance retune. |
| **Last standing** | `FFA_LAST_STANDING`'s win condition: `livingSides` drops to one side (or none, a draw) and the match ends. Death is terminal — no respawn, no `phased`. |
| **Deathmatch** | `FFA_DEATHMATCH`, the second win condition. `livingSides` is never called; the match ends on `ArenaState.matchEndsTick` or when fewer than two roster players remain, and the winner is ranked by kills descending, then deaths ascending (`deathmatchOutcome`). Death costs `DEATHMATCH_CONFIG.respawnDelaySeconds`, not the match. |
| **Phasing** | A respawned car's `phased` status: driveable (the mover gate, `isOnField`, still passes) but not solid (`isSolid` is false) — not a collider, not a ram partner, not a weapon target, not an aim-assist lock candidate. Lasts at least `DEATHMATCH_CONFIG.phaseSeconds`, extended by contact-clear (below) up to `phaseMaxSeconds`, and ends early the instant the player fires. |
| **Last damager** | The session id last credited with a point of a car's hp loss (`CombatPlayer.lastDamagerSessionId`, server-only). Booked to `killedBySessionId` and the killer's `kills` at the death transition. Ramming can never set it — a ram deals zero hp — so every kill traces to a weapon hit or a status pulse. |
| **Contact-clear** | The rule that ends a phase early only once the car's hull overlaps no other solid car (`phaseDecision` in `flow/respawn.ts`), rather than on the timer alone. Exists so a phase lapsing mid-overlap can never snap two interpenetrating cars apart with a sudden MTV push and speed bounce. |
