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

| id | name | speed | strength | hp |
|---|---|---|---|---|
| `rectangle` | Rectangle | 8 | 3 | 5 |
| `oval` | Oval | 5 | 8 | 3 |
| `hexagon` | Hexagon | 3 | 5 | 8 |

Derived: `hpOf` = hp × `COMBAT_CONFIG.hpPerRating` (50 / 30 / 80). `forwardMaxSpeedOf` = `baseMaxSpeed` + speed × `speedPerRating`. `reverseMaxSpeedOf` = forward × `reverseSpeedRatio`.

## COLOR_TABLE

| colorId | name | hex |
|---|---|---|
| 0 | Crimson | `#E74C3C` |
| 1 | Azure | `#3498DB` |
| 2 | Emerald | `#2ECC71` |
| 3 | Gold | `#F1C40F` |
| 4 | Violet | `#9B59B6` |
| 5 | Orange | `#E67E22` |

## WEAPON_CONFIG

| Knob | Value |
|---|---|
| `damage` | 8 |
| `fireRateHz` | 2 |
| `projectileSpeed` | 900 |
| `lifetimeTicks` | 30 |

## COMBAT_CONFIG

| Knob | Value |
|---|---|
| `hpPerRating` | 10 |
| `collisionDamagePerStrength` | 1 |
| `ramDotThreshold` | 0.5 |
| `collisionDamageCooldownTicks` | 15 |
| `ramContactPad` | 1 (hull inflation for ram contact; see [`combat-model.md`](combat-model.md)) |

## DRIVE_CONFIG

| Knob | Value |
|---|---|
| `baseMaxSpeed` | 180 |
| `speedPerRating` | 45 |
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
| rectangle (8) | 540 | 351 |
| oval (5) | 405 | 263 |
| hexagon (3) | 315 | 205 |

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
| `arena-01` | 2400 × 1600 | 6 | none — uses the client's default palette |
| `arena-02` | 2000 × 2000 | 6 | `#d8cfc4` floor / `#6b5b4b` obstacle / `#2f2a26` border |

`arena-01`: 6 `ffaSpawns` (corners + mid-top / mid-bottom), 3 `teamASpawns` on the left (`x=220`,
angle `0`), 3 `teamBSpawns` on the right (`x=2180`, angle `π`). `arena-02` ("Crossroads") is a
square arena built around one central plus-shaped mass with four corner bunkers — deliberately a
different shape from `arena-01`, not a rearrangement of it.

`getArena(id)` throws on an unknown id; it exists for the server's sim path, where an unresolvable
arena is a programming error with no sane fallback. The client checks `isArenaId` first and shows a
mismatch message instead of calling it.
