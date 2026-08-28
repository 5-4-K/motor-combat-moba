# Config reference

Balance tables live in `@motor-combat-moba/shared`. Env knobs override process settings only.

## Env knobs

| Knob | Where | Default |
|---|---|---|
| `DEPLOY_MODE` | server `mode.ts` | `lan` (`cloud` is CORS-only; no hosting) |
| `PORT` | server `mode.ts` | `2567` |
| `TICK_RATE_HZ` | env override of shared constant | shared `30` |
| `SIM_LATENCY_MS` | latency injector | `0` |
| `SIM_JITTER_MS` | latency injector | `0` |
| `CLIENT_ORIGIN` | server CORS (Vite) | unset; `npm run dev` sets `http://localhost:5173` |

Canonical sim rate is `TICK_RATE_HZ` in `@motor-combat-moba/shared`. Patch rate is `DEFAULT_PATCH_RATE_HZ` (20), not an env knob.

## CAR_TABLE

| id | name | speed | attack | hp | weapons |
|---|---|---|---|---|---|
| `rectangle` | Rectangle | 80 | 30 | 40 | `["fireball"]` |
| `oval` | Oval | 50 | 70 | 30 | `["fireball"]` |
| `hexagon` | Hexagon | 30 | 50 | 70 | `["fireball"]` |

Ratings are integers 0-100 with 50 as average, and every row **must sum to exactly 150** —
`config.test.ts` enforces the budget.

Derived: `hpOf` = hp × `COMBAT_CONFIG.hpPerRating` (400 / 300 / 700). `forwardMaxSpeedOf` =
`baseMaxSpeed` + speed × `speedPerRating` (540 / 405 / 315 u/s). `reverseMaxSpeedOf` = forward ×
`reverseSpeedRatio`. `weaponDamageOf(carId, weaponId)` = `damageFor(attack, weapon.damage)` — a
fireball is 40 / 60 / 50 depending on who fires it.

`weapons` is an ordered list of `WEAPON_TABLE` ids — index 0 is slot 1, and order *is* the slot
mapping. `slotsOf(carId)` (`config/weapon-slots.ts`) is what actually reads it, capped at
`WEAPON_SLOT_CONFIG.maxWeaponSlots`; see [`combat-model.md`](combat-model.md) for the fire model
that consumes it.

## COLOR_TABLE

| colorId | name | hex |
|---|---|---|
| 0 | Crimson | `#E74C3C` |
| 1 | Azure | `#3498DB` |
| 2 | Emerald | `#2ECC71` |
| 3 | Gold | `#F1C40F` |
| 4 | Violet | `#9B59B6` |
| 5 | Orange | `#E67E22` |

## WEAPON_TABLE

Every weapon in the game, keyed by id. `CAR_TABLE[car].weapons` (above) names which of these ids a
chassis carries and in what slot order. Durations are authored in **milliseconds** and converted
once, at shared's module load, into the frozen `WEAPON_TICKS` the sim actually reads — see
"Authoring in milliseconds" below.

| id | kind | damage | speed | range | cooldownMs | startUpMs | recoveryMs | stock | pierce | volley (volleys/intervalMs/pellets/spreadDeg) | hitbox | unlocksAt | usesAimAssist | color |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `fireball` | projectile | 50 | 900 | 900 | 500 | 0 | 0 | — | 0 | 1 / 0 / 1 / 0 | circle, radius 12 | 1 | true | `#E8590C` ember |
| `repeater` | projectile | 31 | 700 | 700 | 3000 | 0 | 5000 | max 3, refire 100ms | 0 | 1 / 0 / 1 / 0 | circle, radius 3 | 1 | false | `#0CA5B0` teal |

`damage` is what the weapon deals from a chassis at `COMBAT_CONFIG.attackBaseline` — an *average*
car, not every car; `damageFor` (`sim/damage.ts`) moves it ±50% with the firing chassis's `attack`
rating. `fireball`'s 50 is solved, not chosen: an average chassis has 500 hull HP and fireball fires
twice a second, so 50 is the number that makes an average-vs-average kill take the design target of
5 seconds. `repeater`'s 31 preserves its former 5:8 ratio against `fireball`.

`color` is render-only, like `name`: it is the fill every live instance of that weapon draws in, per
**weapon** rather than per player, so two cars carrying a fireball fire identically coloured shots.
`weapon-config.test.ts` requires each to be a unique `#RRGGBB` and none of them to equal a
`COLOR_TABLE` player colour. See [`combat-model.md`](combat-model.md#what-the-client-shows).

`color` is the *whole* look only for a weapon with no authored style. `fireball` has one — four
concentric bands, dark ember rim to near-white core, plus a slow shrink-only flicker — held in
`WEAPON_GLOW_STYLES` in the client's `combat-visual.ts`, not in this table: it is pure appearance,
nothing the sim or the wire can see. Bands are fractions of the weapon's own hitbox radius, so a
re-tune that widens the hitbox rescales the glow with it and no band can escape the shape that
hits. A weapon with no entry there draws the single flat disc of its `color`, which is what
`repeater` still does.

`usesAimAssist` is **required** and has no default: `true` fires at the car's ambient target lock
instead of along its heading. It is the only per-weapon aim-assist knob — all the geometry lives once
in `AIM_CONFIG` below. See [`combat-model.md`](combat-model.md#aim-assist-and-the-target-lock).

`fireball` carries the pre-weapon-system shot's exact numbers for everything except `damage`:
`fireRateHz: 2` became `cooldownMs: 500`, and `lifetimeTicks: 30` became `range: 900` (one second of
flight at 900 u/s). Its **hitbox is also not a migrated value**: it shipped as a 3-unit circle — the
smallest that kept the old point-hit feel while satisfying "every weapon has a hitbox" — and was
widened to 12 so the shot reads on screen, since the client draws the hitbox itself rather than a
sprite. `damage` itself was re-solved when the `attack` stat landed — see the paragraph above.

**`repeater` is carried by no car, on purpose — it is not dead config.** It is the only multi-stock
weapon in the table (the design's own worked example: three stocks, a three-second recharge,
transcribed literally), kept as the live reference for the stock mechanic and the fixture the stock
unit tests exercise against. `fireball` had to ship single-stock to keep the migration's zero-balance
promise, so nothing in the released roster could prove stocks honestly without `repeater`. Do not
delete it because nothing spawns it.

**Authoring in milliseconds.** Every duration on a weapon — `startUpMs`, `cooldownMs`, `recoveryMs`,
`stock.refireDelayMs`, a beam's `lifetimeMs` — is milliseconds, never ticks, so a balance number
never hard-codes 30 Hz into itself (invariant 1). `WEAPON_TICKS` (`config/weapon-ticks.ts`), built
and frozen once at module load, converts each with `ceil(ms × TICK_RATE_HZ / 1000)` and separately
derives `flightTicks = ceil(range / speed × TICK_RATE_HZ)`. The sim reads only the derived ticks,
never raw ms. The cost is rounding, not drift: at 30 Hz a tick is 33.3 ms, so `startUpMs: 250`
becomes 8 ticks (266 ms) — server and client both compute it from the same built `dist`, so they
always round the same way or neither does.

**Adding a weapon with a real wind-up, burst, or recovery window is a config edit and nothing
else.** Every weapon shipped today has `startUpMs: 0` and `volleys: 1`, and the only weapon with
`recoveryMs > 0` (`repeater`) is carried by no car, so nothing in the roster exercises those paths —
but the wire carries what they need: `PlayerState.pendingUntilTick` and `PlayerState.lastFiredSlot`
give the HUD the car-wide lockout, and the slot's recharge is anchored to the volley's last shot, so
`cooldownMs` still means "time until another stock" for a burst weapon. Nothing about a first
`startUpMs > 0`, `volleys > 1`, or `recoveryMs > 0` weapon requires a schema change. See
[`schema-reference.md`](schema-reference.md#playerstate) for the two fields.

## WEAPON_SLOT_CONFIG

| Knob | Value |
|---|---|
| `maxWeaponSlots` | 3 |

Caps how many slots any chassis may present. A car whose `weapons` list is longer logs one
`console.warn` naming the car and the extras are truncated — a warning, never a thrown error or a
failed test.

## AIM_CONFIG

Aim assist geometry and feel, global to every weapon that opts in with `usesAimAssist: true` (A1).
See [`combat-model.md`](combat-model.md#aim-assist-and-the-target-lock) for how these knobs combine.

| Knob | Value | Unit |
|---|---|---|
| `coneDeg` | 20 | degrees (half-angle of the acquisition cone) |
| `lateralMax` | 120 | world units (perpendicular offset from centreline) |
| `lockRange` | 400 | world units |
| `retentionConeDeg` | 5 | degrees (pad added to `coneDeg` to hold an already-locked target) |
| `retentionLateralUnits` | 30 | world units (pad added to `lateralMax`) |
| `retentionRangeUnits` | 60 | world units (pad added to `lockRange`) |
| `scorePerDistanceUnit` | 0.04 | per world unit (scoring: `abs(angleDeg) + distance × scorePerDistanceUnit`) |
| `stealMarginFraction` | 0.25 | fraction (a rival must score this much better to steal the lock) |
| `commitMs` | 400 | ms (minimum time on a target before it may be stolen) |
| `lockTimeoutMs` | 800 | ms (how long after the last fire press the lock keeps incumbency) |
| `losGraceMs` | 300 | ms (how long a target may be out of sight before the lock releases) |

`commitMs`, `lockTimeoutMs`, and `losGraceMs` are authored in milliseconds and converted once, at
shared's module load, into the frozen `AIM_TICKS` (`commit` / `lockTimeout` / `losGrace`) the sim
actually reads — the same pattern as `WEAPON_TICKS` above.

`lockRange` is deliberately its own number, not borrowed from a weapon's `range` (A3):
`weapon-config.test.ts` asserts every aim-assist weapon's `range` is at least `lockRange`, and
separately asserts every aim-assist weapon's sustained fire rate sits outside a ±15% band around the
`1000 / lockTimeoutMs` cliff — see `combat-model.md` for what that cliff means.

Nothing in `AIM_CONFIG` decides whether you can *see* the lock. The bracket is drawn by the client
alone, from `PlayerState.lockTargetSessionId` on the wire, and `SHOW_LOCK_BRACKET` in the client's
`scenes/combat-visual.ts` (default `true`) is the source switch that suppresses that draw. It is a
render flag with no sim effect whatsoever — with it `false` the server acquires, holds, steals, and
fires at the same targets, and the field still ships on every patch. Turning aim assist *off* is a
different knob entirely: `usesAimAssist` per weapon in `WEAPON_TABLE`.

## COMBAT_CONFIG

| Knob | Value |
|---|---|
| `hpPerRating` | 10 |
| `attackBaseline` | 50 (the `attack` rating `damageFor` treats as an average chassis) |
| `damagePerAttack` | 0.01 (fractional damage change per point of `attack` away from `attackBaseline`; see [`combat-model.md`](combat-model.md#damage)) |

## DRIVE_CONFIG

| Knob | Value |
|---|---|
| `baseMaxSpeed` | 180 |
| `speedPerRating` | 4.5 |
| `accel` | 780 |
| `brakeDecel` | 1600 (must stay above `drag`) |
| `drag` | 900 (throttle released) |
| `turnRate` | 4.2 |
| `turnRateAtStop` | 2.1 |
| `reverseSpeedRatio` | 0.65 |
| `reverseAccel` | 1100 (reverse has its own rate; does not borrow `accel`) |
| `reverseHoldTicks` | 2 (66ms at `TICK_RATE_HZ` 30) |
| `stopEpsilon` | 1e-3 (below this \|speed\| the car counts as stopped) |
| `carWidth` | 48 |
| `carHeight` | 32 |
| `restitution` | 0.35 |

Resulting top speeds, `baseMaxSpeed + speed rating × speedPerRating`:

| Car | Forward | Reverse |
|---|---|---|
| rectangle (80) | 540 | 351 |
| oval (50) | 405 | 263 |
| hexagon (30) | 315 | 205 |

Quoted for the fastest chassis: 0.69s to top speed, 0.60s to coast to rest, 0.34s to brake to rest,
0.32s to reach the reverse cap, 129 world units of turn radius.

**These knobs are coupled.** Turn radius is `speed / turnRate` and time-to-top-speed is
`maxSpeed / accel`, so raising the two speed knobs without raising `turnRate` and `accel` makes a
faster car feel *less* agile. `brakeDecel` must exceed `drag` or the brake button is pointless, and
`CAMERA_CONFIG.freeRoamSpeed` must exceed the fastest car — both are asserted in `config.test.ts`.
`baseMaxSpeed` and `speedPerRating` scale together on purpose: their ratio decides how much the
per-car `speed` rating matters, so moving only one re-balances the roster.

## CAMERA_CONFIG

Render knobs only — nothing in `stepSim` reads them.

| Knob | Value |
|---|---|
| `camLerp` | 0.18 (fraction of remaining distance closed per **60 Hz frame**, rescaled to the real frame time by `smoothFollow`) |
| `zoom` | 1 (above 1 = zoomed in; keep within 1–2 so the 2x car textures stay sharp) |
| `freeRoamSpeed` | 1050 (spectator free-look pan, world units per **second**; must exceed the fastest car) |

`camLerp` is per *reference* frame, not per rendered frame. Applied flat per frame it would close the
gap 2.4x faster at 144 Hz than at 60 Hz, settling into a trailing offset of `speed / (fps × camLerp)`
— 75 world units of lag at 60 Hz against 31 at 144, so the slower display would see meaningfully less
road ahead. `smoothFollow` compounds it per elapsed millisecond instead, matching `panFreeCam`.

At `zoom` 1 the visible world is the full 1280x720 units, so the fastest car crosses it in 2.4
seconds and the camera's trailing offset is 12% of the half-view.

## FLOW_CONFIG

| Knob | Value |
|---|---|
| `carSelectSeconds` | 60 |
| `countdownSeconds` | 3 |
| `nameMin` | 1 |
| `nameMax` | 16 |

## NET_CONFIG

| Knob | Value |
|---|---|
| `pendingInputCap` | 24 |
| `reconcileSnapPos` | 24 |
| `reconcileSnapAngle` | 0.6 |
| `reconcileEaseRate` | 0.25 |
| `interpolationDelayMs` | 50 |

## Arena selection

`ACTIVE_ARENA_ID` in `packages/shared/src/config/arena-config.ts` names the one arena a build plays
and ships. Changing arenas is that single edit:

1. Set `ACTIVE_ARENA_ID` to a key of `ARENAS` in `packages/shared/src/arena/registry.ts`.
2. Rebuild shared — `npm run build -w @motor-combat-moba/shared`, or just restart `npm run dev`.

A value that is not a registered id fails `arena.test.ts`, so a typo breaks the build rather than a
live room. `ArenaState.arenaId` defaults to this constant, which is how the server tells clients
which arena to draw.

To add an arena: write `packages/shared/src/arena/arena-0N.ts`, add one row to `ARENAS`, and export
it from `packages/shared/src/index.ts`. `arena.test.ts` validates every registered arena against the
clearance and spawn rules automatically — no test to write.

## Arena registry

`ARENAS` in `packages/shared/src/arena/registry.ts` currently holds two entries. `arena.test.ts`
checks every registered arena by rule — bounds, obstacle clearance, corridor width, spawn counts,
spawn placement — rather than by pinned values, so the table below is orientation, not a spec to
keep hand-in-sync as more arenas land.

| id | width × height | obstacles | palette |
|---|---|---|---|
| `arena-01` | 1280 × 720 | 0 | none — uses the client's default palette |
| `arena-02` | 2000 × 2000 | 6 | `#d8cfc4` floor / `#6b5b4b` obstacle / `#2f2a26` border |

`arena-01` is one open rectangle with nothing in it, sized to the client's logical canvas so that at
`CAMERA_CONFIG.zoom` of 1 the camera shows the whole of it and never scrolls. Rescaling it without
rescaling the zoom to match breaks that, and `arena-camera.test.ts` on the client is what fails.
Its 6 `ffaSpawns` are the four corners and the midpoint of each long wall, all 160 units off the
wall; corner cars face across the arena and the two midpoint cars face each other. Its 3
`teamASpawns` sit at `x=160` facing `0` and its 3 `teamBSpawns` at `x=1120` facing `π`, at
`y=180/360/540` — quarters of the height, so the gap between team-mates equals the gap to the wall.
`arena-02` ("Crossroads") is a square arena built around one central plus-shaped mass with four
corner bunkers, and is the registry's example of an arena too large to fit the view: it keeps the
follow camera and spectator free roam that `arena-01` no longer needs.

`getArena(id)` throws on an unknown id; it exists for the server's sim path, where an unresolvable
arena is a programming error with no sane fallback. The client checks `isArenaId` first and shows a
mismatch message instead of calling it.
