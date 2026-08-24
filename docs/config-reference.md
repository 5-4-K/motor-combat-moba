# Config reference

Balance tables live in `@motor-arena/shared`. Env knobs override process settings only.

## Env knobs

| Knob | Where | Default |
|---|---|---|
| `DEPLOY_MODE` | server `mode.ts` | `lan` (`cloud` is CORS-only; no hosting) |
| `PORT` | server `mode.ts` | `2567` |
| `TICK_RATE_HZ` | env override of shared constant | shared `30` |
| `SIM_LATENCY_MS` | latency injector | `0` |
| `SIM_JITTER_MS` | latency injector | `0` |
| `CLIENT_ORIGIN` | server CORS (Vite) | unset; `npm run dev` sets `http://localhost:5173` |

Canonical sim rate is `TICK_RATE_HZ` in `@motor-arena/shared`. Patch rate is `DEFAULT_PATCH_RATE_HZ` (20), not an env knob.

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
| `baseMaxSpeed` | 120 |
| `speedPerRating` | 30 |
| `accel` | 520 |
| `brakeDecel` | 780 |
| `drag` | 140 |
| `turnRate` | 2.8 |
| `turnRateAtStop` | 1.4 |
| `reverseSpeedRatio` | 0.5 |
| `reverseHoldTicks` | 6 |
| `carWidth` | 48 |
| `carHeight` | 32 |
| `restitution` | 0.35 |

## CAMERA_CONFIG

Render knobs only — nothing in `stepSim` reads them.

| Knob | Value |
|---|---|
| `camLerp` | 0.12 (fraction of remaining distance closed per **frame**) |
| `zoom` | 0.85 (below 1 = zoomed out) |
| `freeRoamSpeed` | 700 (spectator free-look pan, world units per **second**) |

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

## ARENA_01

`DEFAULT_ARENA_ID` = `"arena-01"`. `getArena(id)` throws if unknown.

| Knob | Value |
|---|---|
| `id` | `arena-01` |
| `width` × `height` | 2400 × 1600 |
| `obstacles` | 6 AABBs: (500,350,220×80), (1680,350,220×80), (500,1170,220×80), (1680,1170,220×80), (1080,620,240×360), (200,720,80×160) |
| `ffaSpawns` | 6: corners + mid-top / mid-bottom |
| `teamASpawns` | 3 on the left (`x=220`, angles `0`) |
| `teamBSpawns` | 3 on the right (`x=2180`, angles `π`) |
